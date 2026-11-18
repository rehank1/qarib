// Unit tests: node --test (no dependencies). Run: npm test
// Times are checked as a phone in India sees them, on any machine (GitHub's runners use UTC).
process.env.TZ = 'Asia/Kolkata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTimes, schedule, clock, defaultSettings, hijriMonth, hijriLabel } from '../src/features/prayer/praytimes.js';
import { parse, buildQuery, query } from '../src/features/masjids/overpass.js';
import { cleanText, isOsmId, timesProblems, passwordProblem, isEmail } from '../src/core/validate.js';
import { distanceKm, directionsUrl, formatDistance, coarse } from '../src/core/geo.js';
import { createStore } from '../src/core/store.js';
import { countdown, ago } from '../src/core/format.js';
import { areaName } from '../src/features/location/places.js';

// ---------- prayer times vs Aladhan (api.aladhan.com), within 1 minute ----------
const REF = [
  ['Pune, Karachi/Hanafi', { lat: 18.5204, lng: 73.8567 }, { y: 2026, m: 11, d: 18 }, { method: 'karachi', asr: 'hanafi', tz: 5.5 }, '05:27 06:43 12:20 16:21 17:57 19:12'],
  ['Makkah in Ramadan, Umm al-Qura', { lat: 21.4225, lng: 39.8262 }, { y: 2026, m: 3, d: 1 }, { method: 'makkah', asr: 'standard', tz: 3 }, '05:25 06:41 12:33 15:54 18:25 20:25'],
  ['London midsummer, MWL', { lat: 51.5074, lng: -0.1278 }, { y: 2026, m: 6, d: 21 }, { method: 'mwl', asr: 'standard', tz: 1 }, '02:31 04:43 13:02 17:25 21:22 23:27'],
  ['New York, ISNA', { lat: 40.7128, lng: -74.006 }, { y: 2026, m: 1, d: 15 }, { method: 'isna', asr: 'standard', tz: -5 }, '05:58 07:18 12:06 14:33 16:53 18:14'],
];
for (const [name, place, day, s, ref] of REF) {
  test(`prayer times match Aladhan: ${name}`, () => {
    const got = Object.values(computeTimes(place, day, s));
    ref.split(' ').forEach((t, i) => {
      const want = Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      assert.ok(Math.abs(got[i] - want) <= 1, `${['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'][i]}: got ${clock(got[i], false)}, want ${t}`);
    });
  });
}

test('high latitude (Tromsø, midsummer): every time exists and is in order', () => {
  const t = computeTimes({ lat: 69.65, lng: 18.96 }, { y: 2026, m: 5, d: 10 }, { method: 'mwl', asr: 'standard', tz: 2 });
  for (const v of Object.values(t)) assert.ok(Number.isFinite(v));
  assert.ok(t.fajr < t.sunrise && t.sunrise < t.dhuhr && t.dhuhr < t.asr && t.asr < t.maghrib);
});

test('Umm al-Qura Isha is 120 min in Ramadan, 90 otherwise', () => {
  assert.equal(hijriMonth(2026, 3, 1), 9);
  const out = computeTimes({ lat: 21.4225, lng: 39.8262 }, { y: 2026, m: 6, d: 1 }, { method: 'makkah', asr: 'standard', tz: 3 });
  assert.equal(out.isha - out.maghrib, 90);
});

test('schedule: before Fajr, Isha is current and Fajr is next; between sunrise and Dhuhr nothing is current', () => {
  const place = { lat: 18.52, lng: 73.86 }, st = { method: 'india', asr: 'hanafi' };
  const early = schedule(place, st, new Date(2026, 10, 18, 3, 0));
  assert.equal(early.current, 'isha'); assert.equal(early.next, 'fajr');
  const morning = schedule(place, st, new Date(2026, 10, 18, 9, 0));
  assert.equal(morning.current, null); assert.equal(morning.next, 'dhuhr');
  const late = schedule(place, st, new Date(2026, 10, 18, 23, 0));
  assert.equal(late.next, 'fajr'); assert.equal(late.nextAt.getDate(), 19); // tomorrow's Fajr
});

