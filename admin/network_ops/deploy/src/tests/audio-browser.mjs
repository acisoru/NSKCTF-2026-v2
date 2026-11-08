import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';
import { benchDriver, wait } from './bench-driver.mjs';

const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    page = await browser.newPage({ viewport }); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const Original = window.AudioContext; window.qaAudio = [];
      window.AudioContext = class extends Original {
        constructor(...args) { super(...args); window.qaAudio.push(this); const original = this.createDynamicsCompressor.bind(this); this.createDynamicsCompressor = () => { const node = original(), meter = this.createAnalyser(); node.connect(meter); this.qaMeter = meter; return node; }; }
      };
    });
    await browserLogin(page.context(), base, `audio${viewport.width}`); await page.goto(base);
    await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка' && document.getElementById('pause-screen').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.qaAudio.length), 0, 'No autoplay before interaction');
    await page.mouse.click(viewport.width / 2, viewport.height / 2); await page.waitForFunction(() => !!document.pointerLockElement);
    await page.waitForFunction(() => { const ctx = window.qaAudio[0]; if (!ctx?.qaMeter) return false; const data = new Float32Array(ctx.qaMeter.fftSize); ctx.qaMeter.getFloatTimeDomainData(data); return data.some(v => Math.abs(v) > .001); });
    const profile = [...app.profiles.values()].at(-1), runtime = app.runtime([...app.profiles.keys()].at(-1));
    for (const [i, tool] of ['hand', 'punch', 'certifier', 'toner', 'console'].entries()) {
      await page.keyboard.press(`Digit${i + 1}`); await wait(() => runtime.context.tool === tool);
      assert.equal(await page.locator(`[data-tool="${tool}"]`).getAttribute('aria-pressed'), 'true');
    }
    await page.keyboard.press('Control+Digit2'); assert.equal(runtime.context.tool, 'console');
    await page.keyboard.press('Escape'); await page.locator('#audio-settings').click(); await page.locator('#audio-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Digit2'); assert.equal(runtime.context.tool, 'console');
    for (const [id, value] of [['music', '18'], ['effects', '61']]) await page.locator(`#volume-${id}`).fill(value);
    await page.screenshot({ path: `${output}audio-settings-${viewport.width}.png` });
    await page.locator('#audio-muted').check(); await page.waitForFunction(() => window.qaAudio[0].state === 'suspended');
    await page.locator('#audio-muted').uncheck(); await page.waitForFunction(() => window.qaAudio[0].state === 'running');
    await page.locator('[data-close="audio-dialog"]').click(); await page.locator('#pause').click(); await page.waitForFunction(() => window.qaAudio[0].state === 'suspended');
    await page.locator('#resume').click(); await page.waitForFunction(() => window.qaAudio[0].state === 'running');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => window.qaAudio[0].state === 'suspended');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('#resume').click(); await page.waitForFunction(() => window.qaAudio[0].state === 'running');
    await page.reload(); await page.waitForFunction(() => document.getElementById('pause-screen').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => window.qaAudio.length), 0); await page.locator('#audio-settings').click();
    assert.equal(await page.locator('#volume-music').inputValue(), '18'); assert.equal(await page.locator('#volume-effects').inputValue(), '61');
    await page.locator('[data-close="audio-dialog"]').click(); await page.locator('#inspect-bench').click(); await page.waitForFunction(() => document.body.classList.contains('bench-mode'));
    for (const [i, tool] of ['hand', 'cutter', 'stripper', 'crimper', 'tester'].entries()) { await page.keyboard.press(`Digit${i + 1}`); await wait(() => runtime.context.tool === tool); }
    const bench = benchDriver(page); await bench.tool('cutter', -.95 + 25 * .0475, -.16); await wait(() => !!profile.labs.easy.draft);
    await page.keyboard.press('Digit3'); await wait(() => runtime.context.tool === 'stripper');
    await page.screenshot({ path: `${output}audio-tools-bench-${viewport.width}.png` });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.body.classList.contains('bench-mode'));
    await page.locator('#command').evaluate(el => { el.closest('#terminal').classList.remove('hidden'); el.focus(); });
    const before = runtime.context.tool; await page.locator('#command').pressSequentially('12345'); assert.equal(await page.locator('#command').inputValue(), '12345'); assert.equal(runtime.context.tool, before);
    await page.locator('#command').press('Escape');
    assert.equal(profile.security?.signals?.length ?? 0, 0); assert.deepEqual(errors, []);
    if (viewport.width === 1440) {
      const source = await readFile(new URL('../client/audio.mjs', import.meta.url), 'utf8');
      await page.route('**/__qa_audio.mjs', route => route.fulfill({ contentType: 'text/javascript', body: source }));
      const samples = await page.evaluate(async () => {
        const { LabAudio } = await import('/__qa_audio.mjs'), results = {};
        for (const kind of ['music', 'shot', 'strip', 'crimp', 'test', 'error', 'muted', 'music-zero', 'effects-zero']) {
          const ctx = new OfflineAudioContext(2, 48000 * 5, 48000), audio = new LabAudio({ contextFactory: () => ctx, storage: null, autoSchedule: false });
          audio.setScene({ active: true });
          if (kind === 'muted') audio.configure({ muted: true });
          if (kind === 'music-zero') audio.configure({ music: 0 });
          if (kind === 'effects-zero') audio.configure({ effects: 0 });
          audio.ensure(); if (['music', 'muted', 'music-zero'].includes(kind)) audio.musicBar(0, .05); else audio.effect(kind === 'effects-zero' ? 'shot' : kind, .05);
          const rendered = await ctx.startRendering(), samples = rendered.getChannelData(0);
          results[kind] = { peak: samples.reduce((n, v) => Math.max(n, Math.abs(v)), 0), rms: Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length), remainingVoices: audio.voices.size };
        }
        return results;
      });
      for (const [kind, values] of Object.entries(samples)) { assert.ok(values.peak < .95, `${kind}: clipping`); assert.equal(values.remainingVoices, 0, `${kind}: nodes must disconnect`); if (['muted', 'music-zero', 'effects-zero'].includes(kind)) assert.equal(values.rms, 0, `${kind}: must be silent`); else assert.ok(values.rms > .0001, `${kind}: blank audio`); }
      assert.ok(new Set(Object.values(samples).map(v => v.rms)).size >= 7); console.log(JSON.stringify({ renderedAudio: samples }));
    }
    await page.close(); console.log(JSON.stringify({ ok: true, viewport, checks: ['gesture-gated music with actual audio samples', 'five world and bench slots', 'typing and modal guards', 'separate saved volumes', 'mute, pause and hidden-tab handler suspend audio', 'zero cheat points', 'bench interaction'] }));
  }
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${output}audio-failure.png` }); throw error; }
finally { await browser?.close(); await app.close(); }
