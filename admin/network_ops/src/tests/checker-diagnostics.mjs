import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { solvedLab } from '../../solve/fixtures.mjs';
import { snapshotForChecker, act, command } from '../server/lab.mjs';
const base = process.env.QA_CHECKER_URL || 'http://127.0.0.1:9135', token = process.env.QA_CHECKER_TOKEN || 'local-network-qa-only-token-not-for-production';
for (const [level, device, operation, expected] of [['easy', 'pc', 'ping', '0% packet loss'], ['medium', 'swa', 'mac', 'swa:p2'], ['hard', 'swa', 'stp', 'Bridge'], ['hard', 'r1', 'neighbors', '2.2.2.2']]) {
  const response = await fetch(base + '/verify', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: randomBytes(24).toString('hex'), ...snapshotForChecker(solvedLab(level), { device, operation, target: operation === 'ping' ? 'archive.lab' : null }) }), signal: AbortSignal.timeout(60000) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); assert.deepEqual(result.checks, []); assert.ok(result.output.includes(expected), result.output);
  console.log(JSON.stringify({ operation, ok: true, output: result.output }));
}
for (const [level, device, line, expected, mutate] of [
  ['easy', 'pc', 'ip a', '10.42.10.20/24'],
  ['medium', 'pc', 'ip a show dev eth0', '10.42.10.'],
  ['easy', 'pc', 'ip l', 'eth0'],
  ['easy', 'pc', 'ip r', 'default via 10.42.10.1'],
  ['easy', 'swa', 'ip link show', 'p4:'],
  ['easy', 'pc', 'ip neigh show', ''],
  ['easy', 'pc', 'dig archive.lab +short', '10.42.99.10'],
  ['medium', 'pc', 'dig archive.lab', 'status: NOERROR'],
  ['easy', 'pc', 'dig @10.42.99.10 archive.lab A', 'ANSWER SECTION:'],
  ['easy', 'pc', 'dig missing.lab', 'status: NXDOMAIN'],
  ['easy', 'pc', 'nslookup archive.lab', '10.42.99.10'],
  ['medium', 'pc', 'nslookup archive.lab 10.42.10.1', '10.42.30.10'],
  ['easy', 'pc', 'dig archive.lab', 'DNS-сервер не задан', l => { l.configs.pc.dns = null; }],
  ['easy', 'pc', 'dig @10.42.99.11 archive.lab', 'no servers could be reached'],
  ['easy', 'pc', 'dig archive.lab', 'no servers could be reached', l => { l.cables.find(c => c.plugs.includes('pc:eth0')).plugs = [null, null]; }],
]) {
  const lab = solvedLab(level); mutate?.(lab); act(lab, { type: 'console', device }); const request = command(lab, line).diagnostic;
  const response = await fetch(base + '/verify', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: randomBytes(24).toString('hex'), ...snapshotForChecker(lab, request) }), signal: AbortSignal.timeout(60000) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); assert.deepEqual(result.checks, []); assert.ok(result.output.includes(expected), `${line}: ${result.output}`);
  if (line.startsWith('nslookup')) assert.ok(!result.output.includes('REFUSED'), result.output);
  console.log(JSON.stringify({ line, level, ok: true, output: result.output }));
}
for (const diagnostic of [
  { device: 'pc', operation: 'dig', target: 'archive.lab', server: '127.0.0.1', record: 'A', short: true },
  { device: 'pc', operation: 'dig', target: 'example.com', record: 'A', short: true },
  { device: 'pc', operation: 'dig', target: 'archive.lab', record: 'AXFR', short: false },
  { device: 'pc', operation: 'interfaces', interface: 'eth0;id' },
]) {
  const response = await fetch(base + '/verify', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: randomBytes(24).toString('hex'), ...snapshotForChecker(solvedLab('easy'), diagnostic) }) });
  assert.equal(response.status, 400, await response.text());
}
console.log('Worker rejected external DNS servers, names, AXFR and invalid interfaces.');
