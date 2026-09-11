import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const root = path.resolve('out');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
await stat(path.join(root, 'index.html'));

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? '/index.html' : path.extname(pathname) ? pathname : `${pathname}.html`;
    const file = path.resolve(root, `.${relative}`);
    if (!file.startsWith(`${root}${path.sep}`) || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': config.app.security.csp, 'Cache-Control': 'no-store' });
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(Number(process.env.SMOKE_PORT || 4173), '127.0.0.1');
