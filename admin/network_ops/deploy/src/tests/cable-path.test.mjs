import test from 'node:test';
import assert from 'node:assert/strict';
import { TubeGeometry, Vector3 } from 'three';
import { cablePath } from '../client/cable-path.mjs';
import { mission, portPosition, TRAYS } from '../shared/catalog.mjs';

test('installed cable surfaces stay above the floor on all endpoint pairs and tray routes', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const spec = mission(level), endpoints = [...spec.devices, ...spec.passive].flatMap(d => d.ports.map(p => portPosition(spec, `${d.id}:${p}`)));
    for (const [i, a] of endpoints.entries()) for (const b of endpoints.slice(i + 1)) {
      for (const route of [[], TRAYS]) {
        const points = [[a.x, a.y, a.z], ...(route.length ? route.map(t => [t.x, t.y, t.z]) : [[a.x, .12, a.z + .5], [b.x, .12, b.z + .5]]), [b.x, b.y, b.z]], path = cablePath(points);
        assert.ok(path.getPoint(0).distanceTo(new Vector3(...points[0])) < 1e-8);
        assert.ok(path.getPoint(1).distanceTo(new Vector3(...points.at(-1))) < 1e-8);
        const geometry = new TubeGeometry(path, 80, .028, 8, false), vertices = geometry.attributes.position;
        for (let j = 0; j < vertices.count; j++) assert.ok(Number.isFinite(vertices.getY(j)) && vertices.getY(j) >= .091, `${level} vertex ${j} dipped below floor clearance`);
        geometry.dispose();
      }
    }
  }
});
