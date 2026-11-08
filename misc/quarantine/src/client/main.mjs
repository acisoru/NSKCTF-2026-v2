import { createIcons, icons } from 'lucide';
import { WorldView } from './world.mjs';
import { GameAudio } from './audio.mjs';
import { CAMERA, WEAPONS, ROLES, SAFE_ZONES, BOSSES, BOMBER, ITEMS, RARITY, SHOP, WORLD } from '../shared/config.mjs';
import { StateReplica } from '../shared/replica.mjs';
import { AdminPanel } from './admin.mjs';

const $ = id => document.getElementById(id);
const show = (id, value) => $(id).classList.toggle('hidden', !value);
const text = (id, value) => { if ($(id).textContent !== String(value)) $(id).textContent = value; };
const store = { get: k => { try { return localStorage.getItem(`labx-world-${k}`); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(`labx-world-${k}`, v); } catch {} } };
let replica = new StateReplica(), worldState = null, inputSeq = 0, requiresAuth = true;
createIcons({ icons });
let view;
try { view = new WorldView($('scene')); } catch (e) { text('alice-text', 'WebGL недоступен. Включите аппаратное ускорение браузера.'); console.error(e); }
let state, ws, ready = false, won = false, yaw = 0, role = store.get('role') || 'assault', retryTimer, id, inventoryKey = '', partyKey = '', objectivesKey = '', lastNotice = '';
let pitch = CAMERA.pitch, roll = 0, cameraFov = CAMERA.fov;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function resetCamera() { pitch = CAMERA.pitch; roll = 0; cameraFov = CAMERA.fov; }
const audio = new GameAudio({ muted: store.get('muted') === 'true' });
const panels = ['inventory', 'party', 'shop', 'journal', 'admin'];
const keys = new Set(), held = new Set(), pendingActions = new Set();
let lookPointer = null, lookX = 0, lookY = 0;
let toastTimer;
let recreateRevision = null, recreating = false, recreationError = '';
function toast(message) { text('toast', message); show('toast', true); clearTimeout(toastTimer); toastTimer = setTimeout(() => show('toast', false), 3500); }
function send(message) { if (ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function addMessage(name, message) {
  const row = document.createElement('div'); row.className = 'message'; const label = document.createElement('b'); label.textContent = name;
  const body = document.createElement('span'); body.textContent = message; row.append(label, body); $('messages').append(row);
  while ($('messages').children.length > 100) $('messages').firstChild.remove(); $('messages').scrollTop = $('messages').scrollHeight;
}
function clearInput() { keys.clear(); held.clear(); pendingActions.clear(); lookPointer = null; }
function panel(name) { const opening = $(name).classList.contains('hidden'); for (const p of panels) show(p, false); show(name, opening); if (opening) { document.exitPointerLock?.(); clearInput(); } }
function overlay() { return panels.some(p => !$(p).classList.contains('hidden')) || !$('reward-modal').classList.contains('hidden') || !!document.querySelector('dialog[open]'); }
function closePanels() { for (const p of panels) show(p, false); }
async function copy(value) { try { await navigator.clipboard.writeText(value); toast('Скопировано'); } catch { toast('Буфер обмена недоступен'); } }
function beep(frequency = 360) { audio.beep(frequency); }
function soundButton() {
  $('sound').innerHTML = `<i data-lucide="${audio.muted ? 'volume-x' : 'volume-2'}"></i>`;
  $('sound').setAttribute('aria-label', audio.muted ? 'Включить звук' : 'Выключить звук');
  $('sound').setAttribute('aria-pressed', String(!audio.muted)); createIcons({ icons });
}
soundButton();
for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => audio.unlock(), { passive: true });
function pickRole(value) {
  role = Object.hasOwn(ROLES, value) ? value : 'assault'; store.set('role', role);
  document.querySelectorAll('[data-role]').forEach(b => { b.classList.toggle('selected', b.dataset.role === role); b.setAttribute('aria-pressed', String(b.dataset.role === role)); });
  text('role-health', `${ROLES[role].hp} HP`); text('role-ability', ROLES[role].ability);
}
pickRole(role); $('callsign').value = store.get('name') || 'Ревизор';
document.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => pickRole(b.dataset.role)));
$('entry-form').addEventListener('submit', e => { e.preventDefault(); if (!ready) return toast('Нет связи с лабораторией'); store.set('name', $('callsign').value); send({ type: 'enter', name: $('callsign').value, role }); });
for (const p of panels.filter(p => p !== 'admin')) $(p === 'journal' ? 'journal-toggle' : p === 'shop' ? 'interact' : `${p}-toggle`)?.addEventListener('click', () => { if (p !== 'shop' || state?.self.shop) panel(p); });
const adminPanel = new AdminPanel({ getState: () => state, send, togglePanel: panel, notify: toast, clearInput });
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => show(b.dataset.close, false)));
$('party-create').addEventListener('click', () => send({ type: 'party-create' }));
$('party-join').addEventListener('click', () => send({ type: 'party-join', code: $('party-code').value }));
$('party-leave').addEventListener('click', () => send({ type: 'party-leave' }));
$('party-copy').addEventListener('click', () => copy(`${location.origin}/?team=${state.self.partyCode}`));
$('flag-copy').addEventListener('click', () => copy(state.reward.flag));
$('reward-close').addEventListener('click', () => show('reward-modal', false));
function recreationControls() {
  if (!$('recreate-dialog').open) return;
  const selected = document.querySelector('input[name="new-role"]:checked')?.value;
  $('recreate-submit').disabled = recreating || !state?.self.canRecreate || !selected || selected === state.self.role || !$('recreate-ack').checked;
  if (!recreating) text('recreate-error', recreationError || (state?.self.canRecreate ? '' : state?.self.recreateWait > 0 ? `Повторное пересоздание через ${state.self.recreateWait} с.` : 'Нужен живой персонаж на земле в зелёной зоне, без режима администратора.'));
}
$('recreate-open').addEventListener('click', () => {
  if (!state) return;
  recreateRevision = state.self.characterRevision; recreating = false; recreationError = ''; $('recreate-form').reset(); text('recreate-error', '');
  for (const radio of document.querySelectorAll('input[name="new-role"]')) radio.disabled = radio.value === state.self.role;
  document.exitPointerLock?.(); clearInput(); $('recreate-dialog').showModal(); recreationControls();
});
$('recreate-form').addEventListener('change', () => { recreationError = ''; recreationControls(); });
$('recreate-cancel').addEventListener('click', () => { if (!recreating) $('recreate-dialog').close(); });
$('recreate-dialog').addEventListener('cancel', event => { if (recreating) event.preventDefault(); });
$('recreate-form').addEventListener('submit', event => {
  event.preventDefault(); const nextRole = document.querySelector('input[name="new-role"]:checked')?.value;
  if (!ready || !state || recreating || !state.self.canRecreate || !nextRole || nextRole === state.self.role || !$('recreate-ack').checked) return;
  recreating = true; recreationError = ''; text('recreate-error', ''); recreationControls();
  send({ type: 'character-recreate', role: nextRole, confirm: state.self.id, revision: recreateRevision });
});
$('archive-toggle').addEventListener('click', () => { document.exitPointerLock?.(); clearInput(); show('reward-modal', true); });
$('camera-reset').addEventListener('click', resetCamera);
$('logout').addEventListener('click', async () => { if (requiresAuth) await fetch('/auth/logout', { method: 'POST' }); ws?.close(); reset(); connect(); });
$('chat-form').addEventListener('submit', e => { e.preventDefault(); if (state && $('chat-input').value.trim()) { send({ type: 'chat', text: $('chat-input').value }); $('chat-input').value = ''; } });
$('sound').addEventListener('click', () => { audio.setMuted(!audio.muted); store.set('muted', String(audio.muted)); soundButton(); beep(); });
const invite = new URL(location.href).searchParams.get('team'); if (invite) $('party-code').value = invite.slice(0, 8).toUpperCase();
$('items').addEventListener('click', event => { const b = event.target.closest('button[data-item]'); if (b) send({ type: b.dataset.command, id: b.dataset.item }); });
$('shop-items').addEventListener('click', event => { const b = event.target.closest('button[data-buy]'); if (b) send({ type: 'buy', item: b.dataset.buy }); });
const slotNames = { weapon: 'Оружие', armor: 'Броня', relic: 'Артефакт' }, slotIcons = { weapon: 'crosshair', armor: 'shield', relic: 'cpu' };
const itemStat = item => item.damage ? `${WEAPONS[item.weapon ?? 'rifle'].name} · +${item.damage}` : item.armor ? `${Math.round(item.armor * 100)}% ЗАЩИТА` : `+${item.hp} HP`;
$('shop-items').innerHTML = SHOP.map(key => {
  const i = ITEMS[key]; return `<div class="item"><i data-lucide="${i ? slotIcons[i.slot] : 'heart-pulse'}"></i><div class="item-info"><strong>${i?.name ?? 'Аптечка'}</strong><small>${i ? itemStat(i) : '45% ЗДОРОВЬЯ'} · ${i?.price ?? 25} CR</small></div><button class="icon" data-buy="${key}" title="Купить ${i?.name ?? 'аптечку'}" aria-label="Купить ${i?.name ?? 'аптечку'}"><i data-lucide="shopping-cart"></i></button></div>`;
}).join(''); createIcons({ icons });

