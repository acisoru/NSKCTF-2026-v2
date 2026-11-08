import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { act } from '../server/lab.mjs';
import { craft } from '../../solve/fixtures.mjs';
import { benchDriver } from './bench-driver.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';
import { incident } from '../server/incidents.mjs';

const app = await createApp({ oauth: mockOAuth, flags: { easy: 'nskctf{browser_network_fixture}' }, checkerUrls: ['http://127.0.0.1:9135'], checkerToken: 'local-network-qa-only-token-not-for-production' });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser;
const wait = async fn => { const end = Date.now() + 8000; while (!fn()) { if (Date.now() > end) throw new Error('Game state timeout'); await new Promise(r => setTimeout(r, 20)); } };
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage(), errors = [];
  await browserLogin(context, base);
  page.on('pageerror', error => errors.push(error.message)); await page.goto(base); await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка');
  await page.waitForTimeout(500); await page.screenshot({ path: `${output}easy-room.png` });
  const owner = [...app.profiles.values()][0], lab = owner.labs.easy;
  await page.locator('#inspect-bench').click(); await page.waitForTimeout(800);
  const bench = benchDriver(page); await bench.craft(lab);
  await bench.tool('certifier', 0, .2); await page.waitForFunction(() => document.getElementById('measurement').textContent.includes('PASS'));
  await page.screenshot({ path: `${output}cable-crimped.png` }); const handmade = lab.draft.id;
  await bench.click([.24, .09, 1.14]); await wait(() => !lab.draft);
  const plug = (id, a, b) => { act(lab, { type: 'plug', id, port: a }); act(lab, { type: 'plug', id, port: b }); };
  act(lab, { type: 'power', device: 'swa' }); plug(handmade, 'pc:eth0', 'outlet:j1'); plug(craft(lab), 'panel:j1', 'swa:p1'); plug(craft(lab), 'swa:p4', 'r1:lan'); plug(craft(lab), 'r1:srv', 'archive:eth0'); act(lab, { type: 'console', device: 'pc' });
  incident(lab).pose = { x: -10, z: 10.5 }; await page.reload(); await page.waitForTimeout(850);
  await page.locator('[data-tool="console"]').click();
  // The terminal must now be attached at the workstation, not remotely reopened.
  // Aim with the unlocked right-mouse fallback, then use the crosshair interaction.
  await page.mouse.move(720, 450); await page.mouse.down({ button: 'right' }); await page.mouse.move(771, 480, { steps: 10 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(150); await page.mouse.click(720, 450); await page.waitForFunction(() => !!document.pointerLockElement); await page.keyboard.press('KeyE'); await page.locator('#terminal').waitFor({ state: 'visible' });
  for (const line of [`ip addr add 10.${lab.subnet}.10.20/24 dev eth0`, `ip route add default via 10.${lab.subnet}.10.1`, `dns server 10.${lab.subnet}.99.10`, 'write memory']) {
    await page.locator('#command').fill(line); await page.locator('#command').press('Enter'); await page.waitForTimeout(120);
  }
  assert.ok(lab.startup.pc.gateway); await page.screenshot({ path: `${output}console.png` }); await page.locator('#terminal-close').click();
  await page.locator('#verify').click(); await wait(() => app.jobs.size > 0);
  await page.locator('#reward').waitFor({ state: 'visible', timeout: 45000 }); assert.equal(await page.locator('#flag').textContent(), 'nskctf{browser_network_fixture}'); await page.screenshot({ path: `${output}easy-verified.png` });
  await page.locator('[data-close="report"]').click();
  await page.reload(); await page.locator('#archive').waitFor({ state: 'visible' }); await page.locator('#archive').click(); assert.equal(await page.locator('#flag').textContent(), 'nskctf{browser_network_fixture}'); await page.locator('[data-close="report"]').click();
  const other = await browser.newContext({ viewport: { width: 1366, height: 768 } }), otherPage = await other.newPage(); await browserLogin(other, base, '1002'); await otherPage.goto(base); await otherPage.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка');
  assert.equal([...app.profiles.values()][1].labs.easy.won, false);
  for (const level of ['medium', 'hard']) { await page.locator(`[data-level="${level}"]`).click(); await wait(() => owner.current === level); await page.waitForTimeout(400); await page.screenshot({ path: `${output}${level}-room.png` }); }
  const pixels = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 50; const ctx = c.getContext('2d'); ctx.drawImage(document.getElementById('scene'), 0, 0, 80, 50); const p = ctx.getImageData(0, 0, 80, 50).data; return new Set(Array.from({ length: p.length / 4 }, (_, i) => `${p[i * 4] >> 4}:${p[i * 4 + 1] >> 4}:${p[i * 4 + 2] >> 4}`)).size; });
  assert.ok(pixels > 30); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['nonblank 3D room', 'dragged sixteen wires into RJ45 contacts', 'crimper handle drag', 'cable certification', 'console configuration', 'real Linux checker result', 'private progress', 'three scenarios'], pixels, screenshots: output }, null, 2));
} finally { await browser?.close(); await app.close(); }
