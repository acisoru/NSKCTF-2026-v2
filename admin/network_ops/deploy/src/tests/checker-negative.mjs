import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { solvedLab } from '../../solve/fixtures.mjs';
import { snapshotForChecker } from '../server/lab.mjs';
const base = process.env.QA_CHECKER_URL || 'http://127.0.0.1:9135', token = process.env.QA_CHECKER_TOKEN || 'local-network-qa-only-token-not-for-production';
const send = (snapshot, auth = token) => fetch(base + '/verify', { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: randomBytes(24).toString('hex'), ...snapshot }), signal: AbortSignal.timeout(150000) });
assert.equal((await send(snapshotForChecker(solvedLab('easy')), 'wrong-token')).status, 403);
const hostile = snapshotForChecker(solvedLab('easy')); hostile.links.push(['pc:eth0', 'host:eth0']); assert.equal((await send(hostile)).status, 400);
for (const [name, level, mutate, expected] of [
  ['unsafe L2 cycle', 'hard', s => { s.configs.swa.rstp = false; }, 'rstp'],
  ['wrong VLAN', 'medium', s => { s.configs.swb.ports.p1.vlans = [20]; }, 'pc-address'],
  ['missing ACL', 'medium', s => { s.configs.r1.denySsh = false; }, 'camera-ssh-denied'],
  ['disconnected camera is not isolation', 'medium', s => { s.links = s.links.filter(e => !e.includes('cam:eth0')); }, 'camera-ssh-denied'],
  ['no backup link', 'hard', s => { s.links = s.links.filter(e => !e.includes('r1:wan2')); }, 'failover'],
  ['unsaved OSPF', 'hard', s => { s.startup.r2.ospf = false; }, 'cold-boot'],
]) {
  const snapshot = snapshotForChecker(solvedLab(level)); mutate(snapshot); const start = performance.now(); const response = await send(snapshot), result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.checks.find(c => c.id === expected)?.ok, false, name);
  console.log(JSON.stringify({ name, rejected: expected, seconds: +((performance.now() - start) / 1000).toFixed(2), failedChecks: result.checks.filter(c => !c.ok).map(c => c.id) }));
}
if (!process.env.QA_CHECKER_URL) {
  for (const args of [['ip', 'netns', 'list'], ['ovs-vsctl', 'list-br']]) assert.equal(execFileSync('docker', ['exec', 'labx-network-qa-checker_qa-1', ...args], { encoding: 'utf8' }).trim(), '');
}
console.log('Negative cases passed; namespaces and switches cleaned up.');
