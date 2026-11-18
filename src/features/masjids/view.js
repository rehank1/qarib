// The 3–4 nearest masjids: name, distance, walking time, jamaat times when the masjid publishes them, directions.
import { h, icon } from '../../core/dom.js';
import { directionsUrl, formatDistance, walkMinutes } from '../../core/geo.js';
import { ago, daysSince } from '../../core/format.js';
import { clock } from '../prayer/praytimes.js';
import { locationPanel } from '../location/view.js';
import { CONFIG } from '../../config.js';

export function masjidsView(ctx) {
  const { state } = ctx;
  if (!state.loc) return [locationPanel(ctx, { title: 'Find the nearest masjids' })];
  const m = state.masjids;
  queueMicrotask(() => ctx.ensureMasjids()); // after this render finishes (never re-render from inside a render)

  const head = h('section', { class: 'spread' },
    h('div', { class: 'stack' }, h('h1', { text: 'Nearest masjids' }), h('p', { class: 'muted small', text: `${state.loc.label || 'Your location'}${m?.at ? ' · updated ' + ago(m.at) : ''}` })),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Refresh the list', onclick: () => ctx.ensureMasjids(true), disabled: m?.loading }, icon('refresh')),
  );

  let body;
  if (m?.loading && !m.list?.length) body = Array.from({ length: CONFIG.masjidLimit }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' }));
  else if (m?.error && !m.list?.length) body = [h('section', { class: 'card empty', role: 'alert' }, icon('alert'), h('p', { text: m.error }), h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.ensureMasjids(true), text: 'Try again' }))];
  else if (m?.list && !m.list.length) body = [h('section', { class: 'card empty' }, h('p', { text: 'No masjids are mapped within 30 km. If you know one, you can add it to OpenStreetMap.' }))];
  else body = (m?.list || []).map((x, i) => card(ctx, x, i));

  return [
    head,
    m?.error && m.list?.length ? h('p', { class: 'banner', role: 'status', text: `${m.error} Showing the list saved ${ago(m.at)}.` }) : null,
    h('div', { class: 'stack', 'aria-busy': m?.loading ? 'true' : 'false' }, ...body),
    h('p', { class: 'attrib' }, 'Masjid data © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer', text: 'OpenStreetMap contributors' })),
  ];
}

function card(ctx, x, i) {
  const t = ctx.state.jamaat?.[x.id];
  const h12 = ctx.state.settings.clock !== '24';
  const fmt = (v) => { const [hh, mm] = v.split(':').map(Number); return clock(hh * 60 + mm, h12).replace(/ (AM|PM)$/, (s) => s.toLowerCase()); };
  const stale = t && daysSince(t.updatedAt) > CONFIG.staleDays;

  const times = t ? h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('span', { class: 'pill ok' }, icon('check'), 'Published by the masjid'),
      h('span', { class: `small ${stale ? '' : 'muted'}`, text: stale ? `Updated ${ago(t.updatedAt)}, may be out of date` : `Updated ${ago(t.updatedAt)}` })),
    h('div', { class: 'jamaat num', 'aria-label': 'Jamaat times' }, ...['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map((k) => h('div', {}, k[0].toUpperCase() + k.slice(1), h('b', { text: fmt(t[k]) })))),
    t.jumuah ? h('p', { class: 'small muted', text: `Jumu'ah ${fmt(t.jumuah)}` }) : null,
  ) : h('p', { class: 'muted small', text: 'Jamaat times not published yet. Imams and committees can publish them from the Portal tab.' });

  ctx.metrics?.view(x.id); // anonymous count for the owner dashboard (once per masjid per session)
  const walk = x.km < 2; // walking directions nearby, driving further away
  const dir = h('a', { class: `btn ${i ? '' : 'primary'} block`, href: directionsUrl(x, walk ? 'walking' : 'driving'), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Directions to ${x.name} in Google Maps` },
    icon('route'), walk ? `Directions · ${walkMinutes(x.km)} min walk` : 'Directions · drive');
  dir.addEventListener('click', () => ctx.metrics?.directions(x.id));

  return h('article', { class: 'card masjid', 'aria-labelledby': `m-${i}` },
    h('div', { class: 'row' }, h('span', { class: `rank${i ? '' : ' first'}`, text: String(i + 1), 'aria-hidden': 'true' }),
      h('div', { class: 'title' }, h('h3', { id: `m-${i}`, text: x.name }), x.nameAr && x.nameAr !== x.name ? h('span', { lang: 'ar', dir: 'rtl', text: x.nameAr }) : null)),
    h('div', { class: 'meta' }, h('span', {}, h('b', { text: formatDistance(x.km) }), ' away'), h('span', { text: `about ${walkMinutes(x.km)} min walk` }), x.address ? h('span', { text: x.address }) : null),
    times,
    dir,
  );
}
