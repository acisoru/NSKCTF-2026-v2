import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, '../dist');
const port = Number(process.env.PORT || 34090);
const flag = process.env.FLAG || 'nskctf{the_archive_keeps_its_own_receipts}';
const accessKey = process.env.ACCESS_KEY || randomBytes(6).toString('hex');
const reviewerCookie = randomBytes(24).toString('hex');
const plates = new Map();
const sessions = new Map();
const queue = [];
let browser;
let reviewing = false;

const ledger = [
  { id: 'C-01', title: 'Контрольный оттиск', date: '13.10.2019', summary: 'Старый штамп переносит на служебную страницу атрибут допуска.' },
  { id: 'C-02', title: 'Изоляция ресурсов', date: '14.10.2019', summary: 'Скрипты и внешние адреса закрыты. Локальные диагностические пиксели работают.' },
  { id: 'C-03', title: 'Возобновление журнала', date: '15.10.2019', summary: 'Запись ALICE от 13 октября открывает новую последовательность после 559 суток.' }
];

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function json(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function getCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : '';
}

function session(req, res) {
  let sid = getCookie(req, 'archive_sid');
  if (!sessions.has(sid)) {
    sid = randomBytes(20).toString('hex');
    sessions.set(sid, { created: Date.now(), plates: 0 });
    res.setHeader('Set-Cookie', `archive_sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
  }
  return sid;
}

async function parseJson(req, limit = 90_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error('body too large');
  }
  return JSON.parse(raw || '{}');
}

function ownedPlate(req, res, id) {
  const plate = plates.get(id);
  const sid = session(req, res);
  if (!plate || plate.owner !== sid) {
    json(res, 404, { error: 'Оттиск не найден' });
    return null;
  }
  return plate;
}

function sameSecret(candidate) {
  const left = Buffer.from(String(candidate));
  const right = Buffer.from(accessKey);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function reviewPlate(plate) {
  if (!browser) {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  }
  const origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.addCookies([{ name: 'reviewer', value: reviewerCookie, url: origin, httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    await page.goto(`${origin}/review/${plate.id}`, { waitUntil: 'networkidle', timeout: 12_000 });
    await page.waitForTimeout(700);
  } finally {
    await context.close();
  }
}

async function runQueue() {
  if (reviewing) return;
  reviewing = true;
  try {
    while (queue.length) {
      const plate = queue.shift();
      plate.status = 'reviewing';
      try {
        await reviewPlate(plate);
        plate.status = 'complete';
      } catch (error) {
        plate.status = 'error';
        plate.error = 'Пост проверки не ответил. Отправьте оттиск повторно.';
        console.error('ошибка проверки', plate.id, error.message);
      }
    }
  } finally {
    reviewing = false;
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2'
};

async function staticFile(res, pathname) {
  let file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const resolved = path.resolve(distDir, file);
  if (!resolved.startsWith(`${distDir}${path.sep}`) && resolved !== path.join(distDir, 'index.html')) {
    json(res, 404, { error: 'Не найдено' });
    return;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error('не файл');
    send(res, 200, await readFile(resolved), { 'Content-Type': mime[path.extname(resolved)] || 'application/octet-stream' });
  } catch {
    json(res, 404, { error: 'Не найдено' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const pathname = url.pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/ledger') {
      session(req, res);
      return json(res, 200, { entries: ledger });
    }

    if (req.method === 'POST' && pathname === '/api/plates') {
      const sid = session(req, res);
      const account = sessions.get(sid);
      if (account.plates >= 80) return json(res, 429, { error: 'Слишком много оттисков за один сеанс' });
      const data = await parseJson(req);
      if (typeof data.css !== 'string' || !data.css.trim() || data.css.length > 16_000) {
        return json(res, 400, { error: 'CSS для калибровки должен содержать от 1 до 16000 символов' });
      }
      const id = randomUUID();
      const plate = { id, owner: sid, css: data.css, status: 'draft', hits: [], created: Date.now(), error: '' };
      plates.set(id, plate);
      account.plates++;
      return json(res, 201, { id, status: plate.status });
    }

    const plateMatch = pathname.match(/^\/api\/plates\/([0-9a-f-]{36})(?:\/(review|telemetry|style\.css))?$/);
    if (plateMatch) {
      const [, id, action] = plateMatch;
      if (action === 'style.css' && req.method === 'GET') {
        const plate = plates.get(id);
        return plate
          ? send(res, 200, plate.css, { 'Content-Type': 'text/css; charset=utf-8' })
          : json(res, 404, { error: 'Оттиск не найден' });
      }
      const plate = ownedPlate(req, res, id);
      if (!plate) return;
      if (!action && req.method === 'GET') return json(res, 200, { id, status: plate.status, error: plate.error });
      if (action === 'telemetry' && req.method === 'GET') return json(res, 200, { hits: plate.hits });
      if (action === 'review' && req.method === 'POST') {
        if (plate.status === 'queued' || plate.status === 'reviewing') return json(res, 409, { error: 'Оттиск уже в очереди' });
        plate.status = 'queued';
        plate.hits = [];
        plate.error = '';
        queue.push(plate);
        setImmediate(runQueue);
        return json(res, 202, { id, status: 'queued' });
      }
    }

    if (req.method === 'GET' && pathname === '/api/telemetry') {
      const referrer = req.headers.referer || '';
      const referrerPlate = referrer.match(/\/(?:api\/plates\/|review\/)([0-9a-f-]{36})(?:\/style\.css)?(?:$|[?#])/);
      const plate = getCookie(req, 'reviewer') === reviewerCookie && referrerPlate
        ? plates.get(referrerPlate[1])
        : null;
      const probe = url.searchParams.get('probe') || '';
      if (plate && probe.length <= 80 && plate.hits.length < 1000) plate.hits.push({ probe, at: Date.now() });
      return send(res, 204, '', { 'Content-Type': 'image/gif' });
    }

    if (req.method === 'GET' && pathname === '/api/archive') {
      session(req, res);
      if (!sameSecret(url.searchParams.get('key') || '')) return json(res, 403, { error: 'Ключ доступа отклонён' });
      return json(res, 200, { flag, clue: 'Поле оператора в первой записи журнала ALICE от 13.10.2019 не пустое: оно затёрто.' });
    }

    const reviewMatch = pathname.match(/^\/review\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && reviewMatch) {
      const plate = plates.get(reviewMatch[1]);
      if (!plate || getCookie(req, 'reviewer') !== reviewerCookie) return json(res, 404, { error: 'Не найдено' });
      const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Пост проверки ${escapeHtml(plate.id)}</title><link rel="stylesheet" href="/api/plates/${plate.id}/style.css"></head><body data-access-key="${escapeHtml(accessKey)}"><main class="proof-sheet"><h1>КОНТРОЛЬНЫЙ ОТТИСК · ${escapeHtml(plate.id.slice(0, 8))}</h1><p>Калибровка штампа доступа.</p></main></body></html>`;
      return send(res, 200, html, {
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'"
      });
    }

    if (req.method === 'GET' && !pathname.startsWith('/api/')) return staticFile(res, pathname);
    json(res, 404, { error: 'Не найдено' });
  } catch (error) {
    if (error instanceof SyntaxError || error.message === 'body too large') return json(res, 400, { error: 'Некорректное тело запроса' });
    console.error('ошибка запроса', error);
    json(res, 500, { error: 'Внутренняя ошибка' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Архив наблюдений слушает порт ${port}`));

process.on('SIGTERM', async () => {
  await browser?.close();
  server.close();
});
