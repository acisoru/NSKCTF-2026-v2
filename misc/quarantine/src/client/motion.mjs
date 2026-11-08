const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const angle = (a, b, amount) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * amount;
const copyPose = pose => ({ ...pose });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Play server poses slightly behind the newest snapshot so each rendered frame
// lies between known positions. Chasing the latest packet with lerp pulses at
// the network update rate, even on a connection with no jitter.
export class MotionBuffer {
  constructor({ delay = .15 } = {}) { this.delay = delay; this.clear(); }
  clear() { this.tracks = new Map(); this.time = null; this.latest = null; this.received = 0; }
  update(time, objects, now = performance.now()) {
    if (!Number.isFinite(time)) time = 0;
    // A restarted server or a long interruption must not replay stale movement.
    if (this.latest !== null && (time < this.latest || time - this.latest > .5 || now - this.received > 1000)) this.clear();
    if (this.time === null) this.time = time - this.delay;
    this.latest = time; this.received = now;
    const ids = new Set();
    for (const object of objects) {
      ids.add(object.id);
      const pose = { time, x: object.x, y: object.kind === 'bomber' ? object.altitude ?? 0 : object.y ?? 0, z: object.z, yaw: object.yaw ?? 0, pitch: object.pitch ?? 0 };
      let track = this.tracks.get(object.id) ?? [];
      const previous = track.at(-1);
      // Respawns and admin teleports are discontinuities, including vertical ones.
      if (previous && Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z) > 20) track = [];
      if (track.at(-1)?.time === time) track[track.length - 1] = pose;
      else track.push(pose);
      if (track.length > 8) track.shift();
      this.tracks.set(object.id, track);
    }
    for (const id of this.tracks.keys()) if (!ids.has(id)) this.tracks.delete(id);
  }
  advance(dt, now = performance.now()) {
    if (this.time === null) return;
    const elapsed = Math.max(0, (now - this.received) / 1000);
    const target = this.latest + elapsed - this.delay;
    // Correct clock drift gradually rather than jumping on a late packet.
    const rate = clamp(1 + (target - (this.time + dt)) * 2, .9, 1.1);
    this.time = Math.min(this.latest, this.time + Math.max(0, dt) * rate);
  }
  sample(id) {
    const track = this.tracks.get(id);
    if (!track?.length) return null;
    let before = track[0];
    if (this.time <= before.time) return before;
    for (let i = 1; i < track.length; i++) {
      const after = track[i];
      if (this.time <= after.time) {
        const amount = (this.time - before.time) / (after.time - before.time);
        return { x: mix(before.x, after.x, amount), y: mix(before.y, after.y, amount), z: mix(before.z, after.z, amount), yaw: angle(before.yaw, after.yaw, amount), pitch: mix(before.pitch, after.pitch, amount) };
      }
      before = after;
    }
    // Never extrapolate actors through walls or keep moving after a disconnect.
    return before;
  }
}

// Keep the local avatar responsive while the server remains authoritative.
// The predicted position is presentation-only: every server snapshot becomes
// the reconciliation target and large discontinuities still snap immediately.
export class LocalPrediction {
  constructor({ correctionRate = 14, deadZone = .035, snapDistance = 3 } = {}) {
    this.correctionRate = correctionRate; this.deadZone = deadZone; this.snapDistance = snapDistance; this.clear();
  }
  clear() { this.pose = null; this.server = null; this.transition = null; this.serverTime = null; }
  reset(pose) { this.pose = copyPose(pose); this.server = copyPose(pose); this.transition = pose.transition ?? null; this.serverTime = Number.isFinite(pose.time) ? pose.time : null; }
  update(pose) {
    if (!pose) return;
    const transition = pose.transition ?? null;
    if (!this.pose || this.pose.id !== pose.id || this.transition !== transition || distance(this.pose, pose) > this.snapDistance || Number.isFinite(pose.time) && Number.isFinite(this.serverTime) && (pose.time < this.serverTime || pose.time - this.serverTime > .5)) { this.reset({ ...pose, transition }); return; }
    this.server = copyPose({ ...pose, transition }); this.serverTime = Number.isFinite(pose.time) ? pose.time : this.serverTime;
  }
  advance(dt, input = {}, integrate = null) {
    if (!this.pose || !this.server) return null;
    const seconds = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    if (typeof integrate === 'function') integrate(this.pose, seconds, input);
    else {
      this.pose.x += (input.x ?? 0) * (input.speed ?? 0) * seconds;
      this.pose.z += (input.z ?? 0) * (input.speed ?? 0) * seconds;
    }
    const error = distance(this.pose, this.server);
    if (error > this.snapDistance) this.reset(this.server);
    else if (error > this.deadZone) {
      const amount = 1 - Math.exp(-this.correctionRate * seconds);
      this.pose.x = mix(this.pose.x, this.server.x, amount); this.pose.z = mix(this.pose.z, this.server.z, amount);
    }
    if (Number.isFinite(this.server.y) && !input.climbing) {
      const amount = 1 - Math.exp(-this.correctionRate * seconds);
      this.pose.y = error > this.snapDistance ? this.server.y : mix(this.pose.y, this.server.y, amount);
    }
    for (const key of ['yaw', 'pitch']) if (Number.isFinite(this.server[key])) this.pose[key] = this.server[key];
    return this.pose;
  }
  sample() { return this.pose ? copyPose(this.pose) : null; }
}
