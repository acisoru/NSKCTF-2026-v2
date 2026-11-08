import { randomBytes } from 'node:crypto';
import { Ray, Vector3, Box3 } from 'three';
import { mission, roomObstacles, portPosition, TRAYS, TOOLS, COLORS } from '../shared/catalog.mjs';
import { BENCH_TOOLS, BENCH_POSITION, PANEL_POSITION, REACH } from '../shared/workshop.mjs';
import { act, command } from './lab.mjs';
import { incident } from './incidents.mjs';

const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function context() { return { mode: 'world', tool: 'hand', end: 0, device: null, measure: 25, depth: 1, mounted: null, gesture: null }; }
export function publicContext(c) { return { mode: c.mode, tool: c.tool, end: c.end, device: c.device, measure: c.measure, depth: c.depth, mounted: c.mounted }; }
export function resetContext(r) { r.context = context(); r.generation++; }
export function requireReach(lab, point) {
  requireThat(point, 'Объект не существует');
  const pose = incident(lab).pose, from = new Vector3(pose.x, 1.7, pose.z), to = new Vector3(point.x, point.y ?? 1.4, point.z), distance = from.distanceTo(to);
  requireThat(distance <= REACH, 'Подойдите ближе к объекту');
  const ray = new Ray(from, to.clone().sub(from).normalize());
  for (const b of roomObstacles(mission(lab.level))) {
    const hit = ray.intersectBox(new Box3(new Vector3(b.x - b.w / 2, 0, b.z - b.d / 2), new Vector3(b.x + b.w / 2, b.h, b.z + b.d / 2)), new Vector3());
    requireThat(!hit || hit.distanceTo(from) >= distance - .45, 'Объект закрыт оборудованием');
  }
}
export function updatePose(lab, r, pose, now) {
  r.lastMove = null;
  requireThat(pose && Number.isFinite(pose.x) && Number.isFinite(pose.z) && Math.abs(pose.x) <= 14.6 && Math.abs(pose.z) <= 13.6, 'Некорректная позиция');
  const old = incident(lab).pose, distance = Math.hypot(pose.x - old.x, pose.z - old.z);
  const intervalMs = Math.max(0, now - r.poseAt);
  r.budget = Math.min(6, r.budget + Math.max(0, now - r.poseAt) / 1000 * 7); r.poseAt = now;
  if (r.context.mode !== 'world' && distance > .06 || distance > r.budget) { r.lastMove = { reason: r.context.mode !== 'world' ? 'context' : 'budget', distance, budget: r.budget, intervalMs }; return false; }
  const obstacles = roomObstacles(mission(lab.level)), steps = Math.max(1, Math.ceil(distance / .08));
  for (let i = 1; i <= steps; i++) {
    const x = old.x + (pose.x - old.x) * i / steps, z = old.z + (pose.z - old.z) * i / steps;
    if (obstacles.some(b => Math.hypot(Math.max(0, Math.abs(x - b.x) - b.w / 2), Math.max(0, Math.abs(z - b.z) - b.d / 2)) < .30)) { r.lastMove = { reason: 'obstacle', distance, budget: r.budget, intervalMs }; return false; }
  }
  r.budget = Math.max(0, r.budget - distance); incident(lab).pose = { x: pose.x, z: pose.z }; return true;
}
export function setContext(lab, r, input) {
  const c = r.context;
  if (input.mode !== undefined) {
    requireThat(['world', 'bench', 'panel'].includes(input.mode), 'Некорректный режим');
    if (input.mode === 'bench') requireReach(lab, BENCH_POSITION);
    if (input.mode === 'panel') { requireReach(lab, PANEL_POSITION); requireThat((input.tool ?? c.tool) === 'certifier', 'Панель уже разделана; используйте сертификатор для проверки'); }
  }
  if (input.tool !== undefined) {
    requireThat(TOOLS.some(t => t[0] === input.tool), 'Неизвестный инструмент');
    if (input.tool === 'shotgun') requireThat(incident(lab).shotgun, 'Дробовик не получен');
    if (['cutter', 'stripper', 'crimper', 'wires', 'tester'].includes(input.tool)) { requireThat((input.mode ?? c.mode) === 'bench', 'Инструмент остался на верстаке'); requireReach(lab, BENCH_POSITION); }
  }
  if (input.end !== undefined) requireThat((input.end === 0 || input.end === 1) && (input.mode ?? c.mode) === 'bench', 'Выберите конец на верстаке');
  const changed = ['mode', 'tool', 'end'].some(k => input[k] !== undefined && input[k] !== c[k]);
  if (changed) { c.gesture = null; c.mounted = null; }
  for (const key of ['mode', 'tool', 'end']) if (input[key] !== undefined) c[key] = input[key];
  if (c.mode !== 'console') { c.device = null; lab.console = null; }
  return publicContext(c);
}
function bench(lab, c) { requireThat(c.mode === 'bench', 'Нужен монтажный верстак'); requireReach(lab, BENCH_POSITION); }
function devicePoint(lab, id) {
  const d = mission(lab.level, lab.subnet).devices.find(d => d.id === id);
  return d ? { x: d.x, y: 1.6, z: d.z + .65 } : null;
}
export function guardedAction(lab, r, action) {
  requireThat(action && typeof action === 'object', 'Некорректное действие'); const c = r.context;
  requireThat(!['cut', 'strip', 'wire', 'trim', 'insert', 'crimp', 'recut', 'punch'].includes(action.type), 'Для этого действия нужен жест инструмента');
  if (['finish', 'discard', 'rework'].includes(action.type)) bench(lab, c);
  else if (action.type === 'test') { bench(lab, c); requireThat(['tester', 'certifier'].includes(c.tool), 'Нужен измеритель'); action = { type: 'test', id: action.id, certify: c.tool === 'certifier' }; }
  else if (action.type === 'panel-test') { requireReach(lab, PANEL_POSITION); requireThat(c.mode === 'panel' && c.tool === 'certifier', 'Нужен сертификатор у панели'); }
  else if (action.type === 'console' || action.type === 'power') {
    requireThat(c.mode === 'world', 'Вернитесь к оборудованию'); requireReach(lab, devicePoint(lab, action.device));
    requireThat(c.tool === (action.type === 'console' ? 'console' : 'hand'), 'Выбран другой инструмент');
  } else if (action.type === 'plug' || action.type === 'tone') {
    requireThat(c.mode === 'world' && c.tool === (action.type === 'tone' ? 'toner' : 'hand'), 'Выберите подходящий инструмент');
    requireReach(lab, portPosition(mission(lab.level, lab.subnet), action.port));
  } else if (action.type === 'unplug') {
    requireThat(c.mode === 'world' && c.tool === 'hand', 'Выберите разъём');
    const cable = lab.cables.find(x => x.id === action.id), port = action.port;
    requireThat(cable && cable.plugs.includes(port), 'Выберите подключённый конец кабеля'); requireReach(lab, portPosition(mission(lab.level, lab.subnet), port));
    const remaining = cable.plugs.find(p => p && p !== port); cable.plugs = [remaining ?? null, null]; cable.route = []; lab.revision++; return null;
  } else if (action.type === 'route') { requireThat(c.mode === 'world' && c.tool === 'hand', 'Выберите кабель'); requireReach(lab, TRAYS.find(t => t.id === action.anchor)); }
  else if (action.type === 'label') {
    requireThat(c.tool === 'label', 'Нужен маркер'); const cable = lab.cables.find(x => x.id === action.id);
    requireThat(cable, 'Кабель не найден');
    if (cable.plugs.some(Boolean)) requireReach(lab, portPosition(mission(lab.level, lab.subnet), action.port)); else bench(lab, c);
    if (cable.plugs.some(Boolean)) requireThat(cable.plugs.includes(action.port), 'Это другой кабель');
  } else throw new Error('Неизвестное действие');
  const result = act(lab, action);
  if (action.type === 'console') { c.mode = 'console'; c.device = action.device; c.gesture = null; }
  return result;
}
export function guardedCommand(lab, r, line) {
  const c = r.context; requireThat(c.mode === 'console' && c.tool === 'console' && c.device === lab.console, 'Подключите консоль к устройству');
  requireReach(lab, devicePoint(lab, c.device)); return command(lab, line);
}
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= 3.5 && Math.abs(p.z) <= 2.5;
const near = (p, x, z, range) => Math.hypot(p.x - x, p.z - z) <= range;
export function gesture(lab, r, input, now) {
  const c = r.context;
  if (input.phase === 'cancel') { c.gesture = null; return { canceled: true }; }
  requireThat(c.mode === 'bench' || c.mode === 'panel', 'Рабочая поверхность не открыта');
  requireReach(lab, c.mode === 'bench' ? BENCH_POSITION : PANEL_POSITION);
  requireThat(point(input.point), 'Некорректная точка инструмента');
  if (input.phase === 'begin') {
    requireThat(!c.gesture, 'Предыдущий жест не завершён');
    const p = input.point, e = lab.draft?.ends[c.end], kind = input.kind, g = { token: randomBytes(16).toString('hex'), kind, from: { x: p.x, z: p.z }, last: { x: p.x, z: p.z }, at: now, started: now, revision: lab.revision, maxTravel: 0, tool: c.tool, end: c.end, draft: lab.draft?.id ?? null };
    if (kind === 'tool') { requireThat(c.mode === 'bench' && Object.hasOwn(BENCH_TOOLS, c.tool), 'Нужен инструмент со стола'); const [x, z] = BENCH_TOOLS[c.tool]; requireThat(near(p, x, z, .65), 'Инструмент не в этой точке'); g.origin = { x, z }; }
    else if (kind === 'measure') { bench(lab, c); requireThat(!lab.draft && near(p, -.95 + c.measure * .0475, -.16, .2), 'Выберите конец бухты'); }
    else if (kind === 'depth') { bench(lab, c); requireThat(near(p, -1.94, -.14, .18), 'Выберите колесо стриппера'); g.depth = c.depth; }
    else if (kind === 'connector') { bench(lab, c); requireThat(e && !e.inserted && near(p, -1.36, .26, .32), 'Разъём не в этой точке'); g.origin = { x: -1.36, z: .26 }; }
    else if (kind === 'stripper' || kind === 'crimper') { bench(lab, c); requireThat(c.tool === kind && c.mounted === kind && near(p, 0, kind === 'stripper' ? .13 : -.49, .6), 'Инструмент не установлен'); }
    else if (kind === 'wire') {
      requireThat(c.mode === 'panel' ? c.tool === 'punch' : e?.stripped && !e.inserted && c.tool === 'hand', 'Жилы недоступны');
      const order = c.mode === 'panel' ? lab.panel : e.order, exposed = c.mode === 'panel' ? COLORS.map(v => v.id) : e.exposed ?? COLORS.map(v => v.id);
      const candidates = exposed.map((wire, i) => { const assigned = order.indexOf(wire), x = ((assigned >= 0 ? assigned : i) - 3.5) * .18, z = c.mode === 'panel' ? -.62 : assigned >= 0 ? -.72 : -.18 - (i % 2) * .06; return { wire, distance: Math.hypot(p.x - x, p.z - z) }; }).sort((a, b) => a.distance - b.distance);
      requireThat(candidates[0].distance < .18, 'Выберите конец жилы'); g.wire = candidates[0].wire;
    } else throw new Error('Неизвестный жест');
    c.gesture = g; return { token: g.token };
  }
  const g = c.gesture;
  requireThat(g && g.token === input.token && g.revision === lab.revision && g.tool === c.tool && g.end === c.end && g.draft === (lab.draft?.id ?? null), 'Жест устарел');
  requireThat(now - g.started <= 15000 && now >= g.at, 'Время жеста истекло');
  const p = input.point, delta = Math.hypot(p.x - g.last.x, p.z - g.last.z);
  requireThat(delta <= 35 * (now - g.at) / 1000 + .035, 'Слишком быстрое движение инструмента');
  g.last = { x: p.x, z: p.z }; g.at = now;
  g.maxTravel = Math.max(g.maxTravel, g.kind === 'stripper' ? p.z - g.from.z : Math.abs(p.x - g.from.x));
  if (input.phase === 'sample') return { accepted: true };
  if (input.phase === 'end' && g.kind === 'tool' && Math.hypot(p.x - g.from.x, p.z - g.from.z) < .03) { c.gesture = null; return { interaction: publicContext(c) }; }
  requireThat(input.phase === 'end' && now - g.started >= 70, 'Жест слишком короткий'); c.gesture = null;
  const e = lab.draft?.ends[c.end], run = (type, extra = {}) => act(lab, { type, end: c.end, ...extra }); let result = null;
  if (g.kind === 'measure') c.measure = clamp(Math.round((p.x + .95) / .0475), 1, 40);
  else if (g.kind === 'depth') c.depth = Math.round(clamp(g.depth + (p.x - g.from.x) * 2, .2, 3) * 10) / 10;
  else if (g.kind === 'stripper') { requireThat(g.maxTravel >= .12, 'Оболочка ещё не снята'); result = run('strip', { depth: c.depth, untwist: clamp(Math.round(g.maxTravel * 45), 5, 40) }); c.mounted = null; }
  else if (g.kind === 'crimper') { requireThat(g.maxTravel >= .3, 'Сожмите рукоятки'); result = run('crimp'); c.mounted = null; }
  else if (g.kind === 'wire') { requireThat(p.z < -.52 && p.z > -1.02 && Math.abs(p.x) < .75, 'Жила не попала в контакт'); result = run(c.mode === 'panel' ? 'punch' : 'wire', { wire: g.wire, pin: clamp(Math.round(p.x / .18 + 3.5), 0, 7) }); }
  else {
    const x = g.origin.x + p.x - g.from.x, z = g.origin.z + p.z - g.from.z, jacket = Math.abs(x) < .55 && z > -.2 && z < .65, pins = Math.abs(x) < .85 && z > -1.05 && z < -.35;
    if (g.kind === 'connector') { requireThat(pins, 'Разъём не на концах жил'); result = run('insert'); }
    else if (c.tool === 'cutter' && !lab.draft) { requireThat(Math.abs(x - (-.95 + c.measure * .0475)) < .3 && Math.abs(z + .16) < .36, 'Режьте по отметке'); result = run('cut', { length: c.measure }); }
    else if (c.tool === 'cutter' && e && (pins || jacket)) result = run(pins && !e.inserted ? 'trim' : 'recut');
    else if (c.tool === 'stripper' && e && !e.stripped && jacket) c.mounted = 'stripper';
    else if (c.tool === 'crimper' && e?.inserted && !e.crimped && pins) c.mounted = 'crimper';
    else if (['tester', 'certifier'].includes(c.tool) && (jacket || pins)) result = run('test', { id: 'draft', certify: c.tool === 'certifier' });
    else requireThat(!['cutter', 'stripper', 'crimper', 'tester', 'certifier'].includes(c.tool), 'Инструмент не применён к заготовке');
  }
  return { result, interaction: publicContext(c) };
}
