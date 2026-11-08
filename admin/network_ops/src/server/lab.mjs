import { randomBytes, randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { LEVELS, T568B, COLORS, mission, portPosition, TRAYS, cableResult, validEnd } from '../shared/catalog.mjs';
import { COMMAND_HELP, HELP } from '../shared/console-help.mjs';
import { TRIM_LENGTH_MM } from '../shared/workshop.mjs';
export { HELP } from '../shared/console-help.mjs';

const clone = v => structuredClone(v);
const id = () => randomBytes(8).toString('hex');
const requireThat = (v, message) => { if (!v) throw new Error(message); };
const loose = () => ({ stripped: false, depth: 0, untwist: 0, exposed: null, order: Array(8).fill(null), trimmed: false, inserted: false, crimped: false });
function shuffleWires() { const wires = [...T568B]; for (let i = wires.length - 1; i > 0; i--) { const j = randomInt(i + 1); [wires[i], wires[j]] = [wires[j], wires[i]]; } return wires; }
export function newLab(level, subnet = randomInt(20, 220)) {
  const spec = mission(level, subnet), address = s => `10.${subnet}.${s}`;
  const lab = { level, subnet, revision: 0, won: false, cables: [], draft: null, panel: [...T568B], panelTested: true, toner: null, console: null, configs: {}, startup: {}, power: {}, log: [], lastReport: null };
  for (const d of spec.devices) {
    lab.power[d.id] = !(level === 'easy' && d.id === 'swa');
    lab.configs[d.id] = { addresses: {}, gateway: null, dns: null, dhcp: false, forwarding: d.kind === 'router', ospf: false, rstp: false, priority: 32768, ports: Object.fromEntries(d.ports.map(p => [p, { mode: 'access', vlans: [1] }])), denySsh: false };
  }
  lab.configs.archive.addresses.eth0 = `${spec.archive}/24`; lab.configs.archive.gateway = address(`${level === 'medium' ? '30' : '99'}.1`);
  if (level === 'easy') {
    Object.assign(lab.configs.r1.addresses, { lan: address('10.1/24'), srv: address('99.1/24') });
  } else {
    Object.assign(lab.configs.r1.addresses, { 'uplink.10': address('10.1/24'), 'uplink.20': address('20.1/24') });
    lab.configs.pc.dhcp = true; lab.configs.cam.dhcp = true;
    lab.configs.swa.ports.p4 = { mode: 'trunk', vlans: [10, 20, 30] };
    if (level === 'medium') {
      lab.configs.r1.addresses['uplink.30'] = address('30.1/24'); lab.configs.r1.forwarding = false;
    } else {
      lab.configs.swa.ports.p2 = { mode: 'trunk', vlans: [10, 20] }; lab.configs.swa.ports.p3 = { mode: 'trunk', vlans: [10, 20] };
      for (const s of ['swb', 'swc']) { lab.configs[s].ports.p3 = { mode: 'trunk', vlans: [10, 20] }; lab.configs[s].ports.p4 = { mode: 'trunk', vlans: [10, 20] }; }
      lab.configs.swb.ports.p1 = { mode: 'access', vlans: [10] }; lab.configs.swc.ports.p1 = { mode: 'access', vlans: [20] };
      lab.configs.swc.ports.p4.vlans = [10]; lab.configs.r2.forwarding = false;
      Object.assign(lab.configs.r1.addresses, { wan1: address('250.1/30'), wan2: address('251.1/30') });
      Object.assign(lab.configs.r2.addresses, { wan1: address('250.2/30'), wan2: address('251.2/30'), srv: address('99.1/24') });
      lab.configs.r1.ospf = true;
    }
  }
  lab.startup = clone(lab.configs); return lab;
}
export function newProfile() { return { current: 'easy', created: Date.now(), labs: Object.fromEntries(LEVELS.map(level => [level, newLab(level)])) }; }
function note(lab, text) { lab.log.push({ at: Date.now(), text }); lab.log = lab.log.slice(-40); }
export function connections(lab) {
  const spec = mission(lab.level, lab.subnet), graph = new Map(), add = (a, b) => { graph.set(a, b); graph.set(b, a); };
  const patched = T568B.every((v, i) => lab.panel[i] === v);
  const edges = lab.cables.filter(c => c.plugs.every(Boolean) && cableResult(c).good).map(c => [...c.plugs]);
  for (const [a, b] of edges) add(a, b);
  const passive = new Map(patched ? [['outlet:j1', 'panel:j1'], ['panel:j1', 'outlet:j1'], ['outlet:j2', 'panel:j2'], ['panel:j2', 'outlet:j2']] : []);
  const links = [], visited = new Set();
  for (const d of spec.devices) for (const port of d.ports) {
    const start = `${d.id}:${port}`; if (visited.has(start)) continue;
    let next = graph.get(start), count = 0;
    while (next && passive.has(next) && count++ < 8) next = graph.get(passive.get(next));
    if (next && spec.devices.some(d => next.startsWith(`${d.id}:`)) && next !== start) { links.push([start, next]); visited.add(start); visited.add(next); }
  }
  return links;
}
export const COMPLETION_VERSION = 2;
export function physicalChecks(lab) {
  const spec = mission(lab.level, lab.subnet), installed = lab.cables.filter(c => c.plugs.some(Boolean));
  const edge = pair => [...pair].sort().join('|'), expected = spec.wiring.map(edge).sort(), actual = installed.map(c => edge(c.plugs.map(p => p ?? ''))).sort();
  return [
    { id: 'topology', name: 'Обязательная схема соединений', ok: actual.length === expected.length && actual.every((v, i) => v === expected[i]) },
    { id: 'power', name: 'Питание обязательного оборудования', ok: spec.devices.every(d => lab.power[d.id] === true) },
    { id: 'crafted', name: 'Ручной монтаж всех линий', ok: installed.length >= expected.length && installed.every(c => c.handmade && c.plugs.every(Boolean) && c.ends.every(e => e.stripped && e.trimmed && e.inserted && e.crimped)) },
    { id: 'wiremap', name: 'Кабельные линии', ok: lab.cables.filter(c => c.plugs.every(Boolean)).every(c => cableResult(c).good) },
    { id: 'panel', name: 'Разделка PP-01', ok: T568B.every((v, i) => lab.panel[i] === v) },
  ];
}
export function snapshotForChecker(lab, diagnostic = null) {
  const spec = mission(lab.level, lab.subnet);
  return { level: lab.level, subnet: lab.subnet, devices: spec.devices.map(({ id, kind, ports }) => ({ id, kind, ports })), links: connections(lab), configs: clone(lab.configs), startup: clone(lab.startup), power: { ...lab.power }, physical: physicalChecks(lab), diagnostic };
}
export function publicLab(lab, context = {}) {
  const spec = mission(lab.level, lab.subnet), bench = context.mode === 'bench';
  const visibleEnd = e => ({ stripped: e.stripped, exposed: e.exposed ? [...e.exposed] : null, order: [...e.order], trimmed: e.trimmed, inserted: e.inserted, crimped: e.crimped });
  const visibleCable = c => ({ id: c.id, label: c.label, length: c.length, handmade: c.handmade, plugs: [...c.plugs], route: [...c.route], ...(c.damage ? { damage: { point: [...c.damage.point] } } : {}) });
  const portLights = Object.fromEntries([...spec.devices, ...spec.passive].flatMap(d => d.ports.map(p => [`${d.id}:${p}`, false])));
  for (const edge of connections(lab)) if (edge.every(p => lab.power[p.split(':')[0]])) for (const port of edge) portLights[port] = true;
  return {
    level: lab.level, revision: lab.revision, won: lab.won, spec, power: { ...lab.power }, portLights,
    cables: lab.cables.map(visibleCable), draft: lab.draft ? { id: lab.draft.id, length: lab.draft.length, ...(bench ? { ends: lab.draft.ends.map(visibleEnd) } : {}) } : null,
    ...(context.mode === 'panel' ? { panel: [...lab.panel] } : {}),
    console: context.mode === 'console' && context.device === lab.console ? lab.console : null,
    log: clone(lab.log.slice(-8)), lastReport: lab.won ? clone(lab.lastReport) : null,
  };
}
export function act(lab, action) {
  requireThat(action && typeof action === 'object' && !Array.isArray(action), 'Некорректное действие');
  const spec = mission(lab.level, lab.subnet); let result = null;
  const draft = () => { requireThat(lab.draft, 'Сначала отмерьте и отрежьте кабель'); return lab.draft; };
  const end = () => { requireThat(action.end === 0 || action.end === 1, 'Выберите конец A или B'); return draft().ends[action.end]; };
  if (action.type === 'cut') {
    requireThat(!lab.draft, 'На верстаке уже есть заготовка'); requireThat(lab.cables.length < 24, 'На объекте достаточно кабелей');
    requireThat(Number.isInteger(action.length) && action.length >= 1 && action.length <= 40, 'Длина: от 1 до 40 м');
    lab.draft = { id: id(), label: 'Без маркировки', length: action.length, handmade: true, ends: [loose(), loose()], plugs: [null, null], route: [] };
  } else if (action.type === 'strip') {
    const e = end(); requireThat(!e.crimped && Number.isFinite(action.depth) && action.depth >= .2 && action.depth <= 3, 'Некорректная глубина стриппера');
    requireThat(Number.isFinite(action.untwist) && action.untwist >= 5 && action.untwist <= 40, 'Длина расплетения: 5–40 мм');
    if (!e.stripped) e.exposed = shuffleWires();
    e.stripped = true; e.depth = Math.max(e.depth, action.depth); e.untwist = Math.max(e.untwist, action.untwist);
  } else if (action.type === 'wire') {
    const e = end(); requireThat(e.stripped && !e.inserted && COLORS.some(c => c.id === action.wire) && Number.isInteger(action.pin) && action.pin >= 0 && action.pin < 8, 'Нельзя установить жилу');
    const previous = e.order.indexOf(action.wire), displaced = e.order[action.pin];
    if (previous >= 0) e.order[previous] = displaced; e.order[action.pin] = action.wire; e.trimmed = false;
  } else if (action.type === 'trim') {
    const e = end(); requireThat(e.stripped && e.order.every(Boolean) && !e.inserted, 'Сначала разложите все восемь жил'); e.trimmed = true; e.untwist = Math.min(e.untwist, TRIM_LENGTH_MM);
  } else if (action.type === 'insert') {
    const e = end(); requireThat(e.trimmed && !e.crimped, 'Подровняйте жилы перед установкой разъёма'); e.inserted = true;
  } else if (action.type === 'crimp') {
    const e = end(); requireThat(e.inserted && !e.crimped, 'Разъём ещё не установлен'); e.crimped = true;
  } else if (action.type === 'recut') {
    end(); requireThat(lab.draft.length > .5, 'Кабель слишком короткий'); lab.draft.length = Math.round((lab.draft.length - .1) * 10) / 10; lab.draft.ends[action.end] = loose();
  } else if (action.type === 'finish') {
    const d = draft(); requireThat(!d.damage, 'Кабель перегрызен посередине. Утилизируйте и изготовьте новый.'); requireThat(d.ends.every(e => e.crimped), 'Обожмите оба конца'); lab.cables.push(d); lab.draft = null;
  } else if (action.type === 'discard') { lab.draft = null;
  } else if (action.type === 'rework') {
    requireThat(!lab.draft, 'Верстак занят'); const index = lab.cables.findIndex(c => c.id === action.id); requireThat(index >= 0 && !lab.cables[index].plugs.some(Boolean), 'Сначала отключите кабель');
    lab.draft = lab.cables.splice(index, 1)[0];
    if (!lab.draft.handmade) { lab.draft.ends = [loose(), loose()]; lab.draft.handmade = true; }
  } else if (action.type === 'test') {
    const c = action.id === 'draft' ? draft() : lab.cables.find(c => c.id === action.id); requireThat(c, 'Кабель не найден');
    const test = cableResult(c); result = action.certify ? test : { map: test.map, continuity: test.continuity, message: test.continuity ? test.map.join(' → ') : 'OPEN / нет контакта' };
  } else if (action.type === 'label') {
    const c = lab.cables.find(c => c.id === action.id) ?? (action.id === 'draft' ? draft() : null);
    requireThat(c && typeof action.text === 'string' && action.text.trim().length > 0 && action.text.length <= 32, 'Маркировка: 1–32 символа'); c.label = action.text.replace(/[\p{C}<>]/gu, '').trim();
  } else if (action.type === 'plug') {
    const c = lab.cables.find(c => c.id === action.id), position = portPosition(spec, action.port ?? '');
    requireThat(!c?.damage, 'Кабель перегрызен. Изготовьте замену.');
    requireThat(c && position && c.plugs.includes(null), 'Кабель или порт недоступен'); requireThat(!lab.cables.some(c => c.plugs.includes(action.port)), 'Порт занят');
    const connected = c.plugs.find(Boolean);
    if (connected) {
      requireThat(connected !== action.port, 'Это тот же порт');
      const points = [portPosition(spec, connected), ...c.route.map(id => TRAYS.find(t => t.id === id)), position];
      const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y, p.z - points[i].z), 0) + .3;
      requireThat(c.length >= length, `Кабель короткий: трасса ${length.toFixed(1)} м, кабель ${c.length} м`);
    }
    c.plugs[c.plugs.indexOf(null)] = action.port;
  } else if (action.type === 'unplug') {
    const c = lab.cables.find(c => c.id === action.id); requireThat(c, 'Кабель не найден'); c.plugs = [null, null]; c.route = [];
  } else if (action.type === 'route') {
    const c = lab.cables.find(c => c.id === action.id); requireThat(c && c.plugs[0] && !c.plugs[1] && TRAYS.some(t => t.id === action.anchor), 'Сначала подключите один конец кабеля');
    requireThat(c.route.length < 6 && !c.route.includes(action.anchor), 'Точка уже пройдена'); c.route.push(action.anchor);
  } else if (action.type === 'punch') {
    requireThat(Number.isInteger(action.pin) && action.pin >= 0 && action.pin < 8 && COLORS.some(c => c.id === action.wire), 'Некорректная жила');
    const old = lab.panel.indexOf(action.wire); if (old >= 0) lab.panel[old] = lab.panel[action.pin]; lab.panel[action.pin] = action.wire; lab.panelTested = false;
  } else if (action.type === 'panel-test') {
    lab.panelTested = true; result = { map: [1, 2, 3, 4, 5, 6, 7, 8], message: lab.panel.every((v, i) => v === T568B[i]) ? 'PP-01 / PASS / 1000BASE-T' : 'PP-01 / SPLIT PAIR / нарушена структура пар' };
  } else if (action.type === 'tone') {
    requireThat(['outlet:j1', 'outlet:j2', 'panel:j1', 'panel:j2'].includes(action.port), 'Подключите генератор к розетке или патч-панели');
    result = { message: `${action.port} ↔ ${action.port.startsWith('outlet') ? 'panel' : 'outlet'}:${action.port.split(':')[1]} / 1000 Hz` }; lab.toner = action.port;
  } else if (action.type === 'console') {
    requireThat(spec.devices.some(d => d.id === action.device && d.kind !== 'server' && d.kind !== 'camera'), 'Консоль недоступна'); requireThat(lab.power[action.device], 'Устройство обесточено'); lab.console = action.device;
  } else if (action.type === 'power') {
    requireThat(spec.devices.some(d => d.id === action.device && !['server', 'camera'].includes(d.kind)), 'Питание недоступно');
    lab.power[action.device] = !lab.power[action.device]; if (lab.power[action.device]) lab.configs[action.device] = clone(lab.startup[action.device]);
    if (lab.console === action.device && !lab.power[action.device]) lab.console = null;
  } else throw new Error('Неизвестное действие');
  if (!['test', 'tone', 'console'].includes(action.type)) lab.revision++;
  if (result?.message) note(lab, result.message);
  return result;
}

