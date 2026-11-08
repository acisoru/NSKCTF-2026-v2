import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Game } from '../server/game.mjs';
import { createApp } from '../server/index.mjs';
import { Moderation } from '../server/moderation.mjs';
import { MOVEMENT, STEP, SAFE_ZONES, BUILDINGS } from '../shared/config.mjs';

const wait = async fn => { const end = Date.now() + 4000; while (!fn()) { if (Date.now() > end) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 15)); } };
function fixture() {
  let now = 1000; const game = new Game({ flag: 'admin-test-flag', now: () => now, isAdmin: id => id === 'yandex:owner' });
  const admin = game.account('yandex:owner'); game.connect(admin.token, () => {}); game.handle(admin, { type: 'enter', name: 'Owner' });
  const player = game.account('yandex:player'); game.connect(player.token, () => {}); game.handle(player, { type: 'enter', name: 'Player' });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { now += STEP * 1000; game.tick(); } };
  const place = (p, x, z, y = 0) => { p.x = x; p.z = z; p.y = y; p.body.position.set(x, y + MOVEMENT.radius, z); p.body.velocity.set(0, 0, 0); };
  return { game, admin, player, tick, place };
}
test('normal clients cannot grant themselves admin powers or fly with forged fields', () => {
  const { game, player: p, tick } = fixture();
  for (const type of ['admin-mode', 'admin-follow', 'admin-weapon', 'admin-ban']) assert.throws(() => game.handle(p, { type, enabled: true, playerId: p.id }), /прав/);
  game.handle(p, { type: 'input', admin: true, providerId: 'yandex:owner', lift: 100, flying: true, weapon: 'admin', x: 0, y: 999 }); tick(10);
  assert.equal(game.adminActive(p), false); assert.ok(p.y < .1); assert.notEqual(game.weapon(p).type, 'admin');
  assert.equal(game.snapshot(p).self.admin, null); assert.equal(p.providerId, 'yandex:player');
});
test('admin flight is bounded, can follow another player and returns to the saved position', () => {
  const { game, admin: p, player, tick, place } = fixture(); place(p, 210, 230); place(player, 190, 220);
  game.handle(p, { type: 'admin-mode', enabled: true });
  for (let i = 0; i < 30; i++) { game.handle(p, { type: 'input', lift: 100, sprint: true }); tick(); }
  assert.ok(p.y > 30 && p.y < 37); assert.equal(p.body.collisionFilterMask, 0);
  const hp = p.hp; assert.equal(game.hitPlayer(p, 1000, player), 0); assert.equal(p.hp, hp);
  const bomber = game.enemies.find(e => e.kind === 'bomber'); assert.equal(game.seesBomber(bomber, p), false);
  game.handle(p, { type: 'admin-follow', playerId: player.id }); tick();
  assert.ok(Math.abs(p.y - player.y - 3) < .05); assert.ok(Math.hypot(p.x - player.x, p.z - player.z) < 5.1);
  game.handle(p, { type: 'admin-mode', enabled: false });
  assert.equal(p.x, 210); assert.equal(p.z, 230); assert.equal(p.y, 0); assert.equal(p.body.collisionFilterMask, 1 | 8);
  assert.ok(!Object.hasOwn(game.records().find(q => q.id === p.id), 'admin'));
  game.handle(p, { type: 'admin-mode', enabled: true }); game.disconnect(p); assert.equal(game.adminActive(p), false);
});
test('admin gun kills with one real projectile but respects cover and safe zones', () => {
  const { game, admin: p, player: target, tick, place } = fixture(); place(p, 210, 230); place(target, 210, 222);
  target.armor = .99; const gold = target.gold;
  game.handle(p, { type: 'admin-mode', enabled: true }); game.handle(p, { type: 'admin-weapon', enabled: true });
  game.handle(p, { type: 'input', attack: true, yaw: 0, pitch: 0 }); tick();
  assert.equal(game.projectiles.filter(s => s.adminShot).length, 1); assert.equal(target.hp, target.maxHp);
  game.handle(p, { type: 'input' }); tick(3); assert.equal(target.hp, 0); assert.equal(target.gold, gold);
  target.hp = target.maxHp; target.dead = 0; place(target, SAFE_ZONES[0].x, SAFE_ZONES[0].z);
  assert.equal(game.hitPlayer(target, 1e6, p, true), 0);
  place(p, SAFE_ZONES[0].x, SAFE_ZONES[0].z); assert.equal(game.hitEnemy(p, game.enemies[0], 1e6, true), 0);
  const wall = BUILDINGS.find(b => b.kind === 'ruin');
  place(p, wall.x - wall.w / 2 - 2, wall.z, .1); place(target, wall.x + wall.w / 2 + 2, wall.z);
  p.cd.attack = 0; game.handle(p, { type: 'input', attack: true, yaw: Math.PI / 2, aim: { x: target.x, y: 1.5, z: target.z } }); tick();
  game.handle(p, { type: 'input' }); tick(8); assert.equal(target.hp, target.maxHp);
});
test('admin boss kills and generator intervention cannot award flags or raid loot', () => {
  const { game, admin, player, place } = fixture(); const boss = game.enemies.find(e => e.bossId === 'warden');
  place(admin, boss.x, boss.z + 12); place(player, boss.x + 3, boss.z + 12); player.marks = ['archivist', 'resonator'];
  assert.equal(game.hitEnemy(player, boss, 1e6, true), 0);
  game.contribution(boss, player, 1000); game.handle(admin, { type: 'admin-mode', enabled: true });
  game.pylons(boss); assert.ok(game.hitEnemy(admin, boss, 1e6, true) > 0); assert.equal(boss.hp, 0);
  assert.equal(player.won, false); assert.equal(admin.won, false); assert.equal(game.loot.length, 0);
  game.resetEnemy(boss); game.pylons(boss);
  const generator = game.enemies.find(e => e.parent === boss.id && e.hp > 0);
  game.hitEnemy(admin, generator, 1e6, true); game.hitEnemy(player, boss, 1e6);
  assert.equal(player.won, false); assert.equal(game.loot.length, 0);
  game.resetEnemy(boss); assert.equal(boss.moderated, false);
});
test('admin gun also respects disabled friendly fire within a party', () => {
  const { game, admin, player, place } = fixture(); place(admin, 210, 230); place(player, 210, 220);
  game.handle(admin, { type: 'party-create' }); game.handle(player, { type: 'party-join', code: admin.party });
  game.handle(admin, { type: 'admin-mode', enabled: true }); game.handle(admin, { type: 'admin-weapon', enabled: true });
  assert.equal(game.hitPlayer(player, 1e6, admin, true), 0); assert.equal(player.hp, player.maxHp);
});
test('temporary bans expire and admin identities are protected', async () => {
  let now = 1000; const moderation = new Moderation({ adminIds: ['owner'], now: () => now });
  const target = { id: 'player', providerId: 'yandex:player' };
  await assert.rejects(moderation.change('yandex:player', target, { action: 'ban', reason: 'test' }), /прав/);
  await assert.rejects(moderation.change('yandex:owner', { ...target, providerId: 'yandex:owner' }, { action: 'ban', reason: 'test' }), /нельзя/);
  await moderation.change('yandex:owner', target, { action: 'ban', duration: 3600, reason: 'test' }); assert.ok(moderation.ban(target.providerId));
  now += 3600001; assert.equal(moderation.ban(target.providerId), null);
});