test('the app uses the Indian standard everywhere: 18°/18°, Hanafi by default', () => {
  assert.deepEqual(defaultSettings(), { method: 'india', asr: 'hanafi' });
  const india = computeTimes({ lat: 18.5204, lng: 73.8567 }, { y: 2026, m: 11, d: 18 }, { method: 'india', asr: 'hanafi', tz: 5.5 });
  assert.deepEqual(india, computeTimes({ lat: 18.5204, lng: 73.8567 }, { y: 2026, m: 11, d: 18 }, { method: 'karachi', asr: 'hanafi', tz: 5.5 })); // same angles
});
test('Hijri date can follow the Indian moon sighting (a day behind Umm al-Qura)', () => {
  const d = new Date(2026, 2, 1, 12);
  assert.notEqual(hijriLabel(d, -1), hijriLabel(d, 0));
  assert.equal(hijriLabel(d, 99), hijriLabel(d, 0)); // nonsense adjustments are ignored
});

// ---------- masjid search: untrusted data in, clean data out ----------
const origin = { lat: 18.522, lng: 73.872 };
const FIXTURE = { elements: [
  { type: 'node', id: 1, lat: 18.5231, lon: 73.8741, tags: { name: 'Jama Masjid', 'name:ar': 'جامع' } },
  { type: 'way', id: 2, center: { lat: 18.5262, lon: 73.8705 }, tags: { name: '<img src=x onerror=alert(1)>‮Noor' } },
  { type: 'node', id: 1, lat: 18.5231, lon: 73.8741, tags: { name: 'duplicate' } },
  { type: 'evil', id: 3, lat: 18.52, lon: 73.87 },
  { type: 'node', id: 4, lat: 999, lon: 73.87 },
  { type: 'node', id: 5, lat: 18.6, lon: 73.95, tags: {} },
] };

test('parse: validates ids and coordinates, de-duplicates, sorts by distance, cleans names', () => {
  const out = parse(FIXTURE, origin, 4);
  assert.deepEqual(out.map((m) => m.id), ['node/1', 'way/2', 'node/5']);
  assert.equal(out[1].name, 'Noor'); // tag and bidi override stripped (and it would render as text anyway)
  assert.equal(out[2].name, 'Masjid (name not listed)');
  assert.ok(out[0].km < out[1].km && out[1].km < out[2].km);
});

test('buildQuery refuses non-numeric input (no query injection)', () => {
  assert.throws(() => buildQuery({ lat: '1);out;', lng: 2 }, 3000));
  assert.match(buildQuery(origin, 3000), /around:3000,18\.5220,73\.8720/);
});

test('hedged query: a slow first mirror is overtaken by the next, and the loser is cancelled', async () => {
  const aborted = [];
  const fetcher = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted.push(url); reject(Object.assign(new Error('aborted'), { code: 'timeout' })); });
    if (url === 'b') setTimeout(() => resolve({ from: 'b' }), 10);
  });
  assert.deepEqual(await query('q', fetcher, ['a', 'b', 'c'], 20), { from: 'b' });
  assert.deepEqual(aborted, ['a']);
});

test('hedged query: a bad request (4xx) is not retried on other mirrors', async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); throw Object.assign(new Error('bad'), { status: 400 }); };
  await assert.rejects(query('q', fetcher, ['a', 'b'], 20));
  assert.deepEqual(calls, ['a']);
});

test('hedged query: all mirrors busy → one clear error', async () => {
  const fetcher = async () => { throw Object.assign(new Error('x'), { status: 502 }); };
  await assert.rejects(query('q', fetcher, ['a', 'b', 'c'], 5), /busy/);
});

