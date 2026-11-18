// Copies the app into www/ (deploy folder for static hosting, and Capacitor's webDir). No bundler needed:
// the app is plain ES modules. Fails if the tests fail, so a broken build never ships.
import { cp, rm, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { CONFIG } from '../src/config.js';

execSync('node --test tests/core.test.js tests/security.test.js tests/db.test.js', { stdio: 'inherit' });
await rm('www', { recursive: true, force: true });
await mkdir('www');
for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'styles', 'src', 'icons']) await cp(p, `www/${p}`, { recursive: true });
await copyFile('hosting/_headers', 'www/_headers');

// Pin the CSP to YOUR Supabase project (instead of any *.supabase.co), and drop the GitHub update check if it is off.
const host = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(CONFIG.supabaseUrl) ? CONFIG.supabaseUrl : '';
for (const f of ['www/index.html', 'www/_headers']) {
  let s = await readFile(f, 'utf8');
  if (!s.includes(' https://*.supabase.co')) throw new Error(`${f}: CSP placeholder https://*.supabase.co not found`);
  s = s.replace(' https://*.supabase.co', host ? ` ${host}` : '');
  if (!CONFIG.updateRepo) s = s.replace(' https://api.github.com', '');
  await writeFile(f, s);
}
console.log(`Built www/ (static hosting + Capacitor webDir). CSP backend: ${host || 'none (demo mode)'}; update check: ${CONFIG.updateRepo || 'off'}.`);
