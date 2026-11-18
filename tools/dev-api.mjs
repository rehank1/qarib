// Local API for development and end-to-end testing: the real Worker code (api/src/index.js) over a real SQLite file,
// served on http://localhost:8787. Usage:
//   node tools/dev-api.mjs                 (OpenStreetMap through the real mirrors)
//   node tools/dev-api.mjs --fake-osm      (a fixed set of Pune masjids, for offline testing)
//   node tools/dev-api.mjs --owner you@example.com   (make an existing account the owner, then exit)
// Run the app against it with:  QARIB_DEV_API=http://localhost:8787 node tools/serve.mjs . 4180
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../api/src/index.js';

const DEV = new URL('../.dev/', import.meta.url); // always qarib/.dev, whatever folder this is started from
mkdirSync(DEV, { recursive: true });
const db = new DatabaseSync(new URL('qarib.sqlite', DEV).pathname.replace(/^\/([A-Z]:)/, '$1'));
db.exec(readFileSync(new URL('../api/schema.sql', import.meta.url), 'utf8'));

const ownerIdx = process.argv.indexOf('--owner');
if (ownerIdx > 0) {
  const r = db.prepare('UPDATE users SET is_owner = 1 WHERE email = ?').run(String(process.argv[ownerIdx + 1] || '').toLowerCase());
  console.log(r.changes ? 'Owner set.' : 'No account with that email yet: sign up in the app first.');
  process.exit(0);
}

const returnsRows = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  exec: () => (returnsRows(sql) ? { results: db.prepare(sql).all(...args) } : { results: [], meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
});
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { const out = list.map((s) => s.exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };

const FAKE = { elements: [
  { type: 'node', id: 9101, lat: 18.5166, lon: 73.8804, tags: { name: 'Jama Masjid Camp', 'addr:street': 'Main Street', 'addr:city': 'Pune' } },
  { type: 'way', id: 9202, center: { lat: 18.5215, lon: 73.8742 }, tags: { name: 'Masjid-e-Noor' } },
  { type: 'node', id: 9303, lat: 18.5102, lon: 73.8851, tags: { name: 'Masjid Ahle Hadees' } },
  { type: 'node', id: 9404, lat: 18.5301, lon: 73.8900, tags: { name: 'Bohri Masjid' } },
] };
const deps = process.argv.includes('--fake-osm') ? { fetcher: async () => FAKE } : {};

const env = { DB, PEPPER: 'local-dev-pepper-not-for-production-0123456789', ALLOWED_ORIGINS: 'http://localhost:4180,http://localhost:4181,https://localhost' };
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await handle(new Request(`http://localhost:8787${req.url}`, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '127.0.0.1' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, {}, deps);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, '127.0.0.1', () => console.log(`Qarib dev API on http://localhost:8787 ${deps.fetcher ? '(fake OSM)' : ''}`));
