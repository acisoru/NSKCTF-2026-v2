import { randomInt, randomBytes } from 'node:crypto';
import PF from 'pathfinding';
import { Ray, Vector3, Box3 } from 'three';
import { RAT_INTERVAL, RAT_VENT, SHOTGUN_RACK, mission, portPosition, roomObstacles } from '../shared/catalog.mjs';

const maps = new Map(), finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
const cell = v => Math.round((v + 14) * 2), coord = v => v / 2 - 14;
const note = (lab, text) => { lab.log.push({ at: Date.now(), text }); lab.log = lab.log.slice(-40); };
export function incident(lab) {
  const s = lab.incident ??= { elapsed: 0, nextRat: RAT_INTERVAL, ratInterval: RAT_INTERVAL, rat: null, shotgun: false, ammo: 6, reloadAt: 0, shotAt: -10, pose: { x: 0, z: 11 }, serial: 0 };
  if (s.ratInterval !== RAT_INTERVAL) {
    // Preserve time since the last scheduled appearance in older saves.
    s.nextRat += RAT_INTERVAL - (s.ratInterval ?? 15 * 60);
    s.ratInterval = RAT_INTERVAL;
  }
  return s;
}
function navigation(lab) {
  if (!maps.has(lab.level)) {
    const obstacles = roomObstacles(mission(lab.level)), grid = new PF.Grid(57, 53);
    for (let z = 0; z < 53; z++) for (let x = 0; x < 57; x++) {
      if (obstacles.some(b => Math.abs(coord(x) - b.x) < b.w / 2 + .3 && Math.abs(coord(z) - b.z) < b.d / 2 + .3)) grid.setWalkableAt(x, z, false);
    }
    maps.set(lab.level, grid);
  }
  return maps.get(lab.level);
}
function pathTo(lab, from, to) {
  const grid = navigation(lab), [sx, sz, tx, tz] = [cell(from.x), cell(from.z), cell(to.x), cell(to.z)];
  if (!grid.isWalkableAt(sx, sz) || !grid.isWalkableAt(tx, tz)) return [];
  return finder.findPath(sx, sz, tx, tz, grid.clone()).slice(1).map(([x, z]) => ({ x: coord(x), z: coord(z) })).concat([{ x: to.x, z: to.z }]);
}
function seek(lab, rat) {
  const spec = mission(lab.level, lab.subnet), candidates = [];
  for (const cable of lab.cables) {
    if (cable.damage || cable.route.length || !cable.plugs.every(Boolean)) continue;
    const a = portPosition(spec, cable.plugs[0]), b = portPosition(spec, cable.plugs[1]);
    if (Math.hypot(a.x - b.x, a.z - b.z) < .8) continue;
    for (const t of [.5, .3, .7]) {
      const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t + .5 }, path = pathTo(lab, rat, point);
      if (path.length) { candidates.push({ cable: cable.id, point, path }); break; }
    }
  }
  if (candidates.length) {
    const target = candidates[randomInt(candidates.length)]; Object.assign(rat, { target: target.cable, bite: target.point, path: target.path, state: 'running', chew: 0 });
  } else {
    const point = [{ x: -8, z: 2 }, { x: 8, z: 3 }, { x: 0, z: -3 }, RAT_VENT][randomInt(4)];
    Object.assign(rat, { target: null, path: pathTo(lab, rat, point), state: 'running', chew: 0 });
  }
}
function flee(lab, rat) { rat.state = 'fleeing'; rat.target = null; rat.path = pathTo(lab, rat, RAT_VENT); }
export function advanceIncident(lab, dt) {
  const s = incident(lab); s.elapsed += dt;
  if (s.reloadAt && s.elapsed >= s.reloadAt) { s.ammo = 6; s.reloadAt = 0; }
  if (s.elapsed >= s.nextRat) {
    s.nextRat = s.elapsed + RAT_INTERVAL;
    if (!s.rat) {
      s.rat = { id: randomBytes(6).toString('hex'), ...RAT_VENT, yaw: 0, born: s.elapsed, state: 'running', path: [], chew: 0 };
      seek(lab, s.rat); s.serial++; note(lab, 'ALICE: движение у вентиляции. Крыса в лаборатории.');
    }
  }
  const r = s.rat; if (!r) return;
  if (r.state === 'dead') { if (s.elapsed - r.deadAt > 4) s.rat = null; return; }
  if (s.elapsed - r.born > 100 && r.state !== 'fleeing') flee(lab, r);
  if (r.target) {
    const c = lab.cables.find(c => c.id === r.target);
    if (!c || c.damage || c.route.length || !c.plugs.every(Boolean)) seek(lab, r);
  }
  if (r.state === 'chewing') {
    r.chew += dt;
    if (r.chew >= 10) {
      const c = lab.cables.find(c => c.id === r.target);
      if (c) { c.damage = { point: [r.bite.x, .12, r.bite.z], at: s.elapsed }; lab.revision++; note(lab, `Обрыв линии: ${c.label}. Кабель перегрызен.`); }
      flee(lab, r); s.serial++;
    }
    return;
  }
  let travel = dt * (r.state === 'fleeing' ? 3.4 : 2.3);
  while (travel > 0 && r.path.length) {
    const next = r.path[0], dx = next.x - r.x, dz = next.z - r.z, distance = Math.hypot(dx, dz);
    if (distance > .001) r.yaw = Math.atan2(dx, dz);
    if (distance <= travel) { r.x = next.x; r.z = next.z; travel -= distance; r.path.shift(); }
    else { r.x += dx / distance * travel; r.z += dz / distance * travel; travel = 0; }
  }
  if (!r.path.length) {
    if (r.state === 'fleeing') s.rat = null;
    else if (r.target) { r.state = 'chewing'; r.chew = 0; }
    else seek(lab, r);
  }
}
export function publicIncident(lab) {
  const s = incident(lab), r = s.rat;
  return { elapsed: s.elapsed, nextRat: s.nextRat, shotgun: s.shotgun, ammo: s.ammo, reload: Math.max(0, s.reloadAt - s.elapsed), pose: s.pose, serial: s.serial, rat: r ? { id: r.id, x: r.x, z: r.z, yaw: r.yaw, state: r.state, chew: r.chew } : null };
}
export function worldCommand(lab, command, direction) {
  const s = incident(lab);
  if (command === 'take') {
    if (Math.hypot(s.pose.x - SHOTGUN_RACK.x, s.pose.z - SHOTGUN_RACK.z) > 3) throw new Error('Подойдите к настенному креплению');
    s.shotgun = true; return { taken: true };
  }
  if (!s.shotgun) throw new Error('Дробовик остался на стене');
  if (command === 'reload') { if (!s.reloadAt && s.ammo < 6) s.reloadAt = s.elapsed + 2.4; return { reloading: !!s.reloadAt }; }
  if (command !== 'shoot') throw new Error('Неизвестное действие');
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite) || Math.abs(Math.hypot(...direction) - 1) > .01) throw new Error('Некорректное направление');
  if (s.reloadAt || !s.ammo || s.elapsed - s.shotAt < .85) return { fired: false };
  s.shotAt = s.elapsed; s.ammo--;
  const rat = s.rat, from = new Vector3(s.pose.x, 1.7, s.pose.z), aim = new Vector3(...direction), result = { fired: true, hit: false };
  if (!rat || rat.state === 'dead') return result;
  const center = new Vector3(rat.x, .3, rat.z), delta = center.clone().sub(from), distance = delta.length(), along = delta.dot(aim);
  if (distance > 16 || along <= 0 || delta.clone().addScaledVector(aim, -along).length() > .38 + distance * .045) return result;
  const sight = new Ray(from, delta.normalize());
  for (const b of roomObstacles(mission(lab.level))) {
    const point = sight.intersectBox(new Box3(new Vector3(b.x - b.w / 2, 0, b.z - b.d / 2), new Vector3(b.x + b.w / 2, b.h, b.z + b.d / 2)), new Vector3());
    if (point && point.distanceTo(from) < distance - .35) return result;
  }
  rat.state = 'dead'; rat.deadAt = s.elapsed; rat.path = []; s.serial++; result.hit = true; note(lab, 'ALICE: движение прекращено.'); return result;
}
