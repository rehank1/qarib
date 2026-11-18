// Validation for everything that crosses a trust boundary: third-party APIs, the backend and form input.

// control characters and bidi overrides (used to disguise text direction) are stripped from any displayed text
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * Display-safe plain text. Rendering already uses textContent (markup can never execute), but text that LOOKS like
 * markup is still a defacement, so tags are removed, then any stray angle brackets.
 */
export function cleanText(v, max = 80) {
  return String(v ?? '').replace(UNSAFE, '').replace(/<\/?[a-z!?][^<>]*>/gi, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Own-property lookup: user-controlled keys such as "__proto__" or "toString" must never hit Object.prototype. */
export const own = (obj, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

export const isLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
export const isLng = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
export const isCoord = (p) => !!p && isLat(p.lat) && isLng(p.lng);

/** A masjid's id: OpenStreetMap ("node/123456") or added by hand in Qarib ("qarib/45"). */
export const isOsmId = (v) => typeof v === 'string' && /^((node|way|relation)\/\d{1,12}|qarib\/\d{1,9})$/.test(v);

/** 24-hour "HH:MM". */
export const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Problems with a masjid's jamaat times, or [] when they are fine. Jumu'ah is optional. */
export function timesProblems(t) {
  const errs = [];
  for (const p of PRAYERS) if (!isTime(t?.[p])) errs.push(`${p}: enter a time`);
  if (t?.jumuah && !isTime(t.jumuah)) errs.push('jumuah: enter a time or leave it empty');
  if (!errs.length) {
    const order = PRAYERS.map((p) => toMinutes(t[p]));
    if (order.some((m, i) => i && m <= order[i - 1])) errs.push('Times must be in order: Fajr, Dhuhr, Asr, Maghrib, Isha.');
  }
  return errs;
}

/** A jamaat-times record from storage or the server → a clean copy, or null if it is not valid. */
export function cleanTimes(t) {
  if (!t || typeof t !== 'object' || timesProblems(t).length) return null;
  const at = new Date(t.updatedAt);
  return { fajr: t.fajr, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha, jumuah: isTime(t.jumuah) ? t.jumuah : '', updatedAt: isNaN(at) ? new Date(0).toISOString() : at.toISOString(), verified: t.verified === true, demo: t.demo === true };
}

/** { osm_id: times } map → only valid ids and valid times survive. */
export function cleanTimesMap(m) {
  const out = {};
  if (m && typeof m === 'object') for (const [id, t] of Object.entries(m)) { const c = isOsmId(id) && cleanTimes(t); if (c) out[id] = c; }
  return out;
}

export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** Why a new password is too weak, or ''. Length beats complexity rules (NIST SP 800-63B). */
export function passwordProblem(email, pw) {
  const p = String(pw || '');
  if (p.length < 10) return 'Use at least 10 characters. A short phrase of three unrelated words works well.';
  if (p.length > 128) return 'Use 128 characters or fewer.';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 3 && p.toLowerCase().includes(local)) return 'The password must not contain your email name.';
  if (new Set(p.toLowerCase()).size < 5 || /^(password|qwerty|123456|masjid|bismillah)/i.test(p)) return 'That password is too easy to guess.';
  return '';
}
