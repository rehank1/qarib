// Qarīb API: a Cloudflare Worker (free plan) in front of a D1 database.
//   Public:     GET  /v1/masjids?lat&lng   nearest masjids (OpenStreetMap, cached per ~2 km tile for a week)
//               GET  /v1/times?ids=a,b,c   published jamaat times (edge-cached 60 s)
//               POST /v1/events            anonymous usage counts (opt-out in the app)
//   Authority:  POST /v1/signup · /v1/login · /v1/logout · GET /v1/me · GET /v1/my/masjids
//               POST /v1/claims            ask to manage a masjid (owner approves)
//               PUT  /v1/times/:type/:id   publish jamaat times (approved authorities only; audited; rate-limited)
//   Owner:      GET  /v1/admin/stats · GET /v1/admin/claims · POST /v1/admin/claims
// Passwords: the phone runs PBKDF2-SHA256 × 600,000 and sends only the derived key; the Worker stores
// SHA-256(salt · key · PEPPER). A stolen database alone is useless without the PEPPER secret, and each guess still
// costs 600k rounds. (Workers' free plan allows 10 ms CPU per request: heavy hashing must not run here.)
import { parse, query, buildQuery } from '../../src/features/masjids/overpass.js';
import { isOsmId, isEmail, timesProblems, isLat, isLng, cleanText } from '../../src/core/validate.js';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Math.floor(Date.now() / 1000);
const today = (offsetDays = 0) => new Date(Date.now() - offsetDays * 864e5).toISOString().slice(0, 10);
const KEY_RE = /^[A-Za-z0-9_-]{43}$/; // a 32-byte PBKDF2 output, base64url
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_DAYS = 30;
const TILE = 0.02; // degrees, ~2.2 km

function safeEqual(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

class HttpError extends Error { constructor(status, code, message = '') { super(message || code); this.status = status; this.code = code; } }

function json(data, status = 200, extra = {}) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer', ...extra,
    },
  });
}

function withCors(req, env, res) {
  const origin = req.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = new Response(res.body, res);
  r.headers.set('vary', 'origin');
  if (origin && allowed.includes(origin)) {
    r.headers.set('access-control-allow-origin', origin);
    r.headers.set('access-control-allow-headers', 'authorization, content-type');
    r.headers.set('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    r.headers.set('access-control-max-age', '86400');
  }
  return r;
}

async function readBody(req) {
  if (!(req.headers.get('content-type') || '').startsWith('application/json')) throw new HttpError(415, 'json_only');
  const text = await req.text();
  if (text.length > 4096) throw new HttpError(413, 'too_large');
  try { const v = JSON.parse(text); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  throw new HttpError(400, 'bad_json');
}

/** Fixed-window limiter: true while under `max` hits per `windowSec` for this key. One upsert, no read-then-write race. */
async function under(env, key, max, windowSec) {
  const t = now();
  const row = await env.DB.prepare(`INSERT INTO hits (key, count, reset_at) VALUES (?1, 1, ?2)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
                                   reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
    RETURNING count`).bind(key, t + windowSec, t).first();
  return row.count <= max;
}
const limit = async (env, key, max, windowSec) => { if (!(await under(env, key, max, windowSec))) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again later.'); };

const pepper = (env) => { if (!env.PEPPER || env.PEPPER.length < 32) throw new HttpError(500, 'not_configured'); return env.PEPPER; };
const passHash = (env, salt, key) => sha256(`${salt}|${key}|${pepper(env)}`);

async function newSession(env, user) {
  const token = rand(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), user.id, now() + SESSION_DAYS * 86400).run();
  return { token, expiresAt: now() + SESSION_DAYS * 86400, user: { email: user.email, isOwner: !!user.is_owner } };
}

async function auth(req, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get('authorization') || '');
  if (!m) throw new HttpError(401, 'signed_out', 'Please sign in.');
  const u = await env.DB.prepare('SELECT u.id, u.email, u.is_owner FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(await sha256(m[1]), now()).first();
  if (!u) throw new HttpError(401, 'signed_out', 'Please sign in again.');
  return u;
}
const owner = async (req, env) => { const u = await auth(req, env); if (!u.is_owner) throw new HttpError(403, 'forbidden'); return u; };

// ---------- masjid search through a shared cache ----------
async function overpassFetch(url, { timeout = 25000, signal, ...init } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { ...init.headers, 'user-agent': 'Qarib/1.0 (free charitable masjid finder)' } });
    if (!r.ok) throw Object.assign(new Error(`http ${r.status}`), { status: r.status });
    return await r.json();
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error('network'), { code: e.name === 'AbortError' ? 'timeout' : 'network' });
  } finally { clearTimeout(t); }
}