export async function httpFixture(dataDir) {
  const app = await createApp({ flag: 'private-admin-fixture', dataDir, adminIds: ['owner'], oauth: { clientId: 'fixture', clientSecret: 'fixture-secret', publicOrigin: 'http://127.0.0.1', fetchImpl: async (url, options) => new Response(JSON.stringify(url.includes('/token') ? { access_token: options.body.get('code') } : { id: options.headers.Authorization.slice('OAuth '.length) })) } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); const base = `http://127.0.0.1:${app.server.address().port}`;
  app.auth.origin = base; app.auth.redirectUri = `${base}/auth/yandex/callback`;
  async function login(user) {
    const start = await fetch(base + '/auth/yandex', { redirect: 'manual' }); const state = new URL(start.headers.get('location')).searchParams.get('state');
    const response = await fetch(`${base}/auth/yandex/callback?state=${state}&code=${user}`, { redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie').split(';')[0] } });
    return { response, cookie: response.headers.getSetCookie().find(c => c.startsWith('labx_session='))?.split(';')[0] };
  }
  const sockets = [];
  async function connect(cookie, name) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie }, origin: base }); const messages = [];
    sockets.push(ws); ws.on('message', raw => messages.push(JSON.parse(raw))); await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'hello' })); await wait(() => messages.some(m => m.type === 'hello'));
    ws.send(JSON.stringify({ type: 'enter', name })); await wait(() => messages.some(m => m.type === 'state'));
    return { ws, messages, id: messages.find(m => m.type === 'hello').id };
  }
  const moderate = (cookie, command, origin = base) => fetch(base + '/api/admin/moderate', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  return { app, base, login, connect, moderate, close: async () => { sockets.forEach(ws => ws.terminate()); await app.close(); } };
}
test('admin API uses OAuth identity, bans disconnect and persist across restart, unban permits login', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quarantine-admin-')); let f = await httpFixture(dir);
  try {
    const owner = await f.login('owner'), user = await f.login('player');
    const admin = await f.connect(owner.cookie, 'Owner'), player = await f.connect(user.cookie, 'Player');
    const roster = cookie => fetch(f.base + '/api/admin/players', { headers: { Cookie: cookie } });
    assert.equal((await roster('')).status, 403); assert.equal((await roster(user.cookie)).status, 403);
    const data = await (await roster(owner.cookie)).json(); assert.equal(data.players.length, 2);
    assert.ok(!JSON.stringify(data).includes('providerId')); assert.ok(!JSON.stringify(data).includes('token'));
    player.ws.send(JSON.stringify({ type: 'admin-mode', enabled: true, admin: true, providerId: 'yandex:owner' }));
    await wait(() => player.messages.some(m => m.type === 'error' && m.message.includes('прав')));
    admin.ws.send(JSON.stringify({ type: 'admin-mode', enabled: true })); await wait(() => admin.messages.some(m => m.self?.admin?.enabled));
    const command = { action: 'ban', playerId: player.id, duration: 0, reason: 'fixture reason' };
    assert.equal((await f.moderate(user.cookie, command)).status, 403);
    assert.equal((await f.moderate(owner.cookie, command, 'https://outside.invalid')).status, 403);
    assert.equal((await f.moderate(owner.cookie, { ...command, playerId: admin.id })).status, 400);
    const closed = once(player.ws, 'close'); assert.equal((await f.moderate(owner.cookie, command)).status, 200); assert.equal((await closed)[0], 4004);
    assert.equal(f.app.game.online.has(player.id), false);
    const ws = new WebSocket(f.base.replace('http', 'ws') + '/ws', { headers: { Cookie: user.cookie }, origin: f.base }); assert.match((await once(ws, 'error'))[0].message, /401/);
    assert.equal((await f.login('player')).response.status, 403);
    await f.close(); f = await httpFixture(dir);
    assert.ok(f.app.moderation.ban('yandex:player')); assert.equal((await f.login('player')).response.status, 403);
    const nextOwner = await f.login('owner'); assert.equal((await f.moderate(nextOwner.cookie, { action: 'unban', playerId: player.id })).status, 200);
    assert.equal((await f.login('player')).response.status, 303);
    assert.equal(f.app.moderation.audit.length, 2);
  } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
});
