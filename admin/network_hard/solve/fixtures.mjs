import { newLab, act, command } from '../src/server/lab.mjs';
import { T568B, mission } from '../src/shared/catalog.mjs';

export function craft(lab) {
  act(lab, { type: 'cut', length: 35 });
  for (const end of [0, 1]) {
    act(lab, { type: 'strip', end, depth: 1, untwist: 10 });
    T568B.forEach((wire, pin) => act(lab, { type: 'wire', end, wire, pin }));
    for (const type of ['trim', 'insert', 'crimp']) act(lab, { type, end });
  }
  const id = lab.draft.id; act(lab, { type: 'finish' }); return id;
}
export function wireLab(lab) {
  for (const edge of mission(lab.level, lab.subnet).wiring) {
    const id = craft(lab); act(lab, { type: 'label', id, text: edge.join(' - ') });
    for (const port of edge) act(lab, { type: 'plug', id, port });
  }
}
export function solvedLab(level, subnet = 42) {
  const lab = newLab(level, subnet); wireLab(lab);
  const config = (device, lines) => { act(lab, { type: 'console', device }); for (const line of lines) command(lab, line); };
  if (level === 'easy') {
    act(lab, { type: 'power', device: 'swa' });
    config('pc', [`ip addr add 10.${subnet}.10.20/24 dev eth0`, `ip route add default via 10.${subnet}.10.1`, `dns server 10.${subnet}.99.10`]);
  } else if (level === 'medium') {
    // PP-01 is factory-terminated; no punch-down interaction is required.
    act(lab, { type: 'tone', port: 'outlet:j1' });
    config('swb', ['switchport access 10 dev p1', 'switchport access 20 dev p2', 'switchport trunk 10,20,30 dev p4']);
    config('swa', ['switchport trunk 10,20,30 dev p2', 'switchport access 30 dev p3']);
    config('r1', ['ip forward on', 'acl deny cameras ssh']);
  } else {
    for (const device of ['swa', 'swb', 'swc']) config(device, [...(device === 'swc' ? ['switchport trunk 10,20 dev p4'] : []), 'bridge rstp on', `bridge priority ${device === 'swa' ? 4096 : 32768}`, 'write memory']);
    config('r1', ['acl deny cameras ssh', 'router ospf on', 'write memory']);
    config('r2', ['ip forward on', 'router ospf on', 'write memory']);
  }
  return lab;
}
