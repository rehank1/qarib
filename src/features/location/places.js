// Area search as you type (like a maps app), for India. Photon: free, no key, built on OpenStreetMap.
// (Google Places would need a billed Google Cloud key; this gives the same type-ahead experience for free.)
import { fetchJSON } from '../../core/net.js';
import { cleanText } from '../../core/validate.js';
import { coarse } from '../../core/geo.js';

const PHOTON = 'https://photon.komoot.io';
const INDIA_BBOX = '68,6,97.5,37.5';

/** "Camp, Pune" from an address: the neighbourhood people say, then the city. */
export function areaName(a = {}) {
  const local = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.district || a.locality || '';
  const city = a.city || a.town || a.village || a.municipality || a.county || '';
  return cleanText([local, city].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(', '), 50);
}

/** One Photon feature → { lat, lng, title, subtitle, label } or null. */
export function fromPhoton(f) {
  const [lng, lat] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates.map(Number) : [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const p = f.properties || {};
  if (p.countrycode && p.countrycode !== 'IN') return null;
  const title = cleanText(p.name || p.district || p.city || p.county || '', 60);
  if (!title) return null;
  const subtitle = cleanText([p.district !== title ? p.district : '', p.city !== title ? p.city : '', p.state].filter(Boolean).join(', '), 80);
  return { ...coarse({ lat, lng }), title, subtitle, city: cleanText(p.city || p.county || '', 60), state: cleanText(p.state || '', 40), postcode: cleanText(p.postcode || '', 6), label: cleanText(subtitle ? `${title}, ${(p.city && p.city !== title) ? p.city : p.state || ''}` : title, 60) };
}

/** Suggestions for what has been typed so far (2+ letters), nearest first when we know roughly where the user is. */
export async function searchPlaces(q, { near, fetcher = fetchJSON } = {}) {
  const query = cleanText(q, 80);
  if (query.length < 2) return [];
  const u = new URL(`${PHOTON}/api/`);
  u.search = new URLSearchParams({ q: query, limit: '8', lang: 'en', bbox: INDIA_BBOX, ...(near ? { lat: String(near.lat), lon: String(near.lng) } : {}) });
  const r = await fetcher(u.href, { timeout: 8000 });
  const seen = new Set();
  return (Array.isArray(r?.features) ? r.features : []).map(fromPhoton).filter((x) => x && !seen.has(x.label) && seen.add(x.label)).slice(0, 6);
}

/** A short place name for coordinates (shown under the date). Best effort: '' on any failure. */
export async function placeName({ lat, lng }, { fetcher = fetchJSON } = {}) {
  try {
    const u = new URL(`${PHOTON}/reverse`);
    u.search = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: 'en', limit: '1' });
    const p = (await fetcher(u.href, { timeout: 8000 }))?.features?.[0]?.properties || {};
    return areaName({ suburb: p.district || p.locality, city: p.city || p.county }) || cleanText(p.state || '', 40);
  } catch { return ''; }
}
