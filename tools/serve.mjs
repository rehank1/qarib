// Local dev server with the SAME security headers as production (hosting/_headers), so CSP problems show up here.
// Usage: node tools/serve.mjs [dir=.] [port=4180]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 4180);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const headerFile = await readFile(join(root, 'hosting/_headers'), 'utf8').catch(() => readFile(join(root, '_headers'), 'utf8'));
const HEADERS = Object.fromEntries(headerFile.split('\n').filter((l) => /^ {2}[A-Z][\w-]+:/.test(l)).map((l) => l.trim().split(/:\s(.+)/).slice(0, 2)).filter(([k]) => k !== 'Strict-Transport-Security' && k !== 'Cache-Control'));
HEADERS['Content-Security-Policy'] = HEADERS['Content-Security-Policy'].replace('; upgrade-insecure-requests', ''); // plain http locally

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; } // no path traversal
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { ...HEADERS, 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  } catch { res.writeHead(404, HEADERS).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Qarib on http://localhost:${port}/ (this computer only)`)); // not the whole Wi-Fi
