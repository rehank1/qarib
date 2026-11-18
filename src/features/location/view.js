// "Where are you?" — asked in context (never on page load), with a city search for people who say no.
import { h, icon } from '../../core/dom.js';
import { currentPosition } from '../../core/geo.js';
import { searchPlaces, placeName } from './places.js';

export function locationPanel(ctx, { title = 'Find prayer times and masjids near you', lead = 'Your location stays on this phone. It is rounded to about 100 m and only used to calculate times and find masjids.' } = {}) {
  const err = h('p', { class: 'err-text', role: 'alert' });
  const results = h('ul', { class: 'results' });
  const useBtn = h('button', { class: 'btn primary block', type: 'button' }, icon('pin'), 'Use my location');

  useBtn.addEventListener('click', async () => {
    useBtn.disabled = true; err.textContent = '';
    useBtn.lastChild.textContent = 'Finding you…';
    try {
      const p = await currentPosition();
      ctx.setLocation({ ...p, label: 'Current location', source: 'gps' });
      placeName(p).then((label) => label && ctx.renameLocation(label));
    } catch (e) { err.textContent = e.message; }
    finally { useBtn.disabled = false; useBtn.lastChild.textContent = 'Use my location'; }
  });

  const form = areaSearch({ near: ctx.state.prevLoc, onPick: (r) => ctx.setLocation({ lat: r.lat, lng: r.lng, label: r.label, source: 'search' }), results, err });

  const mark = icon('star');
  mark.classList.add('big');
  return h('section', { class: 'card empty' },
    mark,
    h('h1', { text: title }),
    h('p', { class: 'muted', text: lead }),
    h('div', { class: 'stack full' }, useBtn, h('p', { class: 'muted small', text: 'or' }), form, results, err,
      ctx.state.prevLoc ? h('button', { class: 'link', type: 'button', onclick: () => ctx.cancelChange() }, `Keep ${ctx.state.prevLoc.label || 'the current location'}`) : null),
  );
}

/** Type-ahead area search: suggestions appear as you type (title + district/state), tap one to choose it. */
export function areaSearch({ onPick, near = null, results = h('ul', { class: 'results' }), err = h('p', { class: 'err-text', role: 'alert' }), placeholder = 'Search an area, e.g. Camp, Pune', id = 'city-q' }) {
  const q = h('input', { id, type: 'search', placeholder, autocomplete: 'off', autocapitalize: 'words', maxlength: '80', enterkeyhint: 'search', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-label': 'Area or city' });
  results.id = `${id}-list`; results.setAttribute('role', 'listbox');
  let seq = 0, timer = 0, rows = [];
  const show = (list) => {
    rows = list;
    q.setAttribute('aria-expanded', String(list.length > 0));
    results.replaceChildren(...list.map((r) => h('li', { role: 'option' }, h('button', { type: 'button', class: 'suggestion', onclick: () => { q.value = r.title; results.replaceChildren(); onPick(r); } },
      h('span', { class: 'sugg-title', text: r.title }), r.subtitle ? h('span', { class: 'sugg-sub', text: r.subtitle }) : null))));
  };
  q.addEventListener('input', () => {
    clearTimeout(timer); err.textContent = '';
    const mine = ++seq, text = q.value;
    if (text.trim().length < 2) return show([]);
    timer = setTimeout(async () => {
      try { const list = await searchPlaces(text, { near }); if (mine === seq) { show(list); if (!list.length) results.replaceChildren(h('li', { class: 'muted small', text: 'No matching area. Try the city name.' })); } }
      catch (ex) { if (mine === seq) err.textContent = ex.message; }
    }, 250); // wait for a short pause in typing: fewer requests, no flicker
  });
  const form = h('form', { class: 'search', role: 'search' }, q);
  form.addEventListener('submit', (e) => { e.preventDefault(); if (rows[0]) { results.replaceChildren(); onPick(rows[0]); } });
  return h('div', { class: 'stack' }, form, results, err);
}
