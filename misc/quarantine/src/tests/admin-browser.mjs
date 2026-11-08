import { chromium } from 'playwright';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { MOVEMENT } from '../shared/config.mjs';

const app = await createApp({ flag: 'private-admin-browser-fixture', adminIds: ['owner'], oauth: { clientId: 'fixture', clientSecret: 'fixture-secret', publicOrigin: 'http://127.0.0.1', fetchImpl: async (url, options) => new Response(JSON.stringify(url.includes('/token') ? { access_token: options.body.get('code') } : { id: options.headers.Authorization.slice('OAuth '.length) })) } });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`; app.auth.origin = base; app.auth.redirectUri = `${base}/auth/yandex/callback`;
const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true });
const errors = []; let browser;
const wait = async check => { const end = Date.now() + 5000; while (!check()) { if (Date.now() > end) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 20)); } };
const place = (p, x, z, y = 0) => { p.x = x; p.z = z; p.y = y; p.body.position.set(x, y + MOVEMENT.radius, z); p.body.velocity.set(0, 0, 0); };
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] });
  async function login(user, name) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.locator('#yandex-login').waitFor();
    const start = await context.request.get(base + '/auth/yandex', { maxRedirects: 0 }); assert.equal(start.status(), 302);
    const state = new URL(start.headers().location).searchParams.get('state');
    await page.goto(`${base}/auth/yandex/callback?code=${user}&state=${state}`);
    try { await page.locator('#entry-form').waitFor({ state: 'visible', timeout: 8000 }); }
    catch (error) { await page.screenshot({ path: `${output}pc-admin-login-failure.png` }); throw new Error(`${error.message}: ${page.url()} / ${(await page.locator('body').innerText()).slice(0, 600)} / ${errors.join(', ')}`); }
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'НАБЛЮДЕНИЕ АКТИВНО');
    await page.locator('#callsign').fill(name); await page.locator('#enter').click(); await page.locator('#vitals').waitFor({ state: 'visible' });
    return { page, p: app.game.accounts.get(`yandex:${user}`) };
  }
  const owner = await login('owner', 'Администратор'), user = await login('player', 'Участник');
  assert.equal(await user.page.locator('#admin-toggle').isVisible(), false);
  await owner.page.bringToFront(); await owner.page.locator('#admin-toggle').click();
  await owner.page.locator('[data-action="follow"]').first().waitFor(); await owner.page.screenshot({ path: `${output}pc-admin-panel.png` });
  await owner.page.locator('#admin-mode').check(); await wait(() => app.game.adminActive(owner.p));
  await owner.page.locator('[data-close="admin"]').click(); const y = owner.p.y;
  await owner.page.keyboard.down('Space'); await wait(() => owner.p.y > y + 5); await owner.page.keyboard.up('Space');
  await owner.page.waitForTimeout(200); await owner.page.screenshot({ path: `${output}pc-admin-flight.png` });
  await owner.page.locator('#admin-toggle').click(); await owner.page.locator(`[data-action="follow"][data-player="${user.p.id}"]`).click();
  await wait(() => owner.p.admin.following === user.p.id && Math.abs(owner.p.y - user.p.y - 3) < .1);
  await owner.page.waitForTimeout(200); await owner.page.screenshot({ path: `${output}pc-admin-spectate.png` });
  await owner.page.locator('#admin-toggle').click(); await owner.page.locator('#admin-unfollow').click(); await wait(() => !owner.p.admin.following);
  await owner.page.locator('#admin-weapon').check(); await wait(() => owner.p.admin.weapon); await owner.page.locator('[data-close="admin"]').click();
  place(owner.p, 210, 230, .1); place(user.p, 210, 222, 0); user.p.armor = .99;
  await owner.page.keyboard.press('Home'); await owner.page.waitForTimeout(500); await owner.page.keyboard.down('KeyF'); await wait(() => user.p.hp <= 0); await owner.page.keyboard.up('KeyF');
  await owner.page.screenshot({ path: `${output}pc-admin-gun.png` });
  user.p.hp = user.p.maxHp; user.p.dead = 0;
  await owner.page.locator('#admin-toggle').click(); await owner.page.locator('#admin-refresh').click();
  await owner.page.locator(`[data-action="moderate"][data-player="${user.p.id}"]`).click();
  await owner.page.locator('#admin-ban-reason').fill('Проверка модерации'); await owner.page.locator('#admin-ban-duration').selectOption('0');
  await owner.page.screenshot({ path: `${output}pc-admin-ban-confirm.png` }); await owner.page.locator('#admin-ban-submit').click();
  await wait(() => !!app.moderation.ban(user.p.providerId)); await user.page.waitForFunction(() => document.getElementById('auth-status').textContent.includes('заблокирован'));
  await owner.page.locator('#admin-filter').selectOption('banned'); await wait(() => !app.game.online.has(user.p.id));
  await owner.page.locator(`[data-action="moderate"][data-player="${user.p.id}"]`).waitFor();
  await owner.page.screenshot({ path: `${output}pc-admin-banned.png` });
  await owner.page.locator(`[data-action="moderate"][data-player="${user.p.id}"]`).click(); await owner.page.locator('#admin-ban-submit').click();
  await wait(() => !app.moderation.ban(user.p.providerId));
  const overlaps = await owner.page.evaluate(() => {
    const panel = document.getElementById('admin').getBoundingClientRect();
    return [...document.querySelectorAll('#admin button, #admin input, #admin select')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < panel.left || r.right > panel.right + 1); }).length;
  });
  assert.equal(overlaps, 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ['OAuth-gated admin UI', 'flight', 'spectator follow', 'one-shot gun', 'ban confirmation and disconnect', 'unban', 'desktop layout'], screenshots: output }, null, 2));
} finally { await browser?.close(); await app.close(); }
