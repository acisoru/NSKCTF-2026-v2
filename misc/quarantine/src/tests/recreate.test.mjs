import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Game } from '../server/game.mjs';
import { createApp } from '../server/index.mjs';
import { SPAWN, ROLES } from '../shared/config.mjs';

const setup = () => { const game = new Game({ flag: 'fixture-reward' }), account = game.account('yandex:fixture'), p = game.connect(account.token, () => {}); game.handle(p, { type: 'enter', name: 'Operator', role: 'assault' }); return { game, p }; };
const request = (p, role = 'medic') => ({ type: 'character-recreate', role, confirm: p.id, revision: p.characterRevision });

test('recreation resets the character, not the account, and clears old combat ownership', () => {
  const { game, p } = setup(), token = p.token, id = p.id, identity = p.providerId, oldItems = p.inventory.map(i => i.id);
  p.level = 6; p.xp = 500; p.gold = 1300; p.potions = 1; p.marks = ['archivist', 'resonator']; p.won = true; p.archived = false; p.damage = 800; p.support = 200;
  game.handle(p, { type: 'party-create' }); const party = p.party; game.enemies[0].contributions.set(p.id, { damage: 999 });
  game.projectiles.push({ source: p }, { source: game.enemies[0] }); game.loot.push({ owner: p.id }, { owner: 'other' });
  const bodies = game.world.bodies.length, oldBody = p.body;
  assert.equal(game.handle(p, request(p)).recreated, true);
  assert.equal(p.id, id); assert.equal(p.token, token); assert.equal(p.providerId, identity); assert.equal(game.accounts.get(identity), p); assert.equal(game.sessions.size, 1);
  assert.equal(p.role, 'medic'); assert.equal(p.level, 1); assert.equal(p.xp, 0); assert.equal(p.gold, 0); assert.equal(p.potions, 1); assert.deepEqual(p.marks, []);
  assert.equal(p.won, true); assert.equal(game.snapshot(p).reward.flag, 'fixture-reward'); assert.equal(p.hp, ROLES.medic.hp);
  assert.equal(p.x, SPAWN.x); assert.equal(p.z, SPAWN.z); assert.equal(p.y, 0); assert.equal(p.party, null); assert.equal(game.parties.has(party), false);
  assert.equal(p.damage, 0); assert.equal(p.support, 0); assert.equal(p.characterRevision, 1); assert.ok(p.inventory.every(i => !oldItems.includes(i.id)));
  assert.equal(game.world.bodies.length, bodies); assert.notEqual(p.body, oldBody); assert.ok(!game.world.bodies.includes(oldBody));
  assert.ok(!game.enemies[0].contributions.has(id)); assert.equal(game.projectiles.length, 1); assert.equal(game.loot.length, 1);
});
test('recreation requires a current explicit confirmation and a different valid role', () => {
  const { game, p } = setup(); const before = JSON.stringify(game.records());
  for (const change of [{ confirm: 'someone-else' }, { revision: -1 }, { role: 'admin' }, { role: '__proto__' }, { role: p.role }]) assert.throws(() => game.handle(p, { ...request(p), ...change }));
  assert.equal(JSON.stringify(game.records()), before);
  const command = request(p); game.handle(p, { ...command, gold: 9999, won: true, marks: ['archivist', 'resonator'], level: 999 });
  assert.equal(p.gold, 0); assert.equal(p.won, false); assert.deepEqual(p.marks, []); assert.equal(p.level, 1);
  assert.throws(() => game.handle(p, command), /устарело/);
});
test('combat, death, flight, climbing and banned accounts cannot recreate', () => {
  for (const change of [p => { p.x = 220; p.z = 230; }, p => { p.hp = 0; }, p => { p.y = 8; }, p => { p.grounded = false; }, p => { p.climbing = 'ladder'; }, (p, game) => { game.isBanned = () => true; }, (p, game) => { game.isAdmin = () => true; p.admin = { enabled: true }; }]) {
    const { game, p } = setup(); change(p, game); const before = p.role;
    assert.throws(() => game.handle(p, request(p)), /зелёной зоне/); assert.equal(p.role, before); assert.equal(p.characterRevision, 0);
  }
});
test('recreation survives reconnect/restart and cannot regenerate credits or consumed medkits', () => {
  const { game, p } = setup(); p.potions = 0;
  game.handle(p, request(p)); game.disconnect(p); const again = game.connect(p.token, () => {}); assert.equal(again, p); assert.equal(again.role, 'medic');
  const restored = new Game({ flag: 'fixture-reward', saved: game.records() }), q = restored.connect(p.token, () => {});
  assert.equal(q.providerId, p.providerId); assert.equal(q.characterRevision, 1); assert.equal(q.role, 'medic');
  assert.throws(() => restored.handle(q, { ...request(q, 'guardian'), revision: 0 }), /устарело/);
  assert.throws(() => restored.handle(q, request(q, 'guardian')), /раза в минуту/); restored.now = () => Date.now() + 61000;
  restored.handle(q, request(q, 'guardian')); assert.equal(q.gold, 0); assert.equal(q.potions, 0); assert.equal(q.inventory.length, 2); assert.equal(restored.accounts.size, 1);
});
test('websocket recreation is acknowledged only after its new revision is persisted', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'recreate-')), app = await createApp({ testAuth: true, dataDir, flag: 'fixture-reward' });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); const messages = [], ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`);
  const wait = async fn => { const deadline = Date.now() + 5000; while (!fn()) { assert.ok(Date.now() < deadline, JSON.stringify(messages.filter(m => m.type === 'error'))); await new Promise(r => setTimeout(r, 10)); } };
  try {
    ws.on('message', raw => messages.push(JSON.parse(raw))); await once(ws, 'open'); ws.send(JSON.stringify({ type: 'hello' })); await wait(() => messages.some(m => m.type === 'hello'));
    ws.send(JSON.stringify({ type: 'enter', name: 'Reset fixture' })); await wait(() => messages.some(m => m.self?.canRecreate));
    await new Promise(resolve => setTimeout(resolve, 150)); await wait(() => app.game.players()[0]?.grounded);
    const self = messages.filter(m => m.self?.canRecreate).at(-1).self;
    ws.send(JSON.stringify({ type: 'character-recreate', confirm: self.id, revision: self.characterRevision, role: 'guardian' })); await wait(() => messages.some(m => m.type === 'character-recreated'));
    const records = JSON.parse(await readFile(join(dataDir, 'players.json'), 'utf8')); assert.equal(records.length, 1); assert.equal(records[0].role, 'guardian'); assert.equal(records[0].characterRevision, 1);
    assert.ok(messages.some(m => m.self?.role === 'guardian')); assert.ok(!messages.some(m => m.reward));
  } finally { ws.terminate(); await app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