export function command(lab, line) {
  requireThat(typeof line === 'string' && line.length <= 240 && /^[\w\s.:/,=@+-]+$/.test(line), 'Недопустимый синтаксис LabOS');
  let a = line.trim().split(/\s+/); line = a.join(' ');
  const deviceId = lab.console, spec = mission(lab.level, lab.subnet), device = spec.devices.find(d => d.id === deviceId);
  requireThat(device && lab.power[deviceId], 'Подключите консольный кабель к включённому устройству');
  const cfg = lab.configs[deviceId]; lab.cliMode ??= 'exec'; lab.cliInterface ??= null;
  const checkIp = address => requireThat(isIP(address) === 4 && address.startsWith(`10.${lab.subnet}.`), 'Адрес должен принадлежать выделенной сети лаборатории');
  const checkPort = port => requireThat(device.ports.includes(port) || device.kind === 'router' && device.ports.includes('uplink') && /^uplink\.(10|20|30)$/.test(port), 'Интерфейс не существует');
  if (line.trim() === 'help') return { output: HELP };
  if (a.at(-1) === '--help') {
    requireThat(Object.hasOwn(COMMAND_HELP, a[0]) && (a.length === 2 || a[0] === 'ip' && a.length === 3 && ['a', 'addr', 'address', 'l', 'link', 'r', 'route', 'n', 'neigh', 'neighbor'].includes(a[1])), 'Неизвестная команда');
    return { output: COMMAND_HELP[a[0]] };
  }
  if (line === 'hostname') return { output: deviceId };
  if (line === 'clear') return { output: '', clear: true };
  if (line === 'enable') { lab.cliMode = 'privileged'; return { output: 'LabOS privileged mode.' }; }
  if (line === 'configure terminal' || line === 'conf t') { requireThat(lab.cliMode === 'privileged', 'Сначала выполните enable'); lab.cliMode = 'config'; return { output: 'Enter configuration mode.' }; }
  if (line === 'exit') { lab.cliMode = lab.cliMode === 'config-if' ? 'config' : 'exec'; lab.cliInterface = null; return { output: '' }; }
  if (line === 'end') { lab.cliMode = 'privileged'; lab.cliInterface = null; return { output: '' }; }
  if (a[0] === 'interface' && a.length === 2) { requireThat(lab.cliMode === 'config', 'Выполните configure terminal'); checkPort(a[1]); lab.cliMode = 'config-if'; lab.cliInterface = a[1]; return { output: 'Configuring ' + a[1] + '.' }; }
  const diagnostic = (operation, options = {}) => ({ diagnostic: { device: deviceId, operation, target: null, ...options } });
  if (a[0] === 'ip') {
    a[1] = ({ a: 'addr', address: 'addr', l: 'link', r: 'route', n: 'neigh', neighbor: 'neigh' })[a[1]] ?? a[1];
    if (['addr', 'link', 'route', 'neigh'].includes(a[1]) && (a.length === 2 || ['show', 'dev'].includes(a[2]))) {
      const rest = a.slice(a[2] === 'show' ? 3 : 2);
      requireThat(!rest.length || rest.length === 2 && rest[0] === 'dev' && a[1] !== 'route', 'Некорректный синтаксис ip');
      if (rest.length) checkPort(rest[1]);
      return diagnostic(({ addr: 'addresses', link: 'interfaces', route: 'routes', neigh: 'arp' })[a[1]], { interface: rest[1] ?? null });
    }
  }
  if (a[0] === 'nslookup' || a[0] === 'dig') {
    let target, server = null, record = 'A', short = false;
    if (a[0] === 'nslookup') {
      requireThat(a.length === 2 || a.length === 3, 'Синтаксис: nslookup NAME.lab [DNS_IP]'); [target, server = null] = a.slice(1);
    } else {
      const names = [];
      for (const arg of a.slice(1)) {
        if (arg.startsWith('@')) { requireThat(server === null, 'DNS-сервер уже задан'); server = arg.slice(1); }
        else if (arg === '+short') { requireThat(!short, 'Повтор +short'); short = true; }
        else names.push(arg);
      }
      requireThat(names.length >= 1 && names.length <= 2, 'Синтаксис: dig [@DNS_IP] NAME.lab [TYPE] [+short]');
      target = names[0]; record = names[1]?.toUpperCase() ?? 'A';
      requireThat(['A', 'AAAA', 'MX', 'TXT', 'NS', 'SOA'].includes(record), 'Тип DNS-записи не поддерживается');
    }
    target = target.toLowerCase().replace(/\.$/, '');
    requireThat(target.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+lab$/.test(target), 'Доступны только имена зоны .lab');
    if (server !== null) checkIp(server);
    return diagnostic(a[0], { target, server, record, short });
  }
  if (line === 'bridge fdb show') { requireThat(device.kind === 'switch', 'Это не коммутатор'); return diagnostic('mac'); }
  if (a[0] === 'ping' && a.length === 4 && a[1] === '-c') {
    requireThat(/^[1-5]$/.test(a[2]), 'Количество пакетов: 1–5'); if (a[3] !== 'archive.lab') checkIp(a[3]);
    return diagnostic('ping', { target: a[3], count: +a[2] });
  }
  if (line.trim() === 'show running-config') return { output: JSON.stringify(cfg, null, 2) };
  if (line.trim() === 'show version') return { output: 'LabOS Network Operations\nFRRouting-compatible control plane\nUptime: 00:17:42' };
  if (line.trim() === 'show clock') return { output: new Date().toISOString() };
  if (line.trim() === 'show inventory') return { output: device.name + '\nInterfaces: ' + device.ports.join(', ') + '\nSerial: LAB-' + lab.subnet + '-' + deviceId.toUpperCase() };
  if (line.trim() === 'show processes') return { output: 'PID  CPU  NAME\n1    0.1  init\n42   0.3  routing-agent\n77   0.0  telemetry' };
  if (line.trim() === 'show logging') return { output: lab.log.map(e => new Date(e.at).toISOString() + ' ' + e.text).join('\n') || 'Лог пуст.' };
  if (line.trim() === 'show users') return { output: 'tty0  console  idle\nnetops  local  active' };
  if (line.trim() === 'show startup-config') return { output: JSON.stringify(lab.startup[deviceId], null, 2) };
  if (line.trim() === 'show interfaces') return { output: device.ports.map(p => `${p.padEnd(9)} ${connections(lab).some(edge => edge.includes(`${deviceId}:${p}`) && edge.every(endpoint => lab.power[endpoint.split(':')[0]])) ? 'carrier UP' : 'carrier DOWN'}  ${cfg.addresses[p] ?? ''}  ${device.kind === 'switch' ? `${cfg.ports[p].mode} ${cfg.ports[p].vlans.join(',')}` : ''}`).join('\n') };
  if (line.trim() === 'show links') return { output: connections(lab).filter(edge => edge.some(e => e.startsWith(`${deviceId}:`))).map(edge => edge.join(' <-> ')).join('\n') || 'Нет соседей с физическим линком' };
  if (['show mac', 'show spanning-tree', 'show ip ospf neighbor'].includes(line.trim())) {
    const router = line.trim() === 'show ip ospf neighbor'; requireThat(device.kind === (router ? 'router' : 'switch'), router ? 'Это не маршрутизатор' : 'Это не коммутатор');
    return { diagnostic: { device: deviceId, operation: router ? 'neighbors' : line.trim() === 'show mac' ? 'mac' : 'stp', target: null } };
  }
  if (a.length === 2 && ['ping', 'traceroute'].includes(a[0]) || line.trim() === 'show ip route') {
    if (a.length === 2 && a[1] !== 'archive.lab') checkIp(a[1]);
    return { diagnostic: { device: deviceId, operation: a[0] === 'show' ? 'routes' : a[0], target: a[1] ?? null } };
  }
  if (a.length === 6 && a.slice(0, 2).join(' ') === 'ip addr' && ['add', 'del', 'replace'].includes(a[2]) && a[4] === 'dev') {
    requireThat(['host', 'router'].includes(device.kind), 'IP настраивается на станции или маршрутизаторе');
    const [address, prefix, extra] = a[3].split('/'); checkIp(address); requireThat(!extra && /^\d+$/.test(prefix) && +prefix >= 8 && +prefix <= 30, 'Некорректная маска'); checkPort(a[5]);
    if (a[2] === 'del') { requireThat(cfg.addresses[a[5]] === `${address}/${+prefix}`, 'Адрес не назначен'); delete cfg.addresses[a[5]]; }
    else cfg.addresses[a[5]] = `${address}/${+prefix}`; cfg.dhcp = false;
  } else if (a.length === 5 && a.slice(0, 4).join(' ') === 'ip addr flush dev') { checkPort(a[4]); delete cfg.addresses[a[4]]; cfg.dhcp = false;
  } else if (a.length === 6 && a[0] === 'ip' && a[1] === 'route' && ['add', 'replace'].includes(a[2]) && a[3] === 'default' && a[4] === 'via') { checkIp(a[5]); cfg.gateway = a[5];
  } else if (a.join(' ') === 'ip route del default') { cfg.gateway = null;
  } else if (a.length === 3 && a.slice(0, 2).join(' ') === 'dns server') { checkIp(a[2]); cfg.dns = a[2];
  } else if (['dhcp eth0', 'dhclient', 'dhclient eth0'].includes(line)) { requireThat(device.kind === 'host', 'DHCP-клиент доступен на станции'); cfg.dhcp = true;
  } else if (a.length === 3 && a[0] === 'switchport' && a[1] === 'mode' && ['access', 'trunk'].includes(a[2])) { requireThat(lab.cliMode === 'config-if' && device.kind === 'switch', 'Сначала выберите switchport'); cfg.ports[lab.cliInterface].mode = a[2];
  } else if (a.length === 5 && a[0] === 'switchport' && ['access', 'trunk'].includes(a[1]) && a[3] === 'dev') {
    requireThat(device.kind === 'switch', 'Это не коммутатор'); checkPort(a[4]); const vlans = a[2].split(',').map(Number);
    requireThat(vlans.length >= 1 && vlans.length <= 8 && vlans.every(v => Number.isInteger(v) && v >= 1 && v <= 4094) && (a[1] !== 'access' || vlans.length === 1), 'Некорректный VLAN'); cfg.ports[a[4]] = { mode: a[1], vlans: [...new Set(vlans)] };
  } else if (a.length === 3 && a.slice(0, 2).join(' ') === 'bridge rstp' && ['on', 'off'].includes(a[2])) { requireThat(device.kind === 'switch', 'Это не коммутатор'); cfg.rstp = a[2] === 'on';
  } else if (a.length === 3 && a.slice(0, 2).join(' ') === 'bridge priority') { const priority = Number(a[2]); requireThat(device.kind === 'switch' && Number.isInteger(priority) && priority >= 0 && priority <= 61440 && priority % 4096 === 0, 'Приоритет: кратное 4096'); cfg.priority = priority;
  } else if (a.length === 3 && a.slice(0, 2).join(' ') === 'ip forward' && ['on', 'off'].includes(a[2])) { requireThat(device.kind === 'router', 'Это не маршрутизатор'); cfg.forwarding = a[2] === 'on';
  } else if (a.length === 2 && a[0] === 'router' && a[1] === 'ospf') { requireThat(lab.cliMode === 'config' && device.kind === 'router', 'Это не маршрутизатор'); cfg.ospf = true;
  } else if (a.length === 3 && a.slice(0, 2).join(' ') === 'router ospf' && ['on', 'off'].includes(a[2])) { requireThat(device.kind === 'router', 'Это не маршрутизатор'); cfg.ospf = a[2] === 'on';
  } else if (['acl deny cameras ssh', 'acl clear'].includes(line.trim())) { requireThat(device.kind === 'router', 'Это не маршрутизатор'); cfg.denySsh = a[1] === 'deny';
  } else if (line.trim() === 'write memory') { lab.startup[deviceId] = clone(cfg);
  } else if (line.trim() === 'reboot') { lab.configs[deviceId] = clone(lab.startup[deviceId]);
  } else throw new Error('Неизвестная команда. Список: help. Справка: <command> --help.');
  lab.revision++; note(lab, `${deviceId}: конфигурация изменена`); return { output: line.trim() === 'write memory' ? 'Конфигурация сохранена в NVRAM.' : line.trim() === 'reboot' ? 'Перезапуск. Загружена startup-config.' : 'OK' };
}
