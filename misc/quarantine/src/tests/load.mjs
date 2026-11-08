import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.mjs';
import { BUILDINGS, MOVEMENT } from '../shared/config.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quantile = (a, q) => { const values = [...a].sort((x, y) => x - y); return +((values[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0).toFixed(2)); };
if (!isMainThread) {
  let mode = 'idle', bytes = 0, frames = 0, rtts = [], disconnects = 0, sequences = [];
  const sockets = [];
  for (let i = 0; i < workerData.count; i++) {
    const ws = new WebSocket(workerData.url); sockets.push(ws); sequences.push(0);
    ws.on('close', () => disconnects++);
    ws.on('error', e => parentPort.postMessage({ error: e.message }));
    ws.on('message', (raw, binary) => {
      bytes += raw.length; if (binary) { frames++; return; } const m = JSON.parse(raw);
      if (m.type === 'hello') ws.send(JSON.stringify({ type: 'enter', name: `Load-${workerData.offset + i}`, role: 'assault' }));
      if (m.type === 'state') frames++;
      if (m.type === 'pong') rtts.push(Date.now() - m.seq);
    });
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'hello', world: true, compression: true }));
  }
  const input = setInterval(() => {
    const t = performance.now() / 1000;
    sockets.forEach((ws, i) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const active = mode !== 'idle', a = t * .5 + (workerData.offset + i) * .9;
      ws.send(JSON.stringify({ type: 'input', seq: ++sequences[i], x: active ? Math.sin(a) : 0, z: active ? Math.cos(a) : 0, yaw: a, pitch: -.02, attack: active, sprint: active && i % 4 === 0, jump: active && i % 5 === 0 && Math.sin(t) > .9, reload: false }));
    });
  }, 50);
  const ping = setInterval(() => { for (const ws of sockets) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', seq: Date.now() })); }, 1000);
  parentPort.on('message', message => {
    if (message.type === 'mode') { mode = message.mode; bytes = frames = 0; rtts = []; }
    if (message.type === 'stats') parentPort.postMessage({ type: 'stats', bytes, frames, rtts, disconnects });
    if (message.type === 'stop') { clearInterval(input); clearInterval(ping); for (const ws of sockets) ws.terminate(); parentPort.close(); }
  });
  parentPort.postMessage({ type: 'ready' });
} else {
  const count = Number(process.env.LOAD_PLAYERS) || 300, seconds = Number(process.env.LOAD_SECONDS) || 15;
  const app = await createApp({ flag: 'nskctf{load_fixture}', maxPlayers: count, testAuth: true });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const workers = [0, 1].map(i => new Worker(new URL(import.meta.url), { workerData: { count: Math.floor(count / 2) + (i === 0 ? count % 2 : 0), offset: i * Math.ceil(count / 2), url: `ws://127.0.0.1:${app.server.address().port}/ws` } }));
  const receive = (worker, type) => new Promise((resolve, reject) => { const handler = message => { if (message.error) { worker.off('message', handler); reject(new Error(message.error)); } else if (message.type === type) { worker.off('message', handler); resolve(message); } }; worker.on('message', handler); worker.once('error', reject); });
  const report = [];
  try {
    await Promise.all(workers.map(w => receive(w, 'ready'))); await sleep(1000);
    if (app.game.players().length !== count) throw new Error(`Only ${app.game.players().length} players connected`);
    const positions = [];
    for (let z = -220; z < 230; z += 22) for (let x = -220; x < 230; x += 22) if (!BUILDINGS.some(b => Math.abs(x - b.x) < b.w / 2 + 3 && Math.abs(z - b.z) < b.d / 2 + 3)) positions.push({ x, z });
    for (const mode of ['spread-combat', 'crowded-combat']) {
      let i = 0;
      for (const p of app.game.players()) {
        const point = mode === 'crowded-combat' ? { x: (i % 20 - 9.5) * .8, z: 60 + Math.floor(i / 20) * .8 } : positions[i % positions.length];
        p.x = point.x; p.z = point.z; p.y = 0; p.body.position.set(p.x, MOVEMENT.radius, p.z); p.body.velocity.set(0, 0, 0);
        const type = mode === 'crowded-combat' ? 'machinegun' : ['pistol', 'shotgun', 'sniper', 'machinegun'][i % 4];
        const item = app.game.item(type); p.inventory.push(item); app.game.handle(p, { type: 'equip', id: item.id }); p.level = 12; p.hp = p.maxHp = 1000000; p.reloading = null;
        i++;
      }
      for (const w of workers) w.postMessage({ type: 'mode', mode });
      await sleep(2000); app.metrics.ticks = []; app.metrics.broadcasts = []; app.metrics.bytes = 0; app.metrics.droppedSnapshots = 0; app.lag.reset();
      for (const w of workers) w.postMessage({ type: 'mode', mode });
      const start = performance.now(); await sleep(seconds * 1000); const elapsed = (performance.now() - start) / 1000;
      const pending = workers.map(w => receive(w, 'stats')); for (const w of workers) w.postMessage({ type: 'stats' }); const stats = await Promise.all(pending);
      const rtts = stats.flatMap(s => s.rtts), result = { mode, players: app.game.players().length, seconds: +elapsed.toFixed(2), tickP95Ms: quantile(app.metrics.ticks, .95), tickP99Ms: quantile(app.metrics.ticks, .99), ticksPerSecond: +(app.metrics.ticks.length / elapsed).toFixed(1), broadcastP95Ms: quantile(app.metrics.broadcasts, .95), eventLoopP95Ms: +(app.lag.percentile(95) / 1e6).toFixed(2), rttP95Ms: quantile(rtts, .95), rttP99Ms: quantile(rtts, .99), outboundMbps: +(app.metrics.bytes * 8 / elapsed / 1e6).toFixed(2), droppedSnapshots: app.metrics.droppedSnapshots, disconnected: stats.reduce((sum, s) => sum + s.disconnects, 0), rssMB: +(process.memoryUsage().rss / 1048576).toFixed(1) };
      report.push(result); console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ passed: report.every(r => r.players === count && r.disconnected === 0 && r.tickP99Ms < 33.34 && r.rttP95Ms < 150 && r.ticksPerSecond >= 27), report }, null, 2));
    if (!report.every(r => r.players === count && r.disconnected === 0 && r.tickP99Ms < 33.34 && r.rttP95Ms < 150 && r.ticksPerSecond >= 27)) process.exitCode = 1;
  } finally { for (const w of workers) w.postMessage({ type: 'stop' }); await Promise.all(workers.map(w => once(w, 'exit'))); await app.close(); }
}
