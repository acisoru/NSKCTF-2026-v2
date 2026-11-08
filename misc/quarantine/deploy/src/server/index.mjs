import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Game } from './game.mjs';
import { YandexAuth } from './auth.mjs';
import { StateEncoder } from '../shared/replica.mjs';
import { WorldStream } from './world-stream.mjs';
import { Moderation } from './moderation.mjs';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

export async function createApp({ flag, maxPlayers = 300, dataDir, testAuth = false, oauth = {}, adminIds = [] } = {}) {
  if (testAuth && process.env.NODE_ENV === 'production') throw new Error('Test authentication is forbidden in production');
  if (!flag) {
    if (process.env.NODE_ENV === 'production') throw new Error('FLAG must be configured in production');
    flag = `nskctf{local_preview_${randomBytes(12).toString('hex')}}`;
  }
  let saved = [];
  if (dataDir) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    try { saved = JSON.parse(await readFile(join(dataDir, 'players.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot load saved players: ${error.message}`); }
    if (!Array.isArray(saved)) throw new Error('Invalid player storage');
  }
  const moderation = new Moderation({ adminIds, dataDir }); await moderation.load();
  const game = new Game({ flag, maxPlayers, saved, isAdmin: id => moderation.isAdmin(id), isBanned: id => !!moderation.ban(id) });
  let pendingSave = Promise.resolve();
  const save = () => {
    if (!dataDir) return Promise.resolve();
    const data = JSON.stringify(game.records());
    pendingSave = pendingSave.catch(() => {}).then(async () => {
      await writeFile(join(dataDir, 'players.tmp'), data, { mode: 0o600 });
      await rename(join(dataDir, 'players.tmp'), join(dataDir, 'players.json'));
    });
    return pendingSave;
  };
  const auth = new YandexAuth({ ...oauth, dataDir, isBlocked: id => !!moderation.ban(id), onIdentity: async providerId => { game.account(providerId); await save(); } });
  await auth.load();
  const metrics = { ticks: [], broadcasts: [], bytes: 0, droppedSnapshots: 0, rejectedMessages: 0 };
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const sample = (list, value) => { list.push(value); if (list.length > 3000) list.shift(); };
  const files = new Map();
  for (const [path, file, type] of [['/', 'index.html', 'text/html; charset=utf-8'], ['/game.js', 'game.js', 'text/javascript; charset=utf-8'], ['/style.css', 'style.css', 'text/css; charset=utf-8'], ['/favicon.svg', 'favicon.svg', 'image/svg+xml']]) {
    files.set(path, { data: await readFile(new URL(`../dist/${file}`, import.meta.url)), type });
  }
  const headers = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
  const httpHandler = async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { res.writeHead(400, headers).end('Bad request'); return; }
    if (url.pathname.startsWith('/api/admin/')) {
      const reply = (status, data) => res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
      const session = auth.authenticate(req);
      if (!session || !moderation.isAdmin(session.providerId)) { reply(403, { error: 'Нет прав администратора' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/admin/players') {
        const search = (url.searchParams.get('q') ?? '').slice(0, 64).toLowerCase(), filter = url.searchParams.get('filter');
        const page = Math.max(0, Math.min(1000, Number.parseInt(url.searchParams.get('page'), 10) || 0));
        const records = [...game.sessions.values()].filter(p => p.registered);
        const online = p => p.connected && p.entered;
        const found = records.filter(p => (p.name.toLowerCase().includes(search) || p.id.includes(search)) && (filter !== 'online' || online(p)) && (filter !== 'banned' || moderation.ban(p.providerId)));
        found.sort((a, b) => Number(online(b)) - Number(online(a)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        reply(200, { total: found.length, page, online: game.players().length, players: found.slice(page * 50, (page + 1) * 50).map(p => ({ id: p.id, name: p.name, level: p.level, hp: p.hp, maxHp: p.maxHp, x: p.x, y: p.y, z: p.z, online: online(p), admin: moderation.isAdmin(p.providerId), canBan: !!p.providerId && !moderation.isAdmin(p.providerId), ban: moderation.ban(p.providerId) ? { until: moderation.ban(p.providerId).until, reason: moderation.ban(p.providerId).reason } : null })), locations: game.players().map(p => ({ id: p.id, x: p.x, z: p.z, admin: game.adminActive(p) })) }); return;
      }
      if (req.method !== 'POST' || url.pathname !== '/api/admin/moderate') { reply(405, { error: 'method' }); return; }
      if (req.headers.origin !== auth.origin || req.headers['content-type']?.split(';')[0] !== 'application/json') { reply(403, { error: 'origin' }); return; }
      let body = '', length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 2048) { reply(413, { error: 'Request too large' }); return; } body += chunk; }
      let command; try { command = JSON.parse(body); } catch { reply(400, { error: 'Invalid JSON' }); return; }
      if (!command || typeof command !== 'object' || Array.isArray(command)) { reply(400, { error: 'Invalid command' }); return; }
      if (!auth.validSession(session.key)) { reply(403, { error: 'Session expired' }); return; }
      const target = [...game.sessions.values()].find(p => p.id === command.playerId);
      try { await moderation.change(session.providerId, target, command); }
      catch (error) { reply(400, { error: error.message }); return; }
      if (command.action === 'ban') {
        for (const ws of wss.clients) if (ws.identity?.providerId === target.providerId) ws.close(4004, 'Account banned');
        game.disconnect(target); game.leaveParty(target); game.removeActorBodies(target); target.entered = false;
        game.projectiles = game.projectiles.filter(shot => shot.source !== target);
        await auth.revokeProvider(target.providerId);
      }
      reply(200, { ok: true }); return;
    }
    if (testAuth && url.pathname === '/api/session') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify({ authenticated: true, configured: true, requiresAuth: false })); return; }
    if (url.pathname === '/auth/migrate') {
      const session = auth.authenticate(req);
      if (req.method !== 'POST' || req.headers.origin !== auth.origin || !session) { res.writeHead(403, headers).end(); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 512) { res.writeHead(413, headers).end(); return; } }
      let token; try { token = JSON.parse(body).token; } catch { res.writeHead(400, headers).end(); return; }
      const migrated = typeof token === 'string' && game.migrate(session.providerId, token);
      if (migrated) await save();
      res.writeHead(migrated ? 200 : 409, { ...headers, 'Content-Type': 'application/json' }).end(JSON.stringify({ migrated })); return;
    }
    if (await auth.route(req, res, url, headers)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers).end(); return; }
    if (url.pathname === '/healthz') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end('{"ok":true}'); return; }
    const file = files.get(url.pathname);
    if (!file) { res.writeHead(404, headers).end('Not found'); return; }
    res.writeHead(200, { ...headers, 'Content-Type': file.type }); res.end(req.method === 'HEAD' ? undefined : file.data);
  };
  const server = createServer((req, res) => { httpHandler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500, headers); res.end('Request failed'); }); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const ipBuckets = new Map();
  const sockets = new Map();
  const worldStream = new WorldStream(); let broadcasting = false;
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    let validOrigin = false;
    try { validOrigin = testAuth ? !req.headers.origin || new URL(req.headers.origin).host === req.headers.host : req.headers.origin === auth.origin; } catch {}
    const identity = testAuth ? null : auth.authenticate(req);
    if (!testAuth && !identity) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    const address = req.headers['x-real-ip'] || req.socket.remoteAddress;
    const now = Date.now();
    let bucket = ipBuckets.get(address);
    if (!bucket || now - bucket.time > 60000) { bucket = { time: now, count: 0 }; ipBuckets.set(address, bucket); }
    if (req.url !== '/ws' || !validOrigin || ++bucket.count > 900 || wss.clients.size >= maxPlayers + 64) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, identity));
  });
  wss.on('connection', (ws, identity) => {
    let player;
    let encoder;
    ws.identity = identity;
    let budget = 0;
    let window = Date.now();
    let actionWindow = Date.now();
    let actionBudget = 0;
    const authTimeout = setTimeout(() => ws.close(1008, 'Hello required'), 5000);
    ws.isAlive = true;
    ws.on('error', () => {});
    ws.on('pong', () => { ws.isAlive = true; });
    const send = data => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1008, 'Slow client'); return; }
      if (data.type === 'state' && ws.bufferedAmount > 256 * 1024) { metrics.droppedSnapshots++; return; }
      if (!testAuth && data.type === 'hello') data = { type: 'hello', id: data.id };
      const payload = data.type === 'state' && encoder ? encoder.encode(data) : JSON.stringify(data);
      metrics.bytes += Buffer.byteLength(payload); ws.send(payload);
    };
    ws.on('message', (buffer, binary) => {
      if (identity && !auth.validSession(identity.key)) { ws.close(4003, 'Session expired'); return; }
      if (binary) { ws.close(1008, 'JSON required'); return; }
      const now = Date.now();
      if (now - window > 1000) { window = now; budget = 0; }
      if (++budget > 75) { ws.close(1008, 'Rate limit'); return; }
      let m;
      try { m = JSON.parse(buffer.toString()); } catch { send({ type: 'error', message: 'Некорректное сообщение' }); return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      try {
        if (!player) {
          if (m.type !== 'hello') return;
          encoder = m.delta === true ? new StateEncoder() : null;
          player = game.connect(testAuth ? m.token : game.account(identity.providerId).token, send);
          if (m.world === true) {
            let cell = null, full = true;
            player.sendWorld = (key, packets, personal) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              if (ws.bufferedAmount > 256 * 1024) { metrics.droppedSnapshots++; full = true; return; }
              const world = packets.packet(full || cell !== key, m.compression === true);
              metrics.bytes += typeof world === 'string' ? Buffer.byteLength(world) : world.length;
              ws.send(world); send(personal); cell = key; full = false;
            };
          } else player.sendWorld = null;
          const previous = sockets.get(player.id);
          sockets.set(player.id, ws);
          previous?.close(4001, 'Session opened elsewhere');
          clearTimeout(authTimeout);
          return;
        }
        if (sockets.get(player.id) !== ws) return;
        if (m.type === 'ping') { if (Number.isSafeInteger(m.seq)) send({ type: 'pong', seq: m.seq }); return; }
        if (!testAuth && m.type === 'input' && (!Number.isSafeInteger(m.seq) || m.seq < 0)) { metrics.rejectedMessages++; return; }
        if (m.type !== 'input') {
          if (now - actionWindow >= 5000) { actionWindow = now; actionBudget = 0; }
          if (++actionBudget > 20) { send({ type: 'error', message: 'Слишком много действий. Подождите несколько секунд.' }); return; }
        }
        const result = game.handle(player, m);
        if (result?.recreated) save().then(() => send({ type: 'character-recreated', revision: result.revision, role: result.role })).catch(error => {
          console.error('Character save failed:', error.message); send({ type: 'error', message: 'Персонаж изменён, но сохранение недоступно. Не закрывайте игру; сервер повторит запись.' });
        });
      } catch (error) { send({ type: 'error', message: error.message }); }
    });
    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (player && sockets.get(player.id) === ws) { sockets.delete(player.id); game.disconnect(player); }
    });
  });
  const simulation = setInterval(() => { const t = performance.now(); game.tick(); sample(metrics.ticks, performance.now() - t); }, 1000 / 30);
  const snapshots = setInterval(async () => {
    if (broadcasting) return;
    broadcasting = true; const t = performance.now();
    try { await game.broadcastWorld(worldStream); } finally { sample(metrics.broadcasts, performance.now() - t); broadcasting = false; }
  }, 100);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.identity && !auth.validSession(ws.identity.key)) { ws.close(4003, 'Session expired'); continue; }
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
    game.cleanup();
    auth.prune();
    for (const [ip, bucket] of ipBuckets) if (Date.now() - bucket.time > 60000) ipBuckets.delete(ip);
  }, 15000);
  const persistence = setInterval(() => save().catch(error => console.error('Save failed:', error.message)), 10000);
  return { server, game, auth, moderation, metrics, lag, save, close: async () => {
    clearInterval(simulation); clearInterval(snapshots); clearInterval(heartbeat); clearInterval(persistence);
    lag.disable(); await moderation.pending.catch(() => {}); await save(); await auth.persist();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp({ flag: process.env.FLAG, maxPlayers: Number(process.env.MAX_PLAYERS) || 300, dataDir: process.env.DATA_DIR || './data', adminIds: (process.env.ADMIN_YANDEX_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean), oauth: { clientId: process.env.YANDEX_CLIENT_ID, clientSecret: process.env.YANDEX_CLIENT_SECRET, publicOrigin: process.env.PUBLIC_ORIGIN || 'http://localhost:3387' } });
  const port = Number(process.env.PORT) || 3387;
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Quarantine: http://${process.env.HOST || '127.0.0.1'}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
