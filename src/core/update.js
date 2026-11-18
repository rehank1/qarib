// "A new version is available" for the Android app (installed from GitHub Releases, so no store updates it).
// Source of truth: the owner's announcement in the database (Dashboard → Announce an update), pushed to every phone
// on its next open. GitHub Releases is the fallback. Nothing about the user is sent.
import { fetchJSON } from './net.js';
import { h } from './dom.js';
import { cleanText } from './validate.js';
import { CONFIG } from '../config.js';
import { HOUR } from './store.js';

const parseVer = (v) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v)) || []).slice(1).map(Number);
export function newer(latest, current) {
  const a = parseVer(latest), b = parseVer(current);
  if (a.length !== 3 || b.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
const releaseUrl = (u) => typeof u === 'string' && !!CONFIG.updateRepo && u.startsWith(`https://github.com/${CONFIG.updateRepo}/releases/`);

/** → { version, url, message } when a newer version exists, else null. */
export async function checkForUpdate(store, backend) {
  try { // 1. the owner's announcement (live, checked on every open)
    const v = backend?.appConfig ? await backend.appConfig() : null;
    if (v && newer(v.version, CONFIG.version) && releaseUrl(v.url)) return { version: String(v.version), url: v.url, message: cleanText(v.message, 300) };
  } catch { /* offline or backend down: try GitHub */ }
  if (!CONFIG.updateRepo || !/^[\w.-]+\/[\w.-]+$/.test(CONFIG.updateRepo)) return null;
  let rel = store.get('latestRelease'); // 2. GitHub Releases, at most once a day
  if (!rel) {
    try {
      const r = await fetchJSON(`https://api.github.com/repos/${CONFIG.updateRepo}/releases/latest`, { timeout: 8000 });
      rel = { version: String(r?.tag_name || '').replace(/^v/, ''), url: String(r?.html_url || ''), message: '' };
      store.set('latestRelease', rel, 24 * HOUR);
    } catch { return null; }
  }
  return releaseUrl(rel.url) && newer(rel.version, CONFIG.version) ? rel : null;
}

/** A clear in-app notice once per version (after the salawat reminder), then a quiet banner until they update. */
export function showUpdate(rel, store) {
  const bar = document.getElementById('update');
  bar.querySelector('a').href = rel.url;
  bar.querySelector('b').textContent = `Version ${rel.version} is available.`;
  bar.hidden = false;
  if (store.get('updateSeen') === rel.version) return;
  const open = () => {
    const later = h('button', { class: 'btn', type: 'button' }, 'Later');
    const get = h('a', { class: 'btn primary', href: rel.url, target: '_blank', rel: 'noopener noreferrer' }, 'Download the update');
    const dlg = h('dialog', { class: 'salawat update-dlg', 'aria-labelledby': 'upd-h' },
      h('p', { class: 'salawat-eyebrow', id: 'upd-h', text: 'Update available' }),
      h('p', { class: 'upd-v', text: `Qarīb ${rel.version}` }),
      rel.message ? h('p', { text: rel.message }) : null,
      h('p', { class: 'muted small', text: 'Download it, open the file and tap Install. Your settings are kept.' }),
      h('div', { class: 'row upd-actions' }, later, get));
    const close = () => { store.set('updateSeen', rel.version); dlg.close(); dlg.remove(); };
    later.addEventListener('click', close);
    get.addEventListener('click', () => setTimeout(close, 300));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.append(dlg);
    dlg.showModal();
    get.focus();
  };
  const salawat = document.getElementById('salawat');
  if (salawat) salawat.addEventListener('close', () => setTimeout(open, 250), { once: true }); else open();
}