// ---------- validation ----------
test('cleanText strips control and bidi characters and caps length', () => {
  assert.equal(cleanText('a\u0000b‮c  d', 80), 'abc d');
  assert.equal(cleanText('x'.repeat(200), 10).length, 10);
});
test('osm ids', () => {
  assert.ok(isOsmId('node/1')); assert.ok(isOsmId('relation/123456789012'));
  for (const bad of ['node/', 'nodes/1', 'node/1 or 1=1', 'way/1"', 1]) assert.ok(!isOsmId(bad), String(bad));
});
test('jamaat times must be valid and in order; Jumuah optional', () => {
  const ok = { fajr: '05:30', dhuhr: '13:30', asr: '16:45', maghrib: '18:02', isha: '20:00' };
  assert.deepEqual(timesProblems(ok), []);
  assert.deepEqual(timesProblems({ ...ok, jumuah: '13:45' }), []);
  assert.equal(timesProblems({ ...ok, asr: '12:00' }).length, 1);
  assert.ok(timesProblems({ ...ok, fajr: '5:30' }).length);
  assert.ok(timesProblems({ ...ok, isha: '24:00' }).length);
});
test('password policy (NIST style: length first)', () => {
  assert.match(passwordProblem('imam@x.org', 'short'), /10 characters/);
  assert.match(passwordProblem('imam@x.org', 'imam-of-the-masjid'), /email name/);
  assert.match(passwordProblem('a@x.org', 'aaaaaaaaaaaa'), /easy/);
  assert.equal(passwordProblem('imam@x.org', 'velvet lantern monsoon'), '');
  assert.ok(isEmail('imam@example.org')); assert.ok(!isEmail('imam@example'));
});

// ---------- geo ----------
test('distances, privacy rounding and directions links', () => {
  assert.ok(Math.abs(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111.2) < 0.2);
  assert.deepEqual(coarse({ lat: 18.520412, lng: 73.856749 }), { lat: 18.52, lng: 73.857 });
  const u = new URL(directionsUrl({ lat: 18.5231, lng: 73.8741 }));
  assert.equal(u.origin, 'https://www.google.com');
  assert.equal(u.searchParams.get('destination'), '18.523100,73.874100');
  assert.throws(() => directionsUrl({ lat: 'javascript:alert(1)', lng: 0 }));
  assert.equal(formatDistance(0.25), '250 m'); assert.equal(formatDistance(2.44), '2.4 km');
});

// ---------- cache ----------
function memory() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; }
test('store: expiry, size cap, corrupt entries, clear', () => {
  let now = 1000;
  const mem = memory(), s = createStore(mem, () => now);
  s.set('a', { x: 1 }, 500);
  assert.deepEqual(s.get('a'), { x: 1 });
  now = 2000; assert.equal(s.get('a'), null);
  assert.equal(s.set('big', 'x'.repeat(300 * 1024)), false);
  mem.setItem('qarib:v1:bad', '{not json'); assert.equal(s.get('bad', 'fb'), 'fb');
  s.set('b', 1); s.clear(); assert.equal(mem.length, 0);
});

test('format helpers', () => {
  assert.equal(countdown(65 * 60e3), 'in 1 h 05 min');
  assert.equal(countdown(125e3), 'in 2:05');
  assert.equal(ago(Date.now() - 3 * 864e5), '3 days ago');
  assert.equal(areaName({ suburb: 'Camp', city: 'Pune' }), 'Camp, Pune');
  assert.equal(areaName({ city: 'Pune', town: 'Pune' }), 'Pune');
});

// ---------- pentest regressions (2026-11-18) ----------
import { own, cleanTimesMap } from '../src/core/validate.js';
import { revive } from '../src/features/masjids/overpass.js';
import { demoBackend } from '../src/data/demo.js';

test('names that look like markup are cleaned, not shown raw', () => {
  assert.equal(cleanText('<img src=x onerror=alert(1)>Masjid-e-Noor'), 'Masjid-e-Noor');
  assert.equal(cleanText('<svg onload=alert(1)>'), '');
  assert.equal(cleanText('<script>alert(1)</script>Noor'), 'alert(1)Noor'); // inert words may stay; no tags do
  assert.equal(cleanText('Masjid <Al-Huda'), 'Masjid Al-Huda');
  assert.equal(cleanText('Masjid & Madrasa'), 'Masjid & Madrasa');
});