async function masjids(req, env, url, deps) {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!isLat(lat) || !isLng(lng)) throw new HttpError(400, 'bad_location');
  await limit(env, `mq:${ip(req)}`, 120, 3600);
  const tile = `${Math.floor(lat / TILE)}:${Math.floor(lng / TILE)}`;
  const cached = await env.DB.prepare('SELECT body, fetched_at FROM masjid_tiles WHERE tile = ?').bind(tile).first();
  if (cached && cached.fetched_at > now() - 7 * 86400) return json({ masjids: JSON.parse(cached.body), cached: true }, 200, { 'cache-control': 'public, max-age=3600' });

  const center = { lat: (Math.floor(lat / TILE) + 0.5) * TILE, lng: (Math.floor(lng / TILE) + 0.5) * TILE };
  let list = [];
  try {
    for (const r of [3000, 8000, 20000]) {
      list = parse(await query(buildQuery(center, r), deps.fetcher || overpassFetch), center, 80).map(({ km, ...m }) => m);
      if (list.length >= 8) break;
    }
  } catch (e) {
    if (cached) return json({ masjids: JSON.parse(cached.body), cached: true, stale: true }); // better old than nothing
    throw new HttpError(503, 'busy', 'The map service is busy right now. Try again in a minute.');
  }
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO masjid_tiles (tile, body, fetched_at) VALUES (?, ?, ?)').bind(tile, JSON.stringify(list), now()),
    ...list.map((m) => env.DB.prepare('INSERT OR REPLACE INTO masjids (osm_id, name, lat, lng) VALUES (?, ?, ?, ?)').bind(m.id, m.name, m.lat, m.lng)),
  ]);
  return json({ masjids: list, cached: false }, 200, { 'cache-control': 'public, max-age=3600' });
}

