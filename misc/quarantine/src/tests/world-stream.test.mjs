import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { inflateRawSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.mjs';
import { WorldStream } from '../server/world-stream.mjs';
import { StateReplica } from '../shared/replica.mjs';

async function wait(check) {
  const end = Date.now() + 4000;
  while (!check()) { if (Date.now() > end) throw new Error('Timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
test('shared compressed world never contains private credentials, loot or rewards', async () => {
  const flag = 'nskctf{compressed_private_fixture}';
  const app = await createApp({ flag, testAuth: true }); const clients = [];
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const url = `ws://127.0.0.1:${app.server.address().port}/ws`;
  async function connect(token) {
    const ws = new WebSocket(url), messages = [], worlds = [], replica = new StateReplica();
    const client = { ws, messages, worlds, replica }; clients.push(client);
    ws.on('message', (data, binary) => {
      const packet = JSON.parse(binary ? inflateRawSync(data).toString() : data.toString());
      messages.push(packet);
      if (binary) { worlds.push(packet); client.state = replica.apply(packet); }
    });
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'hello', token, world: true, compression: true, delta: true }));
    await wait(() => messages.some(m => m.type === 'hello')); client.hello = messages.find(m => m.type === 'hello');
    ws.send(JSON.stringify({ type: 'enter', name: 'Stream tester' })); await wait(() => worlds.length || messages.some(m => m.type === 'reward'));
    return client;
  }
  try {
    const a = await connect(), b = await connect();
    const winner = app.game.sessions.get(a.hello.token); winner.won = true; app.game.archiveWinner(winner);
    const item = app.game.item('sniper');
    app.game.loot.push({ id: 'private-loot-fixture', owner: winner.id, item, x: winner.x, z: winner.z, ttl: 90 });
    await wait(() => a.messages.some(m => m.type === 'reward' && m.reward?.flag === flag));
    await wait(() => b.state.players.length === 2);
    const shared = JSON.stringify([...a.worlds, ...b.worlds]);
    for (const secret of [flag, a.hello.token, b.hello.token, item.id, 'private-loot-fixture', 'inventory', 'partyCode']) assert.ok(!shared.includes(secret), secret);
    assert.ok(!JSON.stringify(b.messages).includes(flag)); assert.ok(!JSON.stringify(b.messages).includes(item.id));
    const resumed = await connect(a.hello.token);
    await wait(() => resumed.messages.some(m => m.type === 'reward' && m.reward?.flag === flag));
  } finally { for (const client of clients) client.ws.terminate(); await app.close(); }
});
test('a full packet repairs a replica after skipped deltas and drops stale entities', () => {
  const stream = new WorldStream(), replica = new StateReplica();
  const frame = players => ({ type: 'world', time: 1, self: null, players, enemies: [], projectiles: [], effects: [], hazards: [], loot: [] });
  const decode = packet => JSON.parse(inflateRawSync(packet));
  replica.apply(decode(stream.prepare('cell', frame([{ id: 'old', x: 0 }])).packet(true, true)));
  stream.prepare('cell', frame([{ id: 'new', x: 1 }]));
  const packets = stream.prepare('cell', frame([{ id: 'new', x: 2 }]));
  const restored = replica.apply(decode(packets.packet(true, true)));
  assert.deepEqual(restored.players, [{ id: 'new', x: 2 }]);
  assert.strictEqual(packets.packet(true, true), packets.packet(true, true));
});
