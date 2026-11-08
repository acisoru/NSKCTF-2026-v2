import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newProfile, publicLab, snapshotForChecker, newLab, physicalChecks, COMPLETION_VERSION } from './lab.mjs';
import { LEVELS } from '../shared/catalog.mjs';
import { advanceIncident, publicIncident, worldCommand } from './incidents.mjs';
import { context, publicContext, resetContext, updatePose, setContext, guardedAction, guardedCommand, gesture } from './interactions.mjs';
import { YandexAuth, hash } from './auth.mjs';
import { AntiCheat, forgedStateFields, publicBan } from './anticheat.mjs';
import { startAntiCheatControl } from './anticheat-control.mjs';

const LEASE_MS = 2500;
export async function createApp({ dataDir, origin = 'http://localhost:3388', checkerUrls = ['http://network_checker:9134'], checkerToken = '', flags = {}, fetchImpl = fetch, maxProfiles = 1000, clock = Date.now, oauth = {}, trustProxy = false, banSeconds = 86400 } = {}) {
  const profiles = new Map(), legacyProfiles = new Map(), claimedLegacy = new Map(), writes = new Map(), dirty = new Set(), jobs = new Map(), queue = [], limits = new Map(), executions = new Map(), runtimes = new Map(); let stopping = false;
  if (dataDir) {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    for (const f of await readdir(dataDir)) if (/^[a-f0-9]{64}\.json$/.test(f)) {
      const p = JSON.parse(await readFile(join(dataDir, f), 'utf8')), key = f.slice(0, -5);
      if (!p.labs || !LEVELS.every(l => p.labs[l]?.level === l)) throw new Error('Invalid saved lab');
      for (const lab of Object.values(p.labs)) { lab.panel = [...['wo','o','wg','b','wb','g','wbr','br']]; lab.panelTested = true; lab.toner = null; if (lab.won && lab.completionVersion !== COMPLETION_VERSION) { lab.won = false; lab.lastReport = null; } }
      if (/^yandex:[A-Za-z0-9_-]{1,128}$/.test(p.identity ?? '') && key === hash(p.identity)) { profiles.set(key, p); dirty.add(key); if (p.legacySource) claimedLegacy.set(p.legacySource, key); }
      else legacyProfiles.set(key, p);
    }
  }
  const save = key => {
    if (!dataDir || !profiles.has(key)) return Promise.resolve();
    const value = JSON.stringify(profiles.get(key)); dirty.delete(key);
    const pending = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => { await writeFile(join(dataDir, `${key}.tmp`), value, { mode: 0o600 }); await rename(join(dataDir, `${key}.tmp`), join(dataDir, `${key}.json`)); }).catch(error => {
      dirty.add(key); console.error('Lab save failed; retry scheduled'); throw error;
    });
    writes.set(key, pending); return pending;
  };
  const runtime = key => {
    if (!runtimes.has(key)) runtimes.set(key, { active: false, controller: null, seen: clock(), lastTick: clock(), poseAt: clock(), budget: 0, generation: 0, context: context(), correction: null, motionGraceUntil: clock() + 3000, issuedTokens: [] });
    return runtimes.get(key);
  };
  const pause = key => { const r = runtime(key); if (r.active) { r.active = false; resetContext(r); const p = profiles.get(key); if (p) p.labs[p.current].console = null; } };
  const antiCheat = new AntiCheat({ profiles, save, now: clock, banSeconds, onBan: key => {
    pause(key);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].owner === key) { const [job] = queue.splice(i, 1); job.status = 'error'; job.error = 'Аккаунт заблокирован'; job.stale = true; job.finished = clock(); delete job.snapshot; }
    for (const job of jobs.values()) if (job.owner === key) job.stale = true;
  } });
  const advance = (key, now = clock()) => {
    const r = runtime(key), profile = profiles.get(key);
    if (antiCheat.ban(key)) pause(key);
    if (!r.active || !profile) { r.lastTick = now; return; }
    let seconds = Math.max(0, (Math.min(now, r.seen + LEASE_MS) - r.lastTick) / 1000);
    while (seconds > .000001) { const dt = Math.min(.1, seconds); advanceIncident(profile.labs[profile.current], dt); seconds -= dt; }
    r.lastTick = now; dirty.add(key); if (now >= r.seen + LEASE_MS) pause(key);
  };
  const tickWorld = () => { for (const [key, r] of runtimes) if (r.active) advance(key); };
  const auth = new YandexAuth({ origin, dataDir, clientId: oauth.clientId, clientSecret: oauth.clientSecret, fetchImpl: oauth.fetchImpl, now: clock, trustProxy, getBan: identity => publicBan(antiCheat.ban(hash(identity))),
    onIdentity: async (identity, legacy) => {
      const key = hash(identity);
      if (!profiles.has(key)) {
        if (profiles.size >= maxProfiles) throw new Error('Account capacity reached');
        const previous = legacy && !claimedLegacy.has(legacy) ? legacyProfiles.get(legacy) : null;
        const profile = previous ? structuredClone(previous) : newProfile(); profile.identity = identity;
        if (previous) { profile.legacySource = legacy; claimedLegacy.set(legacy, key); }
        profiles.set(key, profile);
      }
      await save(key);
    }, onLogout: identity => { const key = hash(identity); advance(key); pause(key); },
  }); origin = auth.origin; await auth.load();
  const workers = checkerUrls.map(url => ({ url, busy: false }));
  const required = level => ['topology', 'power', 'crafted', 'wiremap', 'panel', 'pc-address', 'dns', 'http', ...(level === 'easy' ? [] : ['camera-dhcp', 'camera-http', 'camera-ssh-denied', 'admin-ssh']), ...(level === 'hard' ? ['rstp', 'ospf', 'failover', 'cold-boot'] : [])];
  const run = async worker => {
    if (worker.busy || !queue.length || stopping) return;
    const job = queue.shift(); worker.busy = true; job.status = 'running'; job.started = clock();
    try {
      const response = await fetchImpl(`${worker.url.replace(/\/$/, '')}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${checkerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: job.id, ...job.snapshot }), signal: AbortSignal.timeout(150000) });
      if (!response.ok) throw new Error('Сетевой стенд недоступен. Повторите проверку позже.');
      const report = await response.json();
      if (report.nonce !== job.id || !Array.isArray(report.checks) || report.checks.length > 32) throw new Error('Некорректный ответ стенда');
      job.report = { checks: report.checks, output: String(report.output ?? '').slice(0, 16000), seconds: (clock() - job.started) / 1000 };
      advance(job.owner); const profile = profiles.get(job.owner), lab = profile?.labs[job.level], r = runtime(job.owner);
      job.stale = !!job.stale || !lab || lab.revision !== job.revision || profile.current !== job.level || r.generation !== job.generation || !r.active || !!antiCheat.ban(job.owner);
      if (lab && !job.stale && !job.diagnostic) {
        const passed = job.snapshot.physical.every(check => check.ok) && physicalChecks(lab).every(check => check.ok) && required(job.level).every(id => report.checks.some(c => c.id === id && c.ok === true));
        if (passed) { lab.won = true; lab.completionVersion = COMPLETION_VERSION; }
        lab.lastReport = job.report; dirty.add(job.owner); await save(job.owner);
      }
      job.status = 'done';
    } catch (error) { job.status = 'error'; job.error = error.name === 'TimeoutError' ? 'Стенд превысил время проверки. Флаг не выдан.' : error.message; }
    finally { delete job.snapshot; job.finished = clock(); worker.busy = false; run(worker); }
  };
  const enqueue = (key, lab, diagnostic = null) => {
    if (antiCheat.ban(key)) throw new Error('Аккаунт заблокирован');
    if (!checkerToken || !workers.length) throw new Error('Проверяющий сервер не настроен');
    if (!diagnostic) { const failed = physicalChecks(lab).filter(c => !c.ok); if (failed.length) throw new Error(`Наряд не готов: ${failed.map(c => c.name).join(', ')}`); }
    if ([...jobs.values()].some(j => j.owner === key && ['queued', 'running'].includes(j.status))) throw new Error('У вас уже есть проверка в очереди');
    if (queue.length >= 100) throw new Error('Очередь заполнена. Повторите позже.');
    const profile = profiles.get(key), now = clock();
    if (!profile.checkQuota || now - profile.checkQuota.since >= 60000) profile.checkQuota = { since: now, count: 0 };
    if (profile.checkQuota.count >= 20) throw new Error('Лимит аккаунта: 20 проверок в минуту');
    profile.checkQuota.count++; dirty.add(key);
    const job = { id: randomBytes(24).toString('hex'), owner: key, level: lab.level, revision: lab.revision, generation: runtime(key).generation, diagnostic: !!diagnostic, snapshot: snapshotForChecker(lab, diagnostic), status: 'queued', created: now };
    jobs.set(job.id, job); queue.push(job); for (const worker of workers) run(worker); return job.id;
  };
  const assets = new Map();
  for (const [path, name, type] of [['/', 'index.html', 'text/html'], ['/lab.js', 'lab.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']]) assets.set(path, { data: await readFile(new URL(`../dist/${name}`, import.meta.url)), type });
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
  const handler = async (req, res) => {
    const send = (status, body) => res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') { send(200, { ok: true }); return; }
    if (req.method === 'GET' && assets.has(url.pathname)) { const file = assets.get(url.pathname); res.writeHead(200, { ...headers, 'Content-Type': `${file.type}; charset=utf-8` }).end(file.data); return; }
    if (await auth.route(req, res, url, headers)) return;
    if (!url.pathname.startsWith('/api/')) { send(404, { error: 'Not found' }); return; }
    if (req.method !== 'GET' && (req.method !== 'POST' || req.headers.origin !== origin)) { send(403, { error: 'Origin rejected' }); return; }
    const session = auth.authenticate(req), key = session && hash(session.providerId), profile = profiles.get(key);
    if (!session || !profile) { send(401, { error: 'Войдите через Яндекс' }); return; }
    const denyBanned = () => { const ban = antiCheat.ban(key); if (!ban) return false; send(403, { error: 'Аккаунт заблокирован античитом', code: 'ACCOUNT_BANNED', ban: publicBan(ban) }); return true; };
    if (denyBanned()) return;
    const now = clock(); let limit = limits.get(key);
    if (!limit || now - limit.at >= 1000) { limit = { at: now, count: 0 }; limits.set(key, limit); }
    if (++limit.count > 45) { await antiCheat.detect(key, 'rate_limit', { path: url.pathname }); send(429, { error: 'Слишком много действий аккаунта' }); return; }
    advance(key); const r = runtime(key);
    const state = () => {
      const lab = profile.labs[profile.current], { elapsed, nextRat, ...visibleIncident } = publicIncident(lab);
      return { shift: key.slice(0, 6).toUpperCase(), current: profile.current, progress: LEVELS.map(level => ({ level, won: profile.labs[level].won })), paused: !r.active, interaction: publicContext(r.context), lab: { ...publicLab(lab, r.context), incident: visibleIncident }, reward: lab.won && lab.completionVersion === COMPLETION_VERSION ? flags[profile.current] ?? null : null };
    };
    if (req.method === 'GET' && url.pathname === '/api/state') { send(200, state()); return; }
    if (req.method === 'GET' && url.pathname === '/api/job') {
      const job = jobs.get(url.searchParams.get('id')); if (!job || job.owner !== key) { send(404, { error: 'Проверка не найдена' }); return; }
      const completed = job.status === 'done', stale = job.stale || r.generation !== job.generation;
      send(200, { id: job.id, level: job.level, status: job.status, position: job.status === 'queued' ? queue.indexOf(job) + 1 : 0, report: stale ? undefined : job.report, error: job.error, stale, state: completed ? state() : undefined, reward: !stale && !job.diagnostic && profile.labs[job.level].won && profile.labs[job.level].completionVersion === COMPLETION_VERSION ? flags[job.level] : undefined }); return;
    }
    if (req.method !== 'POST') { send(405, { error: 'method' }); return; }
    const initialLevel = profile.current, initialGeneration = r.generation;
    let body = '', bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) { send(413, { error: 'Слишком большой запрос' }); return; } body += chunk; }
    let data; try { data = JSON.parse(body || '{}'); } catch { send(400, { error: 'Некорректный JSON' }); return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { send(400, { error: 'Некорректный запрос' }); return; }
    if (auth.authenticate(req)?.key !== session.key) { send(401, { error: 'Сессия завершена' }); return; }
    if (denyBanned()) return;
    const completedAt = clock(); let execution = executions.get(key);
    if (!execution || completedAt - execution.at >= 1000) { execution = { at: completedAt, count: 0 }; executions.set(key, execution); }
    if (++execution.count > 45) { await antiCheat.detect(key, 'rate_limit', { path: url.pathname }); send(429, { error: 'Слишком много завершённых действий аккаунта' }); return; }
    advance(key);
    if (data.level !== profile.current || initialLevel !== profile.current || initialGeneration !== r.generation) { send(409, { error: 'Состояние изменилось. Повторите действие.', state: state() }); return; }
    try {
      if (url.pathname === '/api/resume') {
        if (r.active && r.controller !== session.key) throw new Error('Аккаунт уже открыт в другой игровой сессии');
        resetContext(r); r.active = true; r.controller = session.key; r.seen = r.lastTick = r.poseAt = clock(); r.budget = .2; r.correction = null; profile.labs[profile.current].console = null;
        send(200, { state: state() }); return;
      }
      if (!r.active || r.controller !== session.key) { send(409, { error: 'Игра приостановлена. Возобновите смену.', state: state() }); return; }
      r.seen = clock();
      if (url.pathname === '/api/pause') { pause(key); send(200, { state: state() }); return; }
      if (url.pathname === '/api/switch') {
        if (!LEVELS.includes(data.target)) throw new Error('Нет такого наряда');
        profile.labs[profile.current].console = null; profile.current = data.target; resetContext(r); r.budget = .2; r.poseAt = clock(); r.correction = null; dirty.add(key); send(200, { state: state() }); return;
      }
      const lab = profile.labs[profile.current];
      const checkedRoute = ['/api/world', '/api/context', '/api/check', '/api/action', '/api/command', '/api/gesture'].includes(url.pathname);
      const currentRevision = !['/api/action', '/api/command', '/api/gesture'].includes(url.pathname) || data.revision === lab.revision;
      const fields = checkedRoute && currentRevision ? forgedStateFields(data) : [];
      if (fields.length) {
        const detection = await antiCheat.detect(key, 'state_forgery', { path: url.pathname, fields });
        if (!denyBanned()) send(400, { error: 'Серверные поля нельзя изменять', code: 'INVALID_SERVER_FIELDS', securityWarning: detection.warning }); return;
      }
      if (url.pathname === '/api/world') {
        const acknowledged = !!r.correction && data.correction === r.correction;
        if (r.correction && !acknowledged) { send(200, { level: lab.level, incident: state().lab.incident, corrected: true, correction: r.correction }); return; }
        const accepted = updatePose(lab, r, data.pose, clock());
        if (!accepted) {
          const m = r.lastMove, definite = acknowledged && clock() >= r.motionGraceUntil && m?.reason === 'budget' && m.intervalMs <= 1000 && m.distance > Math.max(3, m.intervalMs * .014) && m.distance > m.budget + 1.5;
          r.correction = randomBytes(16).toString('hex');
          const detection = await antiCheat.detect(key, definite ? 'impossible_movement' : 'movement_rejected', { path: url.pathname, ...m });
          if (!denyBanned()) send(200, { level: lab.level, incident: state().lab.incident, corrected: true, correction: r.correction, securityWarning: detection.warning }); return;
        }
        r.correction = null;
        if (data.command && r.context.mode !== 'world') throw new Error('Вернитесь в лабораторию');
        if (['shoot', 'reload'].includes(data.command) && r.context.tool !== 'shotgun') throw new Error('Возьмите дробовик в руки');
        const result = data.command ? worldCommand(lab, data.command, data.direction) : null; dirty.add(key);
        send(200, { level: lab.level, incident: state().lab.incident, corrected: !accepted, paused: !r.active, result, state: data.revision !== lab.revision ? state() : undefined }); return;
      }
      if (url.pathname === '/api/context') { setContext(lab, r, data); send(200, { state: state() }); return; }
      if (url.pathname === '/api/check') { const job = enqueue(key, lab); send(202, { job }); return; }
      if (url.pathname === '/api/reset') {
        if (data.confirm !== profile.current) throw new Error('Подтвердите сброс наряда');
        profile.labs[profile.current] = newLab(profile.current, lab.subnet); profile.labs[profile.current].revision = lab.revision + 1; resetContext(r); r.budget = .2; r.poseAt = clock(); r.correction = null; dirty.add(key); await save(key); send(200, { state: state() }); return;
      }
      if (!['/api/action', '/api/command', '/api/gesture'].includes(url.pathname)) { send(404, { error: 'Not found' }); return; }
      if (data.revision !== lab.revision) { send(409, { error: 'Состояние изменилось. Повторите действие.', state: state() }); return; }
      if (url.pathname === '/api/gesture') {
        const g = r.context.gesture, tokenHash = typeof data.token === 'string' && /^[a-f0-9]{32}$/.test(data.token) ? hash(data.token) : null;
        r.issuedTokens = r.issuedTokens.filter(t => clock() - t.at < 300000);
        const currentGesture = g && g.revision === lab.revision && g.tool === r.context.tool && g.end === r.context.end && g.draft === (lab.draft?.id ?? null) && clock() - g.started <= 15000;
        if (['sample', 'end'].includes(data.phase) && currentGesture && tokenHash && data.token !== g.token && !r.issuedTokens.some(t => t.hash === tokenHash) && clock() >= r.motionGraceUntil) {
          const detection = await antiCheat.detect(key, 'unknown_gesture_token', { path: url.pathname, phase: data.phase, tokenHash: tokenHash.slice(0, 12) }); r.context.gesture = null;
          if (!denyBanned()) send(400, { error: 'Неизвестный токен инструмента', securityWarning: detection.warning, state: state() }); return;
        }
        const result = gesture(lab, r, data, clock());
        if (result.token) r.issuedTokens = [...r.issuedTokens, { hash: hash(result.token), at: clock() }].slice(-128);
        dirty.add(key); send(200, { ...result, state: data.phase === 'end' || data.phase === 'cancel' ? state() : undefined }); return;
      }
      if (url.pathname === '/api/action' && ['cut', 'strip', 'wire', 'trim', 'insert', 'crimp', 'recut', 'punch'].includes(data.action?.type)) await antiCheat.detect(key, 'legacy_action', { path: url.pathname, kind: data.action.type });
      if (denyBanned()) return;
      const result = url.pathname === '/api/action' ? guardedAction(lab, r, data.action) : guardedCommand(lab, r, data.line); dirty.add(key);
      if (result?.diagnostic) { const job = enqueue(key, lab, result.diagnostic); send(202, { job, state: state() }); return; }
      send(200, { result, state: state() });
    } catch (error) { if (denyBanned()) return; if (url.pathname === '/api/gesture') r.context.gesture = null; send(400, { error: error.message, state: state() }); }
  };
  const server = createServer((req, res) => handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500, headers); res.end('Request failed'); }));
  const control = await startAntiCheatControl(dataDir, antiCheat);
  const simulation = setInterval(tickWorld, 100);
  const persistence = setInterval(() => { auth.prune(); for (const key of [...dirty]) save(key).catch(() => {}); for (const [id, job] of jobs) if (job.finished && clock() - job.finished > 3600000) jobs.delete(id); }, 5000);
  return { server, profiles, legacyProfiles, jobs, auth, antiCheat, control, runtimes, runtime, tickWorld, setOrigin: value => { auth.setOrigin(value); origin = auth.origin; }, close: async () => { stopping = true; clearInterval(persistence); clearInterval(simulation); await control.close(); for (const key of profiles.keys()) await save(key); await auth.persist(); await Promise.all(writes.values()); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = process.env.CHECKER_TOKEN || (process.env.CHECKER_TOKEN_FILE ? (await readFile(process.env.CHECKER_TOKEN_FILE, 'utf8')).trim() : '');
  const flags = Object.fromEntries(LEVELS.map(level => [level, process.env[`FLAG_${level.toUpperCase()}`] || `nskctf{network_${level}_preview_only}`]));
  const app = await createApp({ dataDir: process.env.DATA_DIR || './data', origin: process.env.PUBLIC_ORIGIN || 'http://localhost:3388', checkerUrls: (process.env.CHECKER_URLS || 'http://network_checker:9134').split(',').filter(Boolean), checkerToken: token, flags, banSeconds: Number(process.env.ANTICHEAT_BAN_SECONDS || 86400), trustProxy: process.env.TRUST_PROXY === 'true', oauth: { clientId: process.env.YANDEX_CLIENT_ID, clientSecret: process.env.YANDEX_CLIENT_SECRET } });
  app.server.listen(Number(process.env.PORT) || 3388, process.env.HOST || '127.0.0.1', () => console.log('Network operations: server ready'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
