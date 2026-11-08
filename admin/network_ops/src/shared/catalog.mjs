import { TRIM_LENGTH_MM } from './workshop.mjs';

export const LEVELS = ['easy', 'medium', 'hard'];
export const COLORS = [
  { id: 'wo', name: 'Бело-оранжевый', color: '#f08b43', stripe: true },
  { id: 'o', name: 'Оранжевый', color: '#f08b43' },
  { id: 'wg', name: 'Бело-зелёный', color: '#50ba73', stripe: true },
  { id: 'b', name: 'Синий', color: '#458ccf' },
  { id: 'wb', name: 'Бело-синий', color: '#458ccf', stripe: true },
  { id: 'g', name: 'Зелёный', color: '#50ba73' },
  { id: 'wbr', name: 'Бело-коричневый', color: '#a07050', stripe: true },
  { id: 'br', name: 'Коричневый', color: '#a07050' },
];
export const T568B = COLORS.map(c => c.id);
export const T568A = ['wg', 'g', 'wo', 'b', 'wb', 'o', 'wbr', 'br'];
export const TOOLS = [
  ['hand', 'hand', 'Осмотр / разъёмы'], ['cutter', 'scissors', 'Бокорезы'], ['stripper', 'slice', 'Стриппер'],
  ['wires', 'grip', 'Жилы'], ['crimper', 'wrench', 'Кримпер'], ['tester', 'activity', 'Кабельный тестер'],
  ['certifier', 'scan-line', 'Сертификатор'],
  ['toner', 'radio', 'Тональный генератор'], ['console', 'terminal', 'Консольный кабель'], ['label', 'tag', 'Маркировка'],
  ['shotgun', 'crosshair', 'Дробовик / Q'],
];
export const ROOM = { x: 15, z: 14 };
export const SHOTGUN_RACK = { x: -4, y: 1.75, z: 13.68 };
export const RAT_INTERVAL = 5 * 60;
export const RAT_VENT = { x: 13.5, z: 11.5 };
export const VIEWPOINTS = { bench: { position: [0, 4.7, 9.9], target: [0, 1.14, 8] }, panel: { position: [-12, 1.7, -4.15], target: [-12, 1.6, -6.4] } };
export const TRAYS = [{ id: 'west', x: -8, y: 3.8, z: 3 }, { id: 'center', x: 0, y: 3.8, z: 3 }, { id: 'east', x: 8, y: 3.8, z: 3 }];
const device = (id, name, kind, x, z, ports, extra = {}) => ({ id, name, kind, x, z, ports, ...extra });
export function mission(level, subnet = 42) {
  if (!LEVELS.includes(level) || !Number.isInteger(subnet) || subnet < 20 || subnet > 219) throw new Error('Invalid mission');
  const ip = suffix => `10.${subnet}.${suffix}`;
  const devices = [device('pc', 'Рабочая станция', 'host', -10, 8, ['eth0']), device('swa', 'SW-A / доступ', 'switch', -10, -7, ['p1', 'p2', 'p3', 'p4']), device('r1', 'R-1 / шлюз', 'router', -5, -7, level === 'hard' ? ['uplink', 'wan1', 'wan2'] : level === 'easy' ? ['lan', 'srv'] : ['uplink']), device('archive', 'Архив / сервер', 'server', level === 'hard' ? 10 : 0, -7, ['eth0'])];
  if (level !== 'easy') devices.push(device('swb', 'SW-B / отделение', 'switch', 5, -7, ['p1', 'p2', 'p3', 'p4']), device('cam', 'Регистратор', 'camera', 10, 8, ['eth0']));
  if (level === 'hard') devices.push(device('swc', 'SW-C / резерв', 'switch', 10, -3, ['p1', 'p2', 'p3', 'p4']), device('r2', 'R-2 / архив', 'router', 0, -7, ['wan1', 'wan2', 'srv']));
  const passive = [device('outlet', 'Розетка / рабочее место', 'outlet', -12, 7, ['j1', 'j2']), device('panel', 'PP-01 / магистраль', 'panel', -12, -7, ['j1', 'j2'])];
  const network = level === 'hard' || level === 'easy' ? '99' : '30';
  return {
    level, subnet, number: LEVELS.indexOf(level) + 1,
    title: { easy: 'Нет линка', medium: 'Линк есть. Сети нет.', hard: 'Резерв только на схеме' }[level],
    sector: { easy: 'СЕРВИСНАЯ', medium: 'КОММУТАЦИОННАЯ', hard: 'УЗЕЛ РЕЗЕРВИРОВАНИЯ' }[level],
    order: {
      easy: ['Восстановить рабочее место через розетку и патч-панель.', 'Изготовить четыре патч-корда по схеме соединений. Включить SW-A.', `Адрес станции: ${ip('10.20')}/24; шлюз ${ip('10.1')}; DNS ${ip('99.10')}.`, 'Открыть archive.lab с рабочей станции.'],
      medium: ['Собрать все линии по схеме. Розетку → PP-01 найти тональным генератором.', 'VLAN 10: сотрудники. VLAN 20: регистратор. VLAN 30: архив и управление.', 'Оба клиента должны получать адреса по DHCP. Между SW-A и SW-B нужен trunk.', 'Разрешить HTTP архива и DNS, запретить регистратору TCP/22 архива.', 'Выполнить инструментальную проверку разделки PP-01.'],
      hard: ['Собрать все линии по схеме. Кабельные петли должны обрабатываться RSTP.', 'VLAN 10: станция; VLAN 20: регистратор. DHCP обслуживает R-1.', 'R-1 и R-2 обмениваются маршрутами по OSPF через два независимых линка.', 'Архив должен пережить отключение wan1 и холодный перезапуск всех устройств.', 'Регистратору разрешены HTTP и DNS, но запрещён TCP/22 архива.', 'Сохранить конфигурации на устройствах.'],
    }[level],
    devices, passive, archive: ip(`${network}.10`), archiveName: 'archive.lab',
    wiring: level === 'easy' ? [['pc:eth0', 'outlet:j1'], ['panel:j1', 'swa:p1'], ['swa:p4', 'r1:lan'], ['r1:srv', 'archive:eth0']] : [
      ['pc:eth0', 'outlet:j1'], ['panel:j1', 'swb:p1'], ['swa:p4', 'r1:uplink'],
      ...(level === 'medium' ? [['cam:eth0', 'swb:p2'], ['archive:eth0', 'swa:p3'], ['swa:p2', 'swb:p4']] : [['swb:p3', 'swc:p3'], ['swc:p4', 'swa:p3'], ['swa:p2', 'swb:p4'], ['cam:eth0', 'swc:p1'], ['r2:srv', 'archive:eth0'], ['r1:wan1', 'r2:wan1'], ['r1:wan2', 'r2:wan2']]),
    ],
    addresses: { users: ip('10.0/24'), cameras: ip('20.0/24'), management: ip(`${network}.0/24`), gateway: ip('10.1'), dns: level === 'easy' ? ip('99.10') : ip('10.1'), wan1: ip('250.0/30'), wan2: ip('251.0/30') },
  };
}
export function portPosition(spec, endpoint) {
  if (typeof endpoint !== 'string' || endpoint.split(':').length !== 2) return null;
  const [id, port] = endpoint.split(':'); const d = [...spec.devices, ...spec.passive].find(d => d.id === id);
  if (!d || !d.ports.includes(port)) return null;
  const index = d.ports.indexOf(port), rack = ['router', 'switch', 'server', 'panel'].includes(d.kind);
  return { x: d.x + (index - (d.ports.length - 1) / 2) * .29, y: rack ? 1.48 : .95, z: d.z + (rack ? .57 : .18) };
}
// Saved pre-fix ends retain the stripping stroke, not the length after the fixed trimming jig.
export function terminationLength(end) { return end?.trimmed ? Math.min(end.untwist, TRIM_LENGTH_MM) : end?.untwist; }
export function validEnd(end) { return !!end?.stripped && end.depth <= 1.4 && terminationLength(end) <= 13 && end.trimmed && end.inserted && end.crimped && [T568A, T568B].some(order => order.every((wire, i) => end.order[i] === wire)); }
export function cableResult(cable) {
  if (cable.damage) return { map: Array(8).fill(0), continuity: false, paired: false, good: false, message: 'OPEN / кабель перегрызен / требуется замена' };
  const ends = cable.ends;
  const continuity = ends.map(e => e.stripped && e.depth <= 1.4 && e.trimmed && e.inserted && e.crimped && e.order.every(Boolean));
  const map = continuity.every(Boolean) ? ends[0].order.map(w => ends[1].order.indexOf(w) + 1) : Array(8).fill(0);
  const paired = ends.every(validEnd);
  return { map, continuity: continuity.every(Boolean), paired, good: paired && ends[0].order.every((w, i) => ends[1].order[i] === w), message: !continuity.every(Boolean) ? 'OPEN / нет контакта' : !paired ? 'SPLIT PAIR / нарушена структура пар' : map.some((n, i) => n !== i + 1) ? 'CROSS / перекрёстная распайка' : 'PASS / CAT6 / 1000BASE-T' };
}
export function installedCablePoints(spec, cable) {
  const a = portPosition(spec, cable.plugs[0]), b = portPosition(spec, cable.plugs[1]);
  return [[a.x, a.y, a.z], ...(cable.route.length ? cable.route.map(id => { const t = TRAYS.find(t => t.id === id); return [t.x, t.y, t.z]; }) : [[a.x, .12, a.z + .5], [b.x, .12, b.z + .5]]), [b.x, b.y, b.z]];
}
export function roomObstacles(spec) {
  return [
    { x: 0, z: 8, w: 5.6, d: 3.25, h: 1.12 },
    ...spec.devices.map(d => ({ x: d.x, z: d.z, w: ['switch', 'router', 'server'].includes(d.kind) ? 1.75 : 1.6, d: ['switch', 'router', 'server'].includes(d.kind) ? 1.1 : .85, h: ['switch', 'router', 'server'].includes(d.kind) ? 2.67 : 1.58 })),
    ...spec.passive.map(d => ({ x: d.x, z: d.z, w: d.kind === 'panel' ? 1.6 : .75, d: d.kind === 'panel' ? 1 : .2, h: d.kind === 'panel' ? 2.25 : 1.65 })),
  ];
}
