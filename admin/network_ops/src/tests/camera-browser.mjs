import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../server/index.mjs';
import { act } from '../server/lab.mjs';
import { benchDriver } from './bench-driver.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';
import { incident } from '../server/incidents.mjs';

const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser;
const wait = async fn => { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw new Error('Game state timeout'); await new Promise(r => setTimeout(r, 20)); } };
const pixels = page => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 50; const context = c.getContext('2d'); context.drawImage(document.getElementById('scene'), 0, 0, 80, 50); return Array.from(context.getImageData(0, 0, 80, 50).data); });
const difference = (a, b) => a.reduce((sum, n, i) => sum + (i % 4 === 3 ? 0 : Math.abs(n - b[i])), 0) / (a.length * .75);
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []; page.on('pageerror', error => errors.push(error.message));
  await browserLogin(page.context(), base);
  const ready = async () => { await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка'); await page.waitForTimeout(400); };
  const lock = async () => { await page.mouse.click(720, 360); await page.waitForFunction(() => document.pointerLockElement === document.getElementById('scene')); };
  await page.goto(base); await ready(); await lock();
  assert.equal(await page.evaluate(() => document.body.classList.contains('bench-mode')), false);
  const before = await pixels(page); await page.mouse.move(1040, 360, { steps: 10 }); await page.waitForTimeout(180); const horizontal = await pixels(page);
  assert.ok(difference(before, horizontal) > 12, 'Horizontal relative motion must change the scene');
  await page.mouse.move(1040, 100, { steps: 10 }); await page.waitForTimeout(180); const vertical = await pixels(page);
  assert.ok(difference(horizontal, vertical) > 12, 'Vertical relative motion must change the scene');
  await page.screenshot({ path: `${output}camera-pointer-lock.png` });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.pointerLockElement);
  await page.waitForTimeout(120); const released = await pixels(page); await page.mouse.move(880, 520, { steps: 5 }); await page.waitForTimeout(120);
  assert.ok(difference(released, await pixels(page)) < 8, 'An unlocked cursor must not rotate the camera');
  await page.waitForTimeout(1100); await lock();
  await page.evaluate(() => document.getElementById('document').click()); await page.waitForFunction(() => !document.pointerLockElement && document.getElementById('manual').open);
  await page.locator('[data-close="manual"]').click(); assert.equal(await page.evaluate(() => document.pointerLockElement), null);

  await page.reload(); await ready(); await lock();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(720, 360 + i * 18, { steps: 3 }); await page.waitForTimeout(80);
    if ((await page.locator('#hover-label').textContent()).includes('Монтажный верстак')) break;
  }
  assert.match(await page.locator('#hover-label').textContent(), /Монтажный верстак/);
  await page.keyboard.press('KeyE'); await page.waitForFunction(() => !document.pointerLockElement && document.body.classList.contains('bench-mode'));
  await page.waitForTimeout(650); const profile = [...app.profiles.values()][0], bench = benchDriver(page);
  await bench.cut(profile.labs.easy); await bench.strip(profile.labs.easy, 0);
  const loose = profile.labs.easy.draft.ends[0].exposed.indexOf('wo');
  await bench.drag([(loose - 3.5) * .18, .18, -.18 - (loose % 2) * .06], [-.63, .16, -.72]);
  await wait(() => profile.labs.easy.draft.ends[0].order[0] === 'wo'); assert.equal(await page.evaluate(() => document.pointerLockElement), null);
  await page.screenshot({ path: `${output}camera-bench-cursor.png` });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.body.classList.contains('bench-mode')); await page.waitForTimeout(1100); await lock();

  incident(profile.labs.easy).pose = { x: -10, z: 10.5 }; await page.reload(); await ready();
  await page.locator('[data-tool="console"]').click(); await page.mouse.move(720, 450); await page.mouse.down({ button: 'right' }); await page.mouse.move(771, 480, { steps: 10 }); await page.mouse.up({ button: 'right' }); await lock();
  await page.keyboard.press('KeyE'); await page.locator('#terminal').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.pointerLockElement);
  await page.locator('#command').fill('show interfaces'); await page.locator('#command').press('Enter'); await page.waitForFunction(() => document.getElementById('terminal-output').textContent.includes('carrier DOWN'));
  await page.locator('#command').press('Escape'); await wait(() => [...app.runtimes.values()][0].context.mode === 'world'); assert.equal(await page.evaluate(() => document.pointerLockElement), null);
  await page.waitForTimeout(1100); await lock();
  await page.keyboard.down('Shift'); await page.keyboard.down('KeyD'); await page.waitForTimeout(650); await page.keyboard.up('KeyD'); await page.keyboard.up('Shift'); await page.waitForTimeout(800);
  assert.ok(incident(profile.labs.easy).pose.x > -7, 'Sprint must advance the authoritative position after leaving console with Escape'); assert.equal(profile.security?.signals?.length ?? 0, 0, 'Normal movement must not receive cheat points'); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['native pointer lock on first click', 'horizontal and vertical relative mouse look', 'Escape releases cursor', 'reacquisition', 'crosshair interaction with E', 'bench unlock and wire dragging', 'dialog unlock', 'console unlock and keyboard input'], screenshots: output }, null, 2));
} finally { await browser?.close(); await app.close(); }