test('prototype keys never resolve: routes, settings, methods', () => {
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(own({ prayer: 1 }, k), undefined);
  assert.equal(own({ prayer: 1 }, 'prayer'), 1);
  const t = computeTimes({ lat: 18.52, lng: 73.86 }, { y: 2026, m: 11, d: 18 }, { method: '__proto__', asr: 'constructor', tz: 5.5 });
  for (const v of Object.values(t)) assert.ok(Number.isFinite(v)); // falls back to MWL / standard, never NaN
});

test('cached masjid lists are re-validated; any bad entry discards the cache', () => {
  const o = { lat: 18.522, lng: 73.872 };
  const good = [{ id: 'node/1', name: '<b>A</b>', lat: 18.523, lng: 73.874, km: 999 }];
  const r = revive(good, o);
  assert.equal(r[0].name, 'A'); assert.ok(r[0].km < 1); // distance recomputed, not trusted
  assert.equal(revive([{ id: 'node/1', name: 'X', lat: 'javascript:alert(1)', lng: 1 }], o), null);
  assert.equal(revive({ length: 5 }, o), null);
  assert.equal(revive([{ id: 'node/1 or 1=1', lat: 1, lng: 1 }], o), null);
});

test('cached jamaat times are re-validated', () => {
  const ok = { fajr: '05:30', dhuhr: '13:30', asr: '16:45', maghrib: '18:02', isha: '20:00', updatedAt: '2026-11-01T00:00:00Z' };
  const m = cleanTimesMap({ 'node/1': ok, 'node/2': { fajr: '<b>', dhuhr: null }, '__proto__': ok, 'evil': ok });
  assert.deepEqual(Object.keys(m), ['node/1']);
  assert.equal(m['node/1'].verified, false); // "verified" is never inherited from storage by accident
});

test('a forged demo session in storage does not sign anyone in', () => {
  const mem = new Map(), st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  const store = createStore(st);
  store.set('demo:session', { email: 'attacker@x.org' });
  assert.equal(demoBackend({ store }).user(), null);
  store.set('demo:session', 'string-not-object');
  assert.equal(demoBackend({ store }).user(), null);
});

// ---------- live API client pieces ----------
import { nearestFrom } from '../src/features/masjids/overpass.js';
import { newer } from '../src/core/update.js';

test('shared masjid list is re-sorted from the phone, cleaned, and cut to the limit', () => {
  const me = { lat: 18.5, lng: 73.9 };
  const list = [{ id: 'node/1', name: 'Far', lat: 18.6, lng: 73.9 }, { id: 'node/2', name: '<b>Near</b>', lat: 18.501, lng: 73.9 }, { id: 'bad', lat: 1, lng: 1 }, { id: 'node/3', name: 'Mid', lat: 18.52, lng: 73.9 }];
  assert.deepEqual(nearestFrom(list, me, 2).map((m) => m.name), ['Near', 'Mid']);
});

test('update check compares versions numerically', () => {
  assert.equal(newer('v1.10.0', '1.9.9'), true);
  assert.equal(newer('v1.0.0', '1.0.0'), false);
  assert.equal(newer('v0.9.0', '1.0.0'), false);
  assert.equal(newer('nightly', '1.0.0'), false);
});

test('a masjid mapped twice (point and outline, same name, a few metres apart) is shown once', () => {
  const me = { lat: 19.1, lng: 73.0 };
  const list = [{ id: 'node/1', name: 'Gulshane Madina Masjid', lat: 19.1010, lng: 73.0 }, { id: 'way/2', name: 'Gulshane Madina Masjid', lat: 19.1011, lng: 73.0001 }, { id: 'node/3', name: 'Noor Masjid', lat: 19.102, lng: 73.0 }];
  assert.deepEqual(nearestFrom(list, me, 3).map((m) => m.id), ['node/1', 'node/3']);
});
