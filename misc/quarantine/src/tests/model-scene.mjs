import * as T from 'three';
import { WorldView } from '../client/world.mjs';
import { ROLES, SPAWN, CAMERA } from '../shared/config.mjs';

const view = new WorldView(document.getElementById('scene')), draw = view.composer.render.bind(view.composer);
view.composer.render = () => {}; view.renderer.info.autoReset = false;
let mode = 'characters', previous = performance.now();
const player = (id, role, x, z) => ({ id, role, name: role.toUpperCase(), x, y: 0, z, yaw: Math.PI, pitch: 0, hp: 140, maxHp: 140, weapon: 'rifle', ward: 0 });
const enemy = (kind, x, z, bossId) => ({ id: `${kind}-${bossId ?? x}`, kind, bossId, x, z, yaw: Math.PI, level: 3, hp: 100, maxHp: 100, shield: false, behavior: 'patrol', altitude: kind === 'bomber' ? .4 : 0 });
window.showModel = name => {
  mode = name;
  const self = { ...player('self', 'assault', 0, SPAWN.z), yaw: 0, weapon: 'pistol', weaponType: 'pistol', grounded: true, reload: 0 };
  const state = { self, players: [self], enemies: [], effects: [], projectiles: [], hazards: [], loot: [], time: 0 };
  if (name === 'characters') state.players.push(...Object.keys(ROLES).map((role, i) => player(role, role, (i - 1) * 1.8, SPAWN.z - 5)));
  else if (name === 'drones') state.enemies = ['drone', 'sentry', 'bomber'].map((kind, i) => enemy(kind, (i - 1) * 2.8, SPAWN.z - 7));
  else if (name === 'pylon') state.enemies = [enemy('pylon', 0, SPAWN.z - 5)];
  else if (name === 'projectiles') { self.x = 210; self.z = 230; state.projectiles = [-.35, .35].map((x, i) => ({ id: `round-${i}`, at: 0, x: 210 + x, y: 1.6, z: 226, vx: .2, vy: .03, vz: 0, enemy: !!i, life: 10 })); }
  else if (name.startsWith('weapon-')) self.weapon = self.weaponType = name.slice(7);
  else if (name === 'crowd') {
    for (let i = 0; i < 79; i++) state.players.push(player(`crowd-${i}`, Object.keys(ROLES)[i % 3], Math.sin(i * 2.4) * (4 + i * .8), SPAWN.z - 2 - Math.cos(i * 2.4) * (4 + i * .8)));
    for (let i = 0; i < 36; i++) { const e = enemy(['drone', 'sentry', 'bomber'][i % 3], Math.sin(i * 1.8) * (5 + i * 2), SPAWN.z - 3 - Math.cos(i * 1.8) * (5 + i * 2)); e.id = `enemy-${i}`; state.enemies.push(e); }
  } else state.enemies = [enemy('boss', 0, SPAWN.z - 7, name)];
  view.update(state);
};
window.modelStats = () => {
  let detailedPlayers = 0, detailedEnemies = 0, low = 0, meshes = 0;
  for (const g of view.entities.values()) { if (g.userData.low) low++; else if (g.userData.data.kind === 'player') detailedPlayers++; else detailedEnemies++; g.traverse(o => { if (o.isMesh) meshes++; }); }
  return { detailedPlayers, detailedEnemies, low, meshes, visibleProjectiles: [...view.bullets.values()].filter(g => g.visible).length, geometryCount: view.renderer.info.memory.geometries, textures: view.renderer.info.memory.textures, drawCalls: view.renderer.info.render.calls, animated: [...view.entities.values()].flatMap(g => [...(g.userData.rotors ?? []), ...(g.userData.fans ?? [])]).map(g => g.rotation.y) };
};
window.showModel(mode);
function frame(now) {
  const dt = Math.min(.05, (now - previous) / 1000); previous = now; view.render(dt);
  if (!mode.startsWith('weapon-')) {
    view.viewPass.enabled = false; const boss = !['characters', 'drones', 'pylon', 'crowd', 'projectiles'].includes(mode);
    const target = new T.Vector3(0, boss ? 2.3 : mode === 'drones' ? 1.1 : 1.05, SPAWN.z - (boss || mode === 'drones' ? 7 : 5));
    view.camera.position.copy(target).add(new T.Vector3(boss ? 5.5 : mode === 'drones' ? 2.2 : 3.0, boss ? 2.4 : 1.0, boss ? 9.8 : mode === 'drones' ? 10.5 : 7.4));
    view.camera.fov = 48; view.camera.lookAt(target); view.camera.updateProjectionMatrix();
    if (mode === 'projectiles') { view.camera.position.set(210.6, 2.0, 227.3); view.camera.lookAt(210, 1.6, 226); }
  } else { view.camera.fov = CAMERA.fov; view.camera.updateProjectionMatrix(); }
  view.renderer.info.reset(); draw(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
