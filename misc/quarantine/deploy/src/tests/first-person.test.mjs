import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { WorldView } from '../client/world.mjs';
import { CAMERA } from '../shared/config.mjs';

function fixture() {
  const view = Object.create(WorldView.prototype);
  Object.assign(view, { materials: {}, entities: new Map(), hazards: new Map(), effects: new Map(), drops: new Map(), bullets: new Map(), seen: new Set(), solids: [], clock: 0, cameraPosition: new T.Vector3(), camera: new T.PerspectiveCamera(CAMERA.fov, 16 / 9, .05, 165), scene: new T.Scene(), viewScene: new T.Scene(), viewPass: {}, viewRecoil: 0, viewSway: new T.Vector2(), sun: { position: new T.Vector3(), target: { position: new T.Vector3() } }, rain: new T.Group(), film: { uniforms: { time: { value: 0 } } }, composer: { render() {} } });
  view.preview = view.avatar('assault');
  const self = { id: 'self', x: 12, y: 4, z: 8, yaw: 0, pitch: 0, role: 'assault', hp: 140, maxHp: 140, grounded: true, weapon: 'pistol', weaponType: 'pistol', reload: 0 };
  const state = { self, players: [self], enemies: [], projectiles: [], hazards: [], loot: [], effects: [] };
  view.update(state); return { view, self, state };
}
test('first-person camera stays at the eyes when looking, rolling or zooming', () => {
  const { view, self } = fixture();
  for (const [yaw, pitch, roll, fov] of [[0, 0, 0, CAMERA.fov], [2, 1.2, .2, CAMERA.minFov], [-2, -1.2, -.3, CAMERA.maxFov]]) {
    view.render(1 / 60, yaw, pitch, roll, fov);
    assert.ok(view.camera.position.distanceTo(new T.Vector3(self.x, self.y + CAMERA.eyeHeight, self.z)) < 1e-6);
    const forward = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    assert.ok(view.camera.getWorldDirection(new T.Vector3()).distanceTo(forward) < 1e-6);
    assert.equal(view.camera.fov, fov); assert.equal(view.entities.get(self.id).visible, false);
    assert.equal(view.viewPass.enabled, true);
  }
});
test('first-person weapons change, recoil on server events, lower for reload and hide on ladders/death', () => {
  const { view, self, state } = fixture();
  for (const type of ['pistol', 'shotgun', 'sniper', 'machinegun']) {
    self.weapon = self.weaponType = type; view.update(state); view.render(1 / 60);
    assert.equal(view.viewModel.userData.type, type);
    assert.ok(view.viewModel.children.length >= 9);
  }
  state.effects = [{ id: 1, kind: 'gunshot', actor: self.id, x: self.x, y: self.y, z: self.z, dx: 0, dy: 0, dz: -1, ttl: .36 }];
  view.update(state); view.render(1 / 60); assert.equal(view.viewModel.userData.flash.visible, true);
  assert.ok(view.viewModel.position.z > -.42);
  self.reload = 1.65; view.render(1 / 60); assert.ok(view.viewModel.rotation.z < -.6);
  self.climbing = 'ladder'; view.render(1 / 60); assert.equal(view.viewPass.enabled, false);
  self.climbing = null; self.hp = 0; view.render(1 / 60); assert.equal(view.viewPass.enabled, false);
  self.hp = 140; view.render(1 / 60); assert.equal(view.viewPass.enabled, true);
});
test('a recreated remote character rebuilds its role model while retaining its network ID', () => {
  const { view, self, state } = fixture(); view.tag = () => {};
  const other = { ...self, id: 'other', x: self.x + 2, role: 'assault' }; state.players.push(other); view.update(state);
  const before = view.entities.get('other'); other.role = 'medic'; view.update(state);
  assert.notEqual(view.entities.get('other'), before); assert.equal(view.entities.get('other').userData.data.role, 'medic');
  assert.equal(view.entities.get(self.id).visible, false);
});

test('walking at a constant server speed does not pulse with 10 Hz snapshots', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now * 1000);
  const { view, self, state } = fixture();
  const origin = self.x, steps = [];
  let previous = view.camera.position.x;
  for (let frame = 0; frame < 240; frame++) {
    now = frame / 60;
    if (frame % 6 === 0) { state.time = now; self.x = origin + now * 6; view.update(state); }
    view.render(1 / 60);
    if (frame > 60) steps.push(view.camera.position.x - previous);
    previous = view.camera.position.x;
  }
  const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
  const variation = Math.sqrt(steps.reduce((sum, step) => sum + (step - mean) ** 2, 0) / steps.length) / mean;
  t.diagnostic(`Frame-to-frame speed variation: ${(variation * 100).toFixed(1)}%`);
  assert.ok(Math.abs(mean - .1) < .01, `Expected 6 m/s at 60 FPS, got ${mean * 60}`);
  assert.ok(variation < .1, `Frame-to-frame speed variation: ${(variation * 100).toFixed(1)}%`);
});
