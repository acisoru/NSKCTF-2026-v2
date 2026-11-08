import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.mjs';

export async function wait(fn, timeout = 4000) { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 20)); } }
test('real sockets share the world but never a private reward; persistence is atomic and not served', async () => {
  const flag = 'nskctf{network_private}'; const dataDir = await mkdtemp(join(tmpdir(), 'quarantine-test-'));
  const app = await createApp({ flag, dataDir, testAuth: true }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`; const clients = [];
  async function client(token) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws'); const messages = []; ws.on('message', b => messages.push(JSON.parse(b))); await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'hello', token })); await wait(() => messages.some(m => m.type === 'hello')); const hello = messages.find(m => m.type === 'hello');
    ws.send(JSON.stringify({ type: 'enter', name: 'Network tester' })); await wait(() => messages.some(m => m.type === 'state' || m.type === 'reward'));
    const c = { ws, hello, messages }; clients.push(c); return c;
  }
  try {
    for (const path of ['/server/game.mjs', '/.env', '/data/players.json', '/solve/WRITEUP.md']) assert.equal((await fetch(base + path)).status, 404);
    for (const path of ['/', '/game.js']) assert.ok(!(await (await fetch(base + path)).text()).includes(flag));
    const rejected = new WebSocket(base.replace('http', 'ws') + '/ws', { origin: 'https://outside.invalid' }); const [err] = await once(rejected, 'error'); assert.match(err.message, /403/);
    const a = await client(), b = await client(); await wait(() => a.messages.some(m => m.players?.length === 2));
    const winner = app.game.sessions.get(a.hello.token); winner.won = true; app.game.archiveWinner(winner);
    await wait(() => a.messages.some(m => m.reward)); assert.ok(!JSON.stringify(b.messages).includes(flag));
    await app.save(); const saved = JSON.parse(await readFile(join(dataDir, 'players.json'), 'utf8')); assert.equal(saved.length, 2); assert.equal(saved.find(p => p.token === a.hello.token).won, true);
    const resumed = await client(a.hello.token); assert.equal(resumed.hello.id, a.hello.id); await wait(() => resumed.messages.some(m => m.reward)); assert.ok(!resumed.messages.some(m => m.type === 'state'));
  } finally { clients.forEach(c => c.ws.terminate()); await app.close(); await rm(dataDir, { recursive: true }); }
});
