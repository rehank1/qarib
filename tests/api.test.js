// API tests: the real Worker code against a real SQLite database (D1 is SQLite), no network. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle, housekeeping } from '../api/src/index.js';

const SCHEMA = readFileSync(new URL('../api/schema.sql', import.meta.url), 'utf8');

/** Minimal D1 binding over node:sqlite: prepare/bind/first/all/run and atomic batch. */
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const returnsRows = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    exec: () => (returnsRows(sql) ? { results: db.prepare(sql).all(...args) } : { results: [], meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { const out = list.map((s) => s.exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'); // stands in for the phone's PBKDF2 output
function setup() {
  const DB = d1();
  const env = { DB, PEPPER: 'test-pepper-0123456789-abcdefghijklmnop', ALLOWED_ORIGINS: 'https://localhost' };
  let ipN = 0;
  const call = async (method, path, { body, token, origin, ip, raw, contentType } = {}) => {
    const headers = { 'cf-connecting-ip': ip || `10.0.0.${++ipN % 250}` };
    if (body !== undefined || raw !== undefined) headers['content-type'] = contentType || 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (origin) headers.origin = origin;
    const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }), env, {}, setup.deps);
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
  };
  return { env, DB, call };
}

async function account(call, email = 'imam@masjid.org') {
  const k = key();
  const r = await call('POST', '/v1/signup', { body: { email, key: k } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { k, token: r.json.token, email };
}

test('signup returns a session; the password key is never stored as sent', async () => {
  const { call, DB } = setup();
  const { k, token } = await account(call);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const row = DB.raw.prepare('SELECT * FROM users').get();
  assert.ok(!JSON.stringify(row).includes(k));
  assert.ok(!JSON.stringify(DB.raw.prepare('SELECT * FROM sessions').all()).includes(token), 'only the token hash is stored');
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'IMAM@masjid.org', key: key() } })).status, 409, 'emails are case-insensitive and unique');
  assert.equal((await call('POST', '/v1/signup', { body: { email: 'x@y.org', key: 'short' } })).status, 400);
});

test('login: right key works, wrong key locks after 5, unknown email looks the same as a wrong password', async () => {
  const { call } = setup();
  const { k, email } = await account(call);
  assert.equal((await call('POST', '/v1/login', { body: { email, key: k } })).status, 200);
  const unknown = await call('POST', '/v1/login', { body: { email: 'nobody@x.org', key: k } });
  const wrong = await call('POST', '/v1/login', { body: { email, key: key() } });
  assert.equal(unknown.status, 401); assert.equal(wrong.status, 401); assert.equal(unknown.json.message, wrong.json.message);
  for (let i = 0; i < 4; i++) await call('POST', '/v1/login', { body: { email, key: key() } });
  const locked = await call('POST', '/v1/login', { body: { email, key: k } }); // even the right key, while locked
  assert.equal(locked.status, 429); assert.equal(locked.json.error, 'locked');
});

test('per-IP rate limit on signups', async () => {
  const { call } = setup();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call('POST', '/v1/signup', { ip: '1.2.3.4', body: { email: `a${i}@x.org`, key: key() } })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
});

test('authority flow: claim → refused until the owner approves → publish → public read without who-edited', async () => {
  const { call, DB } = setup();
  const imam = await account(call);
  const boss = await account(call, 'owner@qarib.app');
  DB.raw.prepare("UPDATE users SET is_owner = 1 WHERE email = 'owner@qarib.app'").run();
  const times = { fajr: '05:45', dhuhr: '13:30', asr: '16:45', maghrib: '18:02', isha: '20:15', jumuah: '13:45' };

  assert.equal((await call('POST', '/v1/claims', { token: imam.token, body: { osm_id: 'node/101', masjid_name: '<b>Jama</b> Masjid' } })).status, 201);
  assert.equal((await call('POST', '/v1/claims', { token: imam.token, body: { osm_id: 'node/101', masjid_name: 'again' } })).status, 409);
  assert.equal((await call('PUT', '/v1/times/node/101', { token: imam.token, body: times })).status, 403, 'pending cannot publish');

  assert.equal((await call('GET', '/v1/admin/claims', { token: imam.token })).status, 403, 'imams cannot approve themselves');
  const pending = await call('GET', '/v1/admin/claims', { token: boss.token });
  assert.equal(pending.json.claims[0].masjid_name, 'Jama Masjid');
  const uid = pending.json.claims[0].user_id;
  assert.equal((await call('POST', '/v1/admin/claims', { token: boss.token, body: { user_id: uid, osm_id: 'node/101', status: 'approved' } })).status, 200);

  assert.equal((await call('PUT', '/v1/times/node/101', { token: imam.token, body: { ...times, asr: '12:00' } })).status, 400, 'out of order');
  assert.equal((await call('PUT', '/v1/times/node/101', { token: imam.token, body: times })).status, 200);
  assert.equal((await call('PUT', '/v1/times/node/202', { token: imam.token, body: times })).status, 403, 'only their own masjid');

  const pub = await call('GET', '/v1/times?ids=node/101,way/9');
  assert.equal(pub.json.times['node/101'].fajr, '05:45');
  assert.ok(!('updated_by' in pub.json.times['node/101']) && !JSON.stringify(pub.json).includes('imam@'));
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM prayer_times_history').get().n, 1, 'audited');
});

