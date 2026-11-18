// City search for people who don't share their location (OpenStreetMap Nominatim, 1 request per search, no key).
import { fetchJSON } from '../../core/net.js';
import { cleanText } from '../../core/validate.js';
import { coarse } from '../../core/geo.js';

export async function searchPlaces(q, { fetcher = fetchJSON } = {}) {
  const query = cleanText(q, 80);
  if (query.length < 2) return [];
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ format: 'jsonv2', q: query, limit: '5', addressdetails: '1', 'accept-language': navigator.language || 'en' });
  const rows = await fetcher(u.href, { timeout: 10000 });
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: cleanText(r.display_name, 90), short: areaName(r.address) || cleanText(r.name, 40) }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180)
    .map((r) => ({ ...coarse(r), label: r.label, short: r.short || r.label.split(',')[0] }));
}

/** "Camp, Pune" from an address: the neighbourhood people say, then the city. */
export function areaName(a = {}) {
  const local = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
  const city = a.city || a.town || a.village || a.municipality || a.county || '';
  return cleanText([local, city].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(', '), 50);
}

/** A short place name for coordinates (shown under the date). Best effort: '' on any failure. */
export async function placeName({ lat, lng }, { fetcher = fetchJSON } = {}) {
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.search = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: '12', 'accept-language': navigator.language || 'en' });
    const r = await fetcher(u.href, { timeout: 8000 });
    return areaName(r?.address) || cleanText(r?.address?.state || '', 40);
  } catch { return ''; }
}
