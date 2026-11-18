// Owner dashboard: live, anonymous numbers (refreshed every 30 s while open) and imam requests to approve.
// Only shown to the owner account; the API refuses these calls for anyone else.
import { h, icon } from '../../core/dom.js';
import { ago } from '../../core/format.js';
import { cleanText } from '../../core/validate.js';

const n = (v) => (Number.isFinite(+v) ? Number(v).toLocaleString() : '0');

/**
 * The dashboard panel. It refreshes itself every 30 s by replacing only its own contents, so anything else on the
 * Portal screen (for example the jamaat-times form the owner may be filling in) is never redrawn or lost.
 */
export function dashboard(ctx) {
  const wrap = h('div', { class: 'dash-wrap' }, build(ctx));
  let tick = 0;
  const refresh = async () => { await ctx.loadStats(); if (wrap.isConnected) wrap.replaceChildren(build(ctx)); };
  if (!ctx.state.portal.statsAt) queueMicrotask(refresh);
  ctx.onTick(() => { if (++tick >= 30) { tick = 0; refresh(); } }); // live: every 30 s
  ctx.refreshDashboard = refresh; // after Approve / Reject / Remove
  return wrap;
}

function build(ctx) {
  const p = ctx.state.portal;
  const s = p.stats;
  const pending = (p.claims || []).filter((c) => c.status !== 'approved'), approved = (p.claims || []).filter((c) => c.status === 'approved');
  if (!s) return h('section', { class: 'card' }, h('h2', { text: 'Dashboard' }), h('p', { class: 'muted', text: p.statsError || 'Loading live numbers…' }));

  const tiles = [['Active today', s.today.active], ['App opens today', s.today.opens], ['Directions today', s.today.directions], ['Masjids with times', s.totals.published]];
  const days = lastDays(14), byDay = Object.fromEntries((s.activeByDay || []).map((r) => [r.day, r.n]));
  const max = Math.max(1, ...days.map((d) => byDay[d] || 0));

  return h('section', { class: 'card dash', 'aria-labelledby': 'dash-h' },
    h('div', { class: 'spread' }, h('h2', { id: 'dash-h', text: 'Dashboard' }),
      h('span', { class: 'pill ok' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), `Live · ${ago(p.statsAt)}`)),
    p.statsError ? h('p', { class: 'err-text', role: 'alert', text: `${p.statsError} Showing the last numbers.` }) : null,
    h('div', { class: 'tiles' }, ...tiles.map(([k, v]) => h('div', { class: 'tile' }, h('b', { class: 'num', text: n(v) }), h('span', { text: k })))),

    h('h3', { text: 'Active users, last 14 days' }),
    h('div', { class: 'bars', role: 'img', 'aria-label': days.map((d) => `${d}: ${byDay[d] || 0}`).join(', ') },
      ...days.map((d) => { const b = h('div', { class: 'bar', title: `${d}: ${byDay[d] || 0}` }, h('span', { class: 'num', text: byDay[d] ? n(byDay[d]) : '' })); b.dataset.h = String(Math.round(((byDay[d] || 0) / max) * 10)); return b; })),
    h('p', { class: 'muted small', text: 'Each phone counts once per day. Phones cannot be followed from one day to the next.' }),

    h('h3', { text: 'Most visited masjids, last 7 days' }),
    s.topMasjids?.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'num' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Masjid' }), h('th', { scope: 'col', text: 'Directions' }), h('th', { scope: 'col', text: 'Shown' }))),
        h('tbody', {}, ...s.topMasjids.map((m) => h('tr', {}, h('th', { scope: 'row', text: cleanText(m.name, 60) }), h('td', { text: n(m.directions) }), h('td', { text: n(m.views) }))))))
      : h('p', { class: 'muted small', text: 'No visits yet.' }),

    h('h3', { text: `Imam requests (${n(pending.length)})` }),
    ...(pending.length ? pending.map((c) => claimRow(ctx, c)) : [h('p', { class: 'muted small', text: 'Nothing waiting.' })]),
    h('h3', { text: `Approved imams (${n(approved.length)})` }),
    ...(approved.length ? approved.map((c) => approvedRow(ctx, c)) : [h('p', { class: 'muted small', text: 'None yet.' })]),
    h('p', { class: 'muted small', text: `${n(s.totals.authorities)} imam accounts · ${n(s.totals.updates7d)} time updates this week` }),
  );
}

function claimRow(ctx, c) {
  return h('div', { class: 'claim' },
    h('div', { class: 'stack' }, h('b', { text: cleanText(c.masjid_name, 80) }), h('span', { class: 'muted small', text: `${cleanText(c.email, 80)} · ${ago(c.created_at)}` })),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.decideClaim(c, 'rejected') }, 'Reject'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.decideClaim(c, 'approved') }, icon('check'), 'Approve')));
}

/** Remove an approved imam: two taps (no browser dialog), so it can't happen by accident. */
function approvedRow(ctx, c) {
  const twoTap = (label, armed, run) => {
    const b = h('button', { class: 'btn', type: 'button', text: label });
    b.addEventListener('click', () => {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = armed; setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, 4000); return; }
      run();
    });
    return b;
  };
  return h('div', { class: 'claim' },
    h('div', { class: 'stack' }, h('b', { text: cleanText(c.masjid_name, 80) }), h('span', { class: 'muted small', text: cleanText(c.email, 80) })),
    h('div', { class: 'row' },
      twoTap('Remove', 'Tap again to remove', () => ctx.decideClaim(c, 'rejected')),
      twoTap('Remove and hide times', 'Tap again: hide their times too', () => ctx.decideClaim(c, 'rejected', true))));
}

function lastDays(k) {
  return Array.from({ length: k }, (_, i) => new Date(Date.now() - (k - 1 - i) * 864e5).toISOString().slice(0, 10));
}
