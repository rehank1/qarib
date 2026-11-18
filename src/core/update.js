// "A new version is available" for the Android app, which is installed from GitHub Releases (no Play Store to
// update it). Checks the public GitHub Releases API at most once a day; nothing about the user is sent.
import { fetchJSON } from './net.js';
import { CONFIG } from '../config.js';
import { HOUR } from './store.js';

const parseVer = (v) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v)) || []).slice(1).map(Number);
export function newer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  if (a.length !== 3 || b.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** → { version, url } when a newer release exists, else null. */
export async function checkForUpdate(store) {
  if (!CONFIG.updateRepo || !/^[\w.-]+\/[\w.-]+$/.test(CONFIG.updateRepo)) return null;
  let rel = store.get('latestRelease');
  if (!rel) {
    try {
      const r = await fetchJSON(`https://api.github.com/repos/${CONFIG.updateRepo}/releases/latest`, { timeout: 8000 });
      rel = { version: String(r?.tag_name || ''), url: String(r?.html_url || '') };
      store.set('latestRelease', rel, 24 * HOUR);
    } catch { return null; }
  }
  const okUrl = rel.url.startsWith(`https://github.com/${CONFIG.updateRepo}/releases/`);
  return okUrl && newer(rel.version, CONFIG.version) ? rel : null;
}
