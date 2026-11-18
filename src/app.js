// Qarīb: app shell. Owns state, routing (#prayer · #masjids · #portal), caching rules and the service worker.
// Views are pure-ish functions of (ctx) that return DOM nodes; they call back into ctx for anything that changes.
import { createStore, HOUR, DAY } from './core/store.js';
import { mount, toast } from './core/dom.js';
import { isCoord, cleanText, own, cleanTimesMap } from './core/validate.js';
import { distanceKm, coarse } from './core/geo.js';
import { createBackend } from './data/backend.js';
import { defaultSettings, APP_METHODS, ASR } from './features/prayer/praytimes.js';
import { nearestMasjids, nearestFrom, revive } from './features/masjids/overpass.js';
import { createMetrics } from './core/metrics.js';
import { checkForUpdate } from './core/update.js';
import { showSalawat } from './features/prayer/salawat.js';
import { prayerView } from './features/prayer/view.js';
import { masjidsView } from './features/masjids/view.js';
import { portalView } from './features/portal/view.js';
import { CONFIG } from './config.js';

const store = createStore();
const backend = createBackend(store);
const VIEWS = { prayer: prayerView, masjids: masjidsView, portal: portalView };

// ---------- state (restored from the on-device cache, validated: storage is user-editable) ----------
const savedLoc = store.get('loc');
const saved = store.get('settings', {});
const defaults = defaultSettings();
const settings = { // only known keys with known values; anything else falls back to the default
  method: APP_METHODS.includes(saved?.method) ? saved.method : defaults.method,
  asr: own(ASR, saved?.asr) ? saved.asr : defaults.asr,
  clock: saved?.clock === '24' ? '24' : '12',
  hijriAdjust: [-1, 0, 1].includes(saved?.hijriAdjust) ? saved.hijriAdjust : -1, // India usually runs a day behind Umm al-Qura
  metrics: saved?.metrics !== false, // anonymous usage counts: on unless the user turned them off
  salawat: saved?.salawat !== false, // the salawat reminder when the app opens
};

function savedMasjids() {
  const m = store.get('masjids');
  if (!m || !isCoord(m.origin) || !Number.isFinite(m.at)) return null;
  const list = revive(m.list, m.origin, CONFIG.masjidLimit);
  return list ? { origin: coarse(m.origin), list, at: m.at } : null;
}

const state = {
  loc: isCoord(savedLoc) ? { ...coarse(savedLoc), label: cleanText(savedLoc.label, 60), source: savedLoc.source === 'gps' ? 'gps' : 'search' } : null,
  settings,
  masjids: savedMasjids(), // { origin, list, at }
  jamaat: cleanTimesMap(store.get('jamaat', {})), // { [osm_id]: times }
  portal: { mode: 'signin', mine: null },
};

const metrics = createMetrics({ store, backend, enabled: () => state.settings.metrics });
let ticks = [];
let jamaatFetched = false;

