import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { incident } from '../server/incidents.mjs';
import { act } from '../server/lab.mjs';
import { hash } from '../server/auth.mjs';
import { mockOAuth, login } from './auth-fixture.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'network-load-')), app = await createApp({ dataDir, oauth: mockOAuth });
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
const count = Number(process.env.LOAD_PLAYERS) || 100, seconds = Number(process.env.LOAD_SECONDS) || 20, latencies = []; let failures = 0, requests = 0, bytes = 0;
const worldMode = process.env.LOAD_WORLD === '1';
const clients = [];
try {
  for (let i = 0; i < count; i++) {
    const identity = `load${i}`, cookie = await login(base, identity); act(app.profiles.get(hash(`yandex:${identity}`)).labs.easy, { type: 'cut', length: 20 });
    clients.push({ cookie, id: 'draft', revision: 1 });
  }
  for (const client of clients) {
    const post = (path, body) => fetch(base + path, { method: 'POST', headers: { Origin: base, Cookie: client.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'easy', ...body }) });
    if (!(await post('/api/resume', {})).ok) throw new Error('Resume failed');
    if (!worldMode && !(await post('/api/context', { mode: 'bench', tool: 'certifier' })).ok) throw new Error('Bench context failed');
  }
  if (worldMode) for (const profile of app.profiles.values()) incident(profile.labs.easy).nextRat = 0;
  const started = performance.now();
  while (performance.now() - started < seconds * 1000) {
    const round = performance.now();
    await Promise.all(clients.map(async client => {
      for (const path of [worldMode ? '/api/world' : '/api/action', '/api/state']) {
        const start = performance.now();
        const response = await fetch(base + path, path.endsWith('action') || path.endsWith('world') ? { method: 'POST', headers: { Origin: base, Cookie: client.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'easy', revision: client.revision, pose: { x: 0, z: 11 }, action: { type: 'test', id: client.id, certify: true } }) } : { headers: { Cookie: client.cookie } });
        const payload = await response.text(); bytes += Buffer.byteLength(payload); requests++; if (!response.ok) failures++; latencies.push(performance.now() - start);
      }
    }));
    await new Promise(r => setTimeout(r, Math.max(0, 1000 - (performance.now() - round))));
  }
  const elapsed = (performance.now() - started) / 1000; latencies.sort((a, b) => a - b);
  const result = { sessions: count, activeRats: [...app.profiles.values()].filter(p => p.labs.easy.incident?.rat).length, worldMode, seconds: +elapsed.toFixed(2), requests, failures, requestsPerSecond: +(requests / elapsed).toFixed(1), p95Ms: +latencies[Math.floor(latencies.length * .95)].toFixed(2), p99Ms: +latencies[Math.floor(latencies.length * .99)].toFixed(2), outgoingMbps: +(bytes * 8 / elapsed / 1e6).toFixed(2), rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1), persistentProgress: true, checkerJobs: 0 };
  console.log(JSON.stringify(result, null, 2)); if (failures || result.p99Ms > 500) process.exitCode = 1;
} finally { await app.close(); await rm(dataDir, { recursive: true, force: true }); }
