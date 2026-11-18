// Database tests: the real supabase/schema.sql in a real Postgres (PGlite), with Supabase's auth schema and roles
// stubbed. Every rule is checked as the role that would hit it: anon (worshippers), an imam, the owner. Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SCHEMA = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const IMAM = '11111111-1111-4111-8111-111111111111', OWNER = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
let db;

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema extensions; create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth, extensions to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await db.exec(SCHEMA);
  await db.exec(`insert into auth.users values ('${IMAM}', 'imam@masjid.org'), ('${OWNER}', 'owner@qarib.app'), ('${OTHER}', 'other@masjid.org');
                 update public.profiles set is_owner = true where user_id = '${OWNER}';`);
});

/** Run SQL as a role (and user), the way PostgREST does, then return to the superuser. */
async function as(role, uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); select set_config('request.headers', '{"x-forwarded-for":"10.0.0.${uid ? uid[0] : 9}"}', false); set role ${role};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role;'); }
}
const fails = async (p, re) => { await assert.rejects(p, re); };
const T = `'05:45', '13:30', '16:45', '18:02', '20:15'`;

test('accounts get a profile automatically; nobody is owner unless set by hand', async () => {
  const rows = (await db.query('select user_id, is_owner from public.profiles order by user_id')).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter((r) => r.is_owner).map((r) => r.user_id), [OWNER]);
  assert.deepEqual(await as('authenticated', IMAM, 'select user_id from public.profiles'), [{ user_id: IMAM }], 'sees only own profile');
});

test('a pending imam cannot publish; approval is owner-only; then they can, for their masjid only', async () => {
  assert.equal((await as('authenticated', IMAM, `select public.request_masjid('way/9202', '<b>Masjid-e-Noor</b>') as s`))[0].s, 'pending');
  await fails(as('authenticated', IMAM, `select public.request_masjid('way/9202', 'again')`), /already asked/);
  await fails(as('authenticated', IMAM, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha) values ('way/9202', ${T})`), /row-level security/);
  await fails(as('authenticated', IMAM, `select public.decide_claim('${IMAM}', 'way/9202', 'approved')`), /Owner only/);
  await fails(as('anon', null, `select public.decide_claim('${IMAM}', 'way/9202', 'approved')`), /permission denied/);

  const claims = await as('authenticated', OWNER, 'select * from public.admin_claims()');
  assert.equal(claims[0].masjid_name, 'Masjid-e-Noor'); assert.equal(claims[0].email, 'imam@masjid.org');
  await as('authenticated', OWNER, `select public.decide_claim('${IMAM}', 'way/9202', 'approved')`);

  await fails(as('authenticated', IMAM, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha) values ('way/9202', '05:45', '13:30', '12:00', '18:02', '20:15')`), /in_order/);
  await as('authenticated', IMAM, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha) values ('way/9202', ${T})`);
  assert.equal((await db.query(`select updated_by from public.prayer_times where osm_id = 'way/9202'`)).rows[0].updated_by, IMAM, 'the server says who edited');
  await fails(as('authenticated', IMAM, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha, updated_by) values ('node/2', ${T}, '${OTHER}')`), /permission denied/);
  await fails(as('authenticated', IMAM, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha) values ('node/1', ${T})`), /row-level security/);
  await as('authenticated', IMAM, `update public.prayer_times set asr = '16:55' where osm_id = 'way/9202'`);
  assert.equal((await db.query('select count(*)::int n from private.prayer_times_history')).rows[0].n, 2, 'every change audited');
});

test('worshippers read times but never who edited, and cannot write or see private data', async () => {
  const rows = await as('anon', null, `select osm_id, asr::text, updated_at is not null as dated from public.prayer_times`);
  assert.deepEqual(rows, [{ osm_id: 'way/9202', asr: '16:55:00', dated: true }]);
  await fails(as('anon', null, 'select updated_by from public.prayer_times'), /permission denied/);
  await fails(as('anon', null, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha) values ('node/5', ${T})`), /permission denied/);
  await fails(as('anon', null, 'select * from private.prayer_times_history'), /permission denied/);
  await fails(as('authenticated', OTHER, 'select * from private.settings'), /permission denied/);
  assert.deepEqual(await as('authenticated', OTHER, 'select * from public.masjid_admins'), [], 'cannot see other imams');
});

