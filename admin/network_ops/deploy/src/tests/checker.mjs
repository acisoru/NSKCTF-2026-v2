import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { solvedLab } from '../../solve/fixtures.mjs';
import { snapshotForChecker } from '../server/lab.mjs';
const base = process.env.QA_CHECKER_URL || 'http://127.0.0.1:9135', token = process.env.QA_CHECKER_TOKEN || 'local-network-qa-only-token-not-for-production';
for (const level of process.argv[2] ? [process.argv[2]] : ['easy', 'medium', 'hard']) {
  const snapshot = snapshotForChecker(solvedLab(level));
  const started = performance.now();
  const response = await fetch(base + '/verify', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: randomBytes(24).toString('hex'), ...snapshot }), signal: AbortSignal.timeout(150000) });
  const data = await response.json(); console.log(JSON.stringify({ level, status: response.status, elapsed: (performance.now() - started) / 1000, ...data }, null, 2));
  assert.equal(response.status, 200); assert.ok(data.checks.every(c => c.ok), `Failed ${level}: ${data.checks.filter(c => !c.ok).map(c => c.id)}`);
}
