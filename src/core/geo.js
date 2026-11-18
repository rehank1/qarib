// Distances, directions links and the device location.
import { isCoord } from './validate.js';

const R = 6371.0088; // mean Earth radius, km
const rad = (d) => (d * Math.PI) / 180;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Walking time at 4.8 km/h on roads about 25% longer than the straight line. */
export const walkMinutes = (km) => Math.max(1, Math.round(((km * 1.25) / 4.8) * 60));

export const formatDistance = (km) => (km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

/** ~110 m precision: enough for prayer times and "nearest masjid", and the exact spot never leaves the device. */
export const coarse = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

/** Google Maps directions. Opens the Maps app on iOS and Android; no API key. Only numbers go into the URL. */
export function directionsUrl(to, mode = 'walking') {
  if (!isCoord(to)) throw new Error('bad coordinates');
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`);
  u.searchParams.set('travelmode', mode === 'driving' ? 'driving' : 'walking');
  return u.href;
}

/** The device location, rounded. Rejects with a readable message. */
export function currentPosition({ timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This device cannot share its location. Search for your city instead.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(coarse({ lat: p.coords.latitude, lng: p.coords.longitude })),
      (e) => reject(new Error(e.code === 1 ? 'Location is turned off for Qarīb. Allow it in your settings, or search for your city.' : 'Could not find your location. Try again outdoors, or search for your city.')),
      { enableHighAccuracy: false, timeout, maximumAge: 5 * 60e3 },
    );
  });
}