test('remove and hide: times come down, history stays, a removed imam cannot write; they may ask again once', async () => {
  await as('authenticated', OWNER, `select public.decide_claim('${IMAM}', 'way/9202', 'rejected', true)`);
  assert.deepEqual(await as('anon', null, 'select osm_id from public.prayer_times'), []);
  assert.equal((await db.query('select count(*)::int n from private.prayer_times_history')).rows[0].n, 2);
  await fails(as('authenticated', IMAM, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha) values ('way/9202', ${T})`), /row-level security/);
  assert.equal((await as('authenticated', IMAM, `select public.request_masjid('way/9202', 'Masjid-e-Noor') as s`))[0].s, 'pending');
  await fails(as('authenticated', IMAM, `select public.request_masjid('way/9202', 'Masjid-e-Noor')`), /already asked/);
  assert.equal((await as('authenticated', OWNER, `select public.request_masjid('node/9101', 'Jama Masjid Camp') as s`))[0].s, 'approved', 'owner approved at once');
});

test('at most 5 open requests, and 30 time changes an hour', async () => {
  for (let i = 1; i <= 5; i++) await as('authenticated', OTHER, `select public.request_masjid('node/${700 + i}', 'M${i}')`);
  await fails(as('authenticated', OTHER, `select public.request_masjid('node/706', 'M6')`), /Too many pending/);
  await as('authenticated', OWNER, `select public.decide_claim('${OTHER}', 'node/701', 'approved')`);
  await as('authenticated', OTHER, `insert into public.prayer_times (osm_id, fajr, dhuhr, asr, maghrib, isha) values ('node/701', ${T})`);
  for (let i = 0; i < 29; i++) await as('authenticated', OTHER, `update public.prayer_times set isha = '20:${String(16 + i).padStart(2, '0')}' where osm_id = 'node/701'`);
  await fails(as('authenticated', OTHER, `update public.prayer_times set isha = '21:00' where osm_id = 'node/701'`), /Too many changes/);
});

test('anonymous usage counts: hashed daily id, junk ignored, tables private', async () => {
  const install = crypto.randomUUID();
  for (let i = 0; i < 3; i++) await as('anon', null, `select public.log_events($1, $2::jsonb)`, [install, JSON.stringify([{ k: 'open' }, { k: 'directions', id: 'node/9101' }, { k: 'evil' }, { k: 'view', id: "x'; drop table x" }])]);
  const actives = (await db.query('select id from private.actives')).rows;
  assert.equal(actives.length, 1); assert.ok(!actives[0].id.includes(install.slice(0, 8)));
  const m = Object.fromEntries((await db.query(`select kind || ':' || key k, count from private.metrics`)).rows.map((r) => [r.k, r.count]));
  assert.deepEqual(m, { 'open:': 3, 'directions:node/9101': 3 });
  await fails(as('anon', null, 'select * from private.metrics'), /permission denied/);
});

test('update notice: only the owner can publish it, only for a Qarib release link; anyone can read it', async () => {
  await fails(as('authenticated', IMAM, `select public.set_update_notice('1.0.1', 'x', 'https://github.com/rehank1/qarib/releases/latest')`), /Owner only/);
  await fails(as('authenticated', OWNER, `select public.set_update_notice('1.0.1', 'x', 'https://evil.example/app.apk')`), /GitHub release/);
  await fails(as('authenticated', OWNER, `select public.set_update_notice('latest', 'x', 'https://github.com/rehank1/qarib/releases/latest')`), /Version/);
  await as('authenticated', OWNER, `select public.set_update_notice('1.0.1', 'Live jamaat times <script>', 'https://github.com/rehank1/qarib/releases/latest')`);
  const [row] = await as('anon', null, `select value from public.app_config where key = 'android_latest'`);
  assert.deepEqual(row.value, { version: '1.0.1', message: 'Live jamaat times script', url: 'https://github.com/rehank1/qarib/releases/latest' });
});
