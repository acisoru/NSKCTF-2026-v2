import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { benchDriver, wait } from './bench-driver.mjs';
import { mockOAuth, browserLogin } from './auth-fixture.mjs';

const app = await createApp({ oauth: mockOAuth }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true }); let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    page = await browser.newPage({ viewport }); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await browserLogin(page.context(), base, String(viewport.width));
    await page.goto(base); await page.waitForFunction(() => document.getElementById('title').textContent === 'Нет линка');
    const lab = [...app.profiles.values()].at(-1).labs.easy, bench = benchDriver(page, { stripTravel: viewport.width === 1366 ? .62 : .22 });
    await page.locator('#inspect-bench').click(); await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    await page.screenshot({ path: `${output}bench-${viewport.width}.png` });
    await bench.drag([.2375, .15, -.16], [0, .15, -.16]);
    await bench.tool('cutter', 0, -.16); await wait(() => !!lab.draft); assert.equal(lab.draft.length, 20);
    // An early RJ45 drop cannot bypass stripping, sorting and trimming.
    await bench.drag([-1.36, .17, .26], [0, .17, -.72]); assert.equal(lab.draft.ends[0].inserted, false);
    await bench.click([2.35, .18, .96]); await page.locator('#discard-dialog').waitFor({ state: 'visible' });
    await page.locator('[data-close="discard-dialog"]').click(); assert.ok(lab.draft);
    await bench.click([2.35, .18, .96]); await page.locator('#confirm-discard').click(); await wait(() => !lab.draft); await page.locator('#discard-dialog').waitFor({ state: 'hidden' }); await page.waitForTimeout(100);
    await bench.drag([0, .15, -.16], [.2375, .15, -.16]);
    await bench.craft(lab);
    assert.equal(lab.draft.length, 25);
    assert.ok(lab.draft.ends.every(e => e.depth <= 1.4 && e.untwist <= 13));
    await bench.tool('certifier', 0, .2); await page.waitForFunction(() => document.getElementById('measurement').textContent.includes('PASS'));
    await page.screenshot({ path: `${output}bench-crimped-${viewport.width}.png` });
    const pixels = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 50; const ctx = canvas.getContext('2d'); ctx.drawImage(document.getElementById('scene'), 0, 0, 80, 50); const p = ctx.getImageData(0, 0, 80, 50).data; return new Set(Array.from({ length: p.length / 4 }, (_, i) => `${p[i * 4] >> 4}:${p[i * 4 + 1] >> 4}:${p[i * 4 + 2] >> 4}`)).size; }); assert.ok(pixels > 30);
    const id = lab.draft.id; await bench.click([.24, .09, 1.14]); await wait(() => !lab.draft); assert.ok(lab.cables.some(c => c.id === id));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.body.classList.contains('bench-mode'));
    assert.equal([...app.profiles.values()].at(-1).security?.signals?.length ?? 0, 0, 'Normal bench play must not receive cheat points');
    assert.deepEqual(errors, []); await page.close(); console.log(JSON.stringify({ ok: true, viewport, pixels, checks: ['3D tools', 'measuring', 'invalid operation rejected', 'discard confirmation', 'cut', 'strip gesture', '16 wire drags', 'trim', 'RJ45 insertion', 'crimp gesture', 'certify', 'stow', 'no cheat points'] }));
  }
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: `${output}bench-failure.png` }); console.error(await page.locator('#hover-label').textContent(), await page.locator('#toast').textContent(), await page.locator('#stages').textContent()); } throw error; }
finally { await browser?.close(); await app.close(); }
