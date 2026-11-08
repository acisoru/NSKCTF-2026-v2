import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';
import { incident } from '../server/incidents.mjs';
import { craft } from '../../solve/fixtures.mjs';
import { benchDriver, wait } from './bench-driver.mjs';

const pixels = page => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 50; const ctx = c.getContext('2d'); ctx.drawImage(document.getElementById('scene'), 0, 0, 80, 50); return Array.from(ctx.getImageData(0, 0, 80, 50).data); });
const difference = (a, b) => a.reduce((sum, n, i) => sum + (i % 4 === 3 ? 0 : Math.abs(n - b[i])), 0) / (a.length * .75);

const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    page = await browser.newPage({ viewport }); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await browserLogin(page.context(), base, `panels${viewport.width}`); await page.goto(base);
    await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка' && document.getElementById('pause-screen').classList.contains('hidden'));
    const profile = [...app.profiles.values()].at(-1), lab = profile.labs.easy, runtime = app.runtime([...app.profiles.keys()].at(-1));
    assert.equal(await page.locator('#inspector').isVisible(), false); assert.equal(await page.locator('#ticket').isVisible(), false);
    await page.waitForTimeout(400); await page.screenshot({ path: `${output}world-panels-closed-${viewport.width}.png` });
    await page.mouse.click(viewport.width / 2, viewport.height / 2); await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press('KeyI'); await page.locator('#inspector').waitFor({ state: 'visible' }); assert.equal(await page.evaluate(() => !!document.pointerLockElement), true);
    const pose = { ...incident(lab).pose }; await page.keyboard.down('KeyD'); await page.waitForTimeout(350); await page.keyboard.up('KeyD'); await wait(() => incident(lab).pose.x > pose.x + .5);
    await page.keyboard.down('KeyA'); await page.waitForTimeout(350); await page.keyboard.up('KeyA'); await wait(() => incident(lab).pose.x < pose.x + .5);
    await page.keyboard.press('KeyI'); await page.locator('#inspector').waitFor({ state: 'hidden' }); assert.equal(await page.evaluate(() => !!document.pointerLockElement), true);
    await page.keyboard.down('KeyJ'); await page.locator('#ticket').waitFor({ state: 'visible' }); await page.keyboard.down('KeyJ'); assert.equal(await page.locator('#ticket').isVisible(), true); await page.keyboard.up('KeyJ');
    await page.keyboard.press('KeyI'); await page.locator('#inspector').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#crosshair').isVisible(), true);
    const a = await pixels(page); await page.mouse.move(viewport.width / 2 + 140, viewport.height / 2 - 50, { steps: 8 }); await page.waitForTimeout(150); const b = await pixels(page);
    assert.ok(difference(a, b) > 8, 'Both panels must allow horizontal and vertical camera look');
    await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 8 });
    await page.keyboard.press('Digit3'); await wait(() => runtime.context.tool === 'certifier');
    await page.screenshot({ path: `${output}inventory-tasks-${viewport.width}.png` });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.pointerLockElement); assert.equal(await page.locator('#inspector').isVisible(), true); assert.equal(await page.locator('#ticket').isVisible(), true);
    await page.locator('[data-close-panel="ticket"]').click(); await page.mouse.click(viewport.width / 2, viewport.height / 2); await page.waitForFunction(() => !!document.pointerLockElement);
    assert.equal(await page.locator('#inspector').isVisible(), true, 'Clicking the scene reacquires look without closing inventory');
    await page.keyboard.press('Escape'); await page.locator('[data-close-panel="inspector"]').click();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'ш' }))); await page.locator('#inspector').waitFor({ state: 'visible' });
    await page.locator('[data-close-panel="inspector"]').click(); await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', ctrlKey: true }))); assert.equal(await page.locator('#ticket').isVisible(), false);
    await page.keyboard.press('KeyJ'); await page.locator('#document').click(); await page.locator('#manual').waitFor({ state: 'visible' });
    const stopped = { ...incident(lab).pose }; await page.keyboard.down('KeyW'); await page.waitForTimeout(750); await page.keyboard.up('KeyW'); assert.deepEqual(incident(lab).pose, stopped, 'Modal dialogs still block movement');
    await page.locator('[data-close="manual"]').click();
    craft(lab); await page.keyboard.press('KeyI'); await page.locator('#inventory [data-command="label"]').waitFor({ state: 'visible' });
    await page.locator('#inventory [data-command="label"]').click(); await page.locator('#label-text').fill(''); await page.locator('#label-text').press('KeyI'); await page.locator('#label-text').press('KeyJ');
    assert.equal(await page.locator('#label-text').inputValue(), 'ij'); assert.equal(await page.locator('#inspector').isVisible(), false); assert.equal(await page.locator('#ticket').isVisible(), false);
    await page.locator('[data-close="label-dialog"]').click();
    await page.locator('#inspect-bench').click(); await page.waitForFunction(() => document.body.classList.contains('bench-mode')); await page.waitForTimeout(900);
    await page.keyboard.press('KeyI'); await page.locator('#inspector').waitFor({ state: 'visible' }); await benchDriver(page).cut(lab); assert.ok(lab.draft, 'Inventory must not block tabletop tools'); await page.keyboard.press('KeyI'); await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('bench-mode'));
    incident(lab).shotgun = true; await page.waitForFunction(() => !document.querySelector('[data-tool="shotgun"]').disabled); await page.keyboard.press('KeyQ'); await page.waitForFunction(() => document.body.classList.contains('armed'));
    await page.keyboard.press('KeyI'); await page.locator('#inspector').waitFor({ state: 'visible' }); await page.keyboard.press('KeyI');
    await page.mouse.click(viewport.width / 2, viewport.height / 2); await page.waitForFunction(() => !!document.pointerLockElement);
    await page.keyboard.press('KeyI'); await page.keyboard.press('KeyJ'); const ammo = incident(lab).ammo;
    await page.mouse.click(viewport.width / 2, viewport.height / 2); await wait(() => incident(lab).ammo === ammo - 1);
    assert.equal(profile.security?.signals?.length ?? 0, 0);
    assert.deepEqual(errors, []); await page.close(); console.log(JSON.stringify({ ok: true, viewport, checks: ['hidden initially', 'I/J nonmodal toggles', 'native pointer lock retained', 'movement and camera look with panels', 'Escape unlocks without closing panels', 'scene reacquisition', 'tool hotkeys', 'modal and typing guards', 'bench tools and shooting with panels', 'no cheat points'] }));
  }
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${output}panels-failure.png` }); throw error; }
finally { await browser?.close(); await app.close(); }
