import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldView } from '../client/world.mjs';
import * as T from 'three';
import { batchModel, weapon } from '../client/model-details.mjs';
import { projectileModel } from '../client/projectile-model.mjs';
import { ROLES, WEAPONS, BOSSES } from '../shared/config.mjs';

const triangles = group => { let total = 0; group.traverse(o => { if (o.geometry) total += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }); return total; };
const meshes = group => { let count = 0; group.traverse(o => { if (o.isMesh) count++; }); return count; };

test('character and boss assets contain detailed geometry and retain animation joints', () => {
  const view = Object.create(WorldView.prototype); view.materials = {};
  const actor = view.avatar('assault'); const guardian = view.enemy({ kind: 'boss', bossId: 'warden' }); const drone = view.enemy({ kind: 'drone' });
  const bomber = view.enemy({ kind: 'bomber' }); assert.ok(triangles(bomber) > 5000); assert.equal(bomber.userData.rotors.length, 4); assert.ok(bomber.userData.beacon);
  assert.ok(triangles(actor) > 10000); assert.ok(triangles(guardian) > 15000); assert.ok(triangles(drone) > 2500);
  assert.equal(actor.userData.legs.length, 2); assert.ok(guardian.userData.shield);
  console.log(`Model triangles: character=${triangles(actor)}, boss=${triangles(guardian)}, drone=${triangles(drone)}`);
});
test('rigid model batching preserves geometry, local transforms and independent animation nodes', () => {
  const root = new T.Group(); root.position.set(3, 4, 2); root.rotation.y = .7; root.scale.setScalar(1.3);
  const mat = new T.MeshStandardMaterial(), joint = new T.Group(); joint.position.set(1, 0, 0); root.add(joint);
  const rotor = new T.Mesh(new T.BoxGeometry(1, .1, .1), mat); joint.add(rotor);
  for (let i = 0; i < 4; i++) { const mesh = new T.Mesh(new T.BoxGeometry(.3, .5, .2), mat); mesh.position.set(i * .4, 1, 0); root.add(mesh); }
  root.updateMatrixWorld(true); const bounds = new T.Box3().setFromObject(root), before = triangles(root), rotorGeometry = rotor.geometry;
  batchModel(root, [joint]); root.updateMatrixWorld(true); const after = new T.Box3().setFromObject(root);
  assert.ok(bounds.min.distanceTo(after.min) < .000001); assert.ok(bounds.max.distanceTo(after.max) < .000001);
  assert.equal(triangles(root), before); assert.equal(meshes(root), 2); assert.equal(rotor.geometry, rotorGeometry); assert.equal(joint.parent, root);
  joint.rotation.y = 1; assert.equal(joint.rotation.y, 1);
});
test('detailed models keep bounded draw counts, valid UVs and reusable materials', () => {
  const v = Object.create(WorldView.prototype); v.materials = {};
  const assets = [...Object.keys(ROLES).map(role => v.avatar(role)), ...Object.keys(WEAPONS).map(type => v.weaponModel(type)), ...BOSSES.map(b => v.enemy({ kind: 'boss', bossId: b.id })), ...['drone', 'sentry', 'bomber', 'pylon'].map(kind => v.enemy({ kind }))];
  for (const asset of assets) {
    assert.ok(meshes(asset) <= 48, `Rigid details should be batched: ${meshes(asset)} meshes`);
    asset.traverse(o => { if (!o.geometry) return; for (const name of ['position', 'normal', 'uv']) assert.ok(Array.from(o.geometry.getAttribute(name).array).every(Number.isFinite)); });
  }
  const count = Object.keys(v.materials).length; for (const asset of assets) v.dispose(asset);
  for (const role of Object.keys(ROLES)) v.dispose(v.avatar(role)); for (const type of Object.keys(WEAPONS)) v.dispose(v.weaponModel(type));
  assert.equal(Object.keys(v.materials).length, count);
  assert.ok(Object.values(v.materials).some(m => m.bumpMap?.isDataTexture));
  for (const material of Object.values(v.materials)) if (material.roughnessMap) assert.equal(material.roughnessMap.colorSpace, T.NoColorSpace);
});
test('far enemy variants remain recognizable and retain alert and rotor hooks at lower cost', () => {
  const v = Object.create(WorldView.prototype); v.materials = {};
  for (const kind of ['drone', 'sentry', 'bomber', 'pylon']) {
    const full = v.enemy({ kind }), low = v.enemy({ kind, low: true });
    assert.ok(triangles(low) < triangles(full) * .15, kind); assert.equal(low.userData.low, true);
    if (kind === 'bomber') { assert.equal(low.userData.rotors.length, 4); assert.ok(low.userData.beacon); }
    if (['drone', 'sentry'].includes(kind)) assert.ok(low.userData.eye);
    v.dispose(full); v.dispose(low);
  }
});
test('weapon fittings remain physically connected to the receiver before batching', () => {
  const view = Object.create(WorldView.prototype); view.materials = {};
  for (const type of Object.keys(WEAPONS)) {
    const group = weapon(view, type, { batch: false }); group.updateMatrixWorld(true); const parts = [];
    group.traverse(mesh => { if (mesh.isMesh && !mesh.material.transparent) parts.push(new T.Box3().setFromObject(mesh)); });
    const connected = new Set([0]); let changed = true;
    while (changed) { changed = false; for (let i = 0; i < parts.length; i++) if (!connected.has(i) && [...connected].some(j => parts[j].clone().expandByScalar(.004).intersectsBox(parts[i]))) { connected.add(i); changed = true; } }
    const detached = parts.flatMap((box, i) => connected.has(i) ? [] : [box.getCenter(new T.Vector3()).toArray().map(v => +v.toFixed(3))]);
    assert.deepEqual(detached, [], `${type}: unsupported geometry`); view.dispose(group);
  }
});
test('projectiles have a metallic pointed nose at the authoritative position and a short trailing streak', () => {
  const view = Object.create(WorldView.prototype); view.materials = {};
  for (const hostile of [false, true]) {
    const model = projectileModel(view, hostile), bullet = model.getObjectByName('bullet'), trail = model.getObjectByName('tracer');
    bullet.geometry.computeBoundingBox(); const bounds = bullet.geometry.boundingBox;
    assert.ok(Math.abs(bounds.max.y) < .000001); assert.ok(bounds.min.y > -.31); assert.ok(bounds.max.x < .05);
    assert.ok(bullet.material.metalness > .5); assert.ok(trail.material.transparent); assert.equal(trail.material.depthWrite, false); assert.ok(trail.geometry.parameters.height < 1);
    const direction = new T.Vector3(1, .3, -2).normalize(); model.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction);
    assert.ok(new T.Vector3(0, 1, 0).applyQuaternion(model.quaternion).distanceTo(direction) < .000001);
    model.traverse(part => { if (part.isMesh) assert.notEqual(part.geometry.type, 'SphereGeometry'); });
    view.dispose(model);
  }
});