test('sessions: forged, expired and signed-out tokens are refused', async () => {
  const { call, DB } = setup();
  const { token } = await account(call);
  assert.equal((await call('GET', '/v1/me', { token })).status, 200);
  assert.equal((await call('GET', '/v1/me', { token: key() })).status, 401);
  assert.equal((await call('GET', '/v1/me', { token: 'not a token' })).status, 401);
  await call('POST', '/v1/logout', { token });
  assert.equal((await call('GET', '/v1/me', { token })).status, 401);
  const t2 = (await account(call, 'b@x.org')).token;
  DB.raw.prepare('UPDATE sessions SET expires_at = 1').run();
  assert.equal((await call('GET', '/v1/me', { token: t2 })).status, 401);
});

test('hostile input: SQL-ish ids, oversized and non-JSON bodies, missing secret', async () => {
  const { call, env } = setup();
  const r = await call('GET', "/v1/times?ids=node/1')%20OR%201=1--,node/2");
  assert.equal(r.status, 200); assert.deepEqual(r.json.times, {});
  assert.equal((await call('POST', '/v1/signup', { raw: 'x'.repeat(5000) })).status, 413);
  assert.equal((await call('POST', '/v1/signup', { raw: 'email=a', contentType: 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await call('POST', '/v1/signup', { raw: '[1,2]' })).status, 400);
  assert.equal((await call('GET', '/v1/masjids?lat=999&lng=0')).status, 400);
  delete env.PEPPER;
  const e = await call('POST', '/v1/signup', { body: { email: 'a@b.org', key: key() } });
  assert.equal(e.status, 500); assert.equal(e.json.error, 'not_configured');
});

test('CORS: only listed origins are allowed', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/', { origin: 'https://localhost' })).headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal((await call('GET', '/', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
});

test('anonymous metrics: one active per install per day, counters per masjid, owner-only stats', async () => {
  const { call, DB } = setup();
  const install = crypto.randomUUID();
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/v1/events', { body: { install, events: [{ k: 'open' }, { k: 'directions', id: 'node/101' }, { k: 'view', id: 'node/101' }, { k: 'evil' }, { k: 'view', id: "x'; drop" }] } })).status, 204);
  await call('POST', '/v1/events', { body: { install: crypto.randomUUID(), events: [{ k: 'open' }] } });
  assert.equal((await call('POST', '/v1/events', { body: { install: 'not-a-uuid', events: [] } })).status, 400);
  assert.ok(!JSON.stringify(DB.raw.prepare('SELECT * FROM actives').all()).includes(install), 'install ids are never stored');

  const boss = await account(call, 'owner@qarib.app');
  assert.equal((await call('GET', '/v1/admin/stats', { token: boss.token })).status, 403);
  DB.raw.prepare('UPDATE users SET is_owner = 1').run();
  const s = (await call('GET', '/v1/admin/stats', { token: boss.token })).json;
  assert.deepEqual(s.today, { active: 2, opens: 4, views: 3, directions: 3 });
  assert.equal(s.topMasjids[0].osm_id, 'node/101');
  await housekeeping({ DB });
});

test('masjid search: one OpenStreetMap lookup per tile, then served from the shared cache', async () => {
  const { call } = setup();
  let calls = 0;
  setup.deps = { fetcher: async () => { calls++; return { elements: Array.from({ length: 9 }, (_, i) => ({ type: 'node', id: i + 1, lat: 18.52 + i / 1000, lon: 73.87, tags: { name: `M${i}<script>` } })) }; } };
  const a = await call('GET', '/v1/masjids?lat=18.521&lng=73.871');
  const b = await call('GET', '/v1/masjids?lat=18.5215&lng=73.8715'); // same ~2 km tile
  setup.deps = undefined;
  assert.equal(a.json.masjids.length, 9);
  assert.deepEqual(a.json.masjids.map((m) => m.name).sort(), ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']); // tags stripped; phone re-sorts by its own position
  assert.equal(b.json.cached, true); assert.equal(calls, 1);
});
