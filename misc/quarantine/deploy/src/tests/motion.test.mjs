import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalPrediction, MotionBuffer } from '../client/motion.mjs';

const actor = (x, extra = {}) => ({ id: 'actor', kind: 'player', x, y: 0, z: 0, yaw: 0, pitch: 0, ...extra });

test('10 Hz motion stays smooth at different render rates with 0–50 ms packet jitter', () => {
  const jitter = [.04, 0, .025, .01, .05, .015, 0, .03];
  for (const fps of [30, 60, 144]) {
    const motion = new MotionBuffer(), speeds = [];
    let packet = 0, previous;
    for (let frame = 0; frame < fps * 6; frame++) {
      const now = frame / fps;
      while (packet * .1 + jitter[packet % jitter.length] <= now + 1e-9) {
        const time = packet++ * .1;
        motion.update(time, [actor(time * 6)], now * 1000);
      }
      motion.advance(1 / fps, now * 1000);
      const x = motion.sample('actor')?.x;
      if (now > 1) speeds.push((x - previous) * fps);
      previous = x;
    }
    const mean = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
    const variation = Math.sqrt(speeds.reduce((sum, speed) => sum + (speed - mean) ** 2, 0) / speeds.length) / mean;
    assert.ok(Math.abs(mean - 6) < .05, `${fps} FPS: average speed ${mean}`);
    assert.ok(variation < .06, `${fps} FPS: variation ${variation}`);
    assert.ok(Math.min(...speeds) > 5, `${fps} FPS: movement stalled between packets`);
  }
});

test('packet loss holds the last known pose without extrapolating or running backwards', () => {
  const motion = new MotionBuffer();
  motion.update(0, [actor(0)], 0);
  motion.update(.1, [actor(.6)], 100);
  let previous = 0;
  for (let frame = 1; frame <= 120; frame++) {
    motion.advance(1 / 60, 100 + frame / 60 * 1000);
    const x = motion.sample('actor').x;
    assert.ok(x >= previous && x <= .6); previous = x;
  }
  assert.equal(previous, .6);
  motion.update(2.2, [actor(13.2)], 2200);
  assert.equal(motion.sample('actor').x, 13.2);
  motion.update(0, [actor(3)], 2300);
  assert.equal(motion.sample('actor').x, 3, 'server restart discards the old timeline');
});

test('turns take the short route across the angle boundary and bomber altitude is interpolated', () => {
  const motion = new MotionBuffer({ delay: .1 });
  motion.update(0, [actor(0, { kind: 'bomber', altitude: 2, yaw: Math.PI - .1, pitch: -.2 })], 0);
  motion.update(.1, [actor(1, { kind: 'bomber', altitude: 4, yaw: -Math.PI + .1, pitch: .2 })], 100);
  motion.advance(.15, 150);
  const pose = motion.sample('actor');
  for (const [key, expected] of Object.entries({ x: .5, y: 3, yaw: Math.PI, pitch: 0 })) assert.ok(Math.abs(pose[key] - expected) < 1e-9, key);
});

test('teleports snap in all axes; removing and reusing an ID cannot replay its old movement', () => {
  const motion = new MotionBuffer();
  motion.update(0, [actor(0)], 0);
  motion.update(.1, [actor(1)], 100);
  motion.update(.2, [actor(100, { y: 4 })], 200);
  assert.equal(motion.sample('actor').x, 100);
  motion.update(.3, [actor(100, { y: 60 })], 300);
  assert.equal(motion.sample('actor').y, 60);
  motion.update(.4, [], 400);
  assert.equal(motion.sample('actor'), null);
  motion.update(.5, [actor(10)], 500);
  assert.equal(motion.sample('actor').x, 10);
  motion.clear();
  assert.equal(motion.sample('actor'), null);
});

test('same-tick updates replace the pose and snapshot objects are not retained by reference', () => {
  const motion = new MotionBuffer(), pose = actor(1);
  motion.update(0, [pose], 0);
  pose.x = 2;
  assert.equal(motion.sample('actor').x, 1);
  motion.update(0, [pose], 10);
  motion.advance(1 / 60, 20);
  assert.equal(motion.sample('actor').x, 2);
});

test('local movement is immediate and small server drift is reconciled without a snap', () => {
  const prediction = new LocalPrediction(), pose = { id: 'self', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, transition: 'normal' };
  prediction.update(pose);
  prediction.advance(1 / 60, { x: 1, z: 0, speed: 6 }, (current, dt) => { current.x += 6 * dt; });
  assert.ok(prediction.sample().x > 0, 'local input should move before the next packet');
  prediction.update({ ...pose, x: .5 });
  const before = prediction.sample().x; prediction.advance(1 / 60, {}, null); const after = prediction.sample().x;
  assert.ok(after > before && after < .5, 'a small correction should be blended');
});

test('local prediction snaps only for a discontinuity or a movement mode transition', () => {
  const prediction = new LocalPrediction(), pose = { id: 'self', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, transition: 'normal' };
  prediction.update(pose); prediction.advance(.1, { x: 1, speed: 6 }, (current, dt) => { current.x += 6 * dt; });
  prediction.update({ ...pose, x: 10 }); assert.equal(prediction.sample().x, 10);
  prediction.update({ ...pose, x: 0, transition: 'dead' }); assert.equal(prediction.sample().x, 0);
});

test('local prediction keeps ladder movement responsive between snapshots', () => {
  const prediction = new LocalPrediction(), pose = { id: 'self', x: 1, y: 0, z: 2, yaw: 0, pitch: 0, transition: 'ladder-1' };
  prediction.update(pose);
  prediction.advance(.1, { climb: 1, climbing: true }, (current, dt, input) => { current.y += input.climb * 3 * dt; });
  assert.ok(Math.abs(prediction.sample().y - .3) < 1e-9);
});
