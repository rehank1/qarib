// Security and colour checks over the source itself. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { demoBackend } from '../src/data/demo.js';
import { createStore } from '../src/core/store.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const files = (dir) => readdirSync(join(ROOT, dir)).flatMap((f) => (statSync(join(ROOT, dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const SRC = files('src').filter((f) => f.endsWith('.js'));

test('no HTML sinks or eval anywhere in the app code', () => {
  for (const f of SRC) {
    const code = readFileSync(join(ROOT, f), 'utf8');
    for (const bad of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function\(/, /\bon\w+\s*=\s*["']/]) assert.ok(!bad.test(code), `${f}: ${bad}`);
  }
});

test('no secrets in the source (service-role keys, private keys)', () => {
  for (const f of [...SRC, 'index.html']) {
    const code = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(!/service_role|-----BEGIN [A-Z ]*PRIVATE KEY/.test(code), f);
  }
});

test('CSP: strict, Trusted Types on, same connect-src in the page and the headers', () => {
  const meta = readFileSync(join(ROOT, 'index.html'), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const hdr = readFileSync(join(ROOT, 'hosting/_headers'), 'utf8').match(/Content-Security-Policy: (.+)/)[1];
  for (const csp of [meta, hdr]) {
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
    assert.match(csp, /require-trusted-types-for 'script'/);
  }
  assert.equal(meta.match(/connect-src[^;]*/)[0], hdr.match(/connect-src[^;]*/)[0]);
  assert.match(hdr, /frame-ancestors 'none'/);
});

test('index.html has no inline script or inline style (both would be blocked by the CSP)', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'inline <script>');
  assert.ok(!/<style/.test(html) && !/\sstyle="/.test(html), 'inline style');
});

test('service worker precaches every app module', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  for (const f of SRC) assert.ok(sw.includes(`'./${f.replace(/\\/g, '/')}'`), `sw.js is missing ${f}`);
});

// ---------- demo backend: hashing, lockout, no account probing ----------
function memory() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; }
test('demo backend: passwords are salted PBKDF2, wrong logins lock out after 5 tries', { timeout: 120000 }, async () => {
  const store = createStore(memory());
  const b = demoBackend({ store });
  await b.signUp('imam@x.org', 'velvet lantern monsoon');
  const rec = store.get('demo:users')['imam@x.org'];
  assert.ok(rec.salt && rec.hash && !JSON.stringify(rec).includes('velvet'));
  await b.signOut();
  await assert.rejects(b.signIn('nobody@x.org', 'whatever123'), /do not match/); // same message as a wrong password
  for (let i = 0; i < 5; i++) await assert.rejects(b.signIn('imam@x.org', 'wrong password'), /do not match/);
  await assert.rejects(b.signIn('imam@x.org', 'velvet lantern monsoon'), /Too many attempts/);
});

// ---------- colour: WCAG AA for every text role on every surface, both themes ----------
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8');
const theme = (sel) => Object.fromEntries([...css.slice(css.indexOf(sel)).split('}')[0].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, k, v]) => [k, v]));
for (const [name, sel] of [['dark', ':root[data-theme="dark"]'], ['light', ':root[data-theme="light"]']]) {
  test(`contrast ≥ 4.5:1 for every text role (${name})`, () => {
    const t = theme(sel);
    for (const fg of ['text', 'muted', 'gold', 'emerald', 'amber', 'danger']) for (const bg of ['bg', 'surface', 'surface-2']) {
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${name}: --${fg} ${t[fg]} on --${bg} ${t[bg]} = ${r.toFixed(2)}`);
    }
    assert.ok(ratio(t['on-gold'], t.gold) >= 4.5, `${name}: primary button text`);
  });
}

test('database: owner set by hand only, public reads never include who edited, no secrets in the app', () => {
  const sql = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8') + readFileSync(join(ROOT, 'supabase/directory.sql'), 'utf8');
  const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  assert.ok(!/update\s+public\.profiles\s+set\s+is_owner/i.test(code), 'no function can make anyone owner');
  assert.ok(sql.includes('grant select (osm_id, fajr, dhuhr, asr, maghrib, isha, jumuah, updated_at) on public.prayer_times to anon, authenticated'));
  const configCode = readFileSync(join(ROOT, 'src/config.js'), 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/service_role/.test(configCode), 'never the service_role key');
  for (const fn of ['admin_claims', 'decide_claim', 'set_update_notice', 'admin_stats']) {
    const body = code.slice(code.indexOf('function public.' + fn));
    assert.ok(body.slice(0, body.indexOf('end $$')).includes('if not public.is_owner() then raise'), fn + ' is owner-only');
  }
});

test('dev server listens on this computer only', () => {
  assert.match(readFileSync(join(ROOT, 'tools/serve.mjs'), 'utf8'), /listen\(port, '127\.0\.0\.1'/);
});
