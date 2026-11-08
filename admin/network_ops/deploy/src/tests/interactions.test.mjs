import test from 'node:test';
import assert from 'node:assert/strict';
import { newLab, act, command, physicalChecks, publicLab } from '../server/lab.mjs';
import { context, updatePose, setContext, guardedAction, guardedCommand, gesture } from '../server/interactions.mjs';
import { incident } from '../server/incidents.mjs';
import { solvedLab, craft } from '../../solve/fixtures.mjs';
const runtime = () => ({ context: context(), budget: 3, poseAt: 0, generation: 0 });

test('movement cannot pass through the workbench even with sufficient accumulated distance', () => {
  const lab = newLab('easy'), r = runtime(); incident(lab).pose = { x: 0, z: 10.1 };
  assert.equal(updatePose(lab, r, { x: 0, z: 7.2 }, 1000), false); assert.equal(incident(lab).pose.z, 10.1);
  assert.equal(updatePose(lab, r, { x: 2, z: 11 }, 2000), true);
});
test('zero-time small moves cannot mint distance and legitimate 650ms sprint updates work', () => {
  const lab = newLab('easy'), r = runtime(); r.budget = 0;
  for (let i = 0; i < 800; i++) assert.equal(updatePose(lab, r, { x: incident(lab).pose.x - .014, z: 11 }, 0), false);
  assert.deepEqual(incident(lab).pose, { x: 0, z: 11 });
  assert.equal(updatePose(lab, r, { x: 4.225, z: 11 }, 650), true);
  assert.equal(updatePose(lab, r, { x: 8.45, z: 11 }, 1300), true);
});
test('commands require current near-device context and every alias uses that gate', () => {
  const lab = newLab('medium'), r = runtime(); lab.console = 'r1';
  assert.throws(() => guardedCommand(lab, r, 'show running-config'), /Подключите/);
  incident(lab).pose = { x: -5, z: -4.5 }; r.context.tool = 'console'; guardedAction(lab, r, { type: 'console', device: 'r1' });
  assert.ok(guardedCommand(lab, r, 'show running-config').output); assert.equal(guardedCommand(lab, r, 'ip a').diagnostic.operation, 'addresses');
  incident(lab).pose = { x: 10, z: 10 };
  for (const line of ['ip a', 'help', 'ip forward on', 'show startup-config']) assert.throws(() => guardedCommand(lab, r, line), /ближе/);
  assert.throws(() => command(lab, 'ip addr add 10.42.10.1/24 dev uplink.10.extra'));
});
test('calibration and crimp outcomes are derived from bound timed gestures, not supplied booleans', () => {
  const lab = newLab('easy'), r = runtime(); setContext(lab, r, { mode: 'bench', tool: 'cutter' });
  let g = gesture(lab, r, { phase: 'begin', kind: 'tool', point: { x: -2.12, z: -.97 } }, 0);
  assert.throws(() => gesture(lab, r, { phase: 'end', token: g.token, point: { x: .2375, z: -.35 } }, 1), /быстро/);
  r.context.gesture = null; g = gesture(lab, r, { phase: 'begin', kind: 'tool', point: { x: -2.12, z: -.97 } }, 100);
  gesture(lab, r, { phase: 'end', token: g.token, point: { x: .2375, z: -.35 }, length: 40, crimped: true }, 300);
  assert.equal(lab.draft.length, 25); assert.equal(lab.draft.ends[0].crimped, false);
  assert.throws(() => gesture(lab, r, { phase: 'end', token: g.token, point: { x: .2375, z: -.35 } }, 500), /устарел/);
});
test('topology, power, manual construction and panel checks are independent prerequisites', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const lab = solvedLab(level); assert.ok(physicalChecks(lab).every(c => c.ok));
    lab.power.swa = false; assert.equal(physicalChecks(lab).find(c => c.id === 'power').ok, false); lab.power.swa = true;
    lab.cables[0].handmade = false; assert.equal(physicalChecks(lab).find(c => c.id === 'crafted').ok, false); lab.cables[0].handmade = true;
    lab.cables[0].ends[0].depth = 3;
    assert.equal(physicalChecks(lab).find(c => c.id === 'crafted').ok, true); assert.equal(physicalChecks(lab).find(c => c.id === 'wiremap').ok, false);
    lab.cables[0].ends[0].depth = 1; lab.cables[0].ends[0].crimped = false; assert.equal(physicalChecks(lab).find(c => c.id === 'crafted').ok, false);
    lab.cables.pop(); assert.equal(physicalChecks(lab).find(c => c.id === 'topology').ok, false);
  }
});
test('single-end unplug preserves canonical cable state and length checks on reconnection', () => {
  const lab = newLab('easy'), r = runtime(), id = craft(lab), cable = lab.cables[0]; cable.length = 3;
  act(lab, { type: 'plug', id, port: 'pc:eth0' }); act(lab, { type: 'plug', id, port: 'outlet:j1' });
  incident(lab).pose = { x: -10, z: 10 }; guardedAction(lab, r, { type: 'unplug', id, port: 'pc:eth0' });
  assert.deepEqual(cable.plugs, ['outlet:j1', null]); assert.throws(() => act(lab, { type: 'plug', id, port: 'swa:p1' }), /короткий/);
});
test('projection exposes only visible assembly, not hidden quality or all equipment configs', () => {
  const lab = newLab('medium'); act(lab, { type: 'cut', length: 25 }); act(lab, { type: 'strip', end: 0, depth: 3, untwist: 30 });
  assert.equal(publicLab(lab).draft.ends, undefined); assert.equal(publicLab(lab).panel, undefined);
  const rendered = publicLab(lab, { mode: 'bench' }); assert.ok(rendered.draft.ends[0].exposed); assert.equal(rendered.draft.ends[0].depth, undefined); assert.equal(rendered.draft.ends[0].untwist, undefined);
  for (const key of ['configs', 'startup', 'panelTested', 'subnet']) assert.equal(rendered[key], undefined);
});
