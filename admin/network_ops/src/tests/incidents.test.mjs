import test from 'node:test';
import assert from 'node:assert/strict';
import { newLab, act, connections, snapshotForChecker } from '../server/lab.mjs';
import { advanceIncident, incident, publicIncident, worldCommand } from '../server/incidents.mjs';
import { craft } from '../../solve/fixtures.mjs';
import { RAT_INTERVAL, SHOTGUN_RACK, cableResult, roomObstacles, mission } from '../shared/catalog.mjs';

function connected() {
  const lab = newLab('easy', 42), id = craft(lab);
  for (const port of ['r1:srv', 'archive:eth0']) act(lab, { type: 'plug', id, port }); return lab;
}
const aim = (pose, rat) => { const v = [rat.x - pose.x, .3 - 1.7, rat.z - pose.z], length = Math.hypot(...v); return v.map(n => n / length); };
test('rat spawns at 5 minutes, follows walkable paths, chews one cable and severs the network', () => {
  assert.equal(RAT_INTERVAL, 300);
  const lab = connected(), s = incident(lab), before = lab.revision;
  advanceIncident(lab, RAT_INTERVAL - .1); assert.equal(s.rat, null);
  advanceIncident(lab, .1); assert.ok(s.rat); const id = s.rat.id;
  const obstacles = roomObstacles(mission('easy'));
  for (let i = 0; i < 1200 && !lab.cables[0].damage; i++) {
    advanceIncident(lab, .1); const rat = s.rat; assert.ok(rat);
    assert.equal(rat.id, id); assert.ok(!obstacles.some(b => Math.abs(rat.x - b.x) < b.w / 2 && Math.abs(rat.z - b.z) < b.d / 2));
  }
  assert.ok(lab.cables[0].damage); assert.equal(lab.revision, before + 1); assert.equal(s.rat.state, 'fleeing');
  assert.equal(cableResult(lab.cables[0]).good, false); assert.deepEqual(connections(lab), []);
  assert.equal(snapshotForChecker(lab).physical.find(c => c.id === 'wiremap').ok, false);
  for (let i = 0; i < 1000; i++) advanceIncident(lab, .1);
  assert.equal(s.rat, null); assert.ok(s.nextRat > s.elapsed);
});
test('older saves adopt the five-minute cadence without resetting progress or shifting it repeatedly', () => {
  const lab = newLab('easy'), s = incident(lab); delete s.ratInterval;
  s.elapsed = 100; s.nextRat = 900;
  assert.equal(incident(lab).nextRat, 300); assert.equal(s.elapsed, 100);
  assert.equal(incident(lab).nextRat, 300);
  advanceIncident(lab, 199.9); assert.equal(s.rat, null); advanceIncident(lab, .1); assert.ok(s.rat);
  assert.equal(s.nextRat, 600);
  s.rat = null; s.elapsed = 599.9; advanceIncident(lab, .1); assert.ok(s.rat); assert.equal(s.nextRat, 900);
});
test('overdue legacy saves spawn once on resume and keep an existing rat intact', () => {
  const lab = newLab('easy'), s = incident(lab); delete s.ratInterval;
  s.elapsed = 700; s.nextRat = 900; advanceIncident(lab, .1);
  const rat = s.rat; assert.ok(rat); assert.equal(s.nextRat, s.elapsed + 300);
  delete s.ratInterval; s.nextRat = s.elapsed + 900;
  incident(lab); assert.equal(s.rat, rat); assert.ok(Math.abs(s.nextRat - (s.elapsed + 300)) < 1e-6);
});
test('tray cables are protected; unplugging a target stops the bite', () => {
  const protectedLab = connected(); protectedLab.cables[0].route = ['center']; incident(protectedLab).nextRat = 0;
  for (let i = 0; i < 1300; i++) advanceIncident(protectedLab, .1);
  assert.equal(protectedLab.cables[0].damage, undefined);
  const lab = connected(), s = incident(lab); s.nextRat = 0;
  for (let i = 0; i < 700 && s.rat?.state !== 'chewing'; i++) advanceIncident(lab, .1);
  assert.equal(s.rat.state, 'chewing'); act(lab, { type: 'unplug', id: lab.cables[0].id });
  for (let i = 0; i < 200; i++) advanceIncident(lab, .1);
  assert.equal(lab.cables[0].damage, undefined);
});
test('shotgun pickup, ammunition, reload, aim, range and obstruction are server-checked', () => {
  const lab = newLab('easy'), s = incident(lab);
  assert.throws(() => worldCommand(lab, 'take'), /Подойдите/);
  assert.throws(() => worldCommand(lab, 'shoot', [0, 0, -1]), /стене/);
  s.pose = { x: SHOTGUN_RACK.x, z: 12 }; assert.equal(worldCommand(lab, 'take').taken, true);
  assert.throws(() => worldCommand(lab, 'shoot', [NaN, 0, 0]), /направление/);
  assert.throws(() => worldCommand(lab, 'shoot', [0, 0, -100]), /направление/);
  s.pose = { x: 0, z: 11 }; s.rat = { id: 'test', x: 0, z: 5, state: 'chewing', path: [], born: 0 };
  assert.equal(worldCommand(lab, 'shoot', aim(s.pose, s.rat)).hit, false, 'Workbench blocks the shot');
  assert.equal(worldCommand(lab, 'shoot', aim(s.pose, s.rat)).fired, false, 'Fire-rate gate');
  s.elapsed += 1; s.pose = { x: 4, z: 5 }; s.rat.x = 4; s.rat.z = 2;
  assert.equal(worldCommand(lab, 'shoot', [0, 0, 1]).hit, false, 'Aiming away misses');
  s.elapsed += 1; assert.equal(worldCommand(lab, 'shoot', aim(s.pose, s.rat)).hit, true); assert.equal(s.rat.state, 'dead');
  for (let i = 0; i < 3; i++) { s.elapsed += 1; assert.equal(worldCommand(lab, 'shoot', [0, 0, -1]).fired, true); }
  s.elapsed += 1; assert.equal(worldCommand(lab, 'shoot', [0, 0, -1]).fired, false); assert.equal(s.ammo, 0);
  worldCommand(lab, 'reload'); advanceIncident(lab, 2); assert.equal(s.ammo, 0); advanceIncident(lab, .5); assert.equal(s.ammo, 6);
});
test('chewed cable cannot be reconnected or repaired by crimping its ends', () => {
  const lab = connected(), c = lab.cables[0]; c.damage = { point: [0, .12, 0] };
  act(lab, { type: 'unplug', id: c.id }); assert.throws(() => act(lab, { type: 'plug', id: c.id, port: 'r1:srv' }), /перегрызен/);
  act(lab, { type: 'rework', id: c.id }); assert.throws(() => act(lab, { type: 'finish' }), /перегрызен/);
  act(lab, { type: 'recut', end: 0 }); assert.ok(lab.draft.damage); act(lab, { type: 'discard' }); assert.equal(lab.draft, null);
});
test('incident state persists without leaking navigation internals or advancing when only read', () => {
  const lab = connected(); incident(lab).nextRat = 0; advanceIncident(lab, .1);
  const restored = JSON.parse(JSON.stringify(lab)), state = publicIncident(restored);
  assert.deepEqual(state, publicIncident(lab)); assert.equal(state.rat.path, undefined); assert.equal(incident(restored).elapsed, .1);
});
