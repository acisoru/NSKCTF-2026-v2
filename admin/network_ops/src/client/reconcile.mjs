const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// A small authoritative correction should be invisible to the player. Large
// discontinuities are still applied immediately so a rejected move, respawn or
// server-side teleport cannot leave the local body in an invalid place.
export class PositionReconciler {
  constructor({ response = 14, deadZone = .025, snapDistance = 3 } = {}) {
    this.response = response; this.deadZone = deadZone; this.snapDistance = snapDistance; this.target = null;
  }
  clear() { this.target = null; }
  setTarget(current, target) {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return { snap: false, changed: false };
    const error = distance(current, target);
    if (error > this.snapDistance) { this.clear(); return { snap: true, changed: true, x: target.x, z: target.z }; }
    if (error <= this.deadZone) { this.clear(); return { snap: false, changed: false }; }
    this.target = { x: target.x, z: target.z }; return { snap: false, changed: true };
  }
  step(current, dt) {
    if (!this.target) return null;
    const amount = 1 - Math.exp(-this.response * Math.max(0, Math.min(.1, dt)));
    const next = { x: current.x + (this.target.x - current.x) * amount, z: current.z + (this.target.z - current.z) * amount };
    if (distance(next, this.target) <= this.deadZone) { next.x = this.target.x; next.z = this.target.z; this.clear(); }
    return next;
  }
}
