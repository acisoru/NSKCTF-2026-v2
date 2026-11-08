import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
import { STEP, CAMERA, GUNS, WEAPONS, SAFE_ZONES, BUILDINGS } from '../shared/config.mjs';

function setup(count = 1) {
  let clock = 1000;
  const game = new Game({ flag: 'nskctf{projectile_fixture}', now: () => clock });
  const players = Array.from({ length: count }, (_, i) => { const p = game.connect(null, () => {}); game.handle(p, { type: 'enter', name: `Shooter ${i}` }); at(p, 210 + i * 6, 230); return p; });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock += STEP * 1000; game.tick(); } };
  return { game, players, tick };
}
function at(p, x, z) { p.x = x; p.z = z; p.body.position.set(x, .8, z); p.body.velocity.set(0, 0, 0); }

test('player rounds travel in space and inflict one hit only after arrival', () => {
  const { game, players: [p, target], tick } = setup(2); at(target, 210, 210);
  game.handle(p, { type: 'input', attack: true, yaw: 0, pitch: 0 }); tick();
  assert.equal(target.hp, target.maxHp); assert.equal(game.projectiles.length, 1);
  const firstZ = game.projectiles[0].z; game.handle(p, { type: 'input' }); tick(5);
  assert.ok(game.projectiles[0].z < firstZ); assert.equal(target.hp, target.maxHp);
  tick(12); assert.ok(target.hp < target.maxHp); assert.equal(game.projectiles.length, 0);
  const hp = target.hp; tick(10); assert.equal(target.hp, hp);
});
test('moving off the trajectory evades a round; rounds do not follow target IDs', () => {
  const { game, players: [p, target], tick } = setup(2); at(target, 210, 210);
  game.handle(p, { type: 'input', attack: true, aim: { x: target.x, y: 1.1, z: target.z } }); tick();
  game.handle(p, { type: 'input' }); at(target, 216, 210); tick(30);
  assert.equal(target.hp, target.maxHp);
});
test('friendly-fire protection is checked when a projectile arrives; outsiders still take damage', () => {
  const { game, players: [p, target], tick } = setup(2); at(target, 210, 210);
  game.handle(p, { type: 'party-create' });
  game.fire(p, { x: 0, y: 0, z: -1 }, 50); tick();
  game.handle(target, { type: 'party-join', code: p.party }); tick(20);
  assert.equal(target.hp, target.maxHp); assert.equal(game.projectiles.length, 0);
  game.handle(target, { type: 'party-leave' });
  game.fire(p, { x: 0, y: 0, z: -1 }, 50); tick(20); assert.ok(target.hp < target.maxHp);
});
test('swept rounds cannot tunnel through a wall, even at exaggerated test speed', () => {
  const { game, players: [p, target], tick } = setup(2); const wall = BUILDINGS.find(b => b.kind === 'ruin');
  at(p, wall.x - wall.w / 2 - 2, wall.z); at(target, wall.x + wall.w / 2 + 2, wall.z);
  p.yaw = Math.PI / 2;
  game.fire(p, { x: 1, y: 0, z: 0 }, 500, { speed: 1500, range: 60 }); tick();
  assert.equal(target.hp, target.maxHp); assert.equal(game.projectiles.length, 0);
  const impact = game.effects.find(e => e.kind === 'bullet-impact'); assert.ok(impact.x <= wall.x - wall.w / 2 + .01);
});
test('safe-zone boundary absorbs rounds before they cross or hit a protected target', () => {
  const { game, players: [p, target], tick } = setup(2); const zone = SAFE_ZONES[0];
  at(p, 0, zone.z - zone.radius - 3); at(target, 0, zone.z - zone.radius + 1); p.yaw = Math.PI;
  game.fire(p, { x: 0, y: 0, z: 1 }, 500); tick(10);
  assert.equal(target.hp, target.maxHp); assert.equal(game.projectiles.length, 0);
  const impact = game.effects.find(e => e.kind === 'bullet-impact'); assert.ok(impact.z <= zone.z - zone.radius + .01);
  game.handle(target, { type: 'input', attack: true }); tick(); assert.equal(game.projectiles.length, 0);
});
test('pitch and camera aim produce vertical shots; aiming at an elevated drone is required', () => {
  const { game, players: [p], tick } = setup(); const e = game.spawn('bomber', 210, 218, 1); e.homeYaw = Math.PI / 2;
  game.handle(p, { type: 'input', attack: true, pitch: 0 }); tick(); game.handle(p, { type: 'input' }); tick(9); assert.equal(e.hp, e.maxHp);
  p.cd.attack = 0;
  game.handle(p, { type: 'input', attack: true, pitch: .2, aim: { x: e.x, y: e.altitude + 1.15, z: e.z } }); tick();
  assert.ok(game.projectiles.some(s => s.vy > 0)); game.handle(p, { type: 'input' }); tick(12); assert.ok(e.hp < e.maxHp);
});
test('ordinary drone bursts are ranged, damaging and stronger when ignored', () => {
  const { game, players: [p], tick } = setup(); const e = game.spawn('drone', 210, 211, 1); e.cd = 0;
  tick(); assert.equal(e.charging, true); assert.equal(game.projectiles.length, 0);
  tick(25); assert.ok(game.effects.some(s => s.kind === 'gunshot' && s.enemy));
  tick(50); assert.ok(p.hp <= p.maxHp - 40, `Only ${p.maxHp - p.hp} damage`);
  assert.ok(Math.hypot(e.x - p.x, e.z - p.z) > 5, 'Drone should keep firing distance');
  tick(230); assert.ok(p.dead > 0 || game.safe(p) || p.hp < 10, 'Idle player should be defeated by ranged fire');
});
test('enemy shots lead a moving player, respect cover and never shoot from a safe zone', () => {
  const { game, players: [p], tick } = setup(); const e = game.spawn('sentry', 210, 210, 2);
  p.body.velocity.set(5, 0, 0); e.burstLeft = 1; e.cd = 0; game.tickGun(e, p, 20);
  assert.ok(game.projectiles[0].vx > 0); assert.equal(game.projectiles[0].enemy, true);
  const snapshot = JSON.stringify(game.snapshot(p)); assert.ok(!snapshot.includes(p.token)); assert.ok(!snapshot.includes('"source"'));
  game.projectiles = [];
  const wall = BUILDINGS.find(b => b.kind === 'ruin'); at(e, wall.x - wall.w / 2 - 2, wall.z); at(p, wall.x + wall.w / 2 + 2, wall.z); e.cd = 0;
  game.tickGun(e, p, 12); assert.equal(game.projectiles.length, 0);
  const zone = SAFE_ZONES[0]; at(e, zone.x, zone.z); game.fire(e, { x: 1, y: 0, z: 0 }, 100, GUNS.drone); assert.equal(game.projectiles.length, 0);
  tick();
});
test('sky shots expire, downward shots hit terrain, and forged values are rejected', () => {
  const { game, players: [p], tick } = setup();
  game.handle(p, { type: 'input', pitch: Infinity, aim: { x: 1e50, y: NaN, z: 3 }, speed: 9999, damage: 9999 }); assert.equal(p.input.pitch, 0); assert.equal(p.input.aim, null);
  game.handle(p, { type: 'input', pitch: 999, attack: true }); tick(); assert.equal(p.pitch, CAMERA.maxPitch);
  assert.ok(Math.abs(Math.hypot(game.projectiles[0].vx, game.projectiles[0].vy, game.projectiles[0].vz) - WEAPONS.pistol.speed) < .001);
  game.handle(p, { type: 'input' }); tick(45); assert.equal(game.projectiles.length, 0);
  game.handle(p, { type: 'input', pitch: -1, attack: true }); tick(3); assert.ok(game.effects.some(e => e.kind === 'bullet-impact' && e.y <= .04));
});
test('removing and reconnecting actors does not leak raycast hitboxes', () => {
  const { game, players: [p] } = setup(); const count = game.world.bodies.length;
  game.handle(p, { type: 'logout' }); assert.equal(game.world.bodies.length, count - 2);
  game.handle(p, { type: 'enter' }); assert.equal(game.world.bodies.length, count);
});
