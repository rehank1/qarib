// Nearest masjids from OpenStreetMap (Overpass API): free, worldwide, no key. Everything that comes back is treated
// as untrusted: ids, coordinates and names are validated and cleaned before they reach the UI or the cache.
import { fetchJSON } from '../../core/net.js';
import { distanceKm } from '../../core/geo.js';
import { cleanText, isCoord, isLat, isLng, isOsmId } from '../../core/validate.js';

// Public Overpass servers are volunteer-run and sometimes busy (429/502/504): try the next mirror on failure.
export const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const RADII = [1500, 4000, 12000, 30000]; // metres: start small so dense areas never hit the result cap

export function buildQuery({ lat, lng }, radius) {
  if (!isCoord({ lat, lng }) || !Number.isInteger(radius)) throw new Error('bad query');
  const a = `(around:${radius},${lat.toFixed(4)},${lng.toFixed(4)})`;
  return `[out:json][timeout:20];(nwr["amenity"="place_of_worship"]["religion"="muslim"]${a};nwr["building"="mosque"]${a};);out center tags 100;`;
}

function address(t) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return cleanText([street, t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city']].filter(Boolean).join(', '), 120);
}

/** Overpass JSON → [{ id, name, nameAr, address, lat, lng, km }], nearest first, de-duplicated. */
export function parse(json, origin, limit = 4) {
  const seen = new Set(), out = [];
  for (const e of Array.isArray(json?.elements) ? json.elements.slice(0, 1000) : []) { // bounded work on hostile input
    const id = `${e?.type}/${e?.id}`;
    const lat = e?.lat ?? e?.center?.lat, lng = e?.lon ?? e?.center?.lon;
    if (!isOsmId(id) || seen.has(id) || !isLat(lat) || !isLng(lng)) continue;
    seen.add(id);
    const t = e.tags && typeof e.tags === 'object' ? e.tags : {};
    const name = cleanText(t['name:en'] || t.name || t['name:ar'] || '', 80);
    out.push({ id, name: name || 'Masjid (name not listed)', nameAr: cleanText(t['name:ar'] || '', 80), address: address(t), lat, lng, km: distanceKm(origin, { lat, lng }) });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}

/** A shared list from the API (sorted from its tile's centre) → validated, re-measured from THIS phone, nearest first. */
export function nearestFrom(list, origin, limit = 4) {
  return (Array.isArray(list) ? list.slice(0, 200) : [])
    .filter((m) => m && isOsmId(m.id) && isLat(m.lat) && isLng(m.lng))
    .map((m) => ({ id: m.id, name: cleanText(m.name, 80) || 'Masjid (name not listed)', nameAr: cleanText(m.nameAr, 80), address: cleanText(m.address, 120), lat: m.lat, lng: m.lng, km: distanceKm(origin, m) }))
    .sort((a, b) => a.km - b.km).slice(0, limit);
}

/** Re-check a list read back from on-device storage (it may be stale, from an older version, or tampered with). */
export function revive(list, origin, limit = 4) {
  if (!Array.isArray(list)) return null;
  const out = list.slice(0, limit).filter((m) => m && isOsmId(m.id) && isLat(m.lat) && isLng(m.lng)).map((m) => ({
    id: m.id, name: cleanText(m.name, 80) || 'Masjid (name not listed)', nameAr: cleanText(m.nameAr, 80), address: cleanText(m.address, 120), lat: m.lat, lng: m.lng, km: distanceKm(origin, m),
  }));
  return out.length === list.length ? out : null; // anything invalid → discard the whole cache and fetch fresh
}

/** Widening search. `fetcher` is injectable for tests. */
export async function nearestMasjids(origin, { limit = 4, fetcher = fetchJSON } = {}) {
  let found = [];
  for (const r of RADII) {
    found = parse(await query(buildQuery(origin, r), fetcher), origin, limit);
    if (found.length >= limit) break;
  }
  return found;
}

export const HEDGE_MS = 5000;

/**
 * Hedged request ("The Tail at Scale", Dean & Barroso): ask the first mirror; if it fails, or has not answered within
 * HEDGE_MS, also ask the next. The first good answer wins and the others are cancelled. Fast when the main server is
 * healthy, and a slow or overloaded server costs ~5 s instead of a 30 s timeout.
 */
export function query(q, fetcher = fetchJSON, mirrors = MIRRORS, hedgeMs = HEDGE_MS) {
  return new Promise((resolve, reject) => {
    const ctrls = [];
    let next = 0, pending = 0, done = false, last;
    const finish = (fn, v, winner) => { if (done) return; done = true; ctrls.forEach((c) => c !== winner && c.abort()); fn(v); };
    const fail = () => finish(reject, Object.assign(new Error(last?.code === 'offline' ? 'You are offline.' : 'The map service is busy right now. Try again in a minute.'), { code: last?.code || 'busy' }));
    const launch = () => {
      if (done || next >= mirrors.length) return;
      const url = mirrors[next++], ctl = new AbortController();
      ctrls.push(ctl); pending++;
      const hedge = setTimeout(launch, hedgeMs);
      fetcher(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), timeout: 30000, signal: ctl.signal })
        .then((json) => { clearTimeout(hedge); finish(resolve, json, ctl); })
        .catch((e) => {
          clearTimeout(hedge); pending--; last = e;
          if (done) return;
          if (e.code === 'offline' || (e.status >= 400 && e.status < 429)) return fail(); // no network, or a bad query: another mirror won't help
          if (next < mirrors.length) launch(); else if (!pending) fail();
        });
    };
    launch();
  });
}
