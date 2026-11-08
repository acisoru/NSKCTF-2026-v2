import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const controlPath = dataDir => join(resolve(dataDir), 'ac.sock');
export async function startAntiCheatControl(dataDir, antiCheat) {
  if (!dataDir) return { close: async () => {} };
  await chmod(dataDir, 0o700);
  const path = controlPath(dataDir);
  try {
    const file = await lstat(path); if (!file.isSocket()) throw new Error('Anti-cheat control path is not a socket');
    const live = await new Promise((resolve, reject) => {
      const socket = createConnection(path); socket.setTimeout(500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Control socket probe timed out')); });
      socket.once('error', error => { socket.destroy(); if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(false); else reject(error); });
    });
    if (live) throw new Error('Another anti-cheat control server is running');
    await unlink(path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const server = createServer(async (req, res) => {
    const reply = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
    try {
      const url = new URL(req.url, 'http://local');
      if (req.method === 'GET' && url.pathname === '/bans') return reply(200, { bans: antiCheat.list() });
      if (req.method === 'GET' && url.pathname === '/events') return reply(200, antiCheat.events(url.searchParams.get('identity')));
      if (req.method !== 'POST' || url.pathname !== '/unban') return reply(404, { error: 'Unknown operation' });
      let body = '', bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 2048) return reply(413, { error: 'Too large' }); body += chunk; }
      const input = JSON.parse(body); reply(200, await antiCheat.unban(input.identity, input.reason));
    } catch (error) { reply(400, { error: error.message }); }
  });
  server.requestTimeout = 3000; server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  try { await chmod(path, 0o600); } catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  return { path, close: () => new Promise(resolve => server.close(resolve)) };
}
