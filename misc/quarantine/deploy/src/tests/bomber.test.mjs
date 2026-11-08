import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
import { BOMBER, BOMBER_SPAWNS, BUILDINGS, SAFE_ZONES, STEP } from '../shared/config.mjs';

function setup(count = 1) {
  let now = 1000;
  const game = new Game({ flag: 'nskctf{bomber_test}', now: () => now });
  const players = Array.from({ length: count }, () => { const p = game.connect(null, () => {}); game.handle(p, { type: 'enter' }); return p; });
  const bomber = game.spawn('bomber', 210, 220, 1);
  const blasts = new Set();
  function tick(n = 1) { for (let i = 0; i < n; i++) { now += STEP * 1000; game.tick(); for (const e of game.effects) if (e.kind === 'bomber-blast') blasts.add(e.id); } }
  function until(predicate, max = 150) { for (let i = 0; !predicate() && i < max; i++) tick(); assert.ok(predicate(), 'Expected bomber transition'); }
  return { game, players, bomber, tick, until, blasts };
}
function at(p, x, z) { p.x = x; p.z = z; p.body.position.set(x, .8, z); p.body.velocity.set(0, 0, 0); }

test('dynamite drones populate safe patrol points outside settlements and boss arenas', () => {
  const { game } = setup(); assert.ok(BOMBER_SPAWNS.length >= 5);
  assert.equal(game.enemies.filter(e => e.kind === 'bomber').length, BOMBER_SPAWNS.length + 1);
  for (const [x, z] of BOMBER_SPAWNS) {
    assert.ok(!SAFE_ZONES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius + BOMBER.patrolRadius));
    assert.ok(!BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 + BOMBER.patrolRadius && Math.abs(z - b.z) < b.d / 2 + BOMBER.patrolRadius));
  }
});
test('vision checks range, angle, living connected targets and solid occlusion', () => {
  const { game, players: [p], bomber: e } = setup();
  at(p, 210, 210); assert.equal(game.seesBomber(e, p), true);
  at(p, 210, 203); assert.equal(game.seesBomber(e, p), false);
  at(p, 210, 225); assert.equal(game.seesBomber(e, p), false);
  at(p, 220, 220); assert.equal(game.seesBomber(e, p), false);
  at(p, 210, 210); p.hp = 0; assert.equal(game.seesBomber(e, p), false);
  p.hp = p.maxHp; game.disconnect(p); assert.equal(game.seesBomber(e, p), false); p.connected = true;
  const wall = BUILDINGS.find(b => b.kind === 'ruin');
  at(e, wall.x - wall.w / 2 - 2, wall.z); e.yaw = Math.PI / 2;
  at(p, wall.x + wall.w / 2 + 2, wall.z); assert.equal(game.seesBomber(e, p), false);
  at(e, e.x, wall.z + wall.d / 2 + 3); at(p, p.x, e.z); assert.equal(game.seesBomber(e, p), true);
});
test('entering vision arms once, dives down, then damages nearby players exactly once', () => {
  const { game, players: [target, nearby, far], bomber: e, tick, until, blasts } = setup(3);
  at(target, 210, 210); at(nearby, 213, 210); at(far, 219, 210);
  const coins = target.gold, xp = target.xp;
  tick(); assert.equal(e.behavior, 'arming'); assert.equal(target.hp, target.maxHp);
  assert.equal(game.effects.filter(f => f.kind === 'bomber-lock').length, 1);
  const initialHeight = e.altitude;
  until(() => e.behavior === 'diving'); assert.ok(e.altitude < initialHeight);
  const snap = game.snapshot(target).enemies.find(q => q.id === e.id);
  assert.equal(snap.behavior, 'diving'); assert.ok(snap.flightProgress > 0); assert.ok(snap.aim);
  until(() => e.hp === 0);
  assert.ok(e.dead > 56 - STEP * 2 && e.dead <= 56);
  assert.equal(e.behavior, 'spent'); assert.equal(blasts.size, 1);
  assert.ok(target.hp < target.maxHp); assert.ok(nearby.hp < nearby.maxHp); assert.equal(far.hp, far.maxHp);
  assert.ok(target.hp < nearby.hp, 'Damage falls off with distance');
  assert.equal(target.gold, coins); assert.equal(target.xp, xp);
  const hp = target.hp; tick(12); assert.equal(blasts.size, 1); assert.equal(target.hp, hp);
});
test('a committed dive does not home in on a player who dodges sideways', () => {
  const { game, players: [p], bomber: e, tick, until } = setup(); at(p, 210, 207);
  until(() => e.behavior === 'diving'); const aim = { ...e.aim };
  for (let i = 0; i < 40 && e.hp > 0; i++) { game.handle(p, { type: 'input', x: 1, z: 0, sprint: true }); tick(); }
  assert.equal(e.hp, 0); assert.deepEqual(e.aim, aim); assert.equal(p.hp, p.maxHp);
});
test('settlement entry cancels lock; explosions outside cannot hurt players inside', () => {
  const { game, players: [p], bomber: e, tick } = setup(); const zone = SAFE_ZONES[0], edge = zone.z - zone.radius;
  at(e, 0, edge - 9); e.sx = e.x; e.sz = e.z; e.homeYaw = e.yaw = Math.PI;
  at(p, 0, edge - 1); tick(); assert.equal(e.behavior, 'arming');
  at(p, 0, edge + 1); tick(); assert.equal(e.behavior, 'patrol'); assert.equal(game.seesBomber(e, p), false);
  at(e, 0, edge - .5); e.behavior = 'diving'; game.detonateBomber(e); assert.equal(p.hp, p.maxHp);
});
test('cover blocks nearby blast damage even around a building corner', () => {
  const { game, players: [p], bomber: e } = setup(); const wall = BUILDINGS.find(b => b.kind === 'ruin');
  const corner = { x: wall.x - wall.w / 2, z: wall.z - wall.d / 2 };
  at(e, corner.x - .3, corner.z + .4); at(p, corner.x + .4, corner.z - .3);
  assert.ok(Math.hypot(p.x - e.x, p.z - e.z) < BOMBER.blastRadius);
  e.behavior = 'diving'; game.detonateBomber(e); assert.equal(p.hp, p.maxHp);
});
test('a blocked dive explodes at the collision, not beyond the wall', () => {
  const { game, players: [p], bomber: e, until } = setup(); const wall = BUILDINGS.find(b => b.kind === 'ruin');
  at(e, wall.x - wall.w / 2 - 2, wall.z); at(p, wall.x + wall.w / 2 + 2, wall.z);
  e.behavior = 'diving'; e.aim = { x: p.x, z: p.z };
  e.flight = { x: e.x, z: e.z, start: game.time, duration: Math.hypot(e.x - p.x, e.z - p.z) / BOMBER.diveSpeed };
  until(() => e.hp === 0);
  assert.ok(e.x < wall.x - wall.w / 2); assert.equal(p.hp, p.maxHp);
});
test('shooting a drone during windup defuses it and grants ordinary kill rewards', () => {
  const { game, players: [p], bomber: e, tick, blasts } = setup(); at(p, 210, 210); tick();
  assert.equal(e.behavior, 'arming'); game.hitEnemy(p, e, e.hp + 1);
  assert.equal(e.dead, 56);
  assert.equal(e.behavior, 'disabled'); assert.ok(p.xp > 0); const hp = p.hp;
  tick(75); assert.equal(blasts.size, 0); assert.equal(p.hp, hp);
  e.dead = STEP / 2; at(p, 210, 245); tick();
  assert.equal(e.hp, e.maxHp); assert.equal(e.behavior, 'patrol'); assert.equal(e.altitude, BOMBER.hoverHeight); assert.equal(e.targetId, null); assert.equal(e.aim, null);
});
test('client cannot trigger or retarget bomber detonations', () => {
  const { game, players: [p], bomber: e } = setup();
  for (const type of ['detonate', 'bomber-blast', 'bomber-lock']) game.handle(p, { type, id: e.id, targetId: p.id, damage: 99999 });
  assert.equal(e.hp, e.maxHp); assert.equal(e.behavior, 'patrol'); assert.equal(p.hp, p.maxHp);
});
