import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { solvedLab } from '../../solve/fixtures.mjs';
import { snapshotForChecker } from '../server/lab.mjs';
import { advanceIncident, incident } from '../server/incidents.mjs';

const lab = solvedLab('easy'); incident(lab).nextRat = 0;
for (let i = 0; i < 1200 && !lab.cables.some(c => c.damage); i++) advanceIncident(lab, .1);
assert.ok(lab.cables.some(c => c.damage));
const response = await fetch((process.env.QA_CHECKER_URL || 'http://127.0.0.1:9135') + '/verify', {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.QA_CHECKER_TOKEN || 'local-network-qa-only-token-not-for-production'}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ nonce: randomBytes(24).toString('hex'), ...snapshotForChecker(lab) }), signal: AbortSignal.timeout(60000),
});
const report = await response.json(); assert.equal(response.status, 200, JSON.stringify(report));
assert.equal(report.checks.find(c => c.id === 'wiremap').ok, false); assert.equal(report.checks.find(c => c.id === 'http').ok, false);
console.log(JSON.stringify({ ok: true, checks: ['rat bite removed real network link', 'wiremap fails', 'archive HTTP is unreachable'] }));
