// Live backend: the Qarīb API (Cloudflare Worker + D1, see api/). Same interface as demo.js, plus masjid search,
// usage events and the owner dashboard. The server decides every permission; this file only talks to it.
import { fetchJSON, NetError } from '../core/net.js';
import { isOsmId } from '../core/validate.js';

const ITER = 600000;
/** The phone does the slow part: PBKDF2-SHA256 × 600k, salted with the email. Only this derived key is sent. */
export async function clientKey(email, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`qarib-v1|${email}`), iterations: ITER }, base, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function apiBackend({ url, store }) {
  const base = url.replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) throw new Error('apiUrl must be an https origin, e.g. https://qarib-api.example.workers.dev');
  const s0 = store.get('session');
  let session = s0 && /^[A-Za-z0-9_-]{43}$/.test(s0.token) && typeof s0.user?.email === 'string' && s0.expiresAt * 1000 > Date.now() ? s0 : null;

  const save = (s) => {
    session = s?.token ? { token: s.token, expiresAt: s.expiresAt, user: { email: s.user.email, isOwner: !!s.user.isOwner } } : null;
    session ? store.set('session', session, Math.max(0, session.expiresAt * 1000 - Date.now())) : store.del('session');
  };
  async function call(path, { method = 'GET', body, auth = false } = {}) {
    if (auth && !session) throw new NetError('Please sign in.', { status: 401, code: 'signed_out' });
    try {
      return await fetchJSON(base + path, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${session.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { if (e.status === 401 && auth) save(null); throw e; }
  }

  return {
    mode: 'live',
    user: () => session?.user || null,

    async masjids({ lat, lng }) {
      const r = await call(`/v1/masjids?lat=${lat}&lng=${lng}`);
      return Array.isArray(r?.masjids) ? r.masjids : [];
    },
    async times(ids) {
      const ok = ids.filter(isOsmId);
      if (!ok.length) return {};
      const r = await call(`/v1/times?ids=${ok.map(encodeURIComponent).join(',')}`);
      const out = {};
      for (const [id, t] of Object.entries(r?.times || {})) out[id] = { ...t, verified: true };
      return out;
    },

    async signUp(email, password) { save(await call('/v1/signup', { method: 'POST', body: { email, key: await clientKey(email, password) } })); return { signedIn: true }; },
    async signIn(email, password) { save(await call('/v1/login', { method: 'POST', body: { email, key: await clientKey(email, password) } })); return session.user; },
    async signOut() { const had = session; if (had) await call('/v1/logout', { method: 'POST', auth: true }).catch(() => {}); save(null); },
    async resetPassword() { throw new Error('Ask the app owner to reset your account.'); },

    async myMasjids() { return (await call('/v1/my/masjids', { auth: true }))?.masjids || []; },
    async claim(osmId, name) { await call('/v1/claims', { method: 'POST', auth: true, body: { osm_id: osmId, masjid_name: String(name).slice(0, 80) } }); },
    async saveTimes(osmId, t) {
      if (!isOsmId(osmId)) throw new Error('bad masjid id');
      await call(`/v1/times/${osmId}`, { method: 'PUT', auth: true, body: { fajr: t.fajr, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha, jumuah: t.jumuah || '' } });
    },

    // owner only (the server checks)
    stats: () => call('/v1/admin/stats', { auth: true }),
    pendingClaims: async () => (await call('/v1/admin/claims', { auth: true }))?.claims || [],
    decideClaim: (userId, osmId, status) => call('/v1/admin/claims', { method: 'POST', auth: true, body: { user_id: userId, osm_id: osmId, status } }),

    /** Anonymous usage counts. Fire-and-forget; keepalive lets it finish while the app closes. */
    sendEvents(install, events) {
      return fetch(`${base}/v1/events`, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ install, events }) }).catch(() => {});
    },
  };
}
