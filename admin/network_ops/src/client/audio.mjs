export const AUDIO_STORAGE_KEY = 'labx-network-audio-v1';
export const AUDIO_DEFAULTS = Object.freeze({ music: .32, effects: .72, muted: false });
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
export function holdAudioParam(param, at) {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
  else {
    // Firefox lacks cancelAndHoldAtTime; capture the current gain before canceling its ramp.
    const value = param.value; param.cancelScheduledValues(at); param.setValueAtTime(value, at);
  }
}
export function audioPreferences(value) {
  return { music: Number.isFinite(value?.music) ? clamp(value.music, 0, 1) : AUDIO_DEFAULTS.music, effects: Number.isFinite(value?.effects) ? clamp(value.effects, 0, 1) : AUDIO_DEFAULTS.effects, muted: value?.muted === true };
}
export function spatialSound(source, listener, yaw) {
  const dx = source.x - listener.x, dz = source.z - listener.z, distance = Math.hypot(dx, dz);
  return { volume: 1 / (1 + (distance / 4) ** 2), pan: distance ? clamp((dx * Math.cos(yaw) + dz * Math.sin(yaw)) / distance, -1, 1) : 0 };
}
export function resultSound(kind, result) {
  if (result?.good === false || result?.continuity === false || /SPLIT PAIR|OPEN|FAIL/.test(result?.message ?? '')) return 'error';
  if (kind.includes('test') || result?.map) return 'test';
  return ({ cut: 'cut', trim: 'cut', recut: 'cut', strip: 'strip', stripper: 'strip', crimp: 'crimp', crimper: 'crimp', wire: 'wire', punch: 'crimp', connector: 'plug', plug: 'plug', unplug: 'unplug', power: 'power', finish: 'success', tone: 'tone', console: 'plug' })[kind] ?? 'tap';
}

