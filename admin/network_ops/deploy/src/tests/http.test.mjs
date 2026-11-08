import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { solvedLab, craft } from '../../solve/fixtures.mjs';
import { newProfile, act } from '../server/lab.mjs';
import { incident, advanceIncident } from '../server/incidents.mjs';
import { hash } from '../server/auth.mjs';
import { mockOAuth, login } from './auth-fixture.mjs';

const complete = nonce => ({ nonce, checks: ['topology', 'power', 'crafted', 'wiremap', 'panel', 'pc-address', 'dns', 'http'].map(id => ({ id, name: id, ok: true })) });
const wait = async fn => { const end = Date.now() + 4000; while (!fn()) { if (Date.now() > end) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 10)); } };
async function fixture(options = {}) {
  let now = 1000000;
  const app = await createApp({ oauth: mockOAuth, clock: () => now, flags: { easy: 'nskctf{easy_private_fixture}' }, checkerToken: 'fixture-secret', ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
  const post = (path, body, cookie = '', origin = base) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin }, body: JSON.stringify(body) });
  const state = async cookie => (await fetch(base + '/api/state', { headers: { Cookie: cookie } })).json();
  const tick = ms => { now += ms; app.tickWorld(); };
  const session = async (id = '1001', legacy = '') => { const cookie = await login(base, id, legacy); await post('/api/resume', { level: 'easy' }, cookie); return cookie; };
  const profile = (id = '1001') => app.profiles.get(hash(`yandex:${id}`));
  const enterBench = async cookie => { const r = await post('/api/context', { level: 'easy', mode: 'bench', tool: 'hand' }, cookie); assert.equal(r.status, 200, await r.text()); };
  const gesture = async (cookie, kind, tool, from, to, extra = {}) => {
    let s = await state(cookie); assert.equal((await post('/api/context', { level: 'easy', tool }, cookie)).status, 200);
    const begin = await post('/api/gesture', { level: 'easy', revision: s.lab.revision, phase: 'begin', kind, point: from }, cookie), g = await begin.json(); assert.equal(begin.status, 200, JSON.stringify(g));
    tick(200); s = await state(cookie);
    const end = await post('/api/gesture', { level: 'easy', revision: s.lab.revision, phase: 'end', token: g.token, point: to, ...extra }, cookie); assert.equal(end.status, 200, await end.text()); return g.token;
  };
  return { app, base, post, session, state, tick, profile, enterBench, gesture };
}
test('anonymous requests allocate no profiles; authenticated sessions are isolated and origin-bound', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 30; i++) assert.equal((await f.post('/api/session', {})).status, 405);
    assert.equal(f.app.profiles.size, 0); assert.equal((await fetch(f.base + '/api/state')).status, 401);
    const a = await f.session('1001'), b = await f.session('1002');
    assert.equal((await f.post('/api/action', { level: 'easy', revision: 0, action: { type: 'cut', length: 25 } }, a, 'https://other.invalid')).status, 403);
    assert.equal((await f.post('/api/action', { level: 'easy', revision: 0, action: { type: 'cut', length: 25 } }, a)).status, 400);
    await f.enterBench(a); await f.gesture(a, 'tool', 'cutter', { x: -2.12, z: -.97 }, { x: .2375, z: -.35 });
    assert.ok((await f.state(a)).lab.draft); assert.equal((await f.state(b)).lab.draft, null);
    for (const path of ['/server/index.mjs', '/.env', '/data/', '/solve/fixtures.mjs']) assert.equal((await fetch(f.base + path)).status, 404);
    assert.ok(!(await (await fetch(f.base + '/lab.js')).text()).includes('easy_private_fixture'));
  } finally { await f.app.close(); }
});
test('general and conflict state omit internal configuration, defects and automatic test results', async () => {
  const f = await fixture();
  try {
    const c = await f.session(), lab = f.profile().labs.easy; craft(lab); lab.cables[0].ends[0].depth = 3;
    const s = await f.state(c); for (const name of ['configs', 'startup', 'subnet', 'panel', 'liveLinks', 'panelTested']) assert.equal(s.lab[name], undefined);
    for (const name of ['ends', 'test']) assert.equal(s.lab.cables[0][name], undefined);
    assert.equal(s.lab.incident.nextRat, undefined); assert.equal(s.lab.incident.elapsed, undefined);
    const conflict = await (await f.post('/api/action', { level: 'easy', revision: -1, action: { type: 'test' } }, c)).json(); assert.equal(conflict.state.lab.configs, undefined);
    assert.equal((await f.post('/api/command', { level: 'easy', revision: lab.revision, line: 'show running-config' }, c)).status, 400);
  } finally { await f.app.close(); }
});
test('the two-cable shortcut is rejected before invoking even a successful checker', async () => {
  let calls = 0; const f = await fixture({ fetchImpl: async (_, req) => { calls++; return new Response(JSON.stringify(complete(JSON.parse(req.body).nonce))); } });
  try {
    const c = await f.session(), lab = f.profile().labs.easy;
    for (const edge of [['pc:eth0', 'r1:lan'], ['r1:srv', 'archive:eth0']]) { const id = craft(lab); for (const port of edge) act(lab, { type: 'plug', id, port }); }
    assert.equal((await f.post('/api/check', { level: 'easy' }, c)).status, 400); assert.equal(calls, 0); assert.equal((await f.state(c)).reward, null);
  } finally { await f.app.close(); }
});
test('correct topology and authentic current checker results still grant a private flag', async () => {
  const f = await fixture({ fetchImpl: async (_, req) => new Response(JSON.stringify(complete(JSON.parse(req.body).nonce))) });
  try {
    const a = await f.session(), b = await f.session('1002'); f.profile().labs.easy = solvedLab('easy');
    const { job } = await (await f.post('/api/check', { level: 'easy' }, a)).json(); await wait(() => f.app.jobs.get(job).status === 'done');
    assert.equal((await f.state(a)).reward, 'nskctf{easy_private_fixture}'); assert.equal((await f.state(b)).reward, null);
    assert.equal((await fetch(`${f.base}/api/job?id=${job}`, { headers: { Cookie: b } })).status, 404);
  } finally { await f.app.close(); }
});
test('pause prevents gameplay and invalidates an outstanding check; ordinary actions advance incident time', async () => {
  let finish; const f = await fixture({ fetchImpl: async (_, req) => new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify(complete(JSON.parse(req.body).nonce)))); }) });
  try {
    const c = await f.session(); f.profile().labs.easy = solvedLab('easy'); const { job } = await (await f.post('/api/check', { level: 'easy' }, c)).json();
    f.tick(1000); await f.enterBench(c); f.tick(1000); await f.enterBench(c); assert.ok(Math.abs(incident(f.profile().labs.easy).elapsed - 2) < 1e-6);
    await f.post('/api/pause', { level: 'easy' }, c); finish(); await wait(() => f.app.jobs.get(job).status === 'done'); assert.equal(f.app.jobs.get(job).stale, true);
    const elapsed = incident(f.profile().labs.easy).elapsed; f.tick(10000); assert.equal(incident(f.profile().labs.easy).elapsed, elapsed);
    for (const path of ['/api/action', '/api/command', '/api/check', '/api/world', '/api/context', '/api/gesture']) assert.equal((await f.post(path, { level: 'easy' }, c)).status, 409, path);
    await f.post('/api/resume', { level: 'easy' }, c); f.tick(1000); assert.ok(incident(f.profile().labs.easy).elapsed > elapsed); assert.equal((await f.state(c)).reward, null);
  } finally { await f.app.close(); }
});
test('lease expiry pauses time and all actions; resume does not reset the incident timer', async () => {
  const f = await fixture();
  try {
    const c = await f.session(); f.tick(10000);
    assert.ok(Math.abs(incident(f.profile().labs.easy).elapsed - 2.5) < 1e-6); assert.equal((await f.state(c)).paused, true);
    assert.equal((await f.post('/api/check', { level: 'easy' }, c)).status, 409);
    await f.post('/api/resume', { level: 'easy' }, c); assert.ok(Math.abs(incident(f.profile().labs.easy).elapsed - 2.5) < 1e-6);
  } finally { await f.app.close(); }
});
test('gesture output ignores claimed depth/length and rejects nonce replay', async () => {
  const f = await fixture();
  try {
    const c = await f.session(); await f.enterBench(c);
    const token = await f.gesture(c, 'tool', 'cutter', { x: -2.12, z: -.97 }, { x: .2375, z: -.35 }, { length: 40 });
    assert.equal(f.profile().labs.easy.draft.length, 25);
    const revision = f.profile().labs.easy.revision;
    assert.equal((await f.post('/api/gesture', { level: 'easy', revision, phase: 'end', token, point: { x: .2375, z: -.35 } }, c)).status, 400);
    assert.equal((await f.post('/api/action', { level: 'easy', revision, action: { type: 'strip', end: 0, depth: 1, untwist: 10 } }, c)).status, 400);
  } finally { await f.app.close(); }
});
test('remote equipment actions, teleportation and noncanonical identifiers fail', async () => {
  const f = await fixture();
  try {
    const c = await f.session();
    assert.equal((await f.post('/api/action', { level: 'easy', revision: 0, action: { type: 'power', device: 'swa' } }, c)).status, 400);
    const world = await (await f.post('/api/world', { level: 'easy', pose: { x: -10, z: -7 } }, c)).json(); assert.equal(world.corrected, true); assert.deepEqual(world.incident.pose, { x: 0, z: 11 });
    assert.equal((await f.post('/api/context', { level: 'easy', mode: 'panel', tool: 'punch' }, c)).status, 400);
    const id = craft(f.profile().labs.easy); assert.throws(() => act(f.profile().labs.easy, { type: 'plug', id, port: 'pc:eth0:extra' }));
  } finally { await f.app.close(); }
});
test('same verified identity keeps one profile, quotas and progress across sessions/restarts', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'net-oauth-')); let f = await fixture({ dataDir });
  try {
    const c = await f.session(); f.profile().labs.easy = solvedLab('easy'); f.profile().checkQuota = { since: 1000000, count: 20 }; await f.app.close();
    f = await fixture({ dataDir }); const again = await f.session(); assert.equal(f.app.profiles.size, 1); assert.equal(f.profile().labs.easy.cables.length, 4);
    assert.equal((await f.post('/api/check', { level: 'easy' }, again)).status, 400); assert.equal(f.profile().checkQuota.count, 20);
    assert.notEqual(c, again);
  } finally { await f.app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
test('legacy progress is claimed once only after OAuth; previous unversioned wins need revalidation', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'net-legacy-')), raw = 'a'.repeat(43), legacy = newProfile(); legacy.labs.easy = solvedLab('easy'); legacy.labs.easy.won = true;
  await writeFile(join(dataDir, `${hash(raw)}.json`), JSON.stringify(legacy)); const f = await fixture({ dataDir, maxProfiles: 2 });
  try {
    assert.equal(f.app.profiles.size, 0); const c = await f.session('1001', `labx_network=${raw}`);
    assert.equal(f.profile().labs.easy.cables.length, 4); assert.equal((await f.state(c)).reward, null);
    await f.session('1002', `labx_network=${raw}`); assert.equal(f.profile('1002').labs.easy.cables.length, 0);
  } finally { await f.app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
test('cable damage during checking invalidates the original snapshot', async () => {
  let finish; const f = await fixture({ fetchImpl: async (_, req) => new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify(complete(JSON.parse(req.body).nonce)))); }) });
  try {
    const c = await f.session(), lab = solvedLab('easy'); f.profile().labs.easy = lab; const { job } = await (await f.post('/api/check', { level: 'easy' }, c)).json(); incident(lab).nextRat = 0;
    for (let i = 0; i < 1200 && !lab.cables.some(c => c.damage); i++) advanceIncident(lab, .1);
    finish(); await wait(() => f.app.jobs.get(job).status === 'done'); assert.equal(f.app.jobs.get(job).stale, true); assert.equal((await f.state(c)).reward, null);
  } finally { await f.app.close(); }
});
test('delayed bodies are charged at execution as well as admission', async () => {
  const f = await fixture(), pending = [], statuses = [];
  try {
    const cookie = await f.session(), body = JSON.stringify({ level: 'easy', revision: 0, pose: { x: 0, z: 11 } });
    for (let batch = 0; batch < 2; batch++) {
      for (let i = 0; i < 30; i++) {
        let req;
        const done = new Promise((resolve, reject) => {
          req = httpRequest(f.base + '/api/world', { method: 'POST', agent: false, headers: { Origin: f.base, Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => { statuses.push(response.statusCode); response.resume(); response.on('end', resolve); }); req.on('error', reject); req.write(body.slice(0, 1));
        }); pending.push({ req, done });
      }
      await new Promise(r => setTimeout(r, 40)); assert.equal(statuses.length, 0);
      if (!batch) { f.tick(1000); assert.equal((await f.post('/api/world', { level: 'easy', pose: { x: 0, z: 11 } }, cookie)).status, 200); }
    }
    for (const p of pending) p.req.end(body.slice(1)); await Promise.all(pending.map(p => p.done));
    assert.ok(statuses.includes(429)); assert.ok(statuses.filter(code => code === 200).length <= 45);
  } finally { for (const p of pending) if (!p.req.writableEnded) p.req.destroy(); await f.app.close(); }
});
test('bad worker nonce and missing required IDs cannot award completion; diagnostics never award flags', async () => {
  let variant = 'nonce';
  const f = await fixture({ fetchImpl: async (_, req) => { const nonce = JSON.parse(req.body).nonce; return new Response(JSON.stringify(variant === 'nonce' ? { ...complete(nonce), nonce: 'wrong' } : variant === 'missing' ? { nonce, checks: [] } : complete(nonce))); } });
  try {
    const cookie = await f.session(); f.profile().labs.easy = solvedLab('easy');
    for (const mode of ['nonce', 'missing']) { variant = mode; const { job } = await (await f.post('/api/check', { level: 'easy' }, cookie)).json(); await wait(() => ['done', 'error'].includes(f.app.jobs.get(job).status)); assert.equal((await f.state(cookie)).reward, null); }
    variant = 'diagnostic'; incident(f.profile().labs.easy).pose = { x: -10, z: 10.5 };
    await f.post('/api/context', { level: 'easy', tool: 'console' }, cookie);
    await f.post('/api/action', { level: 'easy', revision: f.profile().labs.easy.revision, action: { type: 'console', device: 'pc' } }, cookie);
    const { job } = await (await f.post('/api/command', { level: 'easy', revision: f.profile().labs.easy.revision, line: 'ip a' }, cookie)).json();
    await wait(() => f.app.jobs.get(job).status === 'done'); assert.equal((await f.state(cookie)).reward, null);
  } finally { await f.app.close(); }
});
