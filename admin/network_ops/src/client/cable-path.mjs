import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three';

// Rounded corners stay inside the control polygon, unlike an interpolating spline.
export function cablePath(points, bend = .18) {
  const nodes = points.map(p => new Vector3(...p)).filter((p, i, all) => !i || p.distanceToSquared(all[i - 1]) > 1e-10);
  const path = new CurvePath(); let cursor = nodes[0];
  for (let i = 1; i < nodes.length - 1; i++) {
    const corner = nodes[i], previous = nodes[i - 1], next = nodes[i + 1];
    const distance = Math.min(bend, corner.distanceTo(previous) * .3, corner.distanceTo(next) * .3);
    const entry = corner.clone().lerp(previous, distance / corner.distanceTo(previous));
    const exit = corner.clone().lerp(next, distance / corner.distanceTo(next));
    path.add(new LineCurve3(cursor, entry)); path.add(new QuadraticBezierCurve3(entry, corner, exit)); cursor = exit;
  }
  path.add(new LineCurve3(cursor, nodes.at(-1))); return path;
}
