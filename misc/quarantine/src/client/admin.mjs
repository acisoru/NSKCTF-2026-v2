import { createIcons, icons } from 'lucide';
import { WORLD, SAFE_ZONES, BOSSES } from '../shared/config.mjs';

const $ = id => document.getElementById(id);
export class AdminPanel {
  constructor({ getState, send, togglePanel, notify, clearInput }) {
    Object.assign(this, { getState, send, togglePanel, notify, clearInput });
    this.page = 0; this.players = []; this.loading = false; this.enabled = false;
    $('admin-toggle').addEventListener('click', () => { togglePanel('admin'); this.refresh(); });
    $('admin-mode').addEventListener('change', e => send({ type: 'admin-mode', enabled: e.target.checked }));
    $('admin-weapon').addEventListener('change', e => send({ type: 'admin-weapon', enabled: e.target.checked }));
    $('admin-unfollow').addEventListener('click', () => send({ type: 'admin-follow', playerId: null }));
    $('admin-refresh').addEventListener('click', () => this.refresh());
    $('admin-filter').addEventListener('change', () => { this.page = 0; this.refresh(); });
    $('admin-search').addEventListener('input', () => { clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => { this.page = 0; this.refresh(); }, 250); });
    $('admin-prev').addEventListener('click', () => { this.page = Math.max(0, this.page - 1); this.refresh(); });
    $('admin-next').addEventListener('click', () => { this.page++; this.refresh(); });
    $('admin-players').addEventListener('click', e => {
      const button = e.target.closest('button[data-player]'); if (!button) return;
      if (button.dataset.action === 'follow') {
        if (!getState()?.self.admin?.enabled) send({ type: 'admin-mode', enabled: true });
        send({ type: 'admin-follow', playerId: button.dataset.player }); togglePanel('admin');
      } else {
        const target = this.players.find(p => p.id === button.dataset.player); if (!target) return;
        this.target = target; $('admin-ban-name').textContent = target.name;
        $('admin-ban-reason').value = ''; $('admin-ban-duration').value = '86400';
        $('admin-ban-fields').hidden = !!target.ban;
        $('admin-ban-submit').innerHTML = target.ban ? '<i data-lucide="rotate-ccw"></i>Снять блокировку' : '<i data-lucide="ban"></i>Заблокировать'; createIcons({ icons });
        $('admin-ban-error').textContent = ''; document.exitPointerLock?.(); clearInput(); $('admin-ban-dialog').showModal();
      }
    });
    $('admin-ban-cancel').addEventListener('click', () => $('admin-ban-dialog').close());
    $('admin-ban-form').addEventListener('submit', async e => {
      e.preventDefault(); if (!this.target) return;
      $('admin-ban-submit').disabled = true;
      try {
        const response = await fetch('/api/admin/moderate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: this.target.id, action: this.target.ban ? 'unban' : 'ban', duration: Number($('admin-ban-duration').value), reason: $('admin-ban-reason').value }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось изменить блокировку');
        $('admin-ban-dialog').close(); notify(this.target.ban ? 'Блокировка снята' : 'Игрок заблокирован'); await this.refresh();
      } catch (error) { $('admin-ban-error').textContent = error.message; }
      finally { $('admin-ban-submit').disabled = false; }
    });
    setInterval(() => { if (this.enabled && !$('admin').classList.contains('hidden')) this.refresh(); }, 2000);
  }
  update(self) {
    this.enabled = !!self?.admin; $('admin-toggle').classList.toggle('hidden', !this.enabled);
    const active = !!self?.admin?.enabled;
    $('admin-mode').checked = active; $('admin-weapon').checked = active && self.admin.weapon;
    $('admin-weapon').disabled = !active; $('admin-unfollow').disabled = !self?.admin?.following;
    $('admin-indicator').classList.toggle('hidden', !active);
    $('admin-indicator').textContent = self?.admin?.following ? 'ADMIN / НАБЛЮДЕНИЕ' : 'ADMIN / СВОБОДНЫЙ ПОЛЁТ';
    if (!this.enabled) { $('admin').classList.add('hidden'); $('admin-ban-dialog').close(); }
  }
  async refresh() {
    if (!this.enabled || this.loading) return;
    this.loading = true;
    try {
      const response = await fetch(`/api/admin/players?${new URLSearchParams({ q: $('admin-search').value, filter: $('admin-filter').value, page: this.page })}`);
      if (!response.ok) throw new Error('Список игроков недоступен');
      const data = await response.json(); this.players = data.players;
      $('admin-count').textContent = `${data.online} В СЕТИ / ${data.total} НАЙДЕНО`;
      $('admin-page').textContent = `${this.page + 1} / ${Math.max(1, Math.ceil(data.total / 50))}`;
      $('admin-prev').disabled = this.page === 0; $('admin-next').disabled = (this.page + 1) * 50 >= data.total;
      const fragment = document.createDocumentFragment(), me = this.getState()?.self.id;
      for (const p of this.players) {
        const row = document.createElement('div'); row.className = 'admin-player';
        const info = document.createElement('div'), name = document.createElement('strong'), status = document.createElement('small');
        name.textContent = p.name; name.title = `${p.name} / ${p.id}`;
        status.textContent = p.ban ? `${p.ban.until ? new Date(p.ban.until).toLocaleString('ru-RU') : 'Бессрочная блокировка'} / ${p.ban.reason}` : `${p.admin ? 'ADMIN / ' : ''}${p.online ? 'В сети' : 'Не в сети'} / LV. ${p.level}`;
        info.append(name, status);
        const health = document.createElement('span'); health.className = 'admin-health'; health.textContent = p.online ? `${Math.ceil(p.hp)} HP` : '';
        const follow = document.createElement('button'); follow.className = 'icon'; follow.dataset.player = p.id; follow.dataset.action = 'follow'; follow.disabled = !p.online || p.hp <= 0 || p.id === me; follow.title = 'Наблюдать'; follow.setAttribute('aria-label', `Наблюдать: ${p.name}`); follow.innerHTML = '<i data-lucide="scan-eye"></i>';
        const ban = document.createElement('button'); ban.className = 'icon'; ban.dataset.player = p.id; ban.dataset.action = 'moderate'; ban.disabled = !p.canBan || p.id === me; ban.title = p.ban ? 'Снять блокировку' : 'Заблокировать'; ban.setAttribute('aria-label', `${ban.title}: ${p.name}`); ban.innerHTML = `<i data-lucide="${p.ban ? 'rotate-ccw' : 'ban'}"></i>`;
        row.append(info, health, follow, ban); fragment.append(row);
      }
      if (!this.players.length) { const empty = document.createElement('p'); empty.className = 'admin-empty'; empty.textContent = 'Игроков нет'; fragment.append(empty); }
      $('admin-players').replaceChildren(fragment); createIcons({ icons }); this.drawMap(data.locations);
      $('admin-error').textContent = '';
    } catch (error) { $('admin-error').textContent = error.message; }
    finally { this.loading = false; }
  }
  drawMap(players) {
    const canvas = $('admin-map'), ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const pos = p => [w / 2 + p.x / WORLD.x * (w / 2 - 10), h / 2 + p.z / WORLD.z * (h / 2 - 10)];
    ctx.fillStyle = '#142921'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#537c663b'; for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); } for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (const zone of SAFE_ZONES) { const [x, y] = pos(zone); ctx.strokeStyle = '#82d7a7'; ctx.beginPath(); ctx.ellipse(x, y, zone.radius / WORLD.x * (w / 2 - 10), zone.radius / WORLD.z * (h / 2 - 10), 0, 0, Math.PI * 2); ctx.stroke(); }
    for (const boss of BOSSES) { const [x, y] = pos(boss); ctx.fillStyle = boss.color; ctx.fillRect(x - 3, y - 3, 6, 6); }
    for (const p of players) { const [x, y] = pos(p); ctx.fillStyle = p.admin ? '#efce89' : '#9adee2'; ctx.beginPath(); ctx.arc(x, y, p.id === this.getState()?.self.admin?.following ? 5 : 3, 0, Math.PI * 2); ctx.fill(); }
  }
}
