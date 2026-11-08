import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { NetworkView } from '../client/world.mjs';

test('relative mouse motion rotates both axes and clamps pitch', () => {
  const view = Object.assign(Object.create(NetworkView.prototype), { yaw: 0, pitch: 0 });
  view.look(100, -50); assert.ok(view.yaw > 0); assert.ok(view.pitch > 0);
  view.look(0, 10000); assert.equal(view.pitch, -1.4);
  view.look(0, -10000); assert.equal(view.pitch, 1.4);
  const yaw = view.yaw; view.look(NaN, 20); assert.equal(view.yaw, yaw); assert.equal(view.pitch, 1.4);
});
test('locked cursor picks through the crosshair, not its frozen screen coordinates', () => {
  const before = globalThis.document, canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) };
  globalThis.document = { pointerLockElement: canvas };
  try {
    const root = new T.Group(), mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); mesh.position.z = -4; root.add(mesh);
    const view = Object.assign(Object.create(NetworkView.prototype), { canvas, mode: 'world', deviceRoot: root, baseTargets: [], deviceTargets: [mesh], pointer: new T.Vector2(), ray: new T.Raycaster(), camera: new T.PerspectiveCamera(65, 1.25, .04, 100) });
    assert.equal(view.pick({ clientX: 999, clientY: 1 })?.object, mesh);
    document.pointerLockElement = null; assert.equal(view.pick({ clientX: 999, clientY: 1 }), undefined);
    assert.equal(view.pick()?.object, mesh);
  } finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
});
test('inspection and dialogs release the cursor and stop held movement', () => {
  const before = globalThis.document, canvas = { hasPointerCapture: () => false };
  globalThis.document = { pointerLockElement: canvas, exitPointerLock() { this.pointerLockElement = null; } };
  try {
    const view = Object.assign(Object.create(NetworkView.prototype), { canvas, mode: 'world', keys: new Set(['KeyW']), interact() {}, onHover() {} });
    view.focus('bench', false); assert.equal(document.pointerLockElement, null); assert.equal(view.keys.size, 0); assert.equal(view.mode, 'bench');
    view.mode = 'world'; document.pointerLockElement = canvas; view.keys.add('KeyW'); view.setBlocked(true);
    assert.equal(document.pointerLockElement, null); assert.equal(view.keys.size, 0);
    view.setBlocked(false); assert.equal(document.pointerLockElement, null);
  } finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
});
