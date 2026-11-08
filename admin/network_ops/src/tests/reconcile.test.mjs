import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionReconciler } from '../client/reconcile.mjs';

test('small authoritative movement corrections are blended over frames', () => {
  const reconciler = new PositionReconciler(), current = { x: 0, z: 0 };
  assert.deepEqual(reconciler.setTarget(current, { x: .8, z: 0 }), { snap: false, changed: true });
  const first = reconciler.step(current, 1 / 60);
  assert.ok(first.x > 0 && first.x < .8);
  let next = first;
  for (let i = 0; i < 60 && reconciler.target; i++) next = reconciler.step(next, 1 / 60);
  assert.ok(Math.abs(next.x - .8) < .03);
});

test('tiny drift is ignored and a large discontinuity snaps', () => {
  const reconciler = new PositionReconciler(), current = { x: 2, z: 3 };
  assert.deepEqual(reconciler.setTarget(current, { x: 2.01, z: 3 }), { snap: false, changed: false });
  const snap = reconciler.setTarget(current, { x: 8, z: 3 });
  assert.deepEqual(snap, { snap: true, changed: true, x: 8, z: 3 });
  assert.equal(reconciler.step(current, 1 / 60), null);
});
