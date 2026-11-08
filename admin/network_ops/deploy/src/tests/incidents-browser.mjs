import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../server/index.mjs';
import { act } from '../server/lab.mjs';
import { incident, advanceIncident } from '../server/incidents.mjs';
import { craft } from '../../solve/fixtures.mjs';
import { wait } from './bench-driver.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';
import { RAT_INTERVAL } from '../shared/catalog.mjs';

const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await browserLogin(page.context(), base);
  await page.goto(base); await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка');
  const lab = [...app.profiles.values()][0].labs.easy; assert.equal(lab.cables.length, 0);
  const s = incident(lab); s.pose = { x: -4, z: 11.2 }; await page.reload(); await page.waitForTimeout(1100);
  await page.mouse.move(720, 450); await page.mouse.down({ button: 'right' }); await page.mouse.move(1348.3, 420, { steps: 20 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(180);
  await page.screenshot({ path: `${output}shotgun-wall.png` });
  await page.mouse.click(720, 450); await page.waitForFunction(() => !!document.pointerLockElement); await page.waitForTimeout(100);
  await page.keyboard.press('KeyE'); await wait(() => s.shotgun); await page.waitForFunction(() => document.getElementById('ammo').textContent === '6 / 6');
  await page.keyboard.press('Escape');
  // Accelerate only the private test fixture; production has no timer-control API.
  const id = craft(lab); for (const port of ['r1:srv', 'archive:eth0']) act(lab, { type: 'plug', id, port });
  s.elapsed = RAT_INTERVAL - .1; s.nextRat = RAT_INTERVAL; advanceIncident(lab, .1); assert.ok(s.rat);
  const firstX = s.rat.x, firstZ = s.rat.z; await page.waitForTimeout(500); assert.ok(Math.hypot(s.rat.x - firstX, s.rat.z - firstZ) > .1);
  for (let i = 0; i < 1200 && !lab.cables[0].damage; i++) advanceIncident(lab, .1);
  assert.ok(lab.cables[0].damage);
  s.pose = { x: -2.5, z: -1.5 }; s.rat = null; await page.reload(); await page.waitForTimeout(950);
  await page.mouse.move(720, 450); await page.mouse.down({ button: 'right' }); await page.mouse.move(720, 492, { steps: 6 }); await page.mouse.up({ button: 'right' });
  await page.waitForFunction(() => document.querySelector('.cable-item.damaged'));
  await page.screenshot({ path: `${output}cable-sparks.png` });
  const pixels = () => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 144; c.height = 90; const ctx = c.getContext('2d'); ctx.drawImage(document.getElementById('scene'), 0, 0, 144, 90); return Array.from(ctx.getImageData(0, 0, 144, 90).data); });
  await page.locator('#crt').click(); const a = await pixels(); await page.waitForTimeout(150); const b = await pixels(); assert.ok(a.some((v, i) => Math.abs(v - b[i]) > 20), 'Electrical arcs and sparks animate');
  s.pose = { x: 4, z: 5 }; s.rat = { id: 'aim-fixture', x: 4, z: .8, yaw: 0, born: s.elapsed, state: 'chewing', chew: 0, path: [] };
  await page.reload(); await page.waitForTimeout(950); await page.locator('#pause-screen').waitFor({ state: 'hidden' }); await page.keyboard.press('KeyQ');
  await page.waitForFunction(() => document.body.classList.contains('armed'));
  await page.mouse.move(720, 450); await page.mouse.click(720, 450); await page.waitForFunction(() => !!document.pointerLockElement);
  const pitch = Math.atan2(.3 - 1.7, .8 - 5 < 0 ? 4.2 : -4.2), dy = (-.13 - pitch) / .0032;
  await page.mouse.move(720, 450 + dy, { steps: 8 }); await page.waitForTimeout(120);
  await page.screenshot({ path: `${output}rat-shotgun.png` });
  await page.mouse.click(720, 450 + dy); await wait(() => s.ammo === 5); assert.equal(s.rat.state, 'dead');
  await page.screenshot({ path: `${output}shotgun-fired.png` });
  await page.keyboard.press('KeyR'); await wait(() => s.reloadAt > 0); await wait(() => s.ammo === 6);
  await page.keyboard.press('Escape'); await page.locator('[data-level="medium"]').click(); await page.waitForFunction(() => document.getElementById('title').textContent === 'Линк есть. Сети нет.');
  assert.equal([...app.profiles.values()][0].labs.medium.cables.length, 0); assert.equal(incident([...app.profiles.values()][0].labs.medium).rat, null);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, checks: ['empty initial inventory', 'wall pickup with E', '5-minute fixture spawn', 'server rat movement', 'chewed cable', 'animated sparks', 'first-person shotgun', 'aimed shot kills rat', 'reload', 'independent levels'], screenshots: output }, null, 2));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: `${output}incidents-failure.png` }); console.error(await page.locator('#hover-label').textContent(), await page.locator('#toast').textContent()); } throw error; }
finally { await browser?.close(); await app.close(); }
