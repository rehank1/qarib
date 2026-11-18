// Outsider test: everything here uses ONLY the public anon key, exactly what anyone who unpacks the APK could do.
// Every attempt to read private data or write anything must fail; the few public reads must work.
// Run: node tools/probe-supabase.mjs   (exit code 1 if anything is exposed)
import { CONFIG } from '../src/config.js';

const URL0 = CONFIG.supabaseUrl, KEY = CONFIG.supabaseAnonKey;
const H = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };
const call = async (path, init = {}) => { const r = await fetch(URL0 + path, { ...init, headers: { ...H, ...init.headers } }); let body = ''; try { body = await r.text(); } catch {} return { status: r.status, body }; };
const rows = (r) => { try { const j = JSON.parse(r.body); return Array.isArray(j) ? j.length : -1; } catch { return -1; } };

const checks = [
  // must be DENIED (or return nothing)
  ['read all accounts (auth admin)', () => call('/auth/v1/admin/users'), (r) => r.status === 401 || r.status === 403],
  ['read profiles (who is owner)', () => call('/rest/v1/profiles?select=*'), (r) => r.status >= 400 || rows(r) === 0],
  ['read imam requests + who asked', () => call('/rest/v1/masjid_admins?select=*'), (r) => r.status >= 400 || rows(r) === 0],
  ['read who edited jamaat times', () => call('/rest/v1/prayer_times?select=updated_by'), (r) => r.status >= 400],
  ['read the audit history', () => call('/rest/v1/prayer_times_history?select=*'), (r) => r.status >= 400],
  ['read private schema (usage data)', () => call('/rest/v1/metrics?select=*', { headers: { 'accept-profile': 'private' } }), (r) => r.status >= 400],
  ['read the raw masjid table', () => call('/rest/v1/masjids?select=*&limit=1'), (r) => r.status >= 400],
  ['write fake jamaat times', () => call('/rest/v1/prayer_times', { method: 'POST', body: JSON.stringify({ osm_id: 'node/1', fajr: '05:00', dhuhr: '13:00', asr: '16:00', maghrib: '18:00', isha: '20:00' }) }), (r) => r.status >= 400],
  ['change an existing time', () => call('/rest/v1/prayer_times?osm_id=eq.node/1', { method: 'PATCH', body: JSON.stringify({ fajr: '04:00' }) }), (r) => r.status >= 400],
  ['delete jamaat times', () => call('/rest/v1/prayer_times?osm_id=neq.x', { method: 'DELETE' }), (r) => r.status >= 400],
  ['approve an imam', () => call('/rest/v1/rpc/decide_claim', { method: 'POST', body: JSON.stringify({ p_user: '00000000-0000-0000-0000-000000000000', p_osm: 'node/1', p_status: 'approved' }) }), (r) => r.status >= 400],
  ['list imam requests (owner function)', () => call('/rest/v1/rpc/admin_claims', { method: 'POST', body: '{}' }), (r) => r.status >= 400],
  ['read dashboard numbers', () => call('/rest/v1/rpc/admin_stats', { method: 'POST', body: '{}' }), (r) => r.status >= 400],
  ['post a fake update notice', () => call('/rest/v1/rpc/set_update_notice', { method: 'POST', body: JSON.stringify({ p_version: '9.9.9', p_message: 'x', p_url: 'https://github.com/rehank1/qarib/releases/latest' }) }), (r) => r.status >= 400],
  ['change the update notice table', () => call('/rest/v1/app_config', { method: 'POST', body: JSON.stringify({ key: 'android_latest', value: { version: '9.9.9' } }) }), (r) => r.status >= 400],
  ['make itself owner', () => call('/rest/v1/profiles', { method: 'PATCH', body: JSON.stringify({ is_owner: true }) }), (r) => r.status >= 400 || r.body === '' || rows(r) === 0],
  ['run the importer', () => call('/rest/v1/rpc/refresh_tile', { method: 'POST', body: JSON.stringify({ p_tile: '18:73' }) }), (r) => r.status >= 400],
  ['use GraphQL', () => call('/graphql/v1', { method: 'POST', body: JSON.stringify({ query: '{ __schema { types { name } } }' }) }), (r) => r.status >= 400 || !/prayer_times|masjid_admins|profiles/.test(r.body)],
  // must WORK (public by design)
  ['PUBLIC: read jamaat times', () => call('/rest/v1/prayer_times?select=osm_id,fajr&limit=1'), (r) => r.status === 200],
  ['PUBLIC: search nearest masjids', () => call('/rest/v1/rpc/nearest_masjids', { method: 'POST', body: JSON.stringify({ p_lat: 18.516, p_lng: 73.879, p_limit: 3 }) }), (r) => r.status === 200],
  ['PUBLIC: read update notice', () => call('/rest/v1/app_config?select=value'), (r) => r.status === 200],
];

let bad = 0;
for (const [name, run, ok] of checks) {
  const r = await run();
  const pass = ok(r);
  if (!pass) bad++;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(38)} → ${r.status} ${r.body.slice(0, 70).replace(/\s+/g, ' ')}`);
}
console.log(bad ? `\n${bad} problem(s): something is exposed.` : '\nNothing private is reachable with the public key.');
process.exit(bad ? 1 : 0);
