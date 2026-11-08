import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { AntiCheat, forgedStateFields, AC_WINDOW_MS } from '../server/anticheat.mjs';
import { newProfile, act } from '../server/lab.mjs';
import { incident } from '../server/incidents.mjs';
import { hash } from '../server/auth.mjs';
import { solvedLab } from '../../solve/fixtures.mjs';
import { mockOAuth, login } from './auth-fixture.mjs';

async function fixture(options = {}) {
  let now = options.now ?? 1000000;
  const app = await createApp({ oauth: mockOAuth, clock: () => now, ...options }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
  const post = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'easy', ...body }) });
  const session = async (id = '1001') => { const cookie = await login(base, id); await post('/api/resume', {}, cookie); return cookie; };
  const key = id => hash(`yandex:${id}`), profile = (id = '1001') => app.profiles.get(key(id));
  const tick = ms => { now += ms; app.tickWorld(); };
  const forge = cookie => post('/api/world', { pose: { x: 0, z: 11 }, won: true }, cookie);
  const ban = async cookie => { for (let i = 0; i < 3; i++) { if (i) tick(2100); const response = await forge(cookie); assert.equal(response.status, i === 2 ? 403 : 400); } };
  return { app, base, post, session, key, profile, tick, forge, ban, now: () => now };
}
const status = async (f, cookie) => (await fetch(f.base + '/api/session', { headers: { Cookie: cookie } })).json();
const wait = async fn => { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 10)); } };

