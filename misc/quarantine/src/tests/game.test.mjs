import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
import { STEP, SAFE_ZONES, BOSSES, BUILDINGS, SPAWN, WORLD, MOB_SPAWNS } from '../shared/config.mjs';

const FLAG = 'nskctf{test_private_raid_reward}';
function setup(count = 2) {
  let clock = 1000;
  const game = new Game({ flag: FLAG, now: () => clock });
  const players = Array.from({ length: count }, (_, i) => { const p = game.connect(null, () => {}); game.handle(p, { type: 'enter', name: `Tester ${i}`, role: ['assault', 'medic', 'guardian'][i % 3] }); return p; });
  const tick = (count = 1) => { for (let i = 0; i < count; i++) { clock += STEP * 1000; game.tick(); } };
  return { game, players, tick, advance: n => { clock += n; } };
}
function at(p, x, z) { p.x = x; p.z = z; p.body.position.set(x, .8, z); p.invulnerable = 0; }

test('a tenfold shared world has three bosses, three settlements and valid spawns', () => {
  const { game, players } = setup();
  assert.equal(game.enemies.filter(e => e.kind === 'boss').length, 3);
  assert.equal(game.snapshot(players[0]).players.length, 2);
  assert.equal(SAFE_ZONES.length, 3);
  assert.ok(Math.abs(WORLD.x * WORLD.z / (76 * 83) - 10) < 1e-9);
  assert.ok(MOB_SPAWNS.length >= 70);
  for (const [x, z] of MOB_SPAWNS) assert.ok(!BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 + .5 && Math.abs(z - b.z) < b.d / 2 + .5));
  assert.ok(!JSON.stringify(game.snapshot(players[0])).includes(players[1].token));
  assert.notEqual(players[0].token, players[1].token);
});
test('safe zones block outgoing and incoming PvP, hostile abilities and enemy damage', () => {
  const { game, players } = setup(); const [a, b] = players;
  for (const zone of SAFE_ZONES) {
    at(a, zone.x, zone.z); at(b, zone.x + zone.radius + 1, zone.z);
    const hp = [a.hp, b.hp];
    assert.equal(game.hitPlayer(b, 99999, a), 0);
    assert.equal(game.hitPlayer(a, 99999, b), 0);
    assert.equal(game.hitPlayer(a, 99999, { x: b.x, z: b.z }), 0);
    assert.deepEqual([a.hp, b.hp], hp);
    at(a, zone.x + zone.radius - .01, zone.z); assert.equal(game.hitPlayer(a, 99999, b), 0);
  }
});
test('world population cap is enforced at entry, including preconnected sessions', () => {
  const game = new Game({ flag: FLAG, maxPlayers: 1 });
  const a = game.connect(null, () => {}), b = game.connect(null, () => {});
  game.handle(a, { type: 'enter' });
  assert.throws(() => game.handle(b, { type: 'enter' }), /заполнен/);
});
test('player damage, death, gold transfer and evacuation work outside safe zones', () => {
  const { game, players, tick } = setup(); const [a, b] = players; at(a, 220, 230); at(b, 224, 230);
  const gold = a.gold + b.gold; const attackerGold = a.gold;
  game.hitPlayer(b, 9999, a); assert.equal(b.hp, 0); assert.equal(a.gold + b.gold, gold); assert.ok(a.gold > attackerGold);
  tick(215); assert.ok(b.hp > 0); assert.ok(game.safe(b));
});
test('safe-zone protection also applies when entering a settlement during a telegraph', () => {
  const { game, players, tick } = setup(1); const p = players[0]; const enemy = game.enemies[0];
  const edge = SAFE_ZONES[0].z - SAFE_ZONES[0].radius;
  at(p, 0, edge - 1); game.hazard(enemy, 0, edge, 5, .01, 99999); at(p, 0, edge + 1); tick();
  assert.equal(p.hp, p.maxHp);
});
test('client input cannot assign position, damage, money, level or victory', () => {
  const { game, players, tick } = setup(1); const p = players[0]; const x = p.x;
  game.handle(p, { type: 'input', x: 1e30, z: Infinity, yaw: NaN, hp: 1e9, power: 9999, level: 12, gold: 9999 }); tick();
  assert.ok(p.x - x <= .201); assert.ok(Number.isFinite(p.yaw)); assert.equal(p.level, 1); assert.equal(p.gold, 50);
  for (const type of ['kill', 'reward', 'victory', 'teleport', 'grant-item']) game.handle(p, { type, marks: BOSSES.map(b => b.id), won: true });
  assert.equal(game.snapshot(p).reward, null);
});
test('silent input stops motion; physics prevents walking through a building', () => {
  const { game, players, tick, advance } = setup(1); const p = players[0];
  game.handle(p, { type: 'input', x: 1, z: 0 }); tick(); const x = p.x; advance(400); tick(3); assert.ok(Math.abs(p.x - x) < .001);
  const building = BUILDINGS[0], edge = building.x + building.w / 2;
  at(p, edge + 2, building.z);
  for (let i = 0; i < 100; i++) { game.handle(p, { type: 'input', x: -1, z: 0, dash: true }); tick(); }
  assert.ok(p.x > edge, `Clipped inside building: ${p.x}`);
});
test('aimed shots hit players and rate is enforced by simulation rather than packet count', () => {
  const { game, players, tick } = setup(); const [a, b] = players; at(a, 220, 230); at(b, 220, 225);
  for (let i = 0; i < 1000; i++) game.handle(a, { type: 'input', attack: true, yaw: 0 });
  tick(); assert.equal(b.hp, b.maxHp); assert.equal(game.projectiles.length, 1);
  tick(4); const hp = b.hp; assert.ok(hp < b.maxHp); tick(); assert.equal(b.hp, hp);
  const wall = BUILDINGS[0]; assert.equal(game.visible({ x: wall.x - wall.w, z: wall.z }, { x: wall.x + wall.w, z: wall.z }), false);
});
test('party membership allows healing and prevents direct and ability friendly fire', () => {
  const { game, players, tick } = setup(3); const [a, b, outsider] = players;
  game.handle(a, { type: 'party-create' }); game.handle(b, { type: 'party-join', code: a.party });
  at(a, 220, 230); at(b, 224, 230); a.hp -= 60; game.handle(b, { type: 'input', skill: true }); tick(); assert.equal(a.hp, a.maxHp);
  const hp = b.hp, gold = b.gold; assert.equal(game.hitPlayer(b, 99999, a), 0); assert.equal(b.hp, hp); assert.equal(b.gold, gold);
  at(outsider, 220, 226); const enemyHp = outsider.hp;
  game.handle(a, { type: 'input', skill: true }); tick(); assert.equal(b.hp, hp); assert.ok(outsider.hp < enemyHp);
  game.handle(b, { type: 'party-leave' }); game.hitPlayer(b, 20, a); assert.ok(b.hp < hp);
});
test('parties admit ten including the creator, reject an eleventh, and reuse freed slots', () => {
  const { game, players } = setup(11), creator = players[0];
  game.handle(creator, { type: 'party-create' }); const code = creator.party;
  for (const p of players.slice(1, 10)) game.handle(p, { type: 'party-join', code });
  assert.equal(game.parties.get(code).size, 10);
  assert.throws(() => game.handle(players[10], { type: 'party-join', code }), /10 игроков/);
  assert.equal(players[10].party, null); assert.equal(game.parties.get(code).size, 10);
  game.handle(players[5], { type: 'party-leave' }); game.handle(players[10], { type: 'party-join', code });
  assert.equal(players[10].party, code); assert.equal(game.parties.get(code).size, 10);
});
test('merchant validates location, funds and inventory; equipment changes real stats', () => {
  const { game, players } = setup(1); const p = players[0];
  assert.throws(() => game.handle(p, { type: 'buy', item: 'coil' }), /далеко/);
  at(p, SAFE_ZONES[0].merchant.x, SAFE_ZONES[0].merchant.z + 1); assert.throws(() => game.handle(p, { type: 'buy', item: 'coil' }), /кредитов/);
  p.gold = 500; game.handle(p, { type: 'buy', item: 'coil' }); assert.equal(p.gold, 360);
  const item = p.inventory.find(i => i.type === 'coil'), before = p.power;
  game.handle(p, { type: 'equip', id: item.id }); assert.equal(p.power, before + 7);
  assert.throws(() => game.handle(p, { type: 'sell', id: item.id }), /снимите/);
  assert.throws(() => game.handle(p, { type: 'equip', id: 'forged' }), /найден/);
});
test('kills award XP and currency, loot is personal and requires proximity', () => {
  const { game, players, tick } = setup(); const [a, b] = players; const e = game.enemies[0]; at(a, e.x, e.z + 3);
  game.hitEnemy(a, e, 99999); assert.ok(a.xp > 0); assert.ok(a.gold > 50); assert.ok(e.dead > 0);
  game.drop(a, e); const loot = game.loot.find(l => l.owner === a.id); const count = a.inventory.length;
  assert.equal(game.snapshot(b).loot.length, 0);
  at(a, 60, 60); game.handle(a, { type: 'input', interact: true }); tick(); assert.equal(a.inventory.length, count);
  at(a, loot.x, loot.z); game.handle(a, { type: 'input', interact: true }); tick(); assert.ok(a.inventory.length > count);
});
test('dead enemies respawn and boss aggro reset clears encounter contribution', () => {
  const { game, players, tick } = setup(1); const e = game.enemies[0], p = players[0]; at(p, e.x, e.z + 3); game.hitEnemy(p, e, 99999);
  at(p, SPAWN.x, SPAWN.z); e.dead = .01; tick(); assert.equal(e.hp, e.maxHp);
  const boss = game.enemies.find(e => e.bossId === 'archivist'); boss.hp -= 20; game.contribution(boss, p, 20); game.resetEnemy(boss); assert.equal(boss.contributions.size, 0);
});
test('world enemies use doubled respawn timers without changing player evacuation', () => {
  const { game, players: [p], tick } = setup(1);
  const cases = [['drone', 48], ['sentry', 48], ['bomber', 56], ['archivist', 180], ['resonator', 220], ['warden', 300]];
  const killed = cases.map(([kind, seconds]) => {
    const enemy = game.enemies.find(e => e.kind === kind || e.bossId === kind);
    game.killEnemy(enemy, p); assert.equal(enemy.dead, seconds); return [enemy, seconds];
  });
  tick();
  for (const [enemy, seconds] of killed) {
    assert.equal(enemy.hp, 0); assert.ok(Math.abs(enemy.dead - (seconds - STEP)) < 1e-8);
    enemy.dead = STEP / 2;
  }
  tick();
  for (const [enemy] of killed) assert.equal(enemy.hp, enemy.maxHp);
  at(p, 220, 230); game.hitPlayer(p, 99999); assert.equal(p.dead, 7);
});
test('boss pylons reduce damage, phase transitions regenerate shield once', () => {
  const { game, players, tick } = setup(1); const p = players[0], boss = game.enemies.find(e => e.bossId === 'resonator');
  at(p, boss.x, boss.z + 12); tick(); assert.equal(game.enemies.filter(e => e.parent === boss.id && e.kind === 'pylon').length, 2);
  game.hitEnemy(p, boss, 100); assert.equal(boss.hp, boss.maxHp - 15);
  for (const e of game.enemies.filter(e => e.parent === boss.id)) { e.hp = 0; e.dead = 1; }
  boss.hp = boss.maxHp * .6; tick(); assert.equal(boss.phase, 2);
  const count = game.enemies.filter(e => e.parent === boss.id && e.kind === 'pylon' && e.hp > 0).length; tick(); assert.equal(count, 2); assert.equal(game.enemies.filter(e => e.parent === boss.id && e.kind === 'pylon' && e.hp > 0).length, 2);
});
test('final boss requires both personal raid permits; idle party members get no flag', () => {
  const { game, players } = setup(3); const [fighter, healer, idle] = players;
  game.handle(fighter, { type: 'party-create' });
  for (const p of [healer, idle]) game.handle(p, { type: 'party-join', code: fighter.party });
  const boss = game.enemies.find(e => e.bossId === 'warden'); at(fighter, boss.x, boss.z + 12); at(healer, boss.x + 2, boss.z + 12); at(idle, boss.x + 4, boss.z + 12);
  assert.equal(game.hitEnemy(fighter, boss, 9999), 0); assert.equal(boss.hp, boss.maxHp);
  fighter.marks = healer.marks = idle.marks = ['archivist', 'resonator'];
  game.contribution(boss, healer, 0, 110); healer.hp = 0;
  game.hitEnemy(fighter, boss, 99999);
  assert.equal(game.snapshot(fighter).reward.flag, FLAG); assert.equal(game.snapshot(healer).reward.flag, FLAG);
  assert.ok(!JSON.stringify(game.snapshot(idle)).includes(FLAG));
});
test('only the last-hitting raid gets the flag, even when another raid dealt most damage', () => {
  const { game, players } = setup(6); const [rival, rivalHealer, killer, healer, noPermits, idle] = players;
  const boss = game.enemies.find(e => e.bossId === 'warden');
  for (const [i, p] of players.entries()) { at(p, boss.x + i, boss.z + 12); p.marks = ['archivist', 'resonator']; }
  game.handle(rival, { type: 'party-create' }); game.handle(rivalHealer, { type: 'party-join', code: rival.party });
  game.handle(killer, { type: 'party-create' });
  for (const p of [healer, noPermits, idle]) game.handle(p, { type: 'party-join', code: killer.party });
  noPermits.marks = ['archivist'];
  game.contribution(boss, rivalHealer, 0, 150); game.contribution(boss, healer, 0, 110); game.contribution(boss, noPermits, 0, 150);
  game.hitEnemy(rival, boss, boss.maxHp - 250); game.hitEnemy(killer, boss, 1000);
  assert.equal(boss.hp, 0);
  for (const p of [killer, healer]) assert.equal(game.snapshot(p).reward?.flag, FLAG);
  for (const p of [rival, rivalHealer, noPermits, idle]) assert.equal(game.snapshot(p).reward, null);
  game.handle(rival, { type: 'party-leave' }); game.handle(rival, { type: 'party-join', code: killer.party });
  assert.equal(game.snapshot(rival).reward, null);
  assert.equal(game.hitEnemy(rival, boss, 1000), 0);
});
test('an ungrouped final hitter wins alone; stale contribution in the winning raid is excluded', () => {
  const { game, players } = setup(3); const [a, b, stale] = players;
  const boss = game.enemies.find(e => e.bossId === 'warden');
  for (const [i, p] of players.entries()) { at(p, boss.x + i, boss.z + 12); p.marks = ['archivist', 'resonator']; }
  game.hitEnemy(a, boss, 1000); game.hitEnemy(b, boss, 99999);
  assert.equal(game.snapshot(a).reward, null); assert.equal(game.snapshot(b).reward?.flag, FLAG);
  game.resetEnemy(boss); b.won = false; b.archived = false; game.online.set(b.id, b); game.parties.delete(b.party); b.party = null;
  game.handle(b, { type: 'party-create' }); game.handle(stale, { type: 'party-join', code: b.party });
  game.contribution(boss, stale, 500); game.time += 66;
  game.hitEnemy(b, boss, 99999);
  assert.equal(game.snapshot(b).reward?.flag, FLAG); assert.equal(game.snapshot(stale).reward, null);
});
test('boss permits reward contributors instead of only the final hitter', () => {
  const { game, players } = setup(3); const boss = game.enemies.find(e => e.bossId === 'archivist');
  for (const [i, p] of players.entries()) at(p, boss.x + i, boss.z + 10);
  game.hitEnemy(players[0], boss, 100); game.hitEnemy(players[1], boss, 99999);
  assert.ok(players[0].marks.includes('archivist')); assert.ok(players[1].marks.includes('archivist')); assert.equal(players[2].marks.length, 0);
});
test('progress and private flag entitlement survive persisted reload and reconnect', () => {
  const { game, players } = setup(1); const p = players[0]; game.xp(p, 650); p.gold = 734; p.won = true; p.marks = BOSSES.map(b => b.id);
  const restored = new Game({ flag: FLAG, saved: game.records() }); const q = restored.connect(p.token, () => {}); restored.handle(q, { type: 'enter', name: 'Overwrite', role: 'medic' });
  assert.equal(q.level, p.level); assert.equal(q.gold, 734); assert.equal(q.name, p.name); assert.equal(restored.snapshot(q).reward.flag, FLAG);
  const stranger = restored.connect('wrong', () => {}); restored.handle(stranger, { type: 'enter' }); assert.equal(restored.snapshot(stranger).reward, null);
});