const ctx = {
  state, store, backend, metrics,
  onTick: (fn) => ticks.push(fn),
  render,

  setLocation(loc) {
    if (!isCoord(loc)) return;
    state.loc = { ...coarse(loc), label: cleanText(loc.label, 60), source: loc.source === 'gps' ? 'gps' : 'search' };
    state.prevLoc = null;
    store.set('loc', state.loc); // kept until the user changes or clears it
    render();
  },
  renameLocation(label) { if (state.loc) { state.loc.label = cleanText(label, 60); store.set('loc', state.loc); render(); } },
  changeLocation() { state.prevLoc = state.loc; state.loc = null; render(); },
  cancelChange() { if (state.prevLoc) { state.loc = state.prevLoc; state.prevLoc = null; render(); } },

  updateSettings(patch) {
    Object.assign(state.settings, patch);
    store.set('settings', state.settings);
    if (patch.metrics === false) metrics.forget();
    render();
  },

  clearData(btn) { // two taps, no browser dialog (works the same inside the native app)
    if (btn.dataset.armed) { store.clear(); location.reload(); return; }
    btn.dataset.armed = '1';
    btn.textContent = 'Tap again to clear everything (location, saved masjids, sign-in)';
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Clear everything saved on this phone'; }, 5000);
  },

  /** Load the nearest masjids unless a fresh list for (about) this spot is cached. */
  async ensureMasjids(force = false) {
    const m = state.masjids, loc = state.loc;
    if (!loc || m?.loading) return;
    // after a failure here, only the user (Try again) or coming back online retries: never an automatic loop
    if (m?.error && m.errorFor && distanceKm(m.errorFor, loc) < 0.3 && !force) return;
    const fresh = m?.list && m.origin && distanceKm(m.origin, loc) < 0.3 && Date.now() - m.at < DAY;
    if (fresh && !force) { if (!jamaatFetched) ctx.refreshJamaat(); return; }
    state.masjids = { ...(m?.origin && distanceKm(m.origin, loc) < 0.3 ? m : {}), loading: true, error: '' };
    render();
    try {
      // live: the shared, cached search on our API (one OpenStreetMap lookup per area per week); demo: straight to OSM
      let list;
      try { list = backend.masjids ? nearestFrom(await backend.masjids(loc), loc, CONFIG.masjidLimit) : null; } catch { list = null; } // API down or over its daily limit
      if (!list) list = await nearestMasjids(loc, { limit: CONFIG.masjidLimit }); // fall back to OpenStreetMap directly
      state.masjids = { origin: { lat: loc.lat, lng: loc.lng }, list, at: Date.now() };
      store.set('masjids', state.masjids, 7 * DAY);
      await ctx.refreshJamaat();
    } catch (e) {
      state.masjids = { ...state.masjids, loading: false, error: e.message || 'Could not load masjids.', errorFor: { lat: loc.lat, lng: loc.lng } };
    }
    render();
  },

  /** Published jamaat times for the listed masjids and the ones this authority manages. */
  async refreshJamaat() {
    const ids = [...new Set([...(state.masjids?.list || []).map((x) => x.id), ...(state.portal.mine || []).map((x) => x.osm_id)])];
    if (!ids.length) return;
    jamaatFetched = true;
    try {
      state.jamaat = cleanTimesMap(await backend.times(ids));
      store.set('jamaat', state.jamaat, 6 * HOUR);
      render();
    } catch { /* keep the cached times; the card shows when they were updated */ }
  },

  setPortal(patch) { Object.assign(state.portal, patch); render(); },
  async loadMine() {
    if (state.portal.loadingMine) return;
    state.portal.loadingMine = true;
    try { state.portal.mine = await backend.myMasjids(); ctx.refreshJamaat(); }
    catch (e) {
      if (e.status === 401) await backend.signOut();
      toast(e.message, 'error');
      state.portal.mine = [];
    } finally { state.portal.loadingMine = false; render(); }
  },
  async signOut() { await backend.signOut(); state.portal = { mode: 'signin', mine: null }; toast('Signed out.'); render(); },

  /** Owner dashboard: live numbers, refreshed every 30 s while the Portal is open. */
  async loadStats() {
    if (!backend.stats || state.portal.loadingStats) return;
    state.portal.loadingStats = true;
    try {
      const [stats, claims] = await Promise.all([backend.stats(), backend.pendingClaims()]);
      state.portal.stats = stats; state.portal.claims = claims; state.portal.statsAt = Date.now(); state.portal.statsError = '';
    } catch (e) { state.portal.statsError = e.message; state.portal.statsAt = Date.now(); }
    finally { state.portal.loadingStats = false; if (tab() === 'portal') render(); }
  },
  async decideClaim(c, status) {
    try { await backend.decideClaim(c.user_id, c.osm_id, status); toast(status === 'approved' ? 'Approved.' : 'Rejected.'); }
    catch (e) { toast(e.message, 'error'); }
    ctx.loadStats();
  },
};

// ---------- rendering + routing ----------
const main = document.getElementById('main');
const tab = () => (own(VIEWS, location.hash.slice(1)) ? location.hash.slice(1) : 'prayer'); // "#__proto__" → home

function render() {
  ticks = [];
  const name = tab();
  const view = document.createElement('div');
  view.className = 'view';
  for (const n of [VIEWS[name](ctx)].flat()) if (n) view.append(n);
  mount(main, view);
  document.querySelectorAll('.tabbar a').forEach((a) => (a.dataset.tab === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

addEventListener('hashchange', () => { render(); scrollTo({ top: 0 }); main.focus({ preventScroll: true }); });
setInterval(() => { if (!document.hidden) ticks.forEach((f) => f()); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); }); // the day may have changed

// ---------- theme: dark by default (night-time use, OLED-friendly), remembered ----------
const themeBtn = document.getElementById('theme-btn');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'light' ? '#f7f2e8' : '#091215');
  themeBtn.setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  themeBtn.querySelector('use').setAttribute('href', t === 'light' ? '#i-moon' : '#i-sun');
}
applyTheme(store.get('theme') === 'light' ? 'light' : 'dark');
themeBtn.addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; store.set('theme', t); applyTheme(t); });

// ---------- connectivity ----------
const offline = document.getElementById('offline');
const net = () => { offline.hidden = navigator.onLine; };
addEventListener('online', () => { net(); if (tab() === 'masjids') ctx.ensureMasjids(true); });
addEventListener('offline', net);
net();
if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  offline.textContent = 'This page is not using a secure connection, so location and sign-in are turned off. Open it with https://.';
  offline.hidden = false;
}

// ---------- offline support (web only; the native app ships its files inside the package) ----------
if ('serviceWorker' in navigator && !window.Capacitor && location.protocol === 'https:') { // not on the dev server: edits show at once
  const tt = window.trustedTypes?.createPolicy('qarib-sw', { createScriptURL: (u) => { if (u !== './sw.js') throw new TypeError('blocked script URL'); return u; } });
  navigator.serviceWorker.register(tt ? tt.createScriptURL('./sw.js') : './sw.js').catch(() => {});
}

render();
metrics.open();
showSalawat(ctx);

// New app version on GitHub Releases → a quiet banner (Android app only; the website updates itself)
if (window.Capacitor) checkForUpdate(store).then((rel) => {
  if (!rel) return;
  const bar = document.getElementById('update');
  bar.querySelector('a').href = rel.url;
  bar.querySelector('b').textContent = `Version ${rel.version.replace(/^v/, '')} is available.`;
  bar.hidden = false;
});
