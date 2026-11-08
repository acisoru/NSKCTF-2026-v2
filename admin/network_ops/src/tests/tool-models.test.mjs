import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, NoColorSpace } from 'three';
import { ToolModels, squeezeTool } from '../client/tool-models.mjs';
import { NetworkView } from '../client/world.mjs';
import { BENCH_TOOLS } from '../shared/workshop.mjs';

test('crimper handles rotate without stretching the mesh or its texture coordinates', () => {
  const tool = new Group(); tool.userData.handles = [-1, 1].map(side => { const handle = new Group(); handle.userData = { side, rest: side * .16 }; handle.rotation.y = handle.userData.rest; tool.add(handle); return handle; });
  const positions = tool.userData.handles.map(handle => handle.position.toArray());
  squeezeTool(tool, .75);
  assert.deepEqual(tool.scale.toArray(), [1, 1, 1]);
  for (const [i, handle] of tool.userData.handles.entries()) { assert.deepEqual(handle.scale.toArray(), [1, 1, 1]); assert.deepEqual(handle.position.toArray(), positions[i]); assert.notEqual(handle.rotation.y, handle.userData.rest); }
  squeezeTool(tool, 100); const closed = tool.userData.handles.map(h => h.rotation.y); squeezeTool(tool, 1); assert.deepEqual(tool.userData.handles.map(h => h.rotation.y), closed);
  squeezeTool(tool, 0); for (const handle of tool.userData.handles) assert.equal(handle.rotation.y, handle.userData.rest);
});
test('tool meshes have finite UVs and reuse their surface materials across workbench rebuilds', () => {
  const before = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, fillRect() {}, strokeRect() {}, fillText() {} }) }) };
  try {
    const view = Object.assign(Object.create(NetworkView.prototype), { materials: new Map(), workTargets: [], renderer: { capabilities: { getMaxAnisotropy: () => 8 } } });
    const models = new ToolModels(view), build = () => {
      const root = new Group(); view.workTargets = [];
      for (const [id, [, , label]] of Object.entries(BENCH_TOOLS)) { const group = new Group(); root.add(group); models.build(group, id, { label }); }
      root.traverse(mesh => { if (!mesh.geometry) return; for (const attribute of ['position', 'normal', 'uv']) assert.ok(Array.from(mesh.geometry.getAttribute(attribute).array).every(Number.isFinite)); });
      assert.ok(view.workTargets.some(mesh => mesh.userData.pick.kind === 'bench-depth'));
      for (const id of Object.keys(BENCH_TOOLS)) assert.ok(view.workTargets.some(mesh => mesh.userData.pick.tool === id));
      return root;
    };
    const first = build(), materials = [...view.materials.values()], textures = [...models.textures.values()]; let disposed = 0;
    for (const material of materials) material.addEventListener('dispose', () => disposed++);
    for (const texture of textures) { assert.equal(texture.colorSpace, NoColorSpace); assert.equal(texture.anisotropy, 8); }
    view.dispose(first); const second = build(); view.dispose(second);
    assert.equal(disposed, 0); assert.deepEqual([...view.materials.values()], materials); assert.deepEqual([...models.textures.values()], textures);
  } finally { if (before === undefined) delete globalThis.document; else globalThis.document = before; }
});
