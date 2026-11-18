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

  const q = h('input', { id: 'city-q', type: 'search', placeholder: 'Search a city or area', autocomplete: 'off', maxlength: '80', enterkeyhint: 'search', 'aria-label': 'City or area' });
  const go = h('button', { class: 'btn', type: 'submit', 'aria-label': 'Search' }, icon('search'));
  const form = h('form', { class: 'search', role: 'search' }, q, go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; go.disabled = true;
    try {
      const rows = await searchPlaces(q.value);
      results.replaceChildren(...(rows.length ? rows.map((r) => h('li', {}, h('button', { type: 'button', onclick: () => ctx.setLocation({ lat: r.lat, lng: r.lng, label: r.short, source: 'search' }) }, r.label))) : [h('li', { class: 'muted small', text: 'No places found. Try a nearby town.' })]));
    } catch (ex) { err.textContent = ex.message; }
    finally { go.disabled = false; }
  });

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
