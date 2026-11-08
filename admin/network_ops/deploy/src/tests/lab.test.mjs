import test from 'node:test';
import assert from 'node:assert/strict';
import { newLab, newProfile, act, command, connections, snapshotForChecker } from '../server/lab.mjs';
import { cableResult, T568B, terminationLength } from '../shared/catalog.mjs';
import { craft, solvedLab, wireLab } from '../../solve/fixtures.mjs';

test('three independent missions and immutable protocol identities', () => {
  const p = newProfile(); assert.deepEqual(Object.keys(p.labs), ['easy', 'medium', 'hard']);
  p.labs.easy.won = true; assert.equal(p.labs.medium.won, false);
  for (const lab of Object.values(p.labs)) assert.deepEqual(lab.cables, []);
  assert.throws(() => newLab('unknown'), /Invalid/); assert.throws(() => newLab('easy', 1000), /Invalid/);
});
test('cable ends require stripping, eight unique wires, trim, insertion and crimping', () => {
  const lab = newLab('easy');
  assert.throws(() => act(lab, { type: 'finish' }), /Сначала/);
  act(lab, { type: 'cut', length: 10 });
  assert.throws(() => act(lab, { type: 'crimp', end: 0 }), /не установлен/);
  assert.throws(() => act(lab, { type: 'wire', end: 0, wire: 'wo', pin: 0 }), /Нельзя/);
  act(lab, { type: 'strip', end: 0, depth: 1, untwist: 10 });
  assert.throws(() => act(lab, { type: 'trim', end: 0 }), /восемь/);
  T568B.forEach((wire, pin) => act(lab, { type: 'wire', end: 0, wire, pin }));
  act(lab, { type: 'wire', end: 0, wire: 'wo', pin: 1 }); assert.equal(new Set(lab.draft.ends[0].order).size, 8);
});
test('deep cuts cannot be repaired by resending a shallow cut; recut loses cable length', () => {
  const lab = newLab('easy'); act(lab, { type: 'cut', length: 5 });
  act(lab, { type: 'strip', end: 0, depth: 3, untwist: 30 }); act(lab, { type: 'strip', end: 0, depth: 1, untwist: 10 });
  assert.equal(lab.draft.ends[0].depth, 3); assert.equal(lab.draft.ends[0].untwist, 30);
  act(lab, { type: 'recut', end: 0 }); assert.equal(lab.draft.length, 4.9); assert.equal(lab.draft.ends[0].stripped, false);
});
test('continuity can pass while certification fails for a split pair', () => {
  const lab = newLab('easy'), id = craft(lab), c = lab.cables.find(c => c.id === id);
  for (const end of c.ends) [end.order[2], end.order[3]] = [end.order[3], end.order[2]];
  assert.equal(cableResult(c).continuity, true); assert.equal(cableResult(c).good, false);
  assert.match(act(lab, { type: 'test', id, certify: true }).message, /SPLIT/);
  assert.ok(!act(lab, { type: 'test', id }).message.includes('SPLIT'));
});
test('fixed-jig trimming removes excess untwist but never repairs a damaged conductor', () => {
  const lab = newLab('easy'); act(lab, { type: 'cut', length: 25 });
  for (const end of [0, 1]) {
    act(lab, { type: 'strip', end, depth: 1, untwist: end ? 28 : 25 });
    T568B.forEach((wire, pin) => act(lab, { type: 'wire', end, wire, pin }));
    assert.ok(terminationLength(lab.draft.ends[end]) > 13);
    act(lab, { type: 'trim', end }); assert.equal(lab.draft.ends[end].untwist, 12);
    act(lab, { type: 'insert', end }); act(lab, { type: 'crimp', end });
  }
  assert.equal(cableResult(lab.draft).good, true);
  act(lab, { type: 'recut', end: 0 }); act(lab, { type: 'strip', end: 0, depth: 2.5, untwist: 27 });
  T568B.forEach((wire, pin) => act(lab, { type: 'wire', end: 0, wire, pin }));
  act(lab, { type: 'trim', end: 0 }); act(lab, { type: 'insert', end: 0 }); act(lab, { type: 'crimp', end: 0 });
  assert.equal(lab.draft.ends[0].depth, 2.5); assert.equal(cableResult(lab.draft).good, false);
});
test('older trimmed ends are interpreted without rewriting saves or accepting real wiring defects', () => {
  const lab = solvedLab('easy');
  for (const [i, cable] of lab.cables.entries()) for (const [j, end] of cable.ends.entries()) end.untwist = 25 + (i + j) % 4;
  const saved = JSON.stringify(lab);
  assert.ok(snapshotForChecker(lab).physical.every(check => check.ok));
  assert.ok(lab.cables.every(cable => cableResult(cable).good)); assert.equal(JSON.stringify(lab), saved);
  const cable = lab.cables[0]; cable.ends[0].trimmed = false; assert.equal(cableResult(cable).good, false); cable.ends[0].trimmed = true;
  [cable.ends[0].order[2], cable.ends[0].order[3]] = [cable.ends[0].order[3], cable.ends[0].order[2]]; assert.equal(cableResult(cable).good, false);
  cable.ends[0].order = [...T568B]; cable.damage = { point: [0, .12, 0] }; assert.equal(cableResult(cable).good, false);
});
test('cable length, occupied ports and repair ownership are enforced', () => {
  const lab = newLab('easy'), id = craft(lab), c = lab.cables.find(c => c.id === id); c.length = 1;
  act(lab, { type: 'plug', id, port: 'pc:eth0' });
  assert.throws(() => act(lab, { type: 'plug', id, port: 'swa:p1' }), /короткий/);
  const second = craft(lab); assert.throws(() => act(lab, { type: 'plug', id: second, port: 'pc:eth0' }), /занят/);
  assert.throws(() => act(lab, { type: 'rework', id }), /отключите/);
  act(lab, { type: 'unplug', id }); act(lab, { type: 'rework', id }); assert.equal(lab.draft.id, id);
});
test('patch panel is factory-terminated and does not require a punch-down task', () => {
  const lab = newLab('medium'); wireLab(lab);
  assert.ok(connections(lab).some(link => link.includes('pc:eth0')));
  assert.equal(snapshotForChecker(lab).physical.find(c => c.id === 'panel').ok, true);
});
test('stripping shuffles exposed wires once per end and saves their order', () => {
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const lab = newLab('easy'); act(lab, { type: 'cut', length: 10 });
    for (const end of [0, 1]) {
      act(lab, { type: 'strip', end, depth: 1, untwist: 10 }); const order = [...lab.draft.ends[end].exposed];
      assert.deepEqual([...order].sort(), [...T568B].sort()); seen.add(order.join(','));
      act(lab, { type: 'strip', end, depth: 1, untwist: 10 }); assert.deepEqual(lab.draft.ends[end].exposed, order);
      assert.deepEqual(lab.draft.ends[end].order, Array(8).fill(null));
    }
    act(lab, { type: 'recut', end: 0 }); assert.equal(lab.draft.ends[0].exposed, null);
  }
  assert.ok(seen.size > 1);
});
test('console rejects host shell syntax and outside-lab addresses', () => {
  const lab = newLab('easy', 42); act(lab, { type: 'console', device: 'pc' });
  for (const line of ['id;whoami', 'curl http://example.com', 'ip addr add 8.8.8.8/24 dev eth0', 'ip addr add 10.42.1.2/24 dev __proto__', 'ping 127.0.0.1', 'ping 169.254.169.254', 'sh', '$(id)']) assert.throws(() => command(lab, line));
  command(lab, 'ip addr add 10.42.10.20/24 dev eth0'); assert.equal(lab.configs.pc.addresses.eth0, '10.42.10.20/24');
  assert.equal(command(lab, 'ping archive.lab').diagnostic.target, 'archive.lab');
  assert.throws(() => command(lab, 'show spanning-tree'), /коммутатор/);
  act(lab, { type: 'power', device: 'swa' }); act(lab, { type: 'console', device: 'swa' });
  assert.equal(command(lab, 'show spanning-tree').diagnostic.operation, 'stp'); assert.equal(command(lab, 'show mac').diagnostic.operation, 'mac');
});
test('running configuration is lost on power cycle unless written to startup', () => {
  const lab = newLab('easy', 42); act(lab, { type: 'console', device: 'pc' });
  command(lab, 'dns server 10.42.99.10'); command(lab, 'reboot'); assert.equal(lab.configs.pc.dns, null);
  command(lab, 'dns server 10.42.99.10'); command(lab, 'write memory');
  act(lab, { type: 'power', device: 'pc' }); assert.equal(lab.console, null); act(lab, { type: 'power', device: 'pc' }); assert.equal(lab.configs.pc.dns, '10.42.99.10');
});
test('carrier drops when the connected switch loses power', () => {
  const lab = solvedLab('easy'); act(lab, { type: 'console', device: 'pc' });
  assert.match(command(lab, 'show interfaces').output, /carrier UP/);
  act(lab, { type: 'power', device: 'swa' }); assert.match(command(lab, 'show interfaces').output, /carrier DOWN/);
});
test('author solutions build all required links through valid game actions', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const lab = solvedLab(level), snapshot = snapshotForChecker(lab);
    assert.ok(snapshot.physical.every(c => c.ok)); assert.ok(snapshot.links.some(edge => edge.includes('pc:eth0')));
    assert.equal(lab.won, false);
    if (level === 'hard') assert.ok(snapshot.links.some(edge => edge.includes('r1:wan2') && edge.includes('r2:wan2')));
  }
});
