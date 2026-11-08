import { chromium, firefox } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { MOVEMENT } from '../shared/config.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'recreate-browser-')), app = await createApp({ testAuth: true, dataDir, flag: 'private-recreation-fixture' });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`, output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true });
const engine = process.env.BROWSER === 'firefox' ? 'firefox' : 'chromium'; let browser, page;
const wait = async fn => { const end = Date.now() + 6000; while (!fn()) { assert.ok(Date.now() < end, 'Game update timeout'); await new Promise(r => setTimeout(r, 20)); } };
try {
  browser = await (engine === 'firefox' ? firefox.launch({ headless: true }) : chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] }));
  page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => document.getElementById('connection').textContent === 'НАБЛЮДЕНИЕ АКТИВНО');
  await page.locator('#callsign').fill('Role fixture'); await page.locator('#enter').click(); await page.locator('#vitals').waitFor({ state: 'visible' });
  const p = [...app.game.sessions.values()][0], id = p.id; p.level = 3; p.xp = 75; p.gold = 500; p.potions = 1; p.marks = ['archivist']; p.inventory.push(app.game.item('sniper')); app.game.stats(p);
  await page.waitForFunction(() => document.getElementById('player-level').textContent.includes('03'));
  await page.locator('#inventory-toggle').click(); await page.locator('#recreate-open').click();
  assert.equal(await page.locator('input[name="new-role"][value="assault"]').isDisabled(), true);
  await page.locator('input[name="new-role"][value="medic"]').check(); assert.equal(await page.locator('#recreate-submit').isDisabled(), true);
  await page.locator('#recreate-ack').check(); await page.locator('#recreate-cancel').click(); assert.equal(p.level, 3); assert.equal(p.role, 'assault');
  await page.locator('#recreate-open').click(); await page.locator('input[name="new-role"][value="medic"]').check(); await page.locator('#recreate-ack').check();
  await page.screenshot({ path: `${output}recreate-${engine}-confirmation.png` });
  await page.locator('#recreate-submit').click(); await page.locator('#recreate-dialog').waitFor({ state: 'hidden' });
  await wait(() => p.role === 'medic'); assert.equal(p.id, id); assert.equal(p.level, 1); assert.equal(p.gold, 0); assert.equal(p.potions, 1); assert.equal(p.inventory.length, 2); assert.deepEqual(p.marks, []);
  assert.equal(await page.locator('#character-role').textContent(), 'Медик'); assert.equal(await page.locator('#reward-modal').isVisible(), false);
  const saved = JSON.parse(await readFile(join(dataDir, 'players.json'), 'utf8')); assert.equal(saved[0].characterRevision, 1); assert.equal(saved[0].role, 'medic');
  await page.reload(); await page.locator('#vitals').waitFor({ state: 'visible' }); assert.equal(p.role, 'medic'); assert.equal(app.game.sessions.size, 1);
  assert.ok(p.recreateAfter > Date.now()); p.recreateAfter = 0;
  p.x = 210; p.z = 230; p.y = 0; p.body.position.set(p.x, MOVEMENT.radius, p.z); p.body.velocity.set(0, 0, 0); p.moveStart = null;
  await page.waitForFunction(() => document.getElementById('zone-state').classList.contains('danger'));
  await page.locator('#inventory-toggle').click(); await page.locator('#recreate-open').click(); await page.locator('input[name="new-role"][value="guardian"]').check(); await page.locator('#recreate-ack').check();
  assert.equal(await page.locator('#recreate-submit').isDisabled(), true); assert.match(await page.locator('#recreate-error').textContent(), /зелёной зоне/);
  const layout = await page.evaluate(() => { const panel = document.getElementById('recreate-dialog').getBoundingClientRect(); return [...document.querySelectorAll('#recreate-dialog input, #recreate-dialog button')].every(el => { const r = el.getBoundingClientRect(); return r.left >= panel.left && r.right <= panel.right && r.top >= panel.top && r.bottom <= panel.bottom; }); });
  assert.equal(layout, true); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, engine, checks: ['confirmation and cancellation', 'server role change', 'described progress reset', 'saved before success', 'same account on reconnect', 'no recreation in combat areas', 'desktop dialog layout'] }));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${output}recreate-${engine}-failure.png` }); throw error; }
finally { await browser?.close(); await app.close(); await rm(dataDir, { recursive: true, force: true }); }
