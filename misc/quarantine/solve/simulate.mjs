// Organizer balance fixture: equally geared level-6 players, ordinary combat inputs.
import { Game } from '../src/server/game.mjs';
import { STEP, WALLS } from '../src/shared/config.mjs';

export function simulate(roles, bossId = 'warden', limit = 240) {
  let now = 1000; const game = new Game({ flag: 'nskctf{balance_fixture}', now: () => now });
  const boss = game.enemies.find(e => e.bossId === bossId);
  const players = roles.map((role, index) => {
    const p = game.connect(null, () => {}); game.handle(p, { type: 'enter', role, name: `Fixture ${index}` });
    p.level = 6; p.marks = ['archivist', 'resonator']; p.potions = 3;
    for (const type of ['carbine', 'shell', 'memory']) { const i = game.item(type); p.inventory.push(i); game.handle(p, { type: 'equip', id: i.id }); }
    game.stats(p); p.hp = p.maxHp;
    p.x = boss.x + (index - (roles.length - 1) / 2) * 6; p.z = boss.z + 16; p.body.position.set(p.x, .8, p.z);
    return p;
  });
  game.handle(players[0], { type: 'party-create' });
  for (const p of players.slice(1)) game.handle(p, { type: 'party-join', code: players[0].party });
  let ticks = 0;
  for (; ticks < limit / STEP && boss.hp > 0 && players.some(p => p.hp > 0); ticks++) {
    now += STEP * 1000;
    for (const p of players.filter(p => p.hp > 0)) game.handle(p, { type: 'input', ...plan(game.snapshot(p), boss.id) });
    game.tick();
    // A dead character's evacuation cannot accidentally turn this fixture into repeated raids.
    for (const p of players.filter(p => p.hp <= 0)) game.disconnect(p);
  }
  return { result: boss.hp <= 0 ? 'victory' : players.some(p => p.hp > 0) ? 'timeout' : 'defeat', seconds: Math.round(ticks * STEP), bossHP: Math.round(boss.hp), players: players.map(p => ({ role: p.role, hp: Math.round(p.hp), potionsLeft: p.potions, damage: Math.round(p.damage), support: Math.round(p.support), reward: p.won })) };
}

function plan(state, bossId) {
  const p = state.self; const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const boss = state.enemies.find(e => e.id === bossId);
  const pylons = state.enemies.filter(e => e.kind === 'pylon' && e.parent === bossId && e.hp > 0);
  const threats = state.enemies.filter(e => e.kind !== 'boss' && e.kind !== 'pylon' && e.hp > 0 && d(e, p) < 22);
  const target = [...(threats.length ? threats : pylons.length ? pylons : [boss])].sort((a, b) => d(a, p) - d(b, p))[0];
  let cost = Infinity, motion = { x: 0, z: 0 };
  for (let i = -1; i < 24; i++) {
    const x = i < 0 ? 0 : Math.cos(i * Math.PI / 12), z = i < 0 ? 0 : Math.sin(i * Math.PI / 12), future = { x: p.x + x * 3.4, z: p.z + z * 3.4 };
    let score = Math.abs(d(future, target) - 12) * .5;
    if (d(future, boss) > 24) score += 50;
    if (WALLS.some(w => Math.abs(future.x - w.x) < w.w / 2 + .7 && Math.abs(future.z - w.z) < w.d / 2 + .7)) score += 90;
    for (const h of state.hazards) { const r = d(future, h); if (r < h.radius + .7 && r > h.inner - .7) score += 40 + (h.radius - r) * .4; }
    for (const shot of state.projectiles.filter(s => s.enemy)) {
      const speed2 = shot.vx * shot.vx + shot.vz * shot.vz;
      const t = Math.max(0, Math.min(.5, ((future.x - shot.x) * shot.vx + (future.z - shot.z) * shot.vz) / Math.max(1, speed2)));
      if (Math.hypot(future.x - shot.x - shot.vx * t, future.z - shot.z - shot.vz * t) < 1.5) score += 30;
    }
    if (p.role === 'medic') {
      const wounded = state.players.filter(q => q.id !== p.id && q.hp > 0 && q.hp < q.maxHp * .8).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (wounded) score += Math.max(0, d(future, wounded) - 6) * 2;
    }
    for (const q of state.players.filter(q => q.id !== p.id && q.hp > 0)) if (d(future, q) < 3) score += 10;
    if (score < cost) { cost = score; motion = { x, z }; }
  }
  const skill = p.role === 'medic' ? state.players.some(q => q.hp > 0 && q.maxHp - q.hp > 40 && d(p, q) < 9) : p.role === 'guardian' ? d(p, boss) < 20 : d(p, target) < 8;
  const usingMedkitSkill = p.role === 'medic' && skill && p.cd.skill === 0 && p.potions > 0;
  return { ...motion, yaw: Math.atan2(target.x - p.x, -(target.z - p.z)), attack: true, skill, potion: !usingMedkitSkill && p.hp < p.maxHp * .5, sprint: state.hazards.some(h => h.delay < .5 && d(p, h) < h.radius && d(p, h) >= h.inner) };
}
if (process.argv[1]?.endsWith('/simulate.mjs')) console.log(JSON.stringify({ raid: simulate(['assault', 'medic', 'guardian']), solo: simulate(['assault']) }, null, 2));
