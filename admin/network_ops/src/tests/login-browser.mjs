import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';

const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.locator('#auth-gate').waitFor({ state: 'visible' }); await page.waitForTimeout(700);
  assert.equal(app.profiles.size, 0); assert.equal(await page.locator('#yandex-login').getAttribute('href'), '/auth/yandex');
  await page.screenshot({ path: `${output}yandex-login.png` });
  await browserLogin(page.context(), base); await page.reload(); await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка' && document.getElementById('pause-screen').classList.contains('hidden'));
  await page.locator('#pause').click(); await page.locator('#pause-screen').waitFor({ state: 'visible' });
  const rejected = await page.evaluate(async () => (await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'easy', revision: 0, action: { type: 'cut', length: 40 } }) })).status); assert.equal(rejected, 409);
  await page.screenshot({ path: `${output}server-pause.png` });
  await page.locator('#resume').click(); await page.locator('#pause-screen').waitFor({ state: 'hidden' });
  await page.locator('#logout').click(); await page.locator('#auth-gate').waitFor({ state: 'visible' }); assert.equal(app.profiles.size, 1); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['login gate', 'no anonymous profile allocation', 'OAuth-backed resume', 'server pause rejects actions', 'resume', 'logout preserves account'], screenshots: output }, null, 2));
} finally { await browser?.close(); await app.close(); }
