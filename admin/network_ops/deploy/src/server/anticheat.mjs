import { randomBytes } from 'node:crypto';

export const AC_WINDOW_MS = 5 * 60 * 1000;
const RULES = Object.freeze({ state_forgery: 4, unknown_gesture_token: 4, impossible_movement: 3, movement_rejected: 0, legacy_action: 0, rate_limit: 0 });
const RESERVED = new Set(['won', 'reward', 'flag', 'flags', 'completionVersion', 'identity', 'providerId', 'profile', 'profiles', 'lab', 'labs', 'configs', 'startup', 'cables', 'power', 'checks', 'report', 'snapshot', 'incident', 'elapsed', 'nextRat', 'ammo', 'shotgun', 'admin', 'isAdmin', 'role', 'security', 'ban', 'banned']);
export function forgedStateFields(data) {
  const found = [];
  for (const [prefix, value] of [['', data], ['action.', data?.action]]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const name of Object.keys(value)) if (RESERVED.has(name)) found.push(prefix + name);
  }
  return found.slice(0, 16);
}
const identity = value => {
  if (typeof value !== 'string') throw new Error('Yandex ID required');
  const id = value.startsWith('yandex:') ? value : `yandex:${value}`;
  if (!/^yandex:[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid Yandex ID'); return id;
};
export function publicBan(ban) { return ban ? { id: ban.id, until: ban.until, reason: 'Повторные недопустимые действия в игре' } : null; }
export class AntiCheat {
  constructor({ profiles, save, now = Date.now, onBan = () => {}, banSeconds = 86400 }) {
    if (!Number.isInteger(banSeconds) || banSeconds < 60 || banSeconds > 30 * 86400) throw new Error('ANTICHEAT_BAN_SECONDS must be 60..2592000');
    Object.assign(this, { profiles, save, now, onBan, banSeconds });
    this.pendingUnbans = new Map();
  }
  ban(key) { const value = this.pendingUnbans.get(key)?.ban ?? this.profiles.get(key)?.security?.ban; return value && value.until > this.now() ? value : null; }
  async detect(key, rule, details = {}) {
    if (!Object.hasOwn(RULES, rule)) throw new Error('Unknown anti-cheat rule');
    const profile = this.profiles.get(key); if (!profile) return { warning: false, ban: null };
    if (this.ban(key)) return { warning: false, ban: this.ban(key) };
    const at = this.now(), s = profile.security ??= { signals: [], events: [], last: {}, ban: null };
    if (s.ban && s.ban.until <= at) { s.ban = null; s.signals = []; s.last = {}; }
    s.signals = s.signals.filter(e => at - e.at < AC_WINDOW_MS && e.at <= at);
    const points = RULES[rule], cooldown = points ? 2000 : 10000;
    if (s.last[rule] !== undefined && at - s.last[rule] < cooldown) return { warning: false, ban: null };
    s.last[rule] = at;
    // Only bounded server-built observations belong in the audit, never raw requests or tokens.
    const safe = {};
    for (const name of ['path', 'kind', 'phase', 'reason', 'tokenHash']) if (typeof details[name] === 'string') safe[name] = details[name].slice(0, 100);
    for (const name of ['distance', 'budget', 'intervalMs']) if (Number.isFinite(details[name])) safe[name] = Math.round(details[name] * 1000) / 1000;
    if (Array.isArray(details.fields)) safe.fields = details.fields.slice(0, 16).map(v => String(v).slice(0, 40));
    const event = { id: randomBytes(8).toString('hex'), at, type: 'detection', rule, points, details: safe };
    s.events = [...s.events, event].slice(-100);
    if (points) s.signals = [...s.signals, { at, rule, points }].slice(-30);
    if (s.signals.length >= 3 && s.signals.reduce((n, e) => n + e.points, 0) >= 12) {
      s.ban = { id: randomBytes(8).toString('hex'), at, until: at + this.banSeconds * 1000, trigger: rule };
      s.events = [...s.events, { id: s.ban.id, at, type: 'auto_ban', rule, until: s.ban.until }].slice(-100);
      this.onBan(key);
    }
    await this.save(key);
    return { warning: points > 0 && !this.ban(key), ban: this.ban(key) };
  }
  list() {
    return [...this.profiles].filter(([key]) => this.ban(key)).map(([key, p]) => ({ identity: p.identity, ...this.ban(key) }));
  }
  account(value) {
    const id = identity(value), found = [...this.profiles].find(([, p]) => p.identity === id);
    if (!found) throw new Error('Account not found'); return found;
  }
  events(value) { const [key, p] = this.account(value); return { identity: p.identity, ban: this.ban(key), events: structuredClone(p.security?.events ?? []) }; }
  async unban(value, reason) {
    if (typeof reason !== 'string' || reason.length > 240 || !reason.replace(/[\p{C}]/gu, '').trim()) throw new Error('Unban reason required (1..240 characters)');
    const [key, p] = this.account(value);
    if (this.pendingUnbans.has(key)) throw new Error('Unban already in progress');
    if (!this.ban(key)) return { identity: p.identity, unbanned: false, alreadyAllowed: true };
    const before = structuredClone(p.security); this.pendingUnbans.set(key, before);
    p.security = { ...before, ban: null, signals: [], last: {}, events: [...before.events, { id: randomBytes(8).toString('hex'), at: this.now(), type: 'operator_unban', reason: reason.replace(/[\p{C}]/gu, '').trim() }].slice(-100) };
    try { await this.save(key); return { identity: p.identity, unbanned: true }; }
    catch (error) { p.security = before; throw error; }
    finally { this.pendingUnbans.delete(key); }
  }
}
