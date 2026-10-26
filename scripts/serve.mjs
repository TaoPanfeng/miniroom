import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const host = option('--host', '127.0.0.1');
const initialPort = Number(option('--port', '8080'));
const explicitPort = args.some((arg) => arg === '--port' || arg.startsWith('--port='));
if (!host || !Number.isInteger(initialPort) || initialPort < 1 || initialPort > 65535) {
  console.error('Usage: node scripts/serve.mjs [--host 127.0.0.1] [--port 8080] [--open]');
  process.exit(1);
}

const mime = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}));

// Only expose the app's static files, never repository metadata or launch scripts.
const allowed = (relative) => (
  !relative.split('/').some((segment) => segment.startsWith('.'))
  && (['index.html', 'styles.css'].includes(relative) || /^(src|vendor|assets)\//.test(relative))
  && mime.has(path.extname(relative).toLowerCase())
);

const server = http.createServer({ maxHeaderSize: 16384 }, async (request, response) => {
  const finish = (status, body, contentType = 'text/plain; charset=utf-8') => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    response.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...(status === 405 ? { Allow: 'GET, HEAD' } : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  };
  if (!['GET', 'HEAD'].includes(request.method)) return finish(405, 'Method not allowed.');
  try {
    const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    if (!pathname.startsWith('/') || /[\\\0:]/.test(pathname)) return finish(400, 'Invalid path.');
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!allowed(relative)) return finish(404, 'Not found.');
    const resolved = await realpath(path.join(root, relative));
    const actualRelative = path.relative(root, resolved).split(path.sep).join('/');
    if (!allowed(actualRelative) || !(await stat(resolved)).isFile()) return finish(404, 'Not found.');
    finish(200, await readFile(resolved), mime.get(path.extname(relative).toLowerCase()));
  } catch (error) {
    if (error instanceof URIError) finish(400, 'Invalid URL encoding.');
    else if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) finish(404, 'Not found.');
    else finish(500, 'Unable to read this file.');
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 1000;

let port = initialPort;
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && !explicitPort && port < Math.min(initialPort + 99, 65535)) {
    server.listen(++port, host);
    return;
  }
  console.error(`Cannot start the local server (${error.code || 'unknown error'}).`);
  process.exitCode = 1;
});
server.on('listening', () => {
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`;
  console.log(`Miniroom is ready.\nLocal: ${url}\nKeep this window open. Press Ctrl+C to stop.`);
  if (args.includes('--open')) {
    const commands = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const child = spawn(commands[0], commands[1], { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  }
});
server.listen(port, host);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
}
