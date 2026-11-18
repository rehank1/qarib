// DOM building without HTML strings. Every piece of text goes through textContent, so data from OpenStreetMap,
// the backend or the user can never become markup. The page CSP also enforces Trusted Types: innerHTML would throw.

const SAFE_HREF = /^(https:\/\/|#|\.\/)/;

/** h('a', { class: 'btn', href: 'https://…', onclick: fn }, 'label', childNode) */
export function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else {
      if ((k === 'href' || k === 'src') && !SAFE_HREF.test(String(v))) throw new Error(`blocked ${k}`);
      n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(n, kids);
  return n;
}

function append(n, kids) {
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
}

const SVG = 'http://www.w3.org/2000/svg';
/** An icon from the sprite in index.html. Decorative unless a label is given. */
export function icon(id, label = '') {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', 'ico');
  if (label) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', label); } else s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', `#i-${id}`);
  s.append(u);
  return s;
}

/** Replace a container's children in one go (one layout, no flicker). */
export const mount = (root, ...kids) => { root.replaceChildren(); append(root, kids); };

/** Announce a short message to screen readers and show it as a toast. */
export function toast(text, kind = 'info') {
  const box = document.getElementById('toast');
  if (!box) return;
  box.dataset.kind = kind;
  box.textContent = text;
  box.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { box.hidden = true; }, 3800);
}
