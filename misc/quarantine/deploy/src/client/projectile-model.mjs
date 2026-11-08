import * as T from 'three';
import { surface } from './model-details.mjs';

export function projectileModel(view, enemy = false) {
  const group = new T.Group(); group.name = 'projectile';
  // The server position is the tip. Everything else trails behind along local -Y.
  const profile = [[0, -.30], [.042, -.30], [.047, -.281], [.047, -.123], [.040, -.081], [.023, -.033], [0, 0]].map(p => new T.Vector2(...p));
  const body = new T.Mesh(new T.LatheGeometry(profile, 20), surface(view, 'bullet-jacket', '#bd8753', .68, .37, 'steel')); body.name = 'bullet'; group.add(body);
  const band = new T.Mesh(new T.CylinderGeometry(.048, .048, .014, 20), surface(view, 'bullet-groove', '#785936', .55, .5, 'steel')); band.position.y = -.244; group.add(band);
  const key = `tracer/${enemy ? 'hostile' : 'friendly'}`;
  if (!view.materials[key]) {
    const pixels = new Uint8Array(64 * 4);
    for (let i = 0; i < 64; i++) pixels.set([255, 255, 255, Math.round((i / 63) ** 2 * 180)], i * 4);
    const map = new T.DataTexture(pixels, 1, 64); map.magFilter = T.LinearFilter; map.minFilter = T.LinearFilter; map.needsUpdate = true;
    view.materials[key] = new T.MeshBasicMaterial({ color: enemy ? '#f89861' : '#ffe6ad', map, transparent: true, opacity: .65, depthWrite: false, blending: T.AdditiveBlending });
  }
  const trail = new T.Mesh(new T.CylinderGeometry(.025, .001, .72, 8, 1, true), view.materials[key]); trail.name = 'tracer'; trail.position.y = -.66; group.add(trail);
  return group;
}
