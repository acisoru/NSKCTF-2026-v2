import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
const downloads = path.resolve(here, '../downloads');
const webPort = Number(process.env.WEB_PORT || 34121);
const nativeHost = process.env.NATIVE_HOST || '127.0.0.1';
const nativePort = Number(process.env.NATIVE_PORT || 34120);
const allowedDownloads = new Set(['chamber', 'libc.so.6', 'ld-linux-x86-64.so.2']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

async function serveFile(res, root, name, attachment = false) {
  const file = path.resolve(root, name);
  if (!file.startsWith(`${root}${path.sep}`)) {
    res.writeHead(404); res.end(); return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': attachment || path.extname(file) === '.html' ? 'no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      ...(attachment ? { 'Content-Disposition': `attachment; filename="${path.basename(file)}"` } : {})
    });
    res.end(content);
  } catch {
    res.writeHead(404); res.end();
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${webPort}`);
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }
  if (url.pathname.startsWith('/downloads/')) {
    const name = url.pathname.slice('/downloads/'.length);
    if (!allowedDownloads.has(name)) { res.writeHead(404); res.end(); return; }
    serveFile(res, downloads, name, true);
    return;
  }
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'");
  serveFile(res, dist, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url || '/', `http://127.0.0.1:${webPort}`).pathname !== '/socket') {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
});

sockets.on('connection', ws => {
  const native = connect(nativePort, nativeHost);
  const send = value => { if (ws.readyState === 1) ws.send(JSON.stringify(value)); };
  native.on('connect', () => send({ type: 'status', value: 'connected' }));
  native.on('data', data => send({ type: 'data', base64: data.toString('base64') }));
  native.on('error', () => send({ type: 'status', value: 'native offline' }));
  native.on('close', () => { send({ type: 'status', value: 'session closed' }); ws.close(); });
  ws.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'line' && typeof message.data === 'string' && message.data.length <= 512) {
        native.write(Buffer.from(message.data + '\n'));
      } else if (message.type === 'hex' && typeof message.data === 'string' && /^(?:[0-9a-fA-F]{2}){1,1024}$/.test(message.data)) {
        native.write(Buffer.from(message.data, 'hex'));
      }
    } catch { send({ type: 'status', value: 'invalid command frame' }); }
  });
  ws.on('close', () => native.destroy());
});

server.listen(webPort, '0.0.0.0', () => console.log(`Пульт карантинного контура слушает порт ${webPort}`));