export class LabAudio {
  constructor({ storage, contextFactory = () => new AudioContext(), autoSchedule = true } = {}) {
    this.contextFactory = contextFactory; this.autoSchedule = autoSchedule; this.voices = new Set(); this.last = new Map();
    this.active = false; this.hidden = false; this.focus = false; this.bar = 0;
    try { this.storage = storage === undefined ? globalThis.localStorage : storage; this.preferences = audioPreferences(JSON.parse(this.storage?.getItem(AUDIO_STORAGE_KEY) ?? 'null')); }
    catch { this.preferences = audioPreferences(null); }
  }
  ensure() {
    if (this.ctx) return;
    const ctx = this.ctx = this.contextFactory();
    this.master = ctx.createGain(); this.music = ctx.createGain(); this.effects = ctx.createGain(); this.duck = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor(); compressor.threshold.value = -12; compressor.knee.value = 12; compressor.ratio.value = 5; compressor.attack.value = .003; compressor.release.value = .2;
    this.music.connect(this.duck); this.duck.connect(this.master); this.effects.connect(this.master); this.master.connect(compressor); compressor.connect(ctx.destination);
    this.master.gain.value = this.enabled ? .8 : 0; this.music.gain.value = this.musicVolume; this.effects.gain.value = this.preferences.effects;
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    let seed = 847; const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
  }
  get enabled() { return this.active && !this.hidden && !this.preferences.muted; }
  get musicVolume() { return this.preferences.music * (this.focus ? .48 : 1); }
  safely(operation) {
    try { return operation(); }
    catch (error) {
      this.dispose();
      if (!this.failed) { this.failed = true; console.warn('Audio unavailable; gameplay continues.', error); }
    }
  }
  ramp(param, value, duration = .12) {
    const now = this.ctx.currentTime; holdAudioParam(param, now); param.linearRampToValueAtTime(value, now + duration);
  }
  unlock() {
    if (!this.enabled) return;
    this.safely(() => { this.ensure(); this.ctx.resume?.().catch(() => {}); this.sync(); });
  }
  setScene({ active, hidden = false, focus = false }) {
    if (active === this.active && hidden === this.hidden && focus === this.focus) return;
    Object.assign(this, { active, hidden, focus }); this.sync();
  }
  configure(change) {
    this.preferences = audioPreferences({ ...this.preferences, ...change });
    try { this.storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify(this.preferences)); } catch {}
    this.sync();
  }
  sync() {
    return this.safely(() => {
      if (!this.ctx) return;
      clearTimeout(this.suspendTimer);
      this.ramp(this.master.gain, this.enabled ? .8 : 0);
      this.ramp(this.music.gain, this.musicVolume, .4); this.ramp(this.effects.gain, this.preferences.effects);
      if (this.enabled) {
        this.ctx.resume?.().catch(() => {});
        if (this.autoSchedule && !this.timer) { this.nextBar = this.ctx.currentTime + .08; this.schedule(); if (this.ctx) this.timer = setInterval(() => this.schedule(), 200); }
      } else {
        clearInterval(this.timer); this.timer = null;
        for (const voice of this.voices) { try { voice.source.stop(this.ctx.currentTime + .15); } catch {} }
        this.suspendTimer = setTimeout(() => { if (!this.enabled) this.ctx?.suspend?.().catch(() => {}); }, 180);
      }
    });
  }
  voice({ at, duration, volume, frequency: hz = 440, endFrequency, type = 'sine', noise = false, filter = 1800, highpass = false, pan = 0, attack = .003, bus = this.effects }) {
    if (this.voices.size >= 96 || volume <= 0) return;
    const ctx = this.ctx, source = noise ? ctx.createBufferSource() : ctx.createOscillator(), gain = ctx.createGain(), eq = ctx.createBiquadFilter(), stereo = ctx.createStereoPanner();
    if (noise) { source.buffer = this.noise; source.loop = true; }
    else { source.type = type; source.frequency.setValueAtTime(hz, at); if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, at + duration); }
    eq.type = highpass ? 'highpass' : 'lowpass'; eq.frequency.value = filter; stereo.pan.value = clamp(pan, -1, 1);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(volume, at + attack); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(eq); eq.connect(gain); gain.connect(stereo); stereo.connect(bus);
    const voice = { source, bus }; this.voices.add(voice);
    source.onended = () => { source.disconnect(); eq.disconnect(); gain.disconnect(); stereo.disconnect(); this.voices.delete(voice); };
    source.start(at); source.stop(at + duration + .02);
  }
  // Original 16-bar score: soft minor chords, a sparse bell motif and a muted pulse.
  musicBar(index, at) {
    const beat = 60 / 72, chords = [[50, 57, 60, 64], [46, 53, 57, 60], [48, 55, 58, 62], [45, 52, 57, 60]], chord = chords[Math.floor(index / 2) % chords.length];
    for (const [i, note] of chord.entries()) this.voice({ at, duration: beat * 4.8, attack: .65, volume: .055, frequency: frequency(note), type: 'triangle', filter: 850, pan: (i - 1.5) * .35, bus: this.music });
    this.voice({ at, duration: beat * 3.7, attack: .12, volume: .10, frequency: frequency(chord[0] - 12), filter: 200, bus: this.music });
    const motif = index % 4 === 3 ? [2, 1] : [1, 3, 2];
    for (const [i, degree] of motif.entries()) {
      const t = at + beat * (.5 + i * 1.25), note = chord[degree] + (index % 8 > 3 ? 24 : 12);
      this.voice({ at: t, duration: 1.6, attack: .012, volume: .065, frequency: frequency(note), pan: i % 2 ? .38 : -.38, bus: this.music });
      this.voice({ at: t + beat * .75, duration: 1.7, volume: .019, frequency: frequency(note), pan: i % 2 ? -.6 : .6, bus: this.music });
    }
    for (let i = 0; i < 4; i++) {
      this.voice({ at: at + i * beat, duration: .11, volume: .018, noise: true, filter: 1400, highpass: true, pan: i % 2 ? .5 : -.5, bus: this.music });
      if (i % 2 === 0) this.voice({ at: at + i * beat, duration: .22, volume: .075, frequency: 68, endFrequency: 42, bus: this.music });
    }
  }
  schedule() {
    return this.safely(() => {
      if (!this.enabled || this.ctx?.state !== 'running') return;
      const now = this.ctx.currentTime;
      if (this.nextBar < now) this.nextBar = now + .05;
      if (this.nextBar < now + .35) { this.musicBar(this.bar++ % 16, this.nextBar); this.nextBar += 4 * 60 / 72; }
    });
  }
  play(kind = 'tap', { volume = 1, pan = 0 } = {}) {
    return this.safely(() => {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || !this.preferences.effects) return;
      const now = this.ctx.currentTime, cooldown = ({ spark: .5, rat: 2, error: .4, reload: 2.2, step: .22 })[kind] ?? .06;
      if (now - (this.last.get(kind) ?? -Infinity) < cooldown) return;
      this.last.set(kind, now); this.effect(kind, now + .005, volume, pan);
      if (['shot', 'error', 'success', 'rat'].includes(kind)) {
        const p = this.duck.gain; holdAudioParam(p, now); p.linearRampToValueAtTime(.32, now + .025); p.linearRampToValueAtTime(1, now + 1.2);
      }
    });
  }
  effect(kind, at, volume = 1, pan = 0) {
    const tone = (offset, hz, duration, gain, extra = {}) => this.voice({ at: at + offset, frequency: hz, duration, volume: gain * volume, pan, ...extra });
    const noise = (offset, duration, gain, filter, extra = {}) => tone(offset, 0, duration, gain, { noise: true, filter, ...extra });
    if (kind === 'shot') { noise(0, .42, .8, 2400); tone(0, 125, .32, .5, { endFrequency: 34 }); noise(.065, .65, .13, 1100); noise(.22, .075, .13, 3200); }
    else if (kind === 'reload') { for (const t of [0, .62, 1.22, 1.86]) { noise(t, .075, .14, 2800); tone(t + .02, 260, .045, .06); } }
    else if (kind === 'ready' || kind === 'crimp') { noise(0, .09, .26, 1900); noise(.12, .12, .20, 3100); tone(.01, 190, .08, .12, { endFrequency: 80 }); }
    else if (kind === 'strip') { noise(0, .28, .14, 1500, { highpass: true, attack: .04 }); noise(.23, .06, .20, 3000); }
    else if (kind === 'cut') { noise(0, .055, .35, 3500); tone(0, 350, .07, .09, { endFrequency: 130 }); }
    else if (kind === 'plug' || kind === 'unplug') { noise(0, .04, .17, 2600); tone(.045, kind === 'plug' ? 740 : 470, .065, .08); }
    else if (kind === 'wire' || kind === 'tool' || kind === 'tap' || kind === 'empty') { noise(0, .045, kind === 'tool' ? .13 : .08, 1700); tone(.008, kind === 'wire' ? 880 : 380, .045, .04); }
    else if (kind === 'step') { noise(0, .12, .13, 580); tone(0, 90, .07, .055, { endFrequency: 45 }); }
    else if (kind === 'spark') { for (const t of [0, .045, .12]) noise(t, .04, .17, 2700, { highpass: true }); }
    else if (kind === 'rat') { tone(0, 1700, .12, .08, { endFrequency: 2400 }); tone(.17, 2100, .14, .065, { endFrequency: 1350 }); }
    else if (kind === 'error') { tone(0, 294, .14, .12, { type: 'triangle' }); tone(.18, 220, .20, .1, { type: 'triangle' }); }
    else if (kind === 'success') { for (const [i, hz] of [392, 494, 587, 784].entries()) tone(i * .12, hz, .5, .11); }
    else if (kind === 'test' || kind === 'tone') { tone(0, 880, .12, .1); tone(.17, kind === 'test' ? 1320 : 1000, .2, .09); }
    else if (kind === 'power') { noise(0, .06, .15, 1700); tone(.1, 196, .5, .09, { endFrequency: 392 }); }
  }
  dispose() {
    clearInterval(this.timer); clearTimeout(this.suspendTimer);
    for (const { source } of this.voices) { try { source.stop(); } catch {} }
    this.ctx?.close?.().catch(() => {});
    this.ctx = null; this.timer = null; this.voices.clear(); this.last.clear();
  }
}