test('only server-owned fields are tampering signals, not text or normal input', () => {
  assert.deepEqual(forgedStateFields({ level: 'easy', revision: 0, action: { type: 'label', text: 'won:true' } }), []);
  assert.deepEqual(forgedStateFields({ phase: 'end', point: { x: 1, z: 1 }, length: 40 }), []);
  assert.deepEqual(forgedStateFields({ won: true, action: { configs: {} } }), ['won', 'action.configs']);
});
test('repeated state tampering bans only the sending identity; resets and new sessions do not remove the ban', async () => {
  const f = await fixture();
  try {
    const a = await f.session(), b = await f.session('1002'); await f.ban(a);
    const ban = f.app.antiCheat.ban(f.key('1001')); assert.ok(ban); assert.equal(ban.until - ban.at, 86400000);
    assert.equal(f.app.runtime(f.key('1001')).active, false); assert.equal((await fetch(f.base + '/api/state', { headers: { Cookie: a } })).status, 403);
    assert.equal((await fetch(f.base + '/api/state', { headers: { Cookie: b } })).status, 200); assert.equal(f.app.antiCheat.ban(f.key('1002')), null);
    for (const path of ['/api/resume', '/api/reset', '/api/switch', '/api/check', '/api/command', '/api/gesture']) assert.equal((await f.post(path, { target: 'hard', confirm: 'easy' }, a)).status, 403, path);
    const again = await login(f.base, '1001'); assert.equal((await status(f, again)).ban.id, ban.id); assert.equal((await f.post('/api/resume', {}, again)).status, 403); assert.equal(f.app.profiles.size, 2);
  } finally { await f.app.close(); }
});
test('rapid repeats are deduplicated and the score window expires', async () => {
  let now = 0; const key = hash('yandex:1001'), p = { ...newProfile(), identity: 'yandex:1001' }, profiles = new Map([[key, p]]);
  const ac = new AntiCheat({ profiles, save: async () => {}, now: () => now });
  for (let i = 0; i < 100; i++) await ac.detect(key, 'state_forgery', { fields: ['won'] });
  assert.equal(p.security.signals.length, 1); assert.equal(ac.ban(key), null);
  now += AC_WINDOW_MS + 1; await ac.detect(key, 'state_forgery'); assert.equal(p.security.signals.length, 1); assert.equal(ac.ban(key), null);
  for (let i = 0; i < 150; i++) { now += 10001; await ac.detect(key, 'rate_limit'); }
  assert.equal(ac.ban(key), null); assert.ok(p.security.events.length <= 100);
});
test('movement bans require repeated impossible movement after correction acknowledgements', async () => {
  const f = await fixture();
  try {
    const cookie = await f.session(); for (let i = 0; i < 4; i++) { f.tick(1000); await f.post('/api/world', { pose: { x: 0, z: 11 } }, cookie); }
    let correction = null, blocked = false;
    for (let i = 0; i < 90; i++) {
      f.tick(100); const response = await f.post('/api/world', { pose: { x: -10, z: -7 }, correction }, cookie), data = await response.json();
      if (response.status === 403) { assert.equal(data.code, 'ACCOUNT_BANNED'); blocked = true; break; }
      assert.equal(response.status, 200); assert.equal(data.corrected, true); correction = data.correction;
    }
    assert.equal(blocked, true); assert.deepEqual(incident(f.profile().labs.easy).pose, { x: 0, z: 11 });
    assert.ok(f.app.antiCheat.events('1001').events.some(e => e.rule === 'impossible_movement' && e.points === 3));
  } finally { await f.app.close(); }
});
test('lost corrections, latency and ordinary errors do not produce auto-ban points', async () => {
  const f = await fixture();
  try {
    const cookie = await f.session();
    for (let i = 0; i < 20; i++) { f.tick(500); await f.post('/api/world', { pose: { x: -10, z: -7 } }, cookie); }
    assert.equal(f.app.antiCheat.ban(f.key('1001')), null); assert.equal(f.profile().security.signals.length, 0);
    await f.post('/api/resume', {}, cookie); f.tick(1800);
    const delayed = await (await f.post('/api/world', { pose: { x: 10, z: 11 } }, cookie)).json(); assert.equal(delayed.corrected, true);
    await f.post('/api/world', { pose: { x: 0, z: 11 }, correction: delayed.correction }, cookie);
    for (let i = 0; i < 6; i++) {
      f.tick(1000); await f.post('/api/action', { revision: 0, action: { type: 'cut', length: 20 } }, cookie);
      await f.post('/api/action', { revision: -1, action: { type: 'crimp', end: 0 } }, cookie);
      await f.post('/api/action', { revision: 0, action: { type: 'power', device: 'swa' } }, cookie);
    }
    assert.equal(f.app.antiCheat.ban(f.key('1001')), null); assert.equal(f.profile().security.signals.length, 0);
  } finally { await f.app.close(); }
});
test('invented tokens for a current gesture trigger detection, but known expired tokens do not', async () => {
  const f = await fixture();
  try {
    const cookie = await f.session(); await f.post('/api/context', { mode: 'bench', tool: 'cutter' }, cookie);
    for (let i = 0; i < 4; i++) { f.tick(1000); await f.post('/api/context', { tool: 'cutter' }, cookie); }
    const begin = async () => (await (await f.post('/api/gesture', { revision: 0, phase: 'begin', kind: 'tool', point: { x: -2.12, z: -.97 } }, cookie)).json()).token;
    const old = await begin(); await f.post('/api/gesture', { revision: 0, phase: 'cancel' }, cookie); await begin();
    await f.post('/api/gesture', { revision: 0, phase: 'end', token: old, point: { x: -2.12, z: -.97 } }, cookie);
    assert.equal(f.profile().security, undefined);
    for (let i = 0; i < 3; i++) {
      if (i) f.tick(2100); await begin();
      const response = await f.post('/api/gesture', { revision: 0, phase: 'end', token: 'f'.repeat(32), point: { x: -2.12, z: -.97 } }, cookie); assert.equal(response.status, i === 2 ? 403 : 400);
    }
    const audit = JSON.stringify(f.app.antiCheat.events('1001')); assert.ok(!audit.includes('f'.repeat(32))); assert.ok(!audit.includes(old));
  } finally { await f.app.close(); }
});
test('a ban invalidates an in-flight verification and prevents reward delivery', async () => {
  let finish;
  const f = await fixture({ flags: { easy: 'private-fixture' }, checkerToken: 'checker-fixture', fetchImpl: async (_, req) => new Promise(resolve => { const payload = JSON.parse(req.body); finish = () => resolve(new Response(JSON.stringify({ nonce: payload.nonce, checks: ['topology', 'power', 'crafted', 'wiremap', 'panel', 'pc-address', 'dns', 'http'].map(id => ({ id, ok: true })) }))); }) });
  try {
    const cookie = await f.session(); f.profile().labs.easy = solvedLab('easy'); const { job } = await (await f.post('/api/check', {}, cookie)).json();
    await f.ban(cookie); finish(); await wait(() => f.app.jobs.get(job).status === 'done');
    assert.equal(f.profile().labs.easy.won, false); assert.equal(f.app.jobs.get(job).stale, true);
    assert.equal((await fetch(`${f.base}/api/job?id=${job}`, { headers: { Cookie: cookie } })).status, 403);
  } finally { await f.app.close(); }
});
test('queued work is canceled on ban instead of consuming another checker slot', async () => {
  let finish;
  const f = await fixture({ checkerToken: 'fixture', fetchImpl: async (_, req) => new Promise(resolve => { const nonce = JSON.parse(req.body).nonce; finish = () => resolve(new Response(JSON.stringify({ nonce, checks: [] }))); }) });
  try {
    const a = await f.session(), b = await f.session('1002'); f.profile().labs.easy = solvedLab('easy'); f.profile('1002').labs.easy = solvedLab('easy');
    const first = await (await f.post('/api/check', {}, a)).json(), second = await (await f.post('/api/check', {}, b)).json(); assert.equal(f.app.jobs.get(second.job).status, 'queued');
    await f.ban(b); assert.equal(f.app.jobs.get(second.job).status, 'error'); assert.equal(f.app.jobs.get(second.job).snapshot, undefined);
    finish(); await wait(() => f.app.jobs.get(first.job).status === 'done');
  } finally { await f.app.close(); }
});
test('an authenticated request admitted before the ban is rechecked after its body arrives', async () => {
  const f = await fixture(); let req;
  try {
    const cookie = await f.session(); act(f.profile().labs.easy, { type: 'cut', length: 10 }); await f.post('/api/context', { mode: 'bench' }, cookie);
    const body = JSON.stringify({ level: 'easy', revision: 1, action: { type: 'discard' } });
    const done = new Promise((resolve, reject) => {
      req = httpRequest(f.base + '/api/action', { method: 'POST', headers: { Origin: f.base, Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => { let text = ''; response.on('data', b => { text += b; }); response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) })); }); req.on('error', reject); req.write(body.slice(0, 1));
    });
    await new Promise(r => setTimeout(r, 20)); await f.ban(cookie); req.end(body.slice(1)); const result = await done;
    assert.equal(result.status, 403); assert.equal(result.data.state, undefined); assert.equal(f.profile().labs.easy.draft.length, 10);
  } finally { req?.destroy(); await f.app.close(); }
});
test('reset and re-login cannot clear accumulated evidence before the threshold', async () => {
  const f = await fixture();
  try {
    const a = await f.session(); assert.equal((await f.forge(a)).status, 400);
    assert.equal((await f.post('/api/reset', { confirm: 'easy' }, a)).status, 200); f.tick(2100); assert.equal((await f.forge(a)).status, 400);
    await f.post('/api/pause', {}, a); const b = await f.session(); f.tick(2100); assert.equal((await f.forge(b)).status, 403);
    assert.equal(f.app.profiles.size, 1); assert.equal(f.profile().security.signals.length, 3);
  } finally { await f.app.close(); }
});
test('bans survive restart, local operator socket is private, and unban restores access without wiping progress', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ac-')); let f = await fixture({ dataDir });
  try {
    const cookie = await f.session(); act(f.profile().labs.easy, { type: 'cut', length: 17 }); await f.ban(cookie); const now = f.now(); await f.app.close();
    f = await fixture({ dataDir, now }); assert.equal((await status(f, cookie)).ban.until > now, true); assert.equal(f.profile().labs.easy.draft.length, 17);
    const mode = (await stat(f.app.control.path)).mode & 0o777; assert.equal(mode, 0o600);
    assert.equal((await fetch(f.base + '/bans')).status, 404);
    const operation = (path, body) => new Promise((resolve, reject) => { const req = httpRequest({ socketPath: f.app.control.path, path, method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } }, response => { let text = ''; response.on('data', b => { text += b; }); response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) })); }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined); });
    assert.equal((await operation('/bans')).data.bans.length, 1);
    assert.equal((await operation('/unban', { identity: '1001', reason: 'Reviewed test evidence' })).status, 200);
    assert.equal((await status(f, cookie)).ban, null); assert.equal((await f.post('/api/resume', {}, cookie)).status, 200);
    assert.equal(f.profile().labs.easy.draft.length, 17); assert.equal(f.profile().security.signals.length, 0); assert.equal(f.profile().security.events.at(-1).type, 'operator_unban');
  } finally { await f.app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
test('automatic expiry restores eligibility and persistence failures never silently unban', async () => {
  let now = 1000; const key = hash('yandex:1001'), p = { ...newProfile(), identity: 'yandex:1001' }, profiles = new Map([[key, p]]);
  const ac = new AntiCheat({ profiles, save: async () => {}, now: () => now, banSeconds: 60 });
  for (let i = 0; i < 3; i++) { now += 2100; await ac.detect(key, 'state_forgery'); }
  ac.save = async () => { throw new Error('disk failure'); };
  await assert.rejects(ac.unban('1001', 'test'), /disk failure/); assert.ok(ac.ban(key));
  ac.save = async () => {}; now += 60001; assert.equal(ac.ban(key), null);
  await ac.detect(key, 'state_forgery'); assert.equal(ac.ban(key), null); assert.equal(p.security.signals.length, 1);
});
test('a failed ban write keeps access blocked and is retried after storage recovers', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ac-')), f = await fixture({ dataDir });
  const key = f.key('1001'), blockedPath = join(dataDir, `${key}.tmp`);
  try {
    const cookie = await f.session(); await mkdir(blockedPath);
    for (let i = 0; i < 3; i++) {
      if (i) f.tick(2100);
      await assert.rejects(f.app.antiCheat.detect(key, 'state_forgery'), /EISDIR/);
    }
    assert.ok(f.app.antiCheat.ban(key));
    assert.equal((await fetch(f.base + '/api/state', { headers: { Cookie: cookie } })).status, 403);
    await rm(blockedPath, { recursive: true });
    const deadline = Date.now() + 7000;
    while (!JSON.parse(await readFile(join(dataDir, `${key}.json`), 'utf8')).security?.ban) {
      assert.ok(Date.now() < deadline, 'the normal persistence loop must retry the failed ban write');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const saved = JSON.parse(await readFile(join(dataDir, `${key}.json`), 'utf8'));
    assert.equal(saved.security.ban.id, f.app.antiCheat.ban(key).id);
  } finally { await rm(blockedPath, { recursive: true, force: true }); await f.app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
