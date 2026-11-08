import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
import { MOVEMENT, LADDERS, WEAPONS, STEP, ROLES, SAFE_ZONES } from '../shared/config.mjs';
import { StateEncoder, StateReplica } from '../shared/replica.mjs';

function setup(role = 'assault') {
  let clock = 1000; const game = new Game({ flag: 'fixture', now: () => clock });
  const p = game.connect(null, () => {}); game.handle(p, { type: 'enter', role });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock += STEP * 1000; game.tick(); } };
  const command = m => game.handle(p, { type: 'input', ...m }); tick(3);
  return { game, p, tick, command };
}
function place(p, x, z, y = 0) { p.x = x; p.z = z; p.y = y; p.body.position.set(x, y + MOVEMENT.radius, z); p.body.velocity.set(0, 0, 0); }
test('sprint is capped, costs stamina and cannot be accelerated by packet spam', () => {
  const { p, command, tick } = setup(); const start = p.x;
  for (let i = 0; i < 30; i++) { for (let j = 0; j < 100; j++) command({ x: 999, z: 0, sprint: true, speed: 900, dt: 999 }); tick(); }
  const distance = p.x - start;
  assert.ok(distance > ROLES.assault.speed && distance <= ROLES.assault.speed * MOVEMENT.sprintMultiplier + .1);
  assert.ok(p.stamina < MOVEMENT.staminaMax);
});
test('jump is server-side, lands, and cannot be repeated in the air', () => {
  const { p, command, tick } = setup(); command({ jump: true }); tick(); assert.ok(p.y > .05);
  let highest = p.y;
  for (let i = 0; i < 60; i++) { command({ jump: i % 2 === 0, y: 500, vy: 500 }); tick(); highest = Math.max(highest, p.y); }
  assert.ok(highest < 1.6, `Unexpected jump height ${highest}`);
  command({}); tick(40); assert.ok(p.y < .04); assert.equal(p.grounded, true);
});
test('ladder can be climbed onto a solid roof and descended without remote teleport', () => {
  const { game, p, command, tick } = setup(); const ladder = LADDERS[0];
  command({ interact: true, climb: 1, ladder: ladder.id }); tick(); assert.equal(p.climbing, null);
  place(p, ladder.x, ladder.z + .3); command({ interact: true, climb: 1 }); tick(); assert.equal(p.climbing, ladder.id);
  for (let i = 0; i < 200 && p.climbing; i++) { command({ climb: 1 }); tick(); }
  assert.equal(p.climbing, null); assert.ok(p.y >= ladder.top - .1);
  command({}); tick(20); assert.ok(Math.abs(p.y - ladder.top) < .08); assert.equal(p.grounded, true);
  command({ interact: true, climb: -1 }); tick(); assert.equal(p.climbing, ladder.id);
  for (let i = 0; i < 200 && p.climbing; i++) { command({ climb: -1 }); tick(); }
  assert.equal(p.climbing, null); assert.ok(p.y < .05);
  assert.equal(game.snapshot(p).self.ladder, ladder.id);
});
test('town, XP and reconnect do not heal; medic requires a medkit', () => {
  const { game, p, command, tick } = setup('medic'); p.hp = 30; p.potions = 0; tick(150); assert.equal(p.hp, 30);
  game.xp(p, 400); assert.equal(p.hp, 30); command({ skill: true, potion: true }); tick(); assert.equal(p.hp, 30);
  const restored = new Game({ flag: 'fixture', saved: game.records() }); const q = restored.connect(p.token, () => {}); assert.equal(q.hp, 30);
  p.potions = 1; command({ skill: true }); tick(); assert.ok(p.hp > 30); assert.equal(p.potions, 0);
});
test('weapon families have distinct projectiles, magazines and reload gates', () => {
  for (const type of ['pistol', 'shotgun', 'sniper', 'machinegun']) {
    const { game, p, command, tick } = setup(); place(p, 210, 230);
    const item = game.item(type); p.inventory.push(item); game.handle(p, { type: 'equip', id: item.id });
    command({ attack: true, pitch: .7 }); tick(); assert.equal(item.ammo, WEAPONS[type].magazine - 1);
    assert.equal(game.projectiles.length, WEAPONS[type].pellets);
    assert.ok(Math.abs(Math.hypot(game.projectiles[0].vx, game.projectiles[0].vy, game.projectiles[0].vz) - WEAPONS[type].speed) < .01);
    item.ammo = 0; p.cd.attack = 0; command({ attack: true }); tick(); assert.ok(p.reloading);
    const before = game.projectiles.length; command({ attack: true, reload: true }); tick(3); assert.equal(item.ammo, 0); assert.ok(game.projectiles.length <= before);
    for (let i = 0; i < 120; i++) { command({}); tick(); } assert.equal(item.ammo, WEAPONS[type].magazine);
  }
});
test('equip does not reset fire cooldown, ammo, or health; stale inputs are ignored', () => {
  const { game, p, command, tick } = setup(); place(p, 210, 230); p.hp = 25;
  const sniper = game.item('sniper'); p.inventory.push(sniper); game.handle(p, { type: 'equip', id: sniper.id }); command({ seq: 2, attack: true }); tick();
  const cooldown = p.cd.attack; game.handle(p, { type: 'equip', id: p.inventory[0].id }); assert.equal(p.cd.attack, cooldown);
  game.handle(p, { type: 'equip', id: sniper.id }); assert.equal(sniper.ammo, WEAPONS.sniper.magazine - 1); assert.equal(p.hp, 25);
  command({ seq: 1, x: 1, sprint: true }); assert.equal(p.input.x, 0);
});
test('delta replication merges partial records and removes vanished entities', () => {
  const encoder = new StateEncoder(), replica = new StateReplica();
  const state = { type: 'state', time: 0, self: { id: 'p', hp: 5 }, players: [{ id: 'p', name: 'Name', x: 0 }], enemies: [], projectiles: [], effects: [], hazards: [], loot: [] };
  assert.equal(replica.apply(JSON.parse(encoder.encode(state))).players[0].name, 'Name');
  const next = { ...state, players: [{ id: 'p', name: 'Name', x: 3 }] };
  const packet = JSON.parse(encoder.encode(next)); assert.deepEqual(packet.players.upsert, [{ id: 'p', x: 3 }]);
  assert.equal(replica.apply(packet).players[0].name, 'Name');
  assert.equal(replica.apply(JSON.parse(encoder.encode({ ...state, players: [] }))).players.length, 0);
});
test('boss and generators cannot be damaged from outside the aggro radius', () => {
  const { game, p } = setup(); const boss = game.enemies.find(e => e.bossId === 'resonator');
  game.pylons(boss); const generator = game.enemies.find(e => e.parent === boss.id);
  for (const distance of [30, 32, 34, 100]) {
    place(p, boss.sx, boss.sz + distance);
    assert.equal(game.hitEnemy(p, boss, 100), 0);
    assert.equal(game.hitEnemy(p, generator, 100), 0);
  }
  place(p, boss.sx, boss.sz + 29); assert.ok(game.hitEnemy(p, boss, 100) > 0);
});
test('shop and ground loot require proximity in height as well as on the map', () => {
  const { game, p, command, tick } = setup(); const merchant = SAFE_ZONES[0].merchant;
  place(p, merchant.x, merchant.z, 8); assert.equal(game.shop(p), undefined);
  const item = game.item('pistol'); game.loot.push({ id: 'ground-loot', owner: p.id, x: p.x, z: p.z, item, ttl: 90 });
  command({ interact: true }); tick(); assert.ok(!p.inventory.includes(item));
  place(p, merchant.x, merchant.z); assert.equal(game.shop(p)?.id, SAFE_ZONES[0].id);
  command({ interact: true }); tick(); assert.ok(p.inventory.includes(item));
});
