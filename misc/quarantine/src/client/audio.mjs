export function scheduleExplosion(ctx, output, { gain = .3, pan = 0 } = {}) {
  const now = ctx.currentTime, duration = 1.15;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), envelope = ctx.createGain(), stereo = ctx.createStereoPanner();
  noise.buffer = buffer; filter.type = 'lowpass'; filter.Q.value = .8;
  filter.frequency.setValueAtTime(3500, now); filter.frequency.exponentialRampToValueAtTime(130, now + duration);
  envelope.gain.setValueAtTime(.001, now); envelope.gain.linearRampToValueAtTime(gain, now + .009); envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
  stereo.pan.value = pan; noise.connect(filter).connect(envelope).connect(stereo).connect(output);
  const thump = ctx.createOscillator(), bass = ctx.createGain(); thump.type = 'sine';
  thump.frequency.setValueAtTime(105, now); thump.frequency.exponentialRampToValueAtTime(27, now + .5);
  bass.gain.setValueAtTime(gain * .7, now); bass.gain.exponentialRampToValueAtTime(.001, now + .7);
  thump.connect(bass).connect(stereo); thump.start(now); thump.stop(now + .72);
  thump.onended = () => { thump.disconnect(); bass.disconnect(); };
  noise.onended = () => { noise.disconnect(); filter.disconnect(); envelope.disconnect(); stereo.disconnect(); };
  noise.start(now); noise.stop(now + duration);
}

export function scheduleGunshot(ctx, output, { gain = .24, pan = 0, enemy = false, weapon = 'rifle' } = {}) {
  const now = ctx.currentTime, duration = enemy ? .19 : weapon === 'sniper' ? .46 : weapon === 'shotgun' ? .36 : weapon === 'pistol' ? .18 : .24;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(), high = ctx.createBiquadFilter(), low = ctx.createBiquadFilter(), gainNode = ctx.createGain(), stereo = ctx.createStereoPanner();
  noise.buffer = buffer; high.type = 'highpass'; high.frequency.value = enemy ? 420 : 180;
  low.type = 'lowpass'; low.frequency.setValueAtTime(enemy ? 4700 : 7200, now); low.frequency.exponentialRampToValueAtTime(650, now + duration);
  gainNode.gain.setValueAtTime(.001, now); gainNode.gain.linearRampToValueAtTime(gain, now + .002);
  gainNode.gain.exponentialRampToValueAtTime(gain * .19, now + .035); gainNode.gain.exponentialRampToValueAtTime(.001, now + duration);
  stereo.pan.value = pan; noise.connect(high).connect(low).connect(gainNode).connect(stereo).connect(output);
  const body = ctx.createOscillator(), bodyGain = ctx.createGain(); body.type = enemy ? 'triangle' : 'sine';
  body.frequency.setValueAtTime(enemy ? 260 : weapon === 'shotgun' ? 95 : weapon === 'sniper' ? 110 : 155, now); body.frequency.exponentialRampToValueAtTime(enemy ? 95 : 48, now + .09);
  bodyGain.gain.setValueAtTime(gain * .65, now); bodyGain.gain.exponentialRampToValueAtTime(.001, now + .12);
  body.connect(bodyGain).connect(stereo); body.start(now); body.stop(now + .125);
  body.onended = () => { body.disconnect(); bodyGain.disconnect(); };
  noise.onended = () => { noise.disconnect(); high.disconnect(); low.disconnect(); gainNode.disconnect(); stereo.disconnect(); };
  noise.start(now); noise.stop(now + duration);
}

const SOUNDS = new Set(['bomber-lock', 'bomber-blast', 'gunshot']);
export class GameAudio {
  constructor({ muted = false } = {}) { this.muted = muted; this.context = null; this.master = null; this.seen = new Set(); this.lastTime = -1; this.lastBeep = 0; }
  unlock() {
    if (this.muted) return;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    if (!this.context) {
      this.context = new Context(); this.master = this.context.createGain(); this.master.gain.value = .7;
      const compressor = this.context.createDynamicsCompressor(); compressor.threshold.value = -12; compressor.ratio.value = 5;
      this.master.connect(compressor).connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  setMuted(muted) {
    this.muted = muted;
    if (!muted) this.unlock();
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : .7, this.context.currentTime, .02);
  }
  tone(frequency, duration, gain, pan = 0, delay = 0, endFrequency = frequency) {
    if (this.muted || this.context?.state !== 'running') return;
    const ctx = this.context, now = ctx.currentTime + delay, oscillator = ctx.createOscillator(), envelope = ctx.createGain(), stereo = ctx.createStereoPanner();
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(frequency, now); oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    envelope.gain.setValueAtTime(.001, now); envelope.gain.linearRampToValueAtTime(gain, now + .008); envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
    stereo.pan.value = pan; oscillator.connect(envelope).connect(stereo).connect(this.master);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); stereo.disconnect(); };
    oscillator.start(now); oscillator.stop(now + duration + .01);
  }
  beep(frequency = 360) {
    if (performance.now() - this.lastBeep < 100) return;
    this.lastBeep = performance.now(); this.tone(frequency, .09, .025);
  }
  update(state) {
    if (state.time < this.lastTime) this.seen.clear();
    this.lastTime = state.time;
    let gunshots = 0;
    const priority = e => e.actor === state.self.id ? -1000 : e.kind === 'bomber-blast' ? -500 : Math.hypot(e.x - state.self.x, e.z - state.self.z);
    for (const e of [...state.effects].sort((a, b) => priority(a) - priority(b))) {
      if (!SOUNDS.has(e.kind) || this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      if (e.kind === 'gunshot' && gunshots++ >= 6) continue;
      // Mark muted/out-of-range events seen too, so unmuting never replays an old blast.
      if (this.muted || this.context?.state !== 'running') continue;
      const dx = e.x - state.self.x, dz = e.z - state.self.z, distance = Math.hypot(dx, dz);
      const range = e.kind === 'bomber-blast' ? 65 : e.kind === 'gunshot' ? 55 : 35;
      if (distance >= range) continue;
      const gain = (1 - distance / range) ** 2;
      const pan = Math.max(-.85, Math.min(.85, (dx * Math.cos(state.self.yaw) + dz * Math.sin(state.self.yaw)) / Math.max(1, distance)));
      if (e.kind === 'bomber-blast') scheduleExplosion(this.context, this.master, { gain: .38 * gain, pan });
      else if (e.kind === 'gunshot') scheduleGunshot(this.context, this.master, { gain: (e.enemy ? .19 : .29) * gain, pan, enemy: e.enemy, weapon: e.weapon });
      else for (let i = 0; i < 3; i++) this.tone(680 + i * 150, .12, .07 * gain, pan, i * .19, 1100 + i * 200);
    }
    if (this.seen.size > 1024) this.seen = new Set(state.effects.filter(e => SOUNDS.has(e.kind)).map(e => e.id));
  }
}
