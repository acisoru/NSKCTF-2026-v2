import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_DEFAULTS, LabAudio, audioPreferences, resultSound, spatialSound, holdAudioParam } from '../client/audio.mjs';
import { BENCH_SLOTS, WORLD_SLOTS, toolShortcut } from '../client/tool-shortcuts.mjs';

test('audio preferences are bounded, tolerate unavailable storage and never start audio before input', () => {
  assert.deepEqual(audioPreferences(null), AUDIO_DEFAULTS);
  assert.deepEqual(audioPreferences({ music: -1, effects: 200, muted: 'yes', admin: true }), { music: 0, effects: 1, muted: false });
  assert.equal(audioPreferences({ music: NaN }).music, AUDIO_DEFAULTS.music);
  let created = 0;
  const audio = new LabAudio({ storage: { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } }, contextFactory: () => { created++; } });
  audio.setScene({ active: true }); audio.configure({ music: .2 }); assert.equal(created, 0); assert.equal(audio.preferences.music, .2); audio.dispose();
});
test('saved volume and mute preferences survive a new mixer', () => {
  let saved = null; const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  const first = new LabAudio({ storage }); first.configure({ music: .12, effects: .8, muted: true });
  const second = new LabAudio({ storage }); assert.deepEqual(second.preferences, { music: .12, effects: .8, muted: true });
});
test('audio gain ramps use the native hold method where available and a Firefox-compatible fallback', () => {
  const calls = [], native = { cancelAndHoldAtTime(at) { calls.push(['hold', at]); } };
  holdAudioParam(native, 2); assert.deepEqual(calls, [['hold', 2]]);
  const fallback = { value: .38, cancelScheduledValues(at) { calls.push(['cancel', at]); this.value = .9; }, setValueAtTime(value, at) { calls.push(['set', value, at]); } };
  holdAudioParam(fallback, 3); assert.deepEqual(calls.slice(1), [['cancel', 3], ['set', .38, 3]]);
});
test('audio failure cannot interrupt scene transitions or prevent saved volume updates', () => {
  const audio = new LabAudio({ storage: null }); audio.failed = true;
  audio.ctx = { currentTime: 0, close: async () => {} }; audio.master = { gain: { get value() { throw new Error('audio device failure'); } } };
  assert.doesNotThrow(() => audio.setScene({ active: true, focus: true })); assert.equal(audio.ctx, null);
  assert.doesNotThrow(() => audio.configure({ music: .8, effects: .4 }));
  assert.equal(audio.preferences.music, .8); assert.equal(audio.preferences.effects, .4);
  assert.doesNotThrow(() => audio.setScene({ active: false })); audio.dispose();
});
test('spatial effects attenuate with distance and follow the camera right axis', () => {
  const at = { x: 0, z: 0 };
  assert.equal(spatialSound({ x: 4, z: 0 }, at, 0).pan, 1);
  assert.equal(spatialSound({ x: -4, z: 0 }, at, 0).pan, -1);
  assert.equal(spatialSound({ x: 0, z: 4 }, at, Math.PI / 2).pan, 1);
  assert.ok(spatialSound({ x: 20, z: 0 }, at, 0).volume < spatialSound({ x: 2, z: 0 }, at, 0).volume);
  assert.deepEqual(spatialSound(at, at, 0), { pan: 0, volume: 1 });
});
test('instrument sounds reflect only the visible server result, not hidden defects', () => {
  assert.equal(resultSound('test', { continuity: false }), 'error');
  assert.equal(resultSound('tool', { good: false, map: [] }), 'error');
  assert.equal(resultSound('panel-test', { message: 'PP-01 / SPLIT PAIR' }), 'error');
  assert.equal(resultSound('tool', { map: [1, 2, 3], continuity: true }), 'test');
  assert.equal(resultSound('stripper', null), 'strip'); assert.equal(resultSound('crimper', null), 'crimp');
  assert.equal(resultSound('plug', null), 'plug');
});
test('five physical tool keys and numpad slots work in world and bench contexts', () => {
  for (let i = 1; i <= 5; i++) for (const prefix of ['Digit', 'Numpad']) {
    assert.equal(toolShortcut({ code: `${prefix}${i}`, key: 'unrelated' }, { mode: 'world' }), WORLD_SLOTS[i - 1]);
    assert.equal(toolShortcut({ code: `${prefix}${i}` }, { mode: 'bench' }), BENCH_SLOTS[i - 1]);
  }
  assert.equal(toolShortcut({ code: 'Digit6' }, { mode: 'world' }), null);
});
test('tool shortcuts ignore modifiers, repeats, text, overlays and active drags', () => {
  for (const name of ['repeat', 'ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'isComposing']) assert.equal(toolShortcut({ code: 'Digit2', [name]: true }, {}), null);
  for (const state of [{ blocked: true }, { dragging: true }, { target: { isContentEditable: true } }, ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ target: { tagName } }))]) assert.equal(toolShortcut({ code: 'Digit2' }, state), null);
});
