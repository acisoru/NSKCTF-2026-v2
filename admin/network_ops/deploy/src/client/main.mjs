import { createIcons, icons } from 'lucide';
import { NetworkView } from './world.mjs';
import { COLORS, TOOLS, portPosition } from '../shared/catalog.mjs';
import { HELP } from '../shared/console-help.mjs';
import { LabAudio, resultSound, spatialSound } from './audio.mjs';
import { WORLD_SLOTS, toolShortcut } from './tool-shortcuts.mjs';

const $ = id => document.getElementById(id), show = (id, visible) => $(id).classList.toggle('hidden', !visible);
let state, end = 0, selectedCable = null, tool = 'hand', actionQueue = Promise.resolve(), pendingJob = null, labelId = null, toastTimer, history = [], historyIndex = 0;
const audio = new LabAudio(), sound = (kind, options) => audio.play(kind, options);
let worldQueue = Promise.resolve(), worldBusy = false, seenRat = null, lastCrackle = 0;
let currentGesture = null;
let movementCorrection = null;
const panelButtons = { inspector: 'toggle-inventory', ticket: 'toggle-tasks' };
const panelsOpen = () => Object.keys(panelButtons).some(id => !$(id).classList.contains('hidden'));
const blocked = () => !state || state.paused || !!document.querySelector('dialog[open]') || !$('terminal').classList.contains('hidden');
function updatePanels() {
  const open = panelsOpen(); document.body.classList.toggle('panels-open', open);
  document.body.classList.toggle('inventory-open', !$('inspector').classList.contains('hidden'));
  for (const [id, button] of Object.entries(panelButtons)) $(button).setAttribute('aria-expanded', String(!$(id).classList.contains('hidden')));
  view.setBlocked(blocked());
}
function closePanels() { for (const id of Object.keys(panelButtons)) show(id, false); updatePanels(); }
function togglePanel(id) {
  if (!state || state.paused || document.querySelector('dialog[open]') || !$('terminal').classList.contains('hidden')) return;
  show(id, $(id).classList.contains('hidden')); updatePanels(); sound('tap');
}
function toast(text) { $('toast').textContent = text; show('toast', true); clearTimeout(toastTimer); toastTimer = setTimeout(() => show('toast', false), 4200); }
function showBan(ban) {
  state = null; currentGesture = null; movementCorrection = null; closePanels();
  audio.setScene({ active: false });
  view.setBlocked(true); show('terminal', false); show('pause-screen', false); show('auth-gate', false);
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('ban-reason').textContent = ban?.reason || 'Повторные недопустимые действия в игре';
  $('ban-until').textContent = ban?.until ? `До ${new Date(ban.until).toLocaleString('ru-RU')}` : '';
  $('ban-reference').textContent = ban?.id ? `Код: ${ban.id}` : ''; show('ban-screen', true);
}
async function request(path, data, applyState = true) {
  const response = await fetch(path, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: state?.current, ...data }) });
  const value = await response.json();
  if (value.code === 'ACCOUNT_BANNED') { showBan(value.ban); throw new Error(value.error); }
  if (value.state && (applyState || !response.ok) && (!state || value.state.current === state.current || path === '/api/switch')) render(value.state);
  if (value.securityWarning) { const warning = 'Повторные недопустимые действия приведут к блокировке аккаунта.'; if (response.ok) toast(warning); else value.error = `${value.error}. ${warning}`; }
  if (response.status === 401) { state = null; show('auth-gate', true); view.setBlocked(true); }
  if (!response.ok) throw new Error(value.error || 'Сеть недоступна'); return value;
}
function action(value) {
  actionQueue = actionQueue.catch(() => {}).then(async () => {
    if (!state) return;
    await sendWorld();
    if (!state) return;
    if (['cut', 'strip', 'wire', 'trim', 'insert', 'crimp', 'recut', 'discard', 'rework'].includes(value.type)) { view.bench.measurement = 'CAT6 / READY'; $('measurement').textContent = ''; displayMap(); }
    const result = await request('/api/action', { revision: state.lab.revision, action: value });
    measurement(result.result);
    sound(resultSound(value.type, result.result)); return result;
  }).catch(error => { toast(error.message); sound('error'); }); return actionQueue;
}
function measurement(result) { if (result?.message) { $('measurement').textContent = result.message; $('alice').textContent = result.message; displayMap(result.map); view.bench.measurement = result.message; if (view.mode === 'bench') view.assembly(state.lab); } }
async function contextRequest(change) {
  if (!state || state.paused) return;
  await sendWorld(); if (!state || state.paused) return; return request('/api/context', change);
}
function selectTool(value) {
  if (!state || value === tool) return actionQueue;
  chooseTool(value); actionQueue = actionQueue.catch(() => {}).then(async () => { if (await contextRequest({ tool: value })) sound('tool'); }).catch(error => { toast(error.message); sound('error'); }); return actionQueue;
}
function focusRequest(mode) {
  closePanels();
  actionQueue = actionQueue.catch(() => {}).then(() => contextRequest({ mode })).catch(error => toast(error.message)); return actionQueue;
}
function sendGesture(input) {
  if (!state) return;
  if (input.phase === 'begin') currentGesture = { level: state.current, token: null, began: performance.now(), ackAt: null, kind: input.gesture, tool: input.tool, revision: state.lab.revision };
  const g = currentGesture; if (!g) return;
  const offset = performance.now() - g.began;
  actionQueue = actionQueue.catch(() => {}).then(async () => {
    if (!state || g.level !== state.current || state.paused) return;
    if (input.phase === 'begin') {
      chooseTool(input.tool); await contextRequest({ tool: input.tool });
      if (!state || state.paused || g.level !== state.current) return;
      const result = await request('/api/gesture', { revision: state.lab.revision, phase: 'begin', kind: input.gesture, point: input.point }, false); g.token = result.token; g.ackAt = performance.now();
    } else if (g.token || input.phase === 'cancel') {
      // Preserve input spacing when the begin acknowledgement arrives after mouse events.
      if (g.ackAt !== null && input.phase !== 'cancel') await new Promise(resolve => setTimeout(resolve, Math.max(0, g.ackAt + offset - performance.now())));
      const result = await request('/api/gesture', { revision: state.lab.revision, phase: input.phase, point: input.point, token: g.token });
      if (input.phase === 'end') { measurement(result.result); sound(resultSound(g.kind === 'tool' ? g.tool === 'cutter' && state.lab.revision !== g.revision ? 'cut' : 'tool' : g.kind, result.result)); }
    }
  }).catch(error => { g.token = null; if (input.phase !== 'cancel') { toast(error.message); sound('error'); } });
  if (input.phase === 'end' || input.phase === 'cancel') currentGesture = null;
  return actionQueue;
}
function chooseTool(value) { tool = value; view.tool = value; document.body.classList.toggle('armed', value === 'shotgun'); $('tool-name').textContent = TOOLS.find(t => t[0] === value)[2].toUpperCase(); $('instrument-name').textContent = value === 'certifier' ? 'СЕРТИФИКАТОР / 1000BASE-T' : value === 'toner' ? 'ТОНАЛЬНЫЙ ГЕНЕРАТОР' : 'КАБЕЛЬНЫЙ ТЕСТЕР'; document.querySelectorAll('[data-tool]').forEach(b => { b.classList.toggle('selected', b.dataset.tool === value); b.setAttribute('aria-pressed', String(b.dataset.tool === value)); }); }
function updateIncident(s) {
  const previous = state?.lab.incident;
  if (previous?.reload > 0 && !s.reload && s.ammo === 6) sound('ready');
  if (state) state.lab.incident = s;
  view.incidents.update(s);
  document.querySelector('[data-tool="shotgun"]').disabled = !s.shotgun;
  $('ammo').textContent = s.shotgun ? s.reload > 0 ? 'ПЕРЕЗАРЯДКА' : `${s.ammo} / 6` : '';
  $('incident-status').textContent = s.rat && s.rat.state !== 'dead' ? s.rat.state === 'chewing' ? 'ОПАСНОСТЬ / ПОВРЕЖДЕНИЕ ЛИНИИ' : 'ВЕНТИЛЯЦИЯ / ДВИЖЕНИЕ' : '';
  if (s.rat && s.rat.id !== seenRat) { seenRat = s.rat.id; sound('rat', spatialSound(s.rat, view.camera.position, view.yaw)); }
}
function sendWorld(command = null, direction = null) {
  if (!state || state.paused || !command && worldBusy) return worldQueue;
  worldBusy = true;
  worldQueue = worldQueue.catch(() => {}).then(async () => {
    if (!state || state.paused) return;
    const level = state.current;
    const result = await request('/api/world', { revision: state.lab.revision, pose: { x: view.body.position.x, z: view.body.position.z }, command, direction, correction: movementCorrection }, false);
    if (!state || result.level !== state.current || level !== state.current) return;
    movementCorrection = result.correction ?? null;
    if (result.state && result.state.lab.revision > state.lab.revision) render(result.state);
    updateIncident(result.incident);
    if (result.corrected) view.reconcile(result.incident.pose); else view.confirmPosition();
    if (result.result?.taken) { chooseTool('shotgun'); await request('/api/context', { tool: 'shotgun' }); }
    if (result.result?.fired) { view.incidents.fire(direction, result.result.hit); sound('shot'); }
    else if (command === 'shoot' && !result.incident.ammo) { toast('Магазин пуст'); sound('empty'); }
    if (command === 'reload' && result.result?.reloading) sound('reload');
    return result;
  }).catch(error => { if (command) toast(error.message); }).finally(() => { worldBusy = false; });
  return worldQueue;
}
function inspectBench() { return focusRequest('bench'); }
function openConsole() { if (!state?.lab.console) return toast('Консольный кабель не подключён'); closePanels(); view.setBlocked(true); show('terminal', true); $('command').focus(); }
function openDialog(id) { closePanels(); view.setBlocked(true); $(id).showModal(); }
async function interact(target) {
  if (target.kind === 'pointer-error') { toast('Браузер отклонил захват курсора. Обзор с зажатой ПКМ остаётся доступен.'); return; }
  if (target.kind === 'focus') { document.body.classList.toggle('bench-mode', target.mode === 'bench'); document.body.classList.toggle('panel-mode', target.mode === 'panel'); $('work-title').textContent = target.mode === 'panel' ? 'PP-01 / разделка' : 'Инвентарь'; return; }
  if (!state) return;
  if (target.kind === 'focus-request') return focusRequest(target.mode);
  if (target.kind === 'gesture') return sendGesture(target);
  if (target.kind === 'shotgun') { await sendWorld('take'); return; }
  if (target.kind === 'shoot') { await sendWorld('shoot', target.direction); return; }
  if (target.kind === 'reload') { await sendWorld('reload'); return; }
  if (target.kind === 'toggle-shotgun') { if (view.incidents.state?.shotgun) selectTool(tool === 'shotgun' ? 'hand' : 'shotgun'); return; }
  if (target.kind === 'bench-tool') return selectTool(target.tool);
  if (target.kind === 'bench-end') { actionQueue = actionQueue.catch(() => {}).then(() => contextRequest({ end: target.end })).catch(error => toast(error.message)); return actionQueue; }
  if (target.kind === 'bench-action') {
    const { kind, ...value } = target;
    if (value.type === 'test') value.id = state.lab.draft ? 'draft' : selectedCable;
    if (value.type === 'discard' && state.lab.draft) { openDialog('discard-dialog'); return; }
    await action({ ...value, end }); return;
  }
  if (['wire', 'jacket'].includes(target.kind) && ['tester', 'certifier'].includes(tool)) { await action(view.mode === 'panel' ? { type: 'panel-test' } : { type: 'test', id: 'draft', certify: tool === 'certifier' }); return; }
  if (target.kind === 'console') { if (tool !== 'console') return toast('Нужен консольный кабель'); await action({ type: 'console', device: target.device }); openConsole(); return; }
  if (target.kind === 'power') { await action({ type: 'power', device: target.device }); return; }
  if (target.kind === 'tray') { if (!selectedCable) return toast('Выберите кабель'); await action({ type: 'route', id: selectedCable, anchor: target.id }); return; }
  if (target.kind === 'port') {
    if (tool === 'toner') { await action({ type: 'tone', port: target.port }); return; }
    if (tool === 'label') { const cable = state.lab.cables.find(c => c.plugs.includes(target.port)); if (!cable) return toast('На этом порту нет кабеля'); labelId = cable.id; $('label-text').value = cable.label; openDialog('label-dialog'); return; }
    if (!selectedCable) return toast('Выберите патч-корд');
    await action({ type: 'plug', id: selectedCable, port: target.port });
  }
}
let view;
try { view = new NetworkView($('scene'), interact, text => { $('hover-label').textContent = text; }); }
catch (error) { $('alice').textContent = 'WebGL недоступен. Требуется аппаратное ускорение браузера.'; throw error; }
$('tools').innerHTML = [...WORLD_SLOTS, 'label', 'shotgun'].map(id => TOOLS.find(t => t[0] === id)).map(([id, icon, name]) => `<button data-tool="${id}" title="${name}${WORLD_SLOTS.includes(id) ? ` · ${WORLD_SLOTS.indexOf(id) + 1}` : ''}" aria-label="${name}"${WORLD_SLOTS.includes(id) ? ` aria-keyshortcuts="${WORLD_SLOTS.indexOf(id) + 1}"` : ''}><i data-lucide="${icon}"></i></button>`).join('');
$('standard').innerHTML = COLORS.map((c, i) => `<span style="background:${c.stripe ? `linear-gradient(135deg,#e8eddf 40%,${c.color} 40%,${c.color} 60%,#e8eddf 60%)` : c.color}">${i + 1}</span>`).join('');
$('command-reference').textContent = HELP;
createIcons({ icons }); chooseTool('hand');
for (const [id, button] of Object.entries(panelButtons)) $(button).addEventListener('click', () => togglePanel(id));
document.querySelectorAll('[data-close-panel]').forEach(button => button.addEventListener('click', () => { show(button.dataset.closePanel, false); updatePanels(); }));
addEventListener('keydown', event => {
  const shortcut = toolShortcut(event, { mode: view.mode, blocked: blocked(), dragging: !!(view.drag || view.bench.drag || currentGesture), target: document.activeElement });
  if (shortcut) { event.preventDefault(); selectTool(shortcut); return; }
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  if (event.code === 'KeyI' || event.code === 'KeyJ') { event.preventDefault(); togglePanel(event.code === 'KeyI' ? 'inspector' : 'ticket'); }
});
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => selectTool(b.dataset.tool)));
document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', async () => { try { await actionQueue; await request('/api/switch', { target: b.dataset.level }); selectedCable = null; show('terminal', false); $('terminal-output').textContent = ''; } catch (error) { toast(error.message); } }));
$('confirm-discard').addEventListener('click', async () => { await action({ type: 'discard' }); $('discard-dialog').close(); });
$('inspect-bench').addEventListener('click', inspectBench); $('exit-focus').addEventListener('click', () => view.focus('world'));
function displayMap(map = []) { $('wiremap').innerHTML = Array.from({ length: 8 }, (_, i) => `<span class="${map[i] ? 'live' : 'fail'}">${i + 1}:${map[i] || '×'}</span>`).join(''); }
$('test-cable').addEventListener('click', () => {
  if (view.mode === 'panel') { action({ type: 'panel-test' }); return; }
  const id = state?.lab.draft ? 'draft' : selectedCable;
  if (!id) return toast('Подключите кабель к измерителю'); action({ type: 'test', id, certify: tool === 'certifier' });
});
$('inventory').addEventListener('click', async e => {
  const b = e.target.closest('[data-cable]'); if (!b) return;
  const id = b.dataset.cable;
  if (b.dataset.command === 'unplug') { await selectTool('hand'); action({ type: 'unplug', id, port: nearestPlug(id) }); }
  else if (b.dataset.command === 'rework') { await inspectBench(); if (view.mode === 'bench') action({ type: 'rework', id }); }
  else if (b.dataset.command === 'label') { await selectTool('label'); labelId = id; $('label-text').value = state.lab.cables.find(c => c.id === id).label; openDialog('label-dialog'); }
  else { selectedCable = id; view.selectedCable = id; await selectTool('hand'); render(state); }
});
function nearestPlug(id) { return state.lab.cables.find(c => c.id === id)?.plugs.filter(Boolean).sort((a, b) => { const p = portPosition(state.lab.spec, a), q = portPosition(state.lab.spec, b); return Math.hypot(p.x - view.body.position.x, p.z - view.body.position.z) - Math.hypot(q.x - view.body.position.x, q.z - view.body.position.z); })[0]; }
$('label-form').addEventListener('submit', async e => { e.preventDefault(); await action({ type: 'label', id: labelId, port: nearestPlug(labelId), text: $('label-text').value }); $('label-dialog').close(); });
$('open-console').addEventListener('click', openConsole); $('terminal-close').addEventListener('click', () => { show('terminal', false); document.activeElement.blur(); focusRequest('world'); });
function terminal(text) { $('terminal-output').textContent += text + '\n'; $('terminal-output').scrollTop = $('terminal-output').scrollHeight; }
$('terminal-form').addEventListener('submit', async e => {
  e.preventDefault(); const line = $('command').value.trim(); if (!line) return; $('command').value = ''; history.push(line); historyIndex = history.length;
  terminal(`${state.lab.console}> ${line}`);
  try { await actionQueue; const result = await request('/api/command', { revision: state.lab.revision, line }); if (result.job) watchJob(result.job, true); else if (result.result.clear) $('terminal-output').textContent = ''; else terminal(result.result.output); }
  catch (error) { terminal(`ERROR: ${error.message}`); sound('error'); }
});
$('command').addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); historyIndex = Math.max(0, Math.min(history.length, historyIndex + (e.key === 'ArrowUp' ? -1 : 1))); $('command').value = history[historyIndex] ?? ''; } if (e.key === 'Escape') { show('terminal', false); e.target.blur(); focusRequest('world'); } });
const syncBlocked = () => view.setBlocked(blocked());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { $(b.dataset.close).close(); syncBlocked(); }));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', syncBlocked));
$('document').addEventListener('click', () => openDialog('manual'));
$('reset').addEventListener('click', () => openDialog('reset-dialog'));
$('confirm-reset').addEventListener('click', async () => { try { await request('/api/reset', { confirm: state.current }); $('reset-dialog').close(); selectedCable = null; end = 0; render(state); } catch (error) { toast(error.message); } });
$('crt').addEventListener('click', e => { view.film.enabled = !view.film.enabled; e.currentTarget.setAttribute('aria-pressed', String(view.film.enabled)); });
function audioControls() {
  const { muted, music, effects } = audio.preferences;
  $('sound').innerHTML = `<i data-lucide="${muted ? 'volume-x' : 'volume-2'}"></i>`; $('sound').setAttribute('aria-pressed', String(muted));
  $('sound').title = $('sound').ariaLabel = muted ? 'Включить звук' : 'Выключить звук';
  $('audio-muted').checked = muted;
  for (const [id, value] of [['music', music], ['effects', effects]]) { $(`volume-${id}`).value = Math.round(value * 100); $(`output-${id}`).value = `${Math.round(value * 100)}%`; }
  createIcons({ icons });
}
$('sound').addEventListener('click', () => { audio.configure({ muted: !audio.preferences.muted }); audio.unlock(); audioControls(); sound('tap'); });
$('audio-settings').addEventListener('click', () => openDialog('audio-dialog'));
$('audio-muted').addEventListener('change', event => { audio.configure({ muted: event.target.checked }); audio.unlock(); audioControls(); });
for (const id of ['music', 'effects']) {
  $(`volume-${id}`).addEventListener('input', event => { audio.configure({ [id]: Number(event.target.value) / 100 }); audio.unlock(); audioControls(); });
  if (id === 'effects') $(`volume-${id}`).addEventListener('change', () => sound('test'));
}
for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, e => { if (e.isTrusted) audio.unlock(); }, { capture: true });
audioControls();
$('verify').addEventListener('click', async () => { try { await actionQueue; const result = await request('/api/check', {}); watchJob(result.job); } catch (error) { toast(error.message); } });
$('copy-flag').addEventListener('click', () => navigator.clipboard.writeText($('flag').textContent).then(() => toast('Флаг скопирован')).catch(() => toast('Буфер обмена недоступен')));
$('archive').addEventListener('click', () => { $('job-status').textContent = 'НАРЯД ПРИНЯТ'; show('reward', true); $('flag').textContent = state.reward; displayReport(state.lab.lastReport ?? { checks: [], output: '' }); openDialog('report'); });
function displayReport(report) {
  $('checks').replaceChildren();
  for (const check of report.checks) { const row = document.createElement('div'); row.className = `check ${check.ok ? 'pass' : ''}`; row.innerHTML = `<i data-lucide="${check.ok ? 'check' : 'x'}"></i>`; const content = document.createElement('div'), label = document.createElement('span'), detail = document.createElement('small'); label.textContent = check.name; detail.textContent = check.detail || ''; content.append(label, detail); row.append(content); $('checks').append(row); }
  $('diagnostic-output').textContent = report.output; createIcons({ icons });
}
async function watchJob(id, diagnostic = false) {
  pendingJob = id; $('verify').disabled = true; $('checks').replaceChildren(); $('diagnostic-output').textContent = ''; show('reward', false); $('job-status').textContent = 'Стенд поставлен в очередь.'; if (!diagnostic && !$('report').open) openDialog('report'); if (diagnostic) terminal('Диагностический стенд поставлен в очередь…');
  try {
    for (;;) {
      const job = await request(`/api/job?id=${id}`);
      $('job-status').textContent = job.status === 'queued' ? `ОЧЕРЕДЬ / ПОЗИЦИЯ ${job.position}` : job.status === 'running' ? 'СТЕНД АКТИВЕН / ПРОВЕРКА СЕТИ' : job.status === 'error' ? job.error : job.stale ? 'Конфигурация изменилась во время проверки. Результат не засчитан.' : `ПРОВЕРКА ЗАВЕРШЕНА / ${job.report.seconds.toFixed(1)} С`;
      if (job.status === 'error') { if (diagnostic) terminal(`ERROR: ${job.error}`); sound('error'); break; }
      if (job.status === 'done') {
        if (job.stale) { if (diagnostic) terminal('Результат устарел.'); break; }
        displayReport(job.report); if (diagnostic) terminal(job.report.output);
        show('reward', !!job.reward && !job.stale && !diagnostic); $('flag').textContent = job.reward ?? ''; createIcons({ icons }); sound(job.reward ? 'success' : job.report.checks.some(c => !c.ok) ? 'error' : 'test'); break;
      }
      await new Promise(r => setTimeout(r, 900));
    }
  } catch (error) { $('job-status').textContent = error.message; }
  finally { pendingJob = null; $('verify').disabled = false; }
}
function render(next) {
  if (state?.current !== next.current || next.paused) closePanels();
  state = next; const lab = state.lab, spec = lab.spec, preserveWork = !!(view.drag || view.bench.drag);
  end = state.interaction.end; chooseTool(state.interaction.tool); view.bench.length = state.interaction.measure; view.bench.depth = state.interaction.depth;
  show('pause-screen', state.paused); if (state.paused) { show('terminal', false); view.setBlocked(true); }
  document.querySelectorAll('[data-level]').forEach(b => { b.classList.toggle('selected', b.dataset.level === state.current); b.classList.toggle('done', state.progress.find(p => p.level === b.dataset.level).won); });
  $('shift').textContent = `СМЕНА ${state.shift}`; $('sector').textContent = spec.sector; $('title').textContent = spec.title; $('ticket-number').textContent = `НАРЯД / 0${spec.number}`; $('completion').textContent = lab.won ? 'ПРИНЯТ' : 'ОТКРЫТ';
  show('archive', !!state.reward);
  $('objectives').replaceChildren(...spec.order.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  $('address-plan').textContent = Object.entries(spec.addresses).map(([name, address]) => `${name}: ${address}`).join('\n');
  $('device-plan').replaceChildren(...spec.devices.map(d => { const row = document.createElement('div'); row.className = 'device-note'; row.textContent = `${d.id.toUpperCase()} / ${d.name}\n${d.ports.join(' · ')}`; return row; }));
  $('wiring-plan').textContent = spec.wiring.map(edge => edge.join(' <-> ')).join('\n');
  $('bench-status').textContent = lab.draft ? `CAT6 / ${lab.draft.length} М / КОНЕЦ ${end ? 'B' : 'A'}` : 'CAT6 / БУХТА';
  $('stages').textContent = '';
  if (lab.draft?.ends) { const e = lab.draft.ends[end]; $('stages').textContent = [e.stripped ? 'ОБОЛОЧКА СНЯТА' : 'ОБОЛОЧКА ЦЕЛА', e.order.filter(Boolean).length + '/8 ЖИЛ', e.trimmed ? 'ПОДРЕЗАНО' : '', e.inserted ? 'RJ45 УСТАНОВЛЕН' : '', e.crimped ? 'ОБЖАТО' : ''].filter(Boolean).join(' / '); }
  $('cable-count').textContent = lab.cables.length;
  const fragment = document.createDocumentFragment();
  for (const cable of lab.cables) {
    const row = document.createElement('div'); row.className = `cable-item ${cable.id === selectedCable ? 'selected' : ''}`;
    const select = document.createElement('button'); select.className = 'icon'; select.dataset.cable = cable.id; select.title = 'Выбрать кабель'; select.setAttribute('aria-label', `Выбрать: ${cable.label}`); select.innerHTML = '<i data-lucide="cable"></i>';
    const info = document.createElement('div'), name = document.createElement('strong'), status = document.createElement('small'); name.textContent = cable.label; status.textContent = `${cable.damage ? 'ПЕРЕГРЫЗЕН / ' : ''}${cable.length} м / ${cable.plugs.filter(Boolean).length}/2 · ${cable.plugs.filter(Boolean).join(' ↔ ') || 'свободен'}`; row.classList.toggle('damaged', !!cable.damage); info.append(name, status);
    const label = document.createElement('button'); label.className = 'icon'; label.dataset.cable = cable.id; label.dataset.command = 'label'; label.title = 'Маркировка'; label.setAttribute('aria-label', 'Маркировка'); label.innerHTML = '<i data-lucide="tag"></i>';
    const unplug = document.createElement('button'); unplug.className = 'icon'; unplug.dataset.cable = cable.id; unplug.dataset.command = 'unplug'; unplug.disabled = !cable.plugs.some(Boolean); unplug.title = 'Отключить кабель'; unplug.setAttribute('aria-label', 'Отключить кабель'); unplug.innerHTML = '<i data-lucide="unplug"></i>';
    const repair = document.createElement('button'); repair.className = 'icon'; repair.dataset.cable = cable.id; repair.dataset.command = 'rework'; repair.disabled = cable.plugs.some(Boolean) || !!lab.draft; repair.title = 'На верстак / ремонт'; repair.setAttribute('aria-label', 'Ремонт кабеля'); repair.innerHTML = '<i data-lucide="wrench"></i>';
    row.append(select, info, label, unplug, repair); fragment.append(row);
  }
  $('inventory').replaceChildren(fragment); $('terminal-title').textContent = `CONSOLE / ${lab.console?.toUpperCase() ?? 'НЕ ПОДКЛЮЧЕНО'} / LabOS`; $('prompt').textContent = `${lab.console ?? 'lab'}>`; $('open-console').disabled = !lab.console;
  if (lab.log.length) $('alice').textContent = lab.log.at(-1).text;
  const mode = state.interaction.mode === 'console' ? 'world' : state.interaction.mode;
  view.update(lab, end, preserveWork, mode); if (!preserveWork && mode === 'bench' && state.interaction.mounted) view.bench.mount(state.interaction.mounted);
  createIcons({ icons });
  if (lab.incident) { updateIncident(lab.incident); if (!lab.incident.shotgun && tool === 'shotgun') chooseTool('hand'); }
}
async function start() {
  try {
    const session = await request('/api/session'); if (session.ban) { showBan(session.ban); return; }
    show('ban-screen', false); show('auth-gate', !session.authenticated);
    $('login-status').textContent = session.configured ? '' : 'OAuth не настроен'; $('yandex-login').classList.toggle('unavailable', !session.configured);
    if (!session.authenticated) { view.setBlocked(true); return; }
    state = await request('/api/state'); state.paused = true; show('pause-screen', true); await request('/api/resume', {});
    const level = new URL(location.href).searchParams.get('level'); if (['easy', 'medium', 'hard'].includes(level) && level !== state.current) await request('/api/switch', { target: level });
  } catch (error) { toast(error.message); }
}
$('resume').addEventListener('click', () => request('/api/resume', {}).catch(error => toast(error.message)));
$('pause').addEventListener('click', () => request('/api/pause', {}).catch(error => toast(error.message)));
$('logout').addEventListener('click', async () => { audio.setScene({ active: false }); await fetch('/auth/logout', { method: 'POST' }); location.reload(); });
$('ban-logout').addEventListener('click', () => $('logout').click());
$('ban-retry').addEventListener('click', start);
document.addEventListener('visibilitychange', () => { audio.setScene({ active: !!state && !state.paused, hidden: document.hidden }); if (document.hidden && state && !state.paused) { navigator.sendBeacon('/api/pause', new Blob([JSON.stringify({ level: state.current })], { type: 'application/json' })); state.paused = true; show('pause-screen', true); } });
addEventListener('pagehide', () => audio.dispose());
start();
async function worldPulse() {
  if (state && !document.hidden) await sendWorld();
  if (state && !state.paused && !document.hidden && performance.now() - lastCrackle > 800) {
    const nearest = view.incidents.breaks.reduce((a, b) => !a || b.group.position.distanceTo(view.camera.position) < a.group.position.distanceTo(view.camera.position) ? b : a, null);
    if (nearest && nearest.group.position.distanceTo(view.camera.position) < 9) { sound('spark', spatialSound(nearest.group.position, view.camera.position, view.yaw)); lastCrackle = performance.now(); }
  }
  setTimeout(worldPulse, view.incidents.state?.rat ? 160 : 650);
}
worldPulse();
let previous = performance.now(), stride = 0;
function frame(now) {
  const dt = Math.min(.06, (now - previous) / 1000); previous = now; view.setBlocked(blocked());
  audio.setScene({ active: !!state && !state.paused, hidden: document.hidden, focus: view.mode !== 'world' || !$('terminal').classList.contains('hidden') || !!document.querySelector('dialog[open]') });
  const { x, z } = view.body.position; view.render(dt);
  const distance = Math.hypot(view.body.position.x - x, view.body.position.z - z);
  if (!blocked() && view.mode === 'world' && distance > .001 && distance < .6) { stride += distance; if (stride > 1.5) { sound('step'); stride = 0; } } else stride = 0;
  $('coordinates').textContent = `${view.body.position.x.toFixed(0)} : ${view.body.position.z.toFixed(0)}`; requestAnimationFrame(frame);
} requestAnimationFrame(frame);
