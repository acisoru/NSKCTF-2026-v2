import test from 'node:test';
import assert from 'node:assert/strict';
import { newLab, act, command, HELP } from '../server/lab.mjs';
import { COMMAND_HELP } from '../shared/console-help.mjs';

const lab = () => { const lab = newLab('easy', 42); act(lab, { type: 'console', device: 'pc' }); return lab; };
test('help is only a command list; command --help returns syntax without mutation', () => {
  const l = lab(), revision = l.revision;
  assert.equal(command(l, 'help').output, HELP);
  assert.ok(HELP.split('\n').every(name => /^[a-z]+$/.test(name)));
  for (const name of Object.keys(COMMAND_HELP)) assert.equal(command(l, `${name} --help`).output, COMMAND_HELP[name]);
  assert.match(command(l, 'ip a --help').output, /ip a\[ddress\]/);
  assert.throws(() => command(l, 'nope --help'));
  assert.equal(l.revision, revision);
});
test('familiar Linux aliases generate real diagnostic requests with validated interfaces', () => {
  const l = lab();
  for (const cmd of ['ip a', 'ip addr', 'ip address show', ' ip  a   show ']) assert.equal(command(l, cmd).diagnostic.operation, 'addresses');
  for (const [cmd, op] of [['ip l', 'interfaces'], ['ip link show dev eth0', 'interfaces'], ['ip r', 'routes'], ['ip route show', 'routes'], ['ip n show', 'arp']]) assert.equal(command(l, cmd).diagnostic.operation, op);
  assert.equal(command(l, 'ip a dev eth0').diagnostic.interface, 'eth0');
  assert.equal(command(l, 'ping -c 1 archive.lab').diagnostic.count, 1);
  for (const cmd of ['ip a dev eth9', 'ip a show eth0', 'ip r dev eth0', 'ping -c 100 10.42.1.1', 'ip a show;id']) assert.throws(() => command(l, cmd));
});
test('DNS options are explicit, local-only and cannot inject command arguments', () => {
  const l = lab();
  assert.deepEqual(command(l, 'dig @10.42.99.10 Archive.lab. A +short').diagnostic, { device: 'pc', operation: 'dig', target: 'archive.lab', server: '10.42.99.10', record: 'A', short: true });
  assert.equal(command(l, 'nslookup archive.lab 10.42.99.10').diagnostic.server, '10.42.99.10');
  assert.equal(command(l, 'dig missing.lab TXT').diagnostic.record, 'TXT');
  for (const cmd of ['dig @8.8.8.8 archive.lab', 'dig @127.0.0.1 archive.lab', 'dig @169.254.169.254 archive.lab', 'dig example.com', 'dig archive.lab +trace', 'dig -f /etc/passwd', 'dig archive.lab @10.42.1.1 @10.42.1.2', 'nslookup archive.lab -debug', 'dig @10.42.99.10 archive.lab AXFR', 'dig __proto__.lab', 'dig -bad.lab', 'nslookup archive.lab 10.41.1.1', 'dig archive.lab\n$(id)']) assert.throws(() => command(l, cmd), cmd);
});
test('ip abbreviated configuration, deletions and dhclient preserve server rules', () => {
  const l = lab();
  command(l, 'ip a add 10.42.10.20/24 dev eth0'); assert.equal(l.configs.pc.addresses.eth0, '10.42.10.20/24');
  command(l, 'ip addr del 10.42.10.20/24 dev eth0'); assert.deepEqual(l.configs.pc.addresses, {});
  command(l, 'ip address add 10.42.10.21/24 dev eth0'); command(l, 'ip a flush dev eth0'); assert.deepEqual(l.configs.pc.addresses, {});
  command(l, 'ip r replace default via 10.42.10.1'); assert.equal(l.configs.pc.gateway, '10.42.10.1');
  command(l, 'ip r del default'); assert.equal(l.configs.pc.gateway, null);
  command(l, 'dhclient'); assert.equal(l.configs.pc.dhcp, true);
  assert.equal(command(l, 'hostname').output, 'pc'); assert.equal(command(l, 'clear').clear, true);
});
