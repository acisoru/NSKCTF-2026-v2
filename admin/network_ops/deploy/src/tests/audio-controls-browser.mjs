import { chromium, firefox } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';
import { benchDriver, wait } from './bench-driver.mjs';
import { incident } from '../server/incidents.mjs';
import { cableResult } from '../shared/catalog.mjs';

const engine = process.env.BROWSER === 'firefox' ? 'firefox' : 'chromium';
const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser, page;
try {
  browser = await (engine === 'firefox' ? firefox.launch({ headless: true }) : chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] }));
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(forceFallback => {
    if (forceFallback) Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', { configurable: true, value: undefined });
    const Original = window.AudioContext; window.qaAudio = [];
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args); window.qaAudio.push(this); this.qaGains = [];
        const gain = this.createGain.bind(this); this.createGain = () => { const node = gain(); this.qaGains.push(node); return node; };
        const compressor = this.createDynamicsCompressor.bind(this); this.createDynamicsCompressor = () => { const node = compressor(); this.qaMeter = this.createAnalyser(); node.connect(this.qaMeter); return node; };
      }
    };
  }, process.env.AUDIO_FALLBACK === '1');
  await browserLogin(page.context(), base); await page.goto(base);
  await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка' && document.getElementById('pause-screen').classList.contains('hidden'));
  await page.locator('#audio-settings').click(); await page.locator('#audio-dialog').waitFor({ state: 'visible' });
  const drag = async (id, target) => {
    const input = page.locator(`#volume-${id}`), box = await input.boundingBox(), before = Number(await input.inputValue());
    const x = value => box.x + 9 + (box.width - 18) * value / 100, y = box.y + box.height / 2;
    await page.mouse.move(x(before), y); await page.mouse.down(); await page.mouse.move(x(target), y, { steps: 14 });
    const value = Number(await input.inputValue()); assert.ok(Math.abs(value - target) < 5, `${id}: thumb must follow the mouse`);
    assert.equal(await page.locator(`#output-${id}`).textContent(), `${value}%`, `${id}: percentage must update before mouse release`);
    await page.mouse.up();
    await page.waitForFunction(({ index, expected }) => Math.abs(window.qaAudio[0].qaGains[index].gain.value - expected) < .01, { index: id === 'music' ? 1 : 2, expected: value / 100 * (id === 'music' ? .48 : 1) }, { timeout: 5000 });
    const gains = await page.evaluate(() => window.qaAudio[0].qaGains.slice(0, 4).map(n => n.gain.value));
    assert.ok(Math.abs(gains[id === 'music' ? 1 : 2] - value / 100 * (id === 'music' ? .48 : 1)) < .01, `${id}: actual gain must match slider (${gains.join(', ')})`);
    return value;
  };
  const music = await drag('music', 80), effects = await drag('effects', 44);
  await page.waitForFunction(() => { const ctx = window.qaAudio[0]; if (!ctx?.qaMeter) return false; const samples = new Float32Array(ctx.qaMeter.fftSize); ctx.qaMeter.getFloatTimeDomainData(samples); return samples.some(v => Math.abs(v) > .001); }, null, { timeout: 8000 });
  // Effects are idle during these samples: only the scheduled background score is audible.
  const energy = async () => page.evaluate(async () => { const ctx = window.qaAudio[0], values = new Float32Array(ctx.qaMeter.fftSize); let sum = 0; for (let i = 0; i < 20; i++) { ctx.qaMeter.getFloatTimeDomainData(values); sum += values.reduce((n, v) => n + v * v, 0) / values.length; await new Promise(resolve => setTimeout(resolve, 50)); } return Math.sqrt(sum / 20); });
  await page.waitForTimeout(700); const audible = await energy(); assert.ok(audible > .001, 'Scheduled music must produce audible-level output');
  await page.locator('#volume-music').press('Home'); await page.waitForTimeout(600); const silent = await energy(); assert.ok(silent < .00001, 'Music slider zero must silence the score');
  assert.equal(await page.locator('#output-music').textContent(), '0%');
  await drag('music', music); await page.locator('#volume-effects').press('ArrowRight');
  const expectedEffects = Number(await page.locator('#volume-effects').inputValue()); assert.equal(expectedEffects, effects + 1); assert.equal(await page.locator('#output-effects').textContent(), `${expectedEffects}%`);
  await page.locator('#audio-muted').check(); await page.waitForFunction(() => window.qaAudio[0].state === 'suspended');
  await page.screenshot({ path: `${output}audio-controls-${engine}.png` });
  await page.reload(); await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка');
  await page.locator('#audio-settings').click(); assert.equal(await page.locator('#audio-muted').isChecked(), true);
  assert.equal(Number(await page.locator('#volume-music').inputValue()), music); assert.equal(Number(await page.locator('#volume-effects').inputValue()), expectedEffects);
  await page.locator('#audio-muted').uncheck(); await page.waitForFunction(() => window.qaAudio[0]?.state === 'running');
  await page.locator('[data-close="audio-dialog"]').click();
  const profile = [...app.profiles.values()][0], lab = profile.labs.easy, runtime = [...app.runtimes.values()][0];
  const pixels = () => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 50; const ctx = c.getContext('2d'); ctx.drawImage(document.getElementById('scene'), 0, 0, 80, 50); return Array.from(ctx.getImageData(0, 0, 80, 50).data); });
  const world = await pixels(); await page.locator('#inspect-bench').click(); await page.waitForFunction(() => document.body.classList.contains('bench-mode')); await page.waitForTimeout(1000);
  const benchPixels = await pixels(); assert.ok(world.reduce((n, value, i) => n + Math.abs(value - benchPixels[i]), 0) / world.length > 8, 'The render loop must keep moving the camera after the audio focus transition');
  await benchDriver(page).craft(lab); assert.equal(cableResult(lab.draft).good, true);
  await page.screenshot({ path: `${output}audio-bench-${engine}.png` });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.body.classList.contains('bench-mode'));
  const x = incident(lab).pose.x; await page.keyboard.down('KeyD'); await page.waitForTimeout(450); await page.keyboard.up('KeyD'); await wait(() => incident(lab).pose.x > x + .5);
  // An unrelated future audio-driver failure must not kill requestAnimationFrame or controls.
  await page.evaluate(() => { Object.defineProperty(AudioParam.prototype, 'cancelAndHoldAtTime', { configurable: true, value() { throw new Error('Injected audio device failure'); } }); });
  await page.locator('#inspect-bench').click(); await page.waitForFunction(() => document.body.classList.contains('bench-mode')); await page.waitForTimeout(1000);
  await page.keyboard.press('Digit3'); await wait(() => runtime.context.tool === 'stripper');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.body.classList.contains('bench-mode'));
  const recoverX = incident(lab).pose.x; await page.keyboard.down('KeyA'); await page.waitForTimeout(450); await page.keyboard.up('KeyA'); await wait(() => incident(lab).pose.x < recoverX - .5);
  assert.equal(profile.security?.signals?.length ?? 0, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, engine, version: browser.version(), audibleRms: audible, silentRms: silent, checks: ['real mouse drags update percentages before release', 'actual independent gains', 'scheduled music signal', 'zero music is silent', 'keyboard controls', 'mute persists and resumes after reload', 'full handmade cable with music active', 'bench exit restores movement without a reset', 'audio failure cannot freeze rendering or controls', 'no JavaScript errors or cheat points'] }));
} catch (error) { if (page && !page.isClosed()) { console.error(await page.evaluate(() => ({ userAgent: navigator.userAgent, holdSupported: typeof AudioParam.prototype.cancelAndHoldAtTime, music: document.getElementById('volume-music')?.value, displayed: document.getElementById('output-music')?.textContent, audio: window.qaAudio?.map(c => ({ state: c.state, at: c.currentTime, gains: c.qaGains.slice(0, 4).map(g => g.gain.value) })) }))); await page.screenshot({ path: `${output}audio-controls-${engine}-failure.png` }); } throw error; }
finally { await browser?.close(); await app.close(); }
