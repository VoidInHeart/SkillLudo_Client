import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const root = resolve('build/web-desktop');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
createServer((request, response) => {
  let path;
  try { path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)); } catch { response.writeHead(400).end(); return; }
  if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  if (existsSync(path) && statSync(path).isDirectory()) path = resolve(path, 'index.html');
  if (!existsSync(path)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(path).pipe(response);
}).listen(7459, '127.0.0.1', () => console.log('Fresh build: http://127.0.0.1:7459'));
