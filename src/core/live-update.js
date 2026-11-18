// Silent updates for the Android app. Every release publishes the app's web bundle (zip) and qarib-web.json
// ({ version, url, sha256, minNative }) on GitHub Releases. On each open the app checks that file; if there is a newer
// bundle it downloads it in the background, the updater verifies its SHA-256 before installing it, and it takes effect
// the next time the app is backgrounded or reopened. A bundle that fails to start is rolled back automatically.
// Only changes to the Android shell itself (permissions, plugins) still need an APK: then minNative is raised and the
// app shows the "Update available" notice instead.
import { CONFIG } from '../config.js';
import { newer } from './update.js';
import { DAY } from './store.js';

/** Is this manifest one we may install? Only our own repository's release assets, a real version and a SHA-256. */
export function acceptManifest(m, currentVersion, repo = CONFIG.updateRepo) {
  if (!m || typeof m !== 'object' || !repo) return false;
  const v = String(m.version || '');
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) && newer(v, currentVersion) && /^[0-9a-f]{64}$/.test(String(m.sha256 || ''))
    && typeof m.url === 'string' && m.url.startsWith(`https://github.com/${repo}/releases/download/v${v}/`) && m.url.endsWith('.zip');
}

/** → { ready: version } after a bundle is downloaded and queued; { needsApk: version } when only a new APK will do; null otherwise. */
export async function liveUpdate(store) {
  const P = window.Capacitor?.Plugins, U = P?.CapacitorUpdater, H = P?.CapacitorHttp;
  if (!U) return null;
  try { await U.notifyAppReady(); } catch { /* not fatal */ } // tells the updater this bundle started fine (else it rolls back)
  if (!H || !CONFIG.updateRepo) return null;
  try {
    const r = await H.get({ url: `https://github.com/${CONFIG.updateRepo}/releases/latest/download/qarib-web.json`, connectTimeout: 8000, readTimeout: 8000 });
    const m = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (r.status !== 200 || !acceptManifest(m, CONFIG.version)) return null;
    const native = String((await U.current())?.native || '0.0.0');
    if (m.minNative && newer(String(m.minNative), native)) return { needsApk: m.version };
    if (store.get('liveUpdate') === m.version) return { ready: m.version }; // already downloaded, waiting for a restart
    const bundle = await U.download({ url: m.url, version: m.version, checksum: m.sha256 }); // refused if the SHA-256 differs
    await U.next({ id: bundle.id });
    store.set('liveUpdate', m.version, 7 * DAY);
    return { ready: m.version };
  } catch { return null; } // offline or GitHub unreachable: try again next open
}