function reset() { state = null; recreating = false; $('recreate-dialog').close(); inventoryKey = partyKey = objectivesKey = ''; view?.clear(); adminPanel.update(null); show('entry', true); show('hud', false); show('reward-modal', false); document.body.classList.remove('playing'); closePanels(); clearInput(); }
function showReward(reward) {
  won = true; state = null; view?.clear(); adminPanel.update(null); closePanels(); clearInput();
  show('entry', true); show('hud', false); show('auth-box', false); show('entry-form', false); show('reward-modal', true);
  text('flag', reward.flag); text('clue', reward.clue); document.body.classList.remove('playing');
}
async function connect() {
  clearTimeout(retryTimer);
  let session;
  try { session = await (await fetch('/api/session', { cache: 'no-store' })).json(); }
  catch { text('connection', 'СВЯЗЬ ПОТЕРЯНА'); retryTimer = setTimeout(connect, 2000); return; }
  requiresAuth = session.requiresAuth;
  if (!session.authenticated && state) reset();
  show('auth-box', !session.authenticated); show('entry-form', !!session.authenticated); show('logout', requiresAuth && session.authenticated);
  if (!session.authenticated) {
    text('connection', 'ТРЕБУЕТСЯ ВХОД'); text('auth-status', session.configured ? '' : 'Авторизация ожидает настройки');
    $('yandex-login').classList.toggle('unavailable', !session.configured); $('yandex-login').setAttribute('aria-disabled', String(!session.configured)); return;
  }
  if (requiresAuth && store.get('token')) {
    await fetch('/auth/migrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: store.get('token') }) });
    try { localStorage.removeItem('labx-world-token'); } catch {}
  }
  replica = new StateReplica(); worldState = null; inputSeq = 0;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); ws = socket;
  socket.binaryType = 'arraybuffer';
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', world: true, compression: typeof DecompressionStream !== 'undefined', ...(!requiresAuth ? { token: store.get('token') } : {}) })));
  let incoming = Promise.resolve();
  const message = async event => {
    if (ws !== socket) return;
    const raw = typeof event.data === 'string' ? event.data : await new Response(new Blob([event.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    const m = JSON.parse(raw);
    if (m.type === 'hello') { if (id && id !== m.id) reset(); id = m.id; if (!requiresAuth && m.token) store.set('token', m.token); ready = true; text('connection', 'НАБЛЮДЕНИЕ АКТИВНО'); }
    else if (m.type === 'reward') { showReward(m.reward); }
    else if (m.type === 'state') {
      const first = !state; state = replica.apply(m); if (first) { yaw = state.self.yaw; if (invite && !state.self.partyCode) panel('party'); }
      updateHUD(); view?.update(state); audio.update(state);
    } else if (m.type === 'world') { worldState = replica.apply(m); }
    else if (m.type === 'personal' && worldState) {
      const first = !state, members = new Set(m.self.partyIds), players = new Map([...worldState.players, ...m.self.partyPlayers].map(p => [p.id, { ...p, party: members.has(p.id) }]));
      state = { ...worldState, ...m, type: 'state', players: [...players.values()], effects: [...worldState.effects, ...(m.ownEffects ?? [])] };
      if (first) { yaw = state.self.yaw; if (invite && !state.self.partyCode) panel('party'); }
      updateHUD(); view?.update(state); audio.update(state);
    } else if (m.type === 'character-recreated') { recreating = false; $('recreate-dialog').close(); closePanels(); clearInput(); yaw = 0; resetCamera(); pickRole(m.role); toast('Персонаж пересоздан'); }
    else if (m.type === 'error' || m.type === 'notice') { if (recreating && m.type === 'error') { recreating = false; recreationError = m.message; recreationControls(); } toast(m.message); addMessage('ALICE', m.message); }
    else if (m.type === 'chat') addMessage(m.name, m.text);
    else if (m.type === 'left') reset();
  };
  socket.addEventListener('message', event => { incoming = incoming.then(() => message(event)).catch(error => { console.error(error); socket.close(); }); });
  socket.addEventListener('close', e => { if (ws !== socket) return; ready = false; recreating = false; $('recreate-dialog').close(); clearInput(); text('connection', 'СВЯЗЬ ПОТЕРЯНА'); if (e.code === 4001) { toast('Этот персонаж открыт в другой вкладке'); return; } if (e.code === 4004) { reset(); show('entry-form', false); show('auth-box', true); text('auth-status', 'Аккаунт заблокирован администратором'); return; } if (e.code === 4005 || won) return; if (e.code === 4003) reset(); retryTimer = setTimeout(connect, 1800); });
}
connect();

function renderItems() {
  const p = state.self;
  text('gear-stats', `${p.power} УРОН · ${Math.round(p.armor * 100)}% ЗАЩИТА · ${p.maxHp} HP`); text('bag-count', `${p.inventory.length} / 32`);
  $('equipped').innerHTML = Object.entries(slotNames).map(([slot, name]) => { const item = p.inventory.find(i => i.id === p.equipment[slot]); return `<div class="slot"><i data-lucide="${slotIcons[slot]}"></i><span>${item ? ITEMS[item.type].name : name}</span></div>`; }).join('');
  $('items').innerHTML = p.inventory.map(item => {
    const spec = ITEMS[item.type], equipped = p.equipment[spec.slot] === item.id;
    return `<div class="item ${equipped ? 'selected' : ''}"><i data-lucide="${slotIcons[spec.slot]}"></i><div class="item-info"><strong style="color:${RARITY[spec.rarity]}">${spec.name}</strong><small>${itemStat(spec)}${equipped ? ' · НАДЕТО' : ''}</small></div><button class="icon" data-command="equip" data-item="${item.id}" ${equipped ? 'disabled' : ''} title="Надеть" aria-label="Надеть ${spec.name}"><i data-lucide="check"></i></button>${p.shop && !equipped ? `<button class="icon" data-command="sell" data-item="${item.id}" title="Продать" aria-label="Продать ${spec.name}"><i data-lucide="coins"></i></button>` : ''}</div>`;
  }).join(''); createIcons({ icons });
}
function updateHUD() {
  const p = state.self; show('entry', false); show('hud', true); document.body.classList.add('playing');
  text('character-role', ROLES[p.role].name); recreationControls();
  adminPanel.update(p); if (p.admin?.following) { yaw = p.yaw; pitch = p.pitch; }
  const bosses = state.enemies.filter(e => e.kind === 'boss'); const nearbyBoss = [...bosses].filter(e => e.hp > 0).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  const closeBoss = nearbyBoss && Math.hypot(nearbyBoss.x - p.x, nearbyBoss.z - p.z) < 32 ? nearbyBoss : null;
  document.body.classList.toggle('near-boss', !!closeBoss);
  text('zone-name', p.zone || (closeBoss ? BOSSES.find(b => b.id === closeBoss.bossId).region : p.z > 0 ? 'Сервисный двор' : 'Мёртвый сектор'));
  text('zone-kind', p.zone ? 'НЕЙТРАЛЬНЫЙ КОНТУР' : 'ЗА ПЕРИМЕТРОМ');
  $('zone-state').classList.toggle('danger', !p.safe); $('zone-state').querySelector('span').textContent = p.safe ? 'БЕЗОПАСНАЯ ЗОНА' : 'СВОБОДНЫЙ ОГОНЬ / PVP';
  text('player-name', p.name); text('player-level', `LV. ${String(p.level).padStart(2, '0')}`);
  text('player-health', `${Math.ceil(p.hp)} / ${p.maxHp} HP`); text('credits', `${p.gold} CR`);
  $('hp').style.width = `${p.hp / p.maxHp * 100}%`; $('hp').style.background = p.hp < p.maxHp * .3 ? '#ec8c71' : '#9de2b7';
  $('xp').style.width = `${p.xp / p.nextXp * 100}%`; text('xp-label', `${p.xp} / ${p.nextXp} XP`);
  text('potions', p.potions);
  for (const key of ['skill', 'potion']) text(`${key}-cd`, p.cd[key] > .1 ? Math.ceil(p.cd[key]) : '');
  $('stamina').style.width = `${p.stamina}%`; text('weapon-name', WEAPONS[p.weaponType].name); text('ammo', p.reload > 0 ? `${p.reload.toFixed(1)} с` : `${p.ammo} / ${p.magazine}`);
  $('skill').title = `${ROLES[p.role].ability} · Q`;
  show('death', p.hp <= 0); text('respawn-time', `Эвакуация через ${Math.ceil(p.dead)} с`);
  show('target', !!closeBoss);
  if (closeBoss) {
    const spec = BOSSES.find(b => b.id === closeBoss.bossId); text('target-name', spec.name.toUpperCase()); text('target-level', `LV.${spec.level} / ФАЗА ${closeBoss.phase}`);
    $('target-hp').style.width = `${closeBoss.hp / closeBoss.maxHp * 100}%`;
    text('target-status', closeBoss.bossId === 'warden' && p.marks.length < 2 ? 'НЕОБХОДИМЫ ДВА ДОПУСКА' : closeBoss.shield ? 'ЩИТ АКТИВЕН / УНИЧТОЖИТЬ ГЕНЕРАТОРЫ' : `${Math.ceil(closeBoss.hp)} / ${closeBoss.maxHp} HP`);
  }
  const objectiveKey = p.marks.join(',') + bosses.map(e => e.hp <= 0).join(',');
  if (objectiveKey !== objectivesKey) {
    objectivesKey = objectiveKey;
    $('boss-list').innerHTML = BOSSES.map(b => `<div class="boss-objective ${p.marks.includes(b.id) ? 'done' : ''}"><i data-lucide="${p.marks.includes(b.id) ? 'check' : 'skull'}"></i><div>${b.name}<small>LV.${b.level} · ${p.marks.includes(b.id) ? 'ДОПУСК ПОЛУЧЕН' : b.id === 'warden' ? 'КАРАНТИННЫЙ АРХИВ' : 'РЕЙДОВАЯ ЦЕЛЬ'}</small></div></div>`).join(''); createIcons({ icons });
  }
  const newInventoryKey = JSON.stringify([p.inventory, p.equipment, p.level, p.shop]);
  if (newInventoryKey !== inventoryKey) { inventoryKey = newInventoryKey; renderItems(); }
  text('shop-credits', `${p.gold} КРЕДИТОВ`);
  if (!p.shop) show('shop', false);
  const lootNear = state.loot.find(l => Math.hypot(l.x - p.x, p.y ?? 0, l.z - p.z) < 3);
  show('context', !!p.shop || !!lootNear || !!p.ladder || !!p.climbing); text('context-label', p.climbing ? 'Лестница' : p.shop ? 'Снабжение / торговый пост' : lootNear ? ITEMS[lootNear.item.type].name : p.ladder ? 'Лестница' : '');
  const group = state.players.filter(q => q.party && q.id !== p.id);
  const newPartyKey = JSON.stringify([p.partyCode, group.map(q => [q.id, q.name, q.level, Math.ceil(q.hp)])]);
  if (newPartyKey !== partyKey) {
    partyKey = newPartyKey; show('party-empty', !p.partyCode); show('party-active', !!p.partyCode); text('party-id', p.partyCode || '');
    for (const target of ['party-members', 'party-roster']) {
      $(target).replaceChildren();
      const members = target === 'party-members' ? [p, ...group] : group;
      for (const q of members) {
        const row = document.createElement('div'); row.className = 'party-person';
        const header = document.createElement('div'), name = document.createElement('span'), level = document.createElement('b'); name.textContent = q.name; level.textContent = `LV.${q.level}`; header.append(name, level);
        const bar = document.createElement('progress'); bar.max = q.maxHp; bar.value = q.hp; row.append(header, bar); $(target).append(row);
      }
    }
  }
  show('archive-toggle', !!state.reward);
  if (state.reward) {
    text('flag', state.reward.flag); text('clue', state.reward.clue);
    if (!store.get(`reward-${p.id}`)) { store.set(`reward-${p.id}`, 'seen'); closePanels(); document.exitPointerLock?.(); clearInput(); show('reward-modal', true); beep(640); }
  }
  const notice = p.safe ? 'ALICE · Нейтральный контур. Оружие заблокировано.' : closeBoss?.bossId === 'warden' ? 'ALICE · Страж карантина. Запись финального рейда открыта.' : 'ALICE · Периметр не был пересечён. Всё уже находилось внутри.';
  if (notice !== lastNotice) { lastNotice = notice; text('alice-text', notice); }
  drawMap();
}
function drawMap() {
  const ctx = $('map').getContext('2d'); const size = 180, factor = 82 / WORLD.z; const center = 90;
  ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#163523'; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#bad8ae16'; ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += 20) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke(); }
  const pos = o => [center + o.x * factor, center + o.z * factor];
  ctx.strokeStyle = '#bbbd8a30'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(90, 18); ctx.lineTo(90, 165); ctx.moveTo(25, 92); ctx.lineTo(151, 92); ctx.stroke();
  for (const s of SAFE_ZONES) { const [x, z] = pos(s); ctx.fillStyle = '#83d5a534'; ctx.strokeStyle = '#83d5a590'; ctx.beginPath(); ctx.arc(x, z, s.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  for (const b of BOSSES) { const [x, z] = pos(b); ctx.fillStyle = state.self.marks.includes(b.id) ? '#94e3b2' : b.color; ctx.beginPath(); ctx.moveTo(x, z - 4); ctx.lineTo(x + 4, z); ctx.lineTo(x, z + 4); ctx.lineTo(x - 4, z); ctx.fill(); }
  for (const e of state.enemies.filter(e => e.kind !== 'boss' && e.hp > 0)) {
    const [x, z] = pos(e);
    if (e.kind === 'bomber') {
      ctx.fillStyle = e.behavior === 'patrol' ? '#efb04d55' : '#f26d5955';
      ctx.beginPath(); ctx.moveTo(x, z); ctx.arc(x, z, BOMBER.sightRange * factor, e.yaw - Math.PI / 2 - BOMBER.sightAngle / 2, e.yaw - Math.PI / 2 + BOMBER.sightAngle / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f27860'; ctx.beginPath(); ctx.arc(x, z, 2, 0, Math.PI * 2); ctx.fill();
    } else { ctx.fillStyle = '#ce8e6b'; ctx.fillRect(x - 1, z - 1, 2, 2); }
  }
  for (const p of state.players) { const [x, z] = pos(p); if (p.id === state.self.id) { ctx.save(); ctx.translate(x, z); ctx.rotate(yaw); ctx.fillStyle = '#f3f4d1'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(0, 2); ctx.lineTo(-3.5, 4); ctx.fill(); ctx.restore(); } else { ctx.fillStyle = p.party ? '#95e8b4' : '#efb578'; ctx.beginPath(); ctx.arc(x, z, 2.3, 0, Math.PI * 2); ctx.fill(); } }
  text('coordinates', `${Math.round(state.self.x)} : ${Math.round(state.self.z)}`);
}

const typing = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
addEventListener('keydown', e => {
  if (typing() || !state) return;
  if (e.code === 'Escape') { closePanels(); clearInput(); return; }
  if (e.code === 'Home') { e.preventDefault(); resetCamera(); return; }
  if (e.code === 'KeyI' && !e.repeat) { panel('inventory'); return; }
  if (e.code === 'KeyP' && !e.repeat) { panel('party'); return; }
  if (e.code === 'KeyE' && state.self.shop && !e.repeat) { panel('shop'); return; }
  if (overlay()) return;
  const action = { Space: 'jump', KeyE: 'interact', KeyH: 'potion', KeyQ: 'skill', KeyR: 'reload' }[e.code];
  if (action && !e.repeat) pendingActions.add(action);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyR', 'KeyH', 'KeyE', 'KeyZ', 'KeyC', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'PageUp', 'PageDown', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); keys.add(e.code); }
});
addEventListener('keyup', e => keys.delete(e.code)); addEventListener('blur', clearInput); document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
function look(dx, dy, sensitivity) { yaw += dx * sensitivity; pitch = clamp(pitch - dy * sensitivity, CAMERA.minPitch, CAMERA.maxPitch); }
$('scene').addEventListener('contextmenu', e => e.preventDefault());
$('scene').addEventListener('pointerdown', e => {
  if (!state || overlay()) return;
  if (e.button === 2) { lookPointer = e.pointerId; lookX = e.clientX; lookY = e.clientY; $('scene').setPointerCapture(e.pointerId); }
  else if (e.button === 0) { held.add('attack'); $('scene').requestPointerLock?.()?.catch?.(() => {}); }
});
addEventListener('pointermove', e => {
  if (!state || overlay()) return;
  if (document.pointerLockElement === $('scene')) look(e.movementX, e.movementY, .0032);
  else if (lookPointer === e.pointerId) { look(e.clientX - lookX, e.clientY - lookY, .006); lookX = e.clientX; lookY = e.clientY; }
});
for (const kind of ['pointerup', 'pointercancel']) addEventListener(kind, e => {
  held.delete('attack'); if (lookPointer === e.pointerId) lookPointer = null;
});
$('scene').addEventListener('wheel', e => { if (!state || overlay()) return; e.preventDefault(); cameraFov = clamp(cameraFov + e.deltaY * .035, CAMERA.minFov, CAMERA.maxFov); }, { passive: false });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) held.delete('attack'); });
for (const action of ['attack', 'skill', 'jump', 'reload', 'potion', 'interact']) {
  $(action).addEventListener('pointerdown', e => { e.preventDefault(); if (overlay()) return; held.add(action); pendingActions.add(action); $(action).setPointerCapture(e.pointerId); $(action).classList.add('pressed'); });
  for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) $(action).addEventListener(kind, () => { held.delete(action); $(action).classList.remove('pressed'); });
}
function movementInput() {
  const blocked = overlay() || typing();
  let sideways = blocked ? 0 : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let forward = blocked ? 0 : (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const length = Math.max(1, Math.hypot(sideways, forward)); sideways /= length; forward /= length;
  return { blocked, climbing: !!state?.self?.climbing, x: Math.cos(yaw) * sideways + Math.sin(yaw) * forward, z: Math.sin(yaw) * sideways - Math.cos(yaw) * forward, climb: forward, lift: !blocked && state?.self.admin?.enabled ? (keys.has('Space') ? 1 : 0) - (keys.has('ControlLeft') || keys.has('ControlRight') ? 1 : 0) : 0, sprint: !blocked && (keys.has('ShiftLeft') || keys.has('ShiftRight')) };
}
setInterval(() => {
  if (!state) return;
  const input = movementInput();
  send({ type: 'input', seq: ++inputSeq, yaw, pitch, aim: view?.getAim(), x: input.x, z: input.z, climb: input.climb, lift: input.lift,
    attack: !input.blocked && (held.has('attack') || keys.has('KeyF')), skill: !input.blocked && (pendingActions.has('skill') || held.has('skill') || keys.has('KeyQ')), sprint: input.sprint, jump: !input.blocked && (pendingActions.has('jump') || held.has('jump') || keys.has('Space')), reload: !input.blocked && (pendingActions.has('reload') || held.has('reload') || keys.has('KeyR')), potion: !input.blocked && (pendingActions.has('potion') || held.has('potion') || keys.has('KeyH')), interact: !input.blocked && (pendingActions.has('interact') || held.has('interact') || keys.has('KeyE')) });
  pendingActions.clear();
}, 50);
let previous = performance.now();
function frame(now) {
  const dt = Math.min(.1, (now - previous) / 1000); previous = now;
  if (state && !overlay() && !typing()) {
    yaw += ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * 1.8 * dt;
    pitch = clamp(pitch + ((keys.has('PageUp') ? 1 : 0) - (keys.has('PageDown') ? 1 : 0)) * dt, CAMERA.minPitch, CAMERA.maxPitch);
    roll = clamp(roll + ((keys.has('KeyZ') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0)) * .8 * dt, -CAMERA.maxRoll, CAMERA.maxRoll);
  }
  view?.render(dt, yaw, pitch, roll, cameraFov, state ? movementInput() : { blocked: true }); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