// ---------- jamaat times ----------
const iso = (s) => new Date(s * 1000).toISOString();
async function getTimes(req, env, url, ctx) {
  const ids = [...new Set(String(url.searchParams.get('ids') || '').split(','))].filter(isOsmId).sort().slice(0, 12);
  if (!ids.length) return json({ times: {} });
  const cache = globalThis.caches?.default;
  const key = new Request(`https://qarib-cache/times?ids=${ids.join(',')}`);
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  const { results } = await env.DB.prepare(`SELECT osm_id, fajr, dhuhr, asr, maghrib, isha, jumuah, updated_at FROM prayer_times WHERE osm_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const times = Object.fromEntries(results.map((r) => [r.osm_id, { fajr: r.fajr, dhuhr: r.dhuhr, asr: r.asr, maghrib: r.maghrib, isha: r.isha, jumuah: r.jumuah || '', updatedAt: iso(r.updated_at) }]));
  const res = json({ times }, 200, { 'cache-control': 'public, max-age=60' }); // updated_by is never sent
  if (cache) ctx?.waitUntil?.(cache.put(key, res.clone()));
  return res;
}

async function putTimes(req, env, osmId) {
  const u = await auth(req, env);
  if (!isOsmId(osmId)) throw new HttpError(400, 'bad_masjid');
  const ok = await env.DB.prepare("SELECT 1 FROM masjid_admins WHERE user_id = ? AND osm_id = ? AND status = 'approved'").bind(u.id, osmId).first();
  if (!ok) throw new HttpError(403, 'not_approved', 'You are not approved to manage this masjid.');
  const b = await readBody(req);
  const t = { fajr: b.fajr, dhuhr: b.dhuhr, asr: b.asr, maghrib: b.maghrib, isha: b.isha, jumuah: b.jumuah || '' };
  const problems = timesProblems(t);
  if (problems.length) throw new HttpError(400, 'bad_times', problems.join(' '));
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM prayer_times_history WHERE changed_by = ? AND changed_at > ?').bind(u.id, now() - 3600).first();
  if (recent.n >= 30) throw new HttpError(429, 'rate_limited', 'Too many changes in the last hour. Try again later.');
  const t0 = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha, jumuah, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(osm_id) DO UPDATE SET fajr = excluded.fajr, dhuhr = excluded.dhuhr, asr = excluded.asr, maghrib = excluded.maghrib, isha = excluded.isha,
        jumuah = excluded.jumuah, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(osmId, t.fajr, t.dhuhr, t.asr, t.maghrib, t.isha, t.jumuah || null, u.id, t0),
    env.DB.prepare('INSERT INTO prayer_times_history (osm_id, times, changed_by, changed_at) VALUES (?, ?, ?, ?)').bind(osmId, JSON.stringify(t), u.id, t0),
  ]);
  return json({ ok: true, updatedAt: iso(t0) });
}

// ---------- accounts ----------
async function signup(req, env) {
  await limit(env, `su:${ip(req)}`, 5, 3600);
  const b = await readBody(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!isEmail(email) || !KEY_RE.test(String(b.key))) throw new HttpError(400, 'bad_input');
  const salt = rand(16);
  const res = await env.DB.prepare('INSERT OR IGNORE INTO users (email, salt, hash, created_at) VALUES (?, ?, ?, ?)').bind(email, salt, await passHash(env, salt, b.key), now()).run();
  if (!res.meta?.changes) throw new HttpError(409, 'exists', 'Could not create that account. If you already have one, sign in.');
  const user = await env.DB.prepare('SELECT id, email, is_owner FROM users WHERE email = ?').bind(email).first();
  return json(await newSession(env, user), 201);
}

async function login(req, env) {
  await limit(env, `li:${ip(req)}`, 30, 900);
  const b = await readBody(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!isEmail(email) || !KEY_RE.test(String(b.key))) throw new HttpError(400, 'bad_input');
  const u = await env.DB.prepare('SELECT id, email, salt, hash, is_owner, failed, lock_until FROM users WHERE email = ?').bind(email).first();
  if (u && u.lock_until > now()) throw new HttpError(429, 'locked', `Too many attempts. Try again in ${Math.ceil((u.lock_until - now()) / 60)} min.`);
  const got = await passHash(env, u?.salt || 'no-such-user', b.key); // same work whether or not the account exists
  if (!u || !safeEqual(got, u.hash)) {
    if (u) {
      const failed = u.failed + 1;
      const lock = failed >= 5 ? now() + 300 * 2 ** Math.min(4, failed - 5) : 0;
      await env.DB.prepare('UPDATE users SET failed = ?, lock_until = ? WHERE id = ?').bind(failed, lock, u.id).run();
    }
    throw new HttpError(401, 'bad_login', 'That email and password do not match.');
  }
  await env.DB.prepare('UPDATE users SET failed = 0, lock_until = 0 WHERE id = ?').bind(u.id).run();
  return json(await newSession(env, u));
}

async function logout(req, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get('authorization') || '');
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
  return json(null, 204);
}

async function claim(req, env) {
  const u = await auth(req, env);
  await limit(env, `cl:${u.id}`, 10, 3600);
  const b = await readBody(req);
  const name = cleanText(b.masjid_name, 80);
  if (!isOsmId(b.osm_id) || !name) throw new HttpError(400, 'bad_input');
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM masjid_admins WHERE user_id = ? AND status = 'pending'").bind(u.id).first();
  if (pending.n >= 5) throw new HttpError(429, 'too_many_pending', 'Too many pending requests. Wait for approval first.');
  const res = await env.DB.prepare('INSERT OR IGNORE INTO masjid_admins (user_id, osm_id, masjid_name, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(u.id, b.osm_id, name, u.is_owner ? 'approved' : 'pending', now()).run();
  if (!res.meta?.changes) throw new HttpError(409, 'duplicate', 'You already asked for this masjid.');
  return json({ ok: true }, 201);
}

// ---------- anonymous metrics ----------
const KINDS = new Set(['open', 'view', 'directions']);
async function events(req, env) {
  await limit(env, `ev:${ip(req)}`, 60, 3600);
  const b = await readBody(req);
  if (!UUID_RE.test(String(b.install))) throw new HttpError(400, 'bad_input');
  const d = today();
  const stmts = [env.DB.prepare('INSERT OR IGNORE INTO actives (day, id) VALUES (?, ?)').bind(d, (await sha256(`${d}|${b.install}|${pepper(env)}`)).slice(0, 22))];
  for (const e of (Array.isArray(b.events) ? b.events : []).slice(0, 20)) {
    if (!e || !KINDS.has(e.k)) continue;
    const key = e.k === 'open' ? '' : isOsmId(e.id) ? e.id : null;
    if (key === null) continue;
    stmts.push(env.DB.prepare('INSERT INTO metrics (day, kind, key, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET count = count + 1').bind(d, e.k, key));
  }
  await env.DB.batch(stmts);
  return json(null, 204);
}

async function stats(req, env) {
  await owner(req, env);
  const since = today(13), week = today(6);
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const [act, opens, top, totals, todayRows] = await env.DB.batch([
    q('SELECT day, COUNT(*) AS n FROM actives WHERE day >= ? GROUP BY day ORDER BY day', since),
    q("SELECT day, count AS n FROM metrics WHERE kind = 'open' AND day >= ? ORDER BY day", since),
    q(`SELECT m.key AS osm_id, COALESCE(x.name, m.key) AS name, SUM(CASE WHEN m.kind = 'directions' THEN m.count ELSE 0 END) AS directions,
       SUM(CASE WHEN m.kind = 'view' THEN m.count ELSE 0 END) AS views
       FROM metrics m LEFT JOIN masjids x ON x.osm_id = m.key WHERE m.kind IN ('view', 'directions') AND m.day >= ?
       GROUP BY m.key ORDER BY directions DESC, views DESC LIMIT 10`, week),
    q(`SELECT (SELECT COUNT(*) FROM users WHERE is_owner = 0) AS authorities,
              (SELECT COUNT(*) FROM masjid_admins WHERE status = 'pending') AS pending,
              (SELECT COUNT(*) FROM prayer_times) AS published,
              (SELECT COUNT(*) FROM prayer_times_history WHERE changed_at > ?) AS updates7d`, now() - 7 * 86400),
    q("SELECT kind, SUM(count) AS n FROM metrics WHERE day = ? GROUP BY kind", today()),
  ]);
  const t = Object.fromEntries(todayRows.results.map((r) => [r.kind, r.n]));
  return json({
    generatedAt: new Date().toISOString(),
    today: { active: act.results.find((r) => r.day === today())?.n || 0, opens: t.open || 0, views: t.view || 0, directions: t.directions || 0 },
    activeByDay: act.results, opensByDay: opens.results, topMasjids: top.results, totals: totals.results[0],
  });
}

async function claims(req, env) {
  await owner(req, env);
  if (req.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT a.user_id, u.email, a.osm_id, a.masjid_name, a.created_at FROM masjid_admins a JOIN users u ON u.id = a.user_id WHERE a.status = 'pending' ORDER BY a.created_at LIMIT 50").all();
    return json({ claims: results.map((r) => ({ ...r, created_at: iso(r.created_at) })) });
  }
  const b = await readBody(req);
  if (!Number.isInteger(b.user_id) || !isOsmId(b.osm_id) || !['approved', 'rejected'].includes(b.status)) throw new HttpError(400, 'bad_input');
  const res = await env.DB.prepare('UPDATE masjid_admins SET status = ? WHERE user_id = ? AND osm_id = ?').bind(b.status, b.user_id, b.osm_id).run();
  if (!res.meta?.changes) throw new HttpError(404, 'not_found');
  return json({ ok: true });
}

// ---------- router ----------
const ip = (req) => req.headers.get('cf-connecting-ip') || 'local';

export async function handle(req, env, ctx, deps = {}) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return withCors(req, env, json(null, 204));
  try {
    const p = url.pathname, m = req.method;
    let res;
    if (m === 'GET' && p === '/v1/masjids') res = await masjids(req, env, url, deps);
    else if (m === 'GET' && p === '/v1/times') res = await getTimes(req, env, url, ctx);
    else if (m === 'PUT' && p.startsWith('/v1/times/')) res = await putTimes(req, env, decodeURIComponent(p.slice('/v1/times/'.length)));
    else if (m === 'POST' && p === '/v1/signup') res = await signup(req, env);
    else if (m === 'POST' && p === '/v1/login') res = await login(req, env);
    else if (m === 'POST' && p === '/v1/logout') res = await logout(req, env);
    else if (m === 'GET' && p === '/v1/me') { const u = await auth(req, env); res = json({ email: u.email, isOwner: !!u.is_owner }); }
    else if (m === 'GET' && p === '/v1/my/masjids') {
      const u = await auth(req, env);
      const { results } = await env.DB.prepare('SELECT osm_id, masjid_name, status, created_at FROM masjid_admins WHERE user_id = ? ORDER BY created_at DESC').bind(u.id).all();
      res = json({ masjids: results.map((r) => ({ ...r, created_at: iso(r.created_at) })) });
    } else if (m === 'POST' && p === '/v1/claims') res = await claim(req, env);
    else if (m === 'POST' && p === '/v1/events') res = await events(req, env);
    else if (m === 'GET' && p === '/v1/admin/stats') res = await stats(req, env);
    else if ((m === 'GET' || m === 'POST') && p === '/v1/admin/claims') res = await claims(req, env);
    else if (m === 'GET' && p === '/') res = json({ service: 'qarib-api', ok: true });
    else res = json({ error: 'not_found' }, 404);
    return withCors(req, env, res);
  } catch (e) {
    if (e instanceof HttpError) return withCors(req, env, json({ error: e.code, message: e.message }, e.status));
    console.error(e); // details stay in the Cloudflare logs, never in the response
    return withCors(req, env, json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500));
  }
}

export async function housekeeping(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM hits WHERE reset_at < ?').bind(t),
    env.DB.prepare('DELETE FROM actives WHERE day < ?').bind(today(30)),
    env.DB.prepare('DELETE FROM metrics WHERE day < ?').bind(today(90)),
    env.DB.prepare('DELETE FROM masjid_tiles WHERE fetched_at < ?').bind(t - 30 * 86400),
  ]);
}

export default {
  fetch: (req, env, ctx) => handle(req, env, ctx),
  scheduled: (_event, env, ctx) => ctx.waitUntil(housekeeping(env)),
};
