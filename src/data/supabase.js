// Live backend: Supabase (Auth + Postgres REST), called with fetch. No SDK: a few KB instead of ~50 KB.
// The database decides every permission (row-level security + the functions in supabase/schema.sql).
import { fetchJSON, NetError } from '../core/net.js';
import { isOsmId, isTime } from '../core/validate.js';

const hhmm = (t) => (typeof t === 'string' ? t.slice(0, 5) : '');
const friendly = (e) => {
  if (/row-level security/i.test(e.message)) e.message = 'You are not approved to manage this masjid yet.';
  if (/invalid login credentials/i.test(e.message)) e.message = 'That email and password do not match.';
  if (/email not confirmed/i.test(e.message)) e.message = 'Please confirm your email first: open the link we sent you, then sign in.';
  if (/JWT expired|invalid JWT/i.test(e.message)) e.status = 401;
  return e;
};

export function supabaseBackend({ url, anonKey, store }) {
  const base = url.replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base)) throw new Error('supabaseUrl must be https://<project>.supabase.co');
  const s0 = store.get('session');
  let session = s0 && typeof s0.access_token === 'string' && typeof s0.refresh_token === 'string' && typeof s0.user?.email === 'string' ? s0 : null;
  let refreshing = null; // one refresh at a time: reusing a refresh token twice can get the session revoked

  const save = (s) => {
    session = s?.access_token ? {
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
      user: { id: s.user?.id || session?.user?.id, email: s.user?.email || session?.user?.email, isOwner: s.user?.isOwner ?? session?.user?.isOwner ?? false },
    } : null;
    session ? store.set('session', session, 60 * 24 * 3600e3) : store.del('session');
  };

  async function token() {
    if (!session) return null;
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    refreshing ||= fetchJSON(`${base}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) })
      .then((s) => { save({ ...s, user: { ...s.user, isOwner: session?.user?.isOwner } }); return session?.access_token || null; })
      .catch((e) => { if (e.status === 400 || e.status === 401) save(null); throw Object.assign(e, { status: 401 }); })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  async function rest(path, { method = 'GET', body, auth = false, prefer, cache } = {}) {
    const bearer = auth ? await token() : null;
    if (auth && !bearer) throw new NetError('Please sign in again.', { status: 401, code: 'signed_out' });
    try {
      return await fetchJSON(`${base}/rest/v1/${path}`, {
        method, ...(cache ? { cache } : {}),
        headers: { apikey: anonKey, authorization: `Bearer ${bearer || anonKey}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { e = friendly(e); if (e.status === 401 && auth) save(null); throw e; }
  }
  const rpc = (fn, args, auth = false) => rest(`rpc/${fn}`, { method: 'POST', body: args, auth });
  const authCall = (path, body) => fetchJSON(`${base}/auth/v1/${path}`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch((e) => { throw friendly(e); });

  return {
    mode: 'live',
    user: () => session?.user || null,

    /** Nearest masjids from the India directory in the database (filled from OpenStreetMap by a scheduled job). */
    async masjids({ lat, lng }) {
      const rows = await rpc('nearest_masjids', { p_lat: lat, p_lng: lng, p_limit: 25 });
      return (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.osm_id, name: r.name, nameAr: r.name_ar || '', address: r.address || '', lat: r.lat, lng: r.lng }));
    },

    /** Published jamaat times → { [osm_id]: { fajr, …, updatedAt } } (anyone may read). */
    async times(ids) {
      const ok = ids.filter(isOsmId);
      if (!ok.length) return {};
      const rows = await rest(`prayer_times?select=osm_id,fajr,dhuhr,asr,maghrib,isha,jumuah,updated_at&osm_id=in.(${ok.map((i) => `"${i}"`).join(',')})`, { cache: 'no-cache' });
      const out = {};
      for (const r of Array.isArray(rows) ? rows : []) {
        const t = { fajr: hhmm(r.fajr), dhuhr: hhmm(r.dhuhr), asr: hhmm(r.asr), maghrib: hhmm(r.maghrib), isha: hhmm(r.isha), jumuah: hhmm(r.jumuah), updatedAt: r.updated_at };
        if (isOsmId(r.osm_id) && ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].every((p) => isTime(t[p]))) out[r.osm_id] = { ...t, verified: true };
      }
      return out;
    },

    async signUp(email, password) {
      const r = await authCall('signup', { email, password });
      if (r?.access_token) { save(r); return { signedIn: true }; }
      return { signedIn: false, confirm: true }; // email confirmation is on: they sign in after clicking the link
    },
    async signIn(email, password) { save(await authCall('token?grant_type=password', { email, password })); await this.refreshUser().catch(() => {}); return session.user; },
    async signOut() {
      const t = session?.access_token;
      save(null);
      if (t) await fetchJSON(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: anonKey, authorization: `Bearer ${t}` } }).catch(() => {});
    },
    async resetPassword() { throw new Error('Ask the app owner to reset your account.'); },

    /** Re-read the role from the database (role changes apply without signing in again). */
    async refreshUser() {
      if (!session) return null;
      const rows = await rest('profiles?select=is_owner', { auth: true });
      save({ ...session, user: { ...session.user, isOwner: !!rows?.[0]?.is_owner } });
      return session?.user || null;
    },
    async myMasjids() {
      const rows = await rest('masjid_admins?select=osm_id,masjid_name,status,created_at&order=created_at.desc', { auth: true });
      return (Array.isArray(rows) ? rows : []).filter((r) => isOsmId(r.osm_id));
    },
    async claim(osmId, name) { if (!isOsmId(osmId)) throw new Error('bad masjid id'); await rpc('request_masjid', { p_osm: osmId, p_name: String(name).slice(0, 80) }, true); },
    async saveTimes(osmId, t) {
      if (!isOsmId(osmId)) throw new Error('bad masjid id');
      await rest('prayer_times?on_conflict=osm_id', { method: 'POST', auth: true, prefer: 'resolution=merge-duplicates,return=minimal',
        body: { osm_id: osmId, fajr: t.fajr, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha, jumuah: t.jumuah || null } });
    },

    // owner only (the database checks)
    stats: () => rpc('admin_stats', {}, true),
    pendingClaims: async () => { const r = await rpc('admin_claims', {}, true); return Array.isArray(r) ? r : []; },
    decideClaim: (userId, osmId, status, hideTimes = false) => rpc('decide_claim', { p_user: userId, p_osm: osmId, p_status: status, p_hide: hideTimes }, true),
    submitMasjid: (f) => rpc('submit_masjid', { p_name: f.name, p_street: f.street, p_area: f.area, p_city: f.city, p_state: f.state, p_pincode: f.pincode, p_lat: f.lat, p_lng: f.lng }, true),
    pendingSubmissions: async () => { const r = await rpc('admin_submissions', {}, true); return Array.isArray(r) ? r : []; },
    decideSubmission: (id, status) => rpc('decide_submission', { p_id: id, p_status: status }, true),
    setUpdateNotice: (version, message, url) => rpc('set_update_notice', { p_version: version, p_message: message, p_url: url }, true),

    /** The latest app version announced by the owner (anyone may read). */
    async appConfig() {
      const rows = await rest('app_config?key=eq.android_latest&select=value', { cache: 'no-cache' });
      return rows?.[0]?.value || null;
    },

    /** Anonymous usage counts. Fire-and-forget; keepalive lets it finish while the app closes. */
    sendEvents(install, events) {
      return fetch(`${base}/rest/v1/rpc/log_events`, { method: 'POST', keepalive: true, credentials: 'omit',
        headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_install: install, p_events: events }) }).catch(() => {});
    },
  };
}
