// Prayer times computed on the device: no network, no API key, works offline and never sends the location anywhere.
// Astronomy after the PrayTimes.org reference algorithm (Hamid Zarrabi-Zadeh), checked against Aladhan in tests.

export const METHODS = {
  india: { name: 'Indian standard (Fajr and Isha at 18°)', fajr: 18, isha: 18 }, // the angles Indian masjids and jantris use
  mwl: { name: 'Muslim World League', fajr: 18, isha: 17 },
  isna: { name: 'ISNA (North America)', fajr: 15, isha: 15 },
  egypt: { name: 'Egyptian General Authority', fajr: 19.5, isha: 17.5 },
  makkah: { name: 'Umm al-Qura, Makkah', fajr: 18.5, ishaMinutes: 90 },
  karachi: { name: 'University of Islamic Sciences, Karachi', fajr: 18, isha: 18 },
  gulf: { name: 'Gulf Region', fajr: 19.5, ishaMinutes: 90 },
  turkey: { name: 'Diyanet, Türkiye', fajr: 18, isha: 17 },
};
export const ASR = { hanafi: { name: 'Hanafi (most of India)', factor: 2 }, standard: { name: "Shafi'i (common in Kerala and the Konkan coast)", factor: 1 } };
/** The methods the app offers. Qarīb is made for India. */
export const APP_METHODS = ['india'];

/** A sensible default for where the device is, from its time zone. The user can change it. */
export function defaultSettings() {
  return { method: 'india', asr: 'hanafi' };
}

/** Defaults by time zone, kept for a future international edition (not used by the app). */
export function defaultSettingsByZone(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '') {
  const z = timeZone;
  if (/^Asia\/(Kolkata|Calcutta|Karachi|Dhaka|Kathmandu|Colombo|Kabul)$/.test(z)) return { method: 'karachi', asr: 'hanafi' };
  if (/^America\//.test(z) || /^Canada\//.test(z)) return { method: 'isna', asr: 'standard' };
  if (/^Asia\/Riyadh$/.test(z)) return { method: 'makkah', asr: 'standard' };
  if (/^Africa\/Cairo$/.test(z)) return { method: 'egypt', asr: 'standard' };
  if (/^Asia\/(Dubai|Qatar|Bahrain|Kuwait|Muscat)$/.test(z)) return { method: 'gulf', asr: 'standard' };
  if (/^(Europe\/Istanbul|Asia\/Istanbul)$/.test(z)) return { method: 'turkey', asr: 'hanafi' };
  return { method: 'mwl', asr: 'standard' };
}

const dsin = (d) => Math.sin((d * Math.PI) / 180), dcos = (d) => Math.cos((d * Math.PI) / 180), dtan = (d) => Math.tan((d * Math.PI) / 180);
const darcsin = (x) => (Math.asin(x) * 180) / Math.PI, darccos = (x) => (Math.acos(x) * 180) / Math.PI;
const darctan2 = (y, x) => (Math.atan2(y, x) * 180) / Math.PI, darccot = (x) => (Math.atan(1 / x) * 180) / Math.PI;
const fix = (a, b) => { a -= b * Math.floor(a / b); return a < 0 ? a + b : a; };

function julian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sun(jd) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360), q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * dsin(g) + 0.02 * dsin(2 * g), 360);
  const e = 23.439 - 0.00000036 * D;
  const RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
  return { decl: darcsin(dsin(e) * dsin(L)), eqt: q / 15 - fix(RA, 24) };
}

/**
 * Times for one calendar day at a place, as minutes after local midnight (in the given UTC offset, hours).
 * → { fajr, sunrise, dhuhr, asr, maghrib, isha }
 */
