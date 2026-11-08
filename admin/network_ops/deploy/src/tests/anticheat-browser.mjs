import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';

const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await browserLogin(page.context(), base); await page.goto(base);
  await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка' && document.getElementById('pause-screen').classList.contains('hidden'));
  await page.mouse.click(683, 384); await page.waitForFunction(() => !!document.pointerLockElement);
  for (let i = 0; i < 3; i++) {
    if (i) await page.waitForTimeout(2100);
    const status = await page.evaluate(async () => (await fetch('/api/world', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'easy', pose: { x: 0, z: 11 }, won: true }) })).status);
    assert.equal(status, i === 2 ? 403 : 400);
  }
  await page.locator('#ban-screen').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.pointerLockElement);
  assert.match(await page.locator('#ban-until').textContent(), /^До /); assert.match(await page.locator('#ban-reference').textContent(), /^Код: [a-f0-9]+$/);
  await page.screenshot({ path: `${output}anticheat-blocked.png` });
  await page.reload(); await page.locator('#ban-screen').waitFor({ state: 'visible' });
  await app.antiCheat.unban('1001', 'Browser fixture reviewed'); await page.locator('#ban-retry').click();
  await page.locator('#ban-screen').waitFor({ state: 'hidden' }); await page.waitForFunction(() => document.getElementById('pause-screen').classList.contains('hidden'));
  await page.mouse.click(683, 384); await page.waitForFunction(() => !!document.pointerLockElement); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['repeated tampering auto-ban', 'cursor released', 'expiry and reference displayed', 'reload stays banned', 'operator unban restores play'], screenshots: output }, null, 2));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${output}anticheat-failure.png` }); throw error; }
finally { await browser?.close(); await app.close(); }
