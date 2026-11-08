import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export class Moderation {
  constructor({ adminIds = [], dataDir, now = () => Date.now() } = {}) {
    this.admins = new Set(adminIds.map(id => `yandex:${id}`));
    this.dataDir = dataDir; this.now = now; this.bans = new Map(); this.audit = []; this.pending = Promise.resolve();
  }
  isAdmin(providerId) { return this.admins.has(providerId); }
  ban(providerId) { const ban = this.bans.get(providerId); return ban && (ban.until === null || ban.until > this.now()) ? ban : null; }
  async load() {
    if (!this.dataDir) return;
    try {
      const data = JSON.parse(await readFile(join(this.dataDir, 'moderation.json'), 'utf8'));
      if (!Array.isArray(data.bans) || !Array.isArray(data.audit)) throw new Error('Invalid moderation store');
      for (const [id, ban] of data.bans) {
        if (typeof id !== 'string' || !id.startsWith('yandex:') || !ban || !(ban.until === null || Number.isFinite(ban.until)) || typeof ban.reason !== 'string') throw new Error('Invalid ban record');
        this.bans.set(id, ban);
      }
      this.audit = data.audit.slice(-500);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  change(actorId, target, { action, duration = 0, reason = '' }) {
    this.pending = this.pending.catch(() => {}).then(async () => {
      if (!this.isAdmin(actorId)) throw new Error('Нет прав администратора');
      if (!target?.providerId || this.isAdmin(target.providerId)) throw new Error('Этот аккаунт нельзя заблокировать');
      if (!['ban', 'unban'].includes(action) || ![0, 3600, 86400, 604800].includes(duration)) throw new Error('Некорректная блокировка');
      if (typeof reason !== 'string' || reason.length > 240 || action === 'ban' && !reason.trim()) throw new Error('Укажите причину блокировки');
      const next = new Map(this.bans), at = this.now();
      const record = { at, until: duration ? at + duration * 1000 : null, reason: reason.trim(), by: actorId };
      if (action === 'ban') next.set(target.providerId, record); else next.delete(target.providerId);
      const audit = [...this.audit, { action, actorId, playerId: target.id, ...record }].slice(-500);
      // Publish the in-memory decision only after its durable replacement succeeds.
      if (this.dataDir) {
        await writeFile(join(this.dataDir, 'moderation.tmp'), JSON.stringify({ bans: [...next], audit }), { mode: 0o600 });
        await rename(join(this.dataDir, 'moderation.tmp'), join(this.dataDir, 'moderation.json'));
      }
      this.bans = next; this.audit = audit;
    });
    return this.pending;
  }
}
