// Home: the next prayer as the one focal point, then today's times, then (folded away) calculation settings.
import { h, icon } from '../../core/dom.js';
import { countdown } from '../../core/format.js';
import { schedule, clock, hijriLabel, LABELS, ARABIC, METHODS, ASR } from './praytimes.js';
import { locationPanel } from '../location/view.js';

export function prayerView(ctx) {
  const { state } = ctx;
  if (!state.loc) return [locationPanel(ctx)];

  const now = new Date();
  const s = schedule(state.loc, state.settings, now);
  const h12 = state.settings.clock !== '24';
  const label = (k) => (k === 'dhuhr' && s.isFriday ? "Jumu'ah" : LABELS[k]);

  const left = h('span', { class: 'left num', text: countdown(s.nextAt - now) });
  ctx.onTick(() => {
    const ms = s.nextAt - Date.now();
    if (ms <= 0) return ctx.render(); // the prayer time arrived: move the highlight on
    left.textContent = countdown(ms);
  });

  const hero = h('section', { class: 'hero', 'aria-live': 'off' },
    h('span', { class: 'eyebrow', text: 'Next prayer' }),
    h('div', { class: 'name' }, h('strong', { text: label(s.next) }), h('span', { lang: 'ar', dir: 'rtl', text: ARABIC[s.next] })),
    h('div', { class: 'when num', text: clock(Math.round((s.nextAt - new Date(s.nextAt).setHours(0, 0, 0, 0)) / 60000), h12) }),
    left,
  );

  const list = h('ol', { class: 'times', 'aria-label': 'Prayer times today' },
    ...['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((k) => h('li', { class: k === 'sunrise' ? 'minor' : k === s.current ? 'now' : '', 'aria-current': k === s.current ? 'time' : null },
      h('span', { class: 'n' }, label(k), k === s.current ? h('span', { class: 'pill gold', text: 'Now' }) : null),
      h('span', { class: 'ar', lang: 'ar', dir: 'rtl', text: ARABIC[k] }),
      h('span', { class: 't num', text: clock(s.times[k], h12) }),
    )));

  const place = h('div', { class: 'spread' },
    h('div', { class: 'place' }, icon('pin'), h('div', { class: 'stack' }, h('b', { text: state.loc.label || 'Your location' }), h('span', { class: 'muted small', text: `${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${hijriLabel(now, state.settings.hijriAdjust)}` }))),
    h('button', { class: 'btn', type: 'button', onclick: () => ctx.changeLocation() }, 'Change'),
  );

  return [
    h('section', { class: 'card' }, place),
    hero,
    h('section', { class: 'card' }, h('h2', { text: 'Today' }), list, h('p', { class: 'muted small', text: `${METHODS[state.settings.method].name} · Asr ${ASR[state.settings.asr].name}. These are the start times; your masjid's jamaat times are on the Masjids tab.` })),
    settingsCard(ctx),
  ];
}

function settingsCard(ctx) {
  const st = ctx.state.settings;
  const select = (id, labelText, value, options, key) => {
    const sel = h('select', { id }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    sel.addEventListener('change', () => ctx.updateSettings({ [key]: sel.value }));
    return h('div', { class: 'field' }, h('label', { for: id, text: labelText }), sel);
  };
  const clear = h('button', { class: 'link', type: 'button', text: 'Clear everything saved on this phone' });
  clear.addEventListener('click', () => ctx.clearData(clear));
  return h('details', { class: 'card settings' },
    h('summary', {}, icon('gear'), 'Calculation and display'),
    h('p', { class: 'muted small', text: `Calculation: ${METHODS.india.name}, as used by masjids across India.` }),
    select('set-asr', 'Asr time', st.asr, Object.entries(ASR).map(([k, a]) => [k, a.name]), 'asr'),
    hijriSelect(ctx),
    select('set-clock', 'Clock', st.clock || '12', [['12', '12-hour'], ['24', '24-hour']], 'clock'),
    salawatToggle(ctx),
    usageToggle(ctx),
    clear,
  );
}

function hijriSelect(ctx) {
  const opts = [[-1, 'One day behind Saudi (usual in India)'], [0, 'Same as Saudi (Umm al-Qura)'], [1, 'One day ahead']];
  const sel = h('select', { id: 'set-hijri' }, ...opts.map(([v, l]) => h('option', { value: String(v), selected: v === ctx.state.settings.hijriAdjust }, l)));
  sel.addEventListener('change', () => ctx.updateSettings({ hijriAdjust: Number(sel.value) }));
  return h('div', { class: 'field' }, h('label', { for: 'set-hijri', text: 'Hijri date' }), sel,
    h('span', { class: 'muted small', text: 'Match the date your local Hilal committee announces.' }));
}

function salawatToggle(ctx) {
  const sel = h('select', { id: 'set-salawat' }, h('option', { value: 'on', selected: ctx.state.settings.salawat }, 'Show when the app opens'), h('option', { value: 'off', selected: !ctx.state.settings.salawat }, 'Off'));
  sel.addEventListener('change', () => ctx.updateSettings({ salawat: sel.value === 'on' }));
  return h('div', { class: 'field' }, h('label', { for: 'set-salawat', text: 'Salawat reminder' }), sel);
}

/** Anonymous usage counts: explained in plain words, easy to turn off. */
function usageToggle(ctx) {
  const sel = h('select', { id: 'set-metrics' }, h('option', { value: 'on', selected: ctx.state.settings.metrics }, 'Share anonymous counts'), h('option', { value: 'off', selected: !ctx.state.settings.metrics }, 'Off'));
  sel.addEventListener('change', () => ctx.updateSettings({ metrics: sel.value === 'on' }));
  return h('div', { class: 'field' }, h('label', { for: 'set-metrics', text: 'Usage counts' }), sel,
    h('span', { class: 'muted small', text: 'Counts how often the app is opened and which masjids get directions, so the volunteers know it helps. Never your location, name or anything that identifies you.' }));
}
