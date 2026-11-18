// Portal for masjid authorities: sign in, ask to manage a masjid, publish its jamaat times.
// The UI only guides; the server decides (row-level security). In demo mode everything stays on this phone.
import { h, icon, toast } from '../../core/dom.js';
import { isEmail, passwordProblem, timesProblems } from '../../core/validate.js';
import { dashboard } from './dashboard.js';
import { formatDistance } from '../../core/geo.js';

export function portalView(ctx) {
  const { backend, state } = ctx;
  const demo = backend.mode === 'demo'
    ? h('p', { class: 'banner', role: 'note' }, h('b', { text: 'Demo mode. ' }), 'No server is connected, so accounts and times stay on this phone and are not shown to anyone else.')
    : null;
  const user = backend.user();
  return [h('h1', { text: 'Masjid portal' }), demo, user ? signedIn(ctx, user) : signInForm(ctx, state.portal)];
}

function signInForm(ctx, p) {
  const mode = p.mode || 'signin';
  const err = h('p', { class: 'err-text', role: 'alert' });
  const email = h('input', { id: 'pt-email', type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: '254' });
  const pass = h('input', { id: 'pt-pass', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', required: true, minlength: mode === 'signup' ? '10' : null, maxlength: '128' });
  const show = h('button', { class: 'link', type: 'button', 'aria-controls': 'pt-pass', 'aria-pressed': 'false', text: 'Show password' });
  show.addEventListener('click', () => { const on = pass.type === 'password'; pass.type = on ? 'text' : 'password'; show.setAttribute('aria-pressed', String(on)); show.textContent = on ? 'Hide password' : 'Show password'; });
  const submit = h('button', { class: 'btn primary block', type: 'submit', text: mode === 'signup' ? 'Create account' : 'Sign in' });

  const form = h('form', { class: 'card', novalidate: true, 'aria-labelledby': 'pt-h' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Account' },
      h('button', { type: 'button', 'aria-pressed': String(mode === 'signin'), onclick: () => ctx.setPortal({ mode: 'signin' }) }, 'Sign in'),
      h('button', { type: 'button', 'aria-pressed': String(mode === 'signup'), onclick: () => ctx.setPortal({ mode: 'signup' }) }, 'Create account')),
    h('h2', { id: 'pt-h', text: mode === 'signup' ? 'Create an authority account' : 'Sign in to update your masjid' }),
    h('div', { class: 'field' }, h('label', { for: 'pt-email', text: 'Email' }), email),
    h('div', { class: 'field' }, h('label', { for: 'pt-pass', text: 'Password' }), pass, mode === 'signup' ? h('span', { class: 'muted small', text: 'At least 10 characters. A phrase of three unrelated words is easy to remember and hard to guess.' }) : null, show),
    err, submit,
    mode === 'signin' && ctx.backend.mode === 'live' ? h('p', { class: 'muted small', text: 'Forgot your password? Ask the app owner to reset your account; there is no email reset, so nobody can take over an account through email.' }) : null,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = email.value.trim().toLowerCase();
    err.textContent = '';
    if (!isEmail(em)) { err.textContent = 'Enter a valid email address.'; email.focus(); return; }
    if (mode === 'signup') { const weak = passwordProblem(em, pass.value); if (weak) { err.textContent = weak; pass.focus(); return; } }
    else if (!pass.value) { err.textContent = 'Enter your password.'; pass.focus(); return; }
    submit.disabled = true; submit.textContent = 'Please wait…';
    try {
      if (mode === 'signup') {
        const r = await ctx.backend.signUp(em, pass.value);
        if (r.confirm) { toast('Check your email to confirm your account, then sign in.'); ctx.setPortal({ mode: 'signin' }); return; }
      } else await ctx.backend.signIn(em, pass.value);
      pass.value = '';
      ctx.setPortal({ mode: 'signin', mine: null });
      toast('Signed in.');
    } catch (ex) {
      err.textContent = /invalid login|credentials/i.test(ex.message) ? 'That email and password do not match.' : ex.message;
    } finally { submit.disabled = false; submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in'; }
  });
  return form;
}

function signedIn(ctx, user) {
  const p = ctx.state.portal;
  if (!p.mine) { queueMicrotask(() => ctx.loadMine()); return h('div', { class: 'card skeleton', 'aria-label': 'Loading' }); }

  const out = h('div', { class: 'stack' });
  out.append(h('section', { class: 'card spread' },
    h('div', { class: 'stack' }, h('span', { class: 'muted small', text: 'Signed in as' }), h('b', { text: user.email })),
    h('button', { class: 'btn', type: 'button', text: 'Sign out', onclick: () => ctx.signOut() })));
  if (user.isOwner && ctx.backend.stats) out.append(dashboard(ctx));

  for (const x of p.mine) {
    out.append(x.status === 'approved' ? editor(ctx, x) : h('section', { class: 'card spread' },
      h('b', { text: x.masjid_name }),
      x.status === 'pending' ? h('span', { class: 'pill warn', text: 'Waiting for approval' }) : h('span', { class: 'pill err', text: 'Not approved' })));
  }
  if (!p.mine.length) out.append(h('p', { class: 'muted', text: 'You do not manage a masjid yet. Choose yours below.' }));
  out.append(claimCard(ctx));
  return out;
}

function editor(ctx, x) {
  const cur = ctx.state.jamaat?.[x.osm_id] || {};
  const err = h('p', { class: 'err-text', role: 'alert' });
  const inputs = {};
  const field = (k, label, optional = false) => {
    inputs[k] = h('input', { id: `t-${k}-${x.osm_id.replace('/', '-')}`, type: 'time', value: cur[k] || '', required: !optional });
    return h('div', { class: 'field' }, h('label', { for: inputs[k].id, text: label + (optional ? ' (optional)' : '') }), inputs[k]);
  };
  const save = h('button', { class: 'btn primary block', type: 'submit', text: 'Publish times' });
  const form = h('form', { class: 'card', novalidate: true },
    h('div', { class: 'spread' }, h('h2', { text: x.masjid_name }), h('span', { class: 'pill ok' }, icon('check'), 'You manage this')),
    h('p', { class: 'muted small', text: 'Jamaat (congregation) times. Worshippers see them on the Masjids tab with the date you published them.' }),
    h('div', { class: 'times-form' }, field('fajr', 'Fajr'), field('dhuhr', 'Dhuhr'), field('asr', 'Asr'), field('maghrib', 'Maghrib'), field('isha', 'Isha'), field('jumuah', "Jumu'ah", true)),
    err, save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    const problems = timesProblems(t);
    if (problems.length) { err.textContent = problems.join(' '); return; }
    save.disabled = true; err.textContent = '';
    try { await ctx.backend.saveTimes(x.osm_id, t); toast(ctx.backend.mode === 'demo' ? 'Saved on this phone (demo).' : 'Published. Worshippers will see the new times.'); ctx.showPublished(x.osm_id, t); ctx.refreshJamaat(true); }
    catch (ex) { err.textContent = ex.status === 401 || ex.status === 403 ? 'You are not allowed to change this masjid. Sign in again, or ask the app owner to approve you.' : ex.message; }
    finally { save.disabled = false; }
  });
  return form;
}

function claimCard(ctx) {
  const p = ctx.state.portal, loc = ctx.state.loc;
  if (!loc) {
    return h('section', { class: 'card' }, h('h2', { text: 'Manage a masjid' }),
      h('p', { class: 'muted', text: 'First set your area on the Prayer tab (your location or a city search); the masjids around it will appear here.' }),
      h('a', { class: 'btn', href: '#prayer', text: 'Set my area' }));
  }
  if (p.claimableFor !== `${loc.lat},${loc.lng}`) { queueMicrotask(() => ctx.loadClaimable()); return h('div', { class: 'card skeleton', 'aria-label': 'Loading nearby masjids' }); }
  const list = (p.claimable || []).filter((m) => !p.mine.some((x) => x.osm_id === m.id));
  if (!list.length) {
    return h('section', { class: 'card' }, h('h2', { text: 'Manage a masjid' }),
      h('p', { class: 'muted', text: `No masjids found around ${loc.label || 'your area'}. Change your area on the Prayer tab to where the masjid is.` }),
      h('a', { class: 'btn', href: '#prayer', text: 'Change area' }));
  }
  const sel = h('select', { id: 'claim-sel' }, ...list.map((m) => h('option', { value: m.id }, `${m.name} · ${formatDistance(m.km)}`)));
  const btn = h('button', { class: 'btn primary block', type: 'button', text: ctx.backend.mode === 'demo' ? 'Manage this masjid' : 'Request to manage' });
  btn.addEventListener('click', async () => {
    const m = list.find((x) => x.id === sel.value);
    btn.disabled = true;
    try { await ctx.backend.claim(m.id, m.name); toast(ctx.backend.mode === 'demo' || ctx.backend.user()?.isOwner ? 'Added. You can publish its times now.' : 'Request sent. You can publish times once it is approved.'); ctx.setPortal({ mine: null }); }
    catch (ex) { toast(/duplicate|23505/.test(ex.message + ex.code) ? 'You already asked for this masjid.' : ex.message, 'error'); }
    finally { btn.disabled = false; }
  });
  return h('section', { class: 'card' }, h('h2', { text: 'Manage a masjid' }),
    h('p', { class: 'muted small', text: ctx.backend.mode === 'demo' ? 'In demo mode you are approved at once.' : 'The app owner checks each request before you can publish times, so nobody can post false times for a masjid.' }),
    h('div', { class: 'field' }, h('label', { for: 'claim-sel', text: `Masjids near ${loc.label || 'you'} (nearest first)` }), sel),
    h('p', { class: 'muted small' }, 'Not listed? ', h('a', { class: 'link', href: '#prayer', text: 'Change your area' }), ' to where the masjid is. If it is missing from the map, add it on OpenStreetMap.'),
    btn);
}
