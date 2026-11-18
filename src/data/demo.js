// Demo backend: the same interface as api.js, kept entirely on this device so the portal can be tried without a
// server. Nothing here is shown to other users, and the UI labels these times "Demo", never "Verified".
// Passwords are still handled properly (PBKDF2-SHA256, 600k iterations, salted, constant-time compare, lockout).

import { isOsmId, cleanText } from '../core/validate.js';

const ITER = 600000;
const b64 = (u8) => btoa(String.fromCharCode(...u8));
async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
}
function same(a, b) { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a[i] | 0) ^ (b[i] | 0); return d === 0; }

export function demoBackend({ store }) {
  const users = () => { const u = store.get('demo:users', {}); return u && typeof u === 'object' && !Array.isArray(u) ? u : {}; };
  const s0 = store.get('demo:session');
  let session = s0 && typeof s0.email === 'string' && users()[s0.email] ? { id: s0.email, email: s0.email } : null; // must match a real account

  return {
    mode: 'demo',
    user: () => session,

    async times(ids) {
      const all = store.get('demo:times', {});
      return Object.fromEntries(ids.filter((i) => all[i]).map((i) => [i, { ...all[i], verified: false, demo: true }]));
    },

    async signUp(email, password) {
      const u = users();
      if (u[email]) throw new Error('An account with this email already exists on this device. Sign in instead.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      u[email] = { salt: b64(salt), hash: b64(await derive(password, salt)), fails: 0, lockUntil: 0 };
      store.set('demo:users', u);
      session = { id: email, email };
      store.set('demo:session', session, 7 * 24 * 3600e3);
      return { signedIn: true };
    },

    async signIn(email, password) {
      const u = users(), rec = u[email];
      if (rec?.lockUntil > Date.now()) throw new Error(`Too many attempts. Try again in ${Math.ceil((rec.lockUntil - Date.now()) / 60000)} min.`);
      const salt = rec ? Uint8Array.from(atob(rec.salt), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
      const got = await derive(password, salt); // always derive, so a missing account takes as long as a wrong password
      const ok = !!rec && same(got, Uint8Array.from(atob(rec.hash), (c) => c.charCodeAt(0)));
      if (!ok) {
        if (rec) { rec.fails += 1; if (rec.fails >= 5) { rec.lockUntil = Date.now() + 5 * 60e3 * 2 ** Math.min(4, rec.fails - 5); } store.set('demo:users', u); }
        throw new Error('That email and password do not match.');
      }
      rec.fails = 0; rec.lockUntil = 0; store.set('demo:users', u);
      session = { id: email, email };
      store.set('demo:session', session, 7 * 24 * 3600e3);
      return session;
    },
    async signOut() { session = null; store.del('demo:session'); },
    async resetPassword() { throw new Error('Password reset needs the live backend.'); },

    async myMasjids() {
      const list = store.get(`demo:claims:${session?.email}`, []);
      return (Array.isArray(list) ? list : []).filter((c) => c && isOsmId(c.osm_id)).map((c) => ({ osm_id: c.osm_id, masjid_name: cleanText(c.masjid_name, 80), status: c.status === 'approved' ? 'approved' : 'pending', created_at: c.created_at }));
    },
    async claim(osmId, name) {
      const k = `demo:claims:${session.email}`, list = store.get(k, []);
      if (!list.some((c) => c.osm_id === osmId)) list.unshift({ osm_id: osmId, masjid_name: name, status: 'approved', created_at: new Date().toISOString() });
      store.set(k, list);
    },
    async saveTimes(osmId, t) {
      const all = store.get('demo:times', {});
      all[osmId] = { fajr: t.fajr, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha, jumuah: t.jumuah || '', updatedAt: new Date().toISOString() };
      store.set('demo:times', all);
    },
  };
}