export function computeTimes({ lat, lng }, { y, m, d }, { method = 'mwl', asr = 'standard', tz }) {
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const M = has(METHODS, method) ? METHODS[method] : METHODS.mwl, factor = (has(ASR, asr) ? ASR[asr] : ASR.standard).factor;
  const jDate = julian(y, m, d) - lng / (15 * 24);
  const noon = (t) => fix(12 - sun(jDate + t).eqt, 24);
  const angleTime = (angle, t, before) => {
    const { decl } = sun(jDate + t);
    const T = darccos((-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat))) / 15;
    return noon(t) + (before ? -T : T);
  };
  const asrTime = (t) => {
    const { decl } = sun(jDate + t);
    return angleTime(-darccot(factor + dtan(Math.abs(lat - decl))), t, false);
  };
  // first estimates as day fractions, then one refinement pass using them (as the reference algorithm does)
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  for (let pass = 0; pass < 2; pass++) {
    const f = (h) => (Number.isFinite(h) ? h : 12) / 24;
    t = {
      fajr: angleTime(M.fajr, f(t.fajr), true),
      sunrise: angleTime(0.833, f(t.sunrise), true),
      dhuhr: noon(f(t.dhuhr)),
      asr: asrTime(f(t.asr)),
      sunset: angleTime(0.833, f(t.sunset), false),
      isha: M.isha ? angleTime(M.isha, f(t.isha), false) : t.isha,
    };
  }
  // Umm al-Qura: Isha is 90 minutes after Maghrib, 120 during Ramadan
  if (M.ishaMinutes) t.isha = t.sunset + (method === 'makkah' && hijriMonth(y, m, d) === 9 ? 120 : M.ishaMinutes) / 60;

  // high latitudes (summer nights too short for twilight angles): the "angle-based" rule
  const night = 24 - (t.sunset - t.sunrise);
  const fajrMax = (M.fajr / 60) * night;
  if (!Number.isFinite(t.fajr) || t.sunrise - t.fajr > fajrMax) t.fajr = t.sunrise - fajrMax;
  if (!M.ishaMinutes) {
    const ishaMax = (M.isha / 60) * night;
    if (!Number.isFinite(t.isha) || t.isha - t.sunset > ishaMax) t.isha = t.sunset + ishaMax;
  }

  const shift = tz - lng / 15;
  const min = (h) => Math.round(fix(h + shift, 24) * 60);
  return { fajr: min(t.fajr), sunrise: min(t.sunrise), dhuhr: min(t.dhuhr), asr: min(t.asr), maghrib: min(t.sunset), isha: min(t.isha) };
}

/** Hijri (Umm al-Qura) month number of a Gregorian date, 1–12; 0 if the device lacks the calendar. */
export function hijriMonth(y, m, d) {
  try {
    const part = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(y, m - 1, d, 12))).find((p) => p.type === 'month');
    return Number(part?.value) || 0;
  } catch { return 0; }
}

/**
 * "8 Jumada II 1448 AH" for display. In India the month begins with local moon sighting, often a day after Saudi
 * Arabia's Umm al-Qura calendar, so the user can shift it by a day to match the local announcement.
 */
export function hijriLabel(date = new Date(), adjustDays = 0) {
  const d = new Date(date); d.setDate(d.getDate() + (Number.isInteger(adjustDays) && Math.abs(adjustDays) <= 2 ? adjustDays : 0));
  try { return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch { return ''; }
}

/** The device's UTC offset (hours) on a date, daylight saving included. */
export const deviceOffset = ({ y, m, d }) => -new Date(y, m - 1, d, 12).getTimezoneOffset() / 60;

export const dayParts = (date) => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() });

export const LABELS = { fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
export const ARABIC = { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
const FIVE = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** The schedule for `now`'s day, the prayer whose time is running (null between sunrise and Dhuhr) and the next one. */
export function schedule(place, settings, now = new Date()) {
  const day = dayParts(now);
  const today = computeTimes(place, day, { ...settings, tz: deviceOffset(day) });
  const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  let next = FIVE.find((k) => today[k] > mins);
  let nextAt;
  if (next) nextAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, today[next]);
  else {
    const tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
    const td = dayParts(tm), tomorrow = computeTimes(place, td, { ...settings, tz: deviceOffset(td) });
    next = 'fajr'; nextAt = new Date(tm.getFullYear(), tm.getMonth(), tm.getDate(), 0, tomorrow.fajr);
  }
  const passed = FIVE.filter((k) => today[k] <= mins);
  let current = passed.at(-1) || 'isha'; // before Fajr, last night's Isha is still running
  if (current === 'fajr' && mins >= today.sunrise) current = null;
  return { times: today, current, next, nextAt, isFriday: now.getDay() === 5 };
}

export const clock = (minutes, h12 = true) => {
  const hh = Math.floor(minutes / 60) % 24, mm = String(minutes % 60).padStart(2, '0');
  return h12 ? `${((hh + 11) % 12) + 1}:${mm} ${hh < 12 ? 'AM' : 'PM'}` : `${String(hh).padStart(2, '0')}:${mm}`;
};
