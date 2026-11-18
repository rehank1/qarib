// Offline support: the app shell is cached at install, served cache-first and refreshed in the background.
// Third-party requests (OpenStreetMap, Supabase) are never cached here: the app keeps its own validated copy.
const VERSION = 'qarib-v1.3.0'; // bump on every release so phones drop the old cached files
const SHELL = [
  './', './index.html', './manifest.webmanifest', './styles/tokens.css', './styles/app.css', './icons/icon.svg', './icons/icon-192.png',
  './src/app.js', './src/config.js',
  './src/core/dom.js', './src/core/store.js', './src/core/validate.js', './src/core/net.js', './src/core/geo.js', './src/core/format.js',
  './src/data/backend.js', './src/data/supabase.js', './src/data/demo.js',
  './src/core/metrics.js', './src/core/update.js', './src/core/live-update.js', './src/features/portal/dashboard.js',
  './src/features/prayer/praytimes.js', './src/features/prayer/view.js', './src/features/prayer/salawat.js',
  './src/features/masjids/overpass.js', './src/features/masjids/view.js',
  './src/features/location/places.js', './src/features/location/view.js',
  './src/features/portal/view.js', './src/features/portal/add-masjid.js',
  './vendor/leaflet/leaflet-src.esm.js', './vendor/leaflet/leaflet.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const update = fetch(req).then((res) => { if (res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(update); return hit; }
      return (await update) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }),
  );
});
