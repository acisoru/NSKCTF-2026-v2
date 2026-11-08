import { chromium, firefox } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = new URL('../test-results/', import.meta.url).pathname; await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: ['tests/model-scene.mjs'], bundle: true, format: 'esm', write: false });
const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas id="scene"></canvas><script type="module" src="/qa.js"></script></body></html>';
const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/qa.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/qa.js' ? bundle.outputFiles[0].text : html); });
server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
let browser, page; const engine = process.env.BROWSER === 'firefox' ? 'firefox' : 'chromium';
try {
  browser = await (engine === 'firefox' ? firefox.launch({ headless: true }) : chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }), args: ['--enable-gpu'] }));
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => typeof window.showModel === 'function');
  const pixels = () => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 100; c.height = 65; const ctx = c.getContext('2d'); ctx.drawImage(document.getElementById('scene'), 0, 0, 100, 65); const a = ctx.getImageData(0, 0, 100, 65).data; return new Set(Array.from({ length: a.length / 4 }, (_, i) => `${a[i * 4] >> 4}:${a[i * 4 + 1] >> 4}:${a[i * 4 + 2] >> 4}`)).size; });
  for (const mode of ['characters', 'drones', 'archivist', 'resonator', 'warden', 'pylon', 'projectiles', 'weapon-pistol', 'weapon-rifle', 'weapon-shotgun', 'weapon-sniper', 'weapon-machinegun', 'weapon-admin']) {
    await page.evaluate(mode => window.showModel(mode), mode); await page.waitForTimeout(650); assert.ok(await pixels() > 25, `${mode}: nonblank canvas`);
    await page.screenshot({ path: `${output}models-${engine}-${mode}.png` });
    if (mode === 'projectiles') assert.equal(await page.evaluate(() => window.modelStats().visibleProjectiles), 2);
    if (mode === 'drones') { const before = await page.evaluate(() => window.modelStats().animated); await page.waitForTimeout(200); const after = await page.evaluate(() => window.modelStats().animated); assert.ok(before.length >= 8); assert.ok(before.some((value, i) => Math.abs(value - after[i]) > .1)); }
  }
  await page.setViewportSize({ width: 1366, height: 768 }); await page.evaluate(() => window.showModel('warden')); await page.waitForTimeout(600); assert.ok(await pixels() > 25);
  await page.screenshot({ path: `${output}models-${engine}-warden-1366.png` });
  await page.evaluate(() => window.showModel('crowd')); await page.waitForTimeout(900); const crowd = await page.evaluate(() => window.modelStats());
  assert.ok(crowd.detailedPlayers <= 16); assert.ok(crowd.detailedEnemies <= 12); assert.ok(crowd.low > 50); assert.ok(crowd.meshes < 1500);
  await page.evaluate(() => window.showModel('drones')); await page.waitForTimeout(100); await page.evaluate(() => window.showModel('crowd')); await page.waitForTimeout(700);
  const repeated = await page.evaluate(() => window.modelStats()); assert.ok(repeated.geometryCount <= crowd.geometryCount + 2); assert.equal(repeated.textures, crowd.textures); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, engine, checks: ['all roles', 'six weapon families', 'three distinct bosses', 'drones and bomber rotors animate', 'pylon', 'desktop framing', 'crowd LOD budgets', 'no geometry/texture growth after model replacement'], crowd, screenshots: output }, null, 2));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: `${output}models-${engine}-failure.png` }); throw error; }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
