import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { MOVEMENT, LADDERS, SAFE_ZONES, WEAPONS } from '../shared/config.mjs';

const app = await createApp({ flag: 'nskctf{browser_pc_fixture}', testAuth: true });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const url = `http://127.0.0.1:${app.server.address().port}`, output = new URL('../test-results/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', errors = []; let browser;
const place = (p, x, z, y = 0) => { p.x = x; p.z = z; p.y = y; p.moveStart = null; p.body.position.set(x, y + MOVEMENT.radius, z); p.body.velocity.set(0, 0, 0); };
const wait = async (fn, timeout = 5000) => { const deadline = Date.now() + timeout; while (!fn() && Date.now() < deadline) await new Promise(r => setTimeout(r, 20)); assert.ok(fn(), 'Game condition timed out'); };
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: chrome }), args: ['--enable-gpu'] });
  async function player(name, role = 'assault') {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url); await page.waitForFunction(() => document.getElementById('connection').textContent === 'НАБЛЮДЕНИЕ АКТИВНО');
    await page.locator('#callsign').fill(name); await page.locator(`[data-role="${role}"]`).click(); await page.locator('#enter').click(); await page.locator('#vitals').waitFor({ state: 'visible' });
    return { page, p: [...app.game.sessions.values()].find(p => p.name === name) };
  }
  const { page, p } = await player('PC operator'); const second = await player('PC medic', 'medic');
  await page.bringToFront(); await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}pc-city.png` });
  const turnStart = p.yaw;
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(200); await page.keyboard.up('ArrowRight'); await wait(() => p.yaw > turnStart + .1);
  await page.keyboard.down('PageUp'); await page.keyboard.down('KeyZ'); await page.waitForTimeout(200); await page.keyboard.up('PageUp'); await page.keyboard.up('KeyZ'); await wait(() => p.pitch > .1);
  await page.mouse.move(600, 450); await page.mouse.wheel(0, -800); await page.waitForTimeout(150);
  await page.screenshot({ path: `${output}pc-first-person-look.png` }); await page.keyboard.press('Home'); await wait(() => Math.abs(p.pitch) < .01);
  const start = p.z; await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW'); const walked = start - p.z;
  const sprintStart = p.z; await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(600); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  assert.ok(sprintStart - p.z > walked * 1.25); assert.ok(p.stamina < 100);
  await page.keyboard.down('Space'); await wait(() => p.y > .65); await page.screenshot({ path: `${output}pc-jump.png` }); await page.keyboard.up('Space'); await wait(() => p.grounded && p.y < .04);
  const ladder = LADDERS[0]; place(p, ladder.x, ladder.z + .2); await page.waitForTimeout(220);
  await page.keyboard.press('KeyE'); await wait(() => p.climbing === ladder.id);
  await page.keyboard.down('KeyW'); await wait(() => p.y > 2); await page.screenshot({ path: `${output}pc-ladder.png` }); await wait(() => !p.climbing, 7000); await page.keyboard.up('KeyW');
  assert.ok(p.y >= ladder.top - .1); await page.waitForTimeout(250); await page.screenshot({ path: `${output}pc-roof.png` });
  const hp = Math.max(20, p.hp - 50); p.hp = hp; app.game.xp(p, 150); await page.waitForTimeout(400); assert.equal(p.hp, hp);
  const potions = p.potions; await page.keyboard.press('KeyH'); await wait(() => p.potions === potions - 1); assert.ok(p.hp > hp);
  const market = SAFE_ZONES[0].merchant; place(p, market.x, market.z + 1); p.gold = 3000; await page.waitForTimeout(220); await page.keyboard.press('KeyE'); await page.locator('#shop').waitFor({ state: 'visible' });
  for (const type of ['shotgun', 'sniper', 'machinegun']) { await page.locator(`[data-buy="${type}"]`).click(); await wait(() => p.inventory.some(i => i.type === type)); }
  await page.screenshot({ path: `${output}pc-weapon-shop.png` }); await page.locator('[data-close="shop"]').click();
  for (const type of ['shotgun', 'sniper', 'machinegun', 'pistol']) {
    const item = p.inventory.find(i => i.type === (type === 'pistol' ? 'issue' : type));
    await page.locator('#inventory-toggle').click(); await page.locator(`[data-command="equip"][data-item="${item.id}"]`).click(); await wait(() => p.equipment.weapon === item.id); await page.locator('[data-close="inventory"]').click();
    place(p, 210, 230); await page.waitForTimeout(220); await page.keyboard.down('KeyF'); await wait(() => item.ammo < WEAPONS[type].magazine); await page.keyboard.up('KeyF');
    assert.equal(await page.locator('#weapon-name').textContent(), WEAPONS[type].name); await page.screenshot({ path: `${output}pc-${type}.png` });
    await page.keyboard.press('KeyR'); await wait(() => !!p.reloading);
    if (type === 'sniper') { await page.waitForTimeout(700); await page.screenshot({ path: `${output}pc-first-person-reload.png` }); }
    await wait(() => !p.reloading, 5000); assert.equal(item.ammo, WEAPONS[type].magazine);
  }
  await page.locator('#party-toggle').click(); await page.locator('#party-create').click(); await wait(() => !!p.party); const code = p.party; await page.locator('[data-close="party"]').click();
  await second.page.locator('#party-toggle').click(); await second.page.locator('#party-code').fill(code); await second.page.locator('#party-join').click(); await wait(() => second.p.party === code); await second.page.locator('[data-close="party"]').click();
  for (let i = 0; i < 8; i++) {
    const member = app.game.connect(null, () => {}); app.game.handle(member, { type: 'enter', name: `Raid member ${i + 3}` });
    app.game.handle(member, { type: 'party-join', code });
  }
  await page.bringToFront(); await page.setViewportSize({ width: 1366, height: 768 }); await page.locator('#party-toggle').click();
  await page.waitForFunction(() => document.querySelectorAll('#party-members .party-person').length === 10);
  const partyLayout = await page.evaluate(() => {
    const panel = document.getElementById('party').getBoundingClientRect(), leave = document.getElementById('party-leave').getBoundingClientRect(), members = document.getElementById('party-members');
    return { contained: leave.bottom <= panel.bottom && leave.top >= panel.top, scrollable: members.scrollHeight > members.clientHeight };
  });
  assert.deepEqual(partyLayout, { contained: true, scrollable: true });
  await page.screenshot({ path: `${output}pc-party-ten.png` }); await page.locator('[data-close="party"]').click();
  const hudLayout = await page.evaluate(() => document.getElementById('party-roster').getBoundingClientRect().bottom < document.getElementById('vitals').getBoundingClientRect().top);
  assert.ok(hudLayout); await page.screenshot({ path: `${output}pc-party-ten-hud.png` }); await page.setViewportSize({ width: 1440, height: 900 });
  await page.bringToFront(); const rememberedHp = p.hp; await page.reload(); await page.locator('#vitals').waitFor({ state: 'visible' }); assert.equal(p.hp, rememberedHp);
  const boss = app.game.enemies.find(e => e.bossId === 'warden');
  p.marks = ['archivist', 'resonator']; place(p, boss.x, boss.z + 10); boss.hp = 10;
  app.game.contribution(boss, p, 500); app.game.hitEnemy(p, boss, 1000);
  await page.locator('#reward-modal').waitFor({ state: 'visible' }); assert.equal(await second.page.locator('#reward-modal').isVisible(), false); await page.locator('#reward-close').click();
  const pixels = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 60; const ctx = c.getContext('2d'); ctx.drawImage(document.getElementById('scene'), 0, 0, 80, 60); const a = ctx.getImageData(0, 0, 80, 60).data; return { bright: a.filter((x, i) => i % 4 !== 3 && x > 80).length, colors: new Set(Array.from({ length: a.length / 4 }, (_, i) => `${a[i * 4] >> 4}:${a[i * 4 + 1] >> 4}:${a[i * 4 + 2] >> 4}`)).size }; });
  assert.ok(pixels.bright > 400 && pixels.colors > 25); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, platform: 'PC', checks: ['compressed world stream', 'first-person look/roll/zoom', 'Shift sprint', 'Space jump and landing', 'ladder and solid roof', 'no passive/level healing', 'medkit', 'four weapon families', 'magazines and reload', 'ten-member party and scrollable roster', 'reconnect health', 'last-hitting raid private reward'], pixels, screenshots: output }, null, 2));
} finally { await browser?.close(); await app.close(); }
