import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export function readCookie(req, name) {
  const values = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0].slice(name.length + 1)) ? values[0].slice(name.length + 1) : null;
}
export class YandexAuth {
  constructor({ clientId = '', clientSecret = '', origin, dataDir, fetchImpl = fetch, now = Date.now, onIdentity, onLogout = () => {}, getBan = () => null, trustProxy = false }) {
    this.setOrigin(origin); Object.assign(this, { clientId, clientSecret, dataDir, fetch: fetchImpl, now, onIdentity, onLogout, getBan, trustProxy });
    this.transactions = new Map(); this.sessions = new Map(); this.limits = new Map(); this.writes = Promise.resolve();
  }
  setOrigin(value) {
    const u = new URL(value);
    if (u.pathname !== '/' || u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('PUBLIC_ORIGIN must be HTTPS (except loopback development)');
    this.origin = u.origin; this.redirectUri = `${u.origin}/auth/yandex/callback`;
  }
  get configured() { return !!(this.clientId && this.clientSecret); }
  cookie(name, value, age) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.origin.startsWith('https:') ? '; Secure' : ''}`; }
  async load() {
    if (!this.dataDir) return;
    try {
      for (const [key, value] of JSON.parse(await readFile(join(this.dataDir, 'network-auth.json'), 'utf8'))) {
        if (/^[a-f0-9]{64}$/.test(key) && /^yandex:[A-Za-z0-9_-]{1,128}$/.test(value.providerId) && value.expires > this.now()) this.sessions.set(key, value);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  persist() {
    if (!this.dataDir) return Promise.resolve();
    const data = JSON.stringify([...this.sessions]);
    this.writes = this.writes.catch(() => {}).then(async () => { await writeFile(join(this.dataDir, 'network-auth.tmp'), data, { mode: 0o600 }); await rename(join(this.dataDir, 'network-auth.tmp'), join(this.dataDir, 'network-auth.json')); }); return this.writes;
  }
  authenticate(req) {
    const raw = readCookie(req, 'labx_net_session'), key = raw && hash(raw), session = this.sessions.get(key);
    if (!session || session.expires <= this.now()) { if (key) this.sessions.delete(key); return null; }
    return { ...session, key };
  }
  prune() {
    for (const [key, value] of this.transactions) if (value.expires <= this.now()) this.transactions.delete(key);
    for (const [key, value] of this.sessions) if (value.expires <= this.now()) this.sessions.delete(key);
    for (const [key, value] of this.limits) if (this.now() - value.at > 60000) this.limits.delete(key);
  }
  rate(req) {
    this.prune(); const ip = this.trustProxy ? String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    if (!this.limits.has(ip)) { if (this.limits.size >= 4096) return false; this.limits.set(ip, { at: this.now(), count: 0 }); }
    return ++this.limits.get(ip).count <= 300;
  }
  async route(req, res, url, headers) {
    if (!['/api/session', '/auth/yandex', '/auth/yandex/callback', '/auth/logout'].includes(url.pathname)) return false;
    const reply = (status, body, extra = {}) => res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra }).end(JSON.stringify(body));
    if (url.pathname === '/api/session') { if (req.method !== 'GET') reply(405, { error: 'Вход только через Яндекс' }); else { const session = this.authenticate(req); reply(200, { authenticated: !!session, configured: this.configured, loginUrl: '/auth/yandex', ban: session ? this.getBan(session.providerId) : null }); } return true; }
    if (url.pathname === '/auth/logout') {
      if (req.method !== 'POST' || req.headers.origin !== this.origin) { reply(403, { error: 'Origin rejected' }); return true; }
      const session = this.authenticate(req);
      if (session) { this.sessions.delete(session.key); this.onLogout(session.providerId); }
      await this.persist(); reply(200, { ok: true }, { 'Set-Cookie': this.cookie('labx_net_session', '', 0) }); return true;
    }
    if (req.method !== 'GET') { reply(405, { error: 'method' }); return true; }
    if (!this.configured) { reply(503, { error: 'Yandex OAuth не настроен' }); return true; }
    if (!this.rate(req)) { reply(429, { error: 'Слишком много попыток входа' }); return true; }
    if (url.pathname === '/auth/yandex') {
      if (req.headers.host !== new URL(this.origin).host) { res.writeHead(303, { ...headers, Location: `${this.origin}/auth/yandex` }).end(); return true; }
      if (this.transactions.size >= 500) { reply(429, { error: 'Повторите вход позже' }); return true; }
      const state = secret(), binding = secret(), verifier = secret(), legacy = readCookie(req, 'labx_network');
      this.transactions.set(state, { binding: hash(binding), verifier, legacy: legacy ? hash(legacy) : null, expires: this.now() + 300000 });
      const u = new URL('https://oauth.yandex.ru/authorize'); u.search = new URLSearchParams({ response_type: 'code', client_id: this.clientId, redirect_uri: this.redirectUri, scope: 'login:info', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      res.writeHead(302, { ...headers, Location: u.href, 'Set-Cookie': this.cookie('labx_net_oauth', binding, 300) }).end(); return true;
    }
    const state = url.searchParams.get('state'), tx = this.transactions.get(state), binding = readCookie(req, 'labx_net_oauth');
    if (!tx || tx.expires <= this.now() || !binding || hash(binding) !== tx.binding) { reply(403, { error: 'OAuth state недействителен или истёк' }); return true; }
    this.transactions.delete(state); const code = url.searchParams.get('code');
    if (!code || code.length > 2048 || url.searchParams.has('error')) { reply(400, { error: 'Вход не завершён' }); return true; }
    try {
      const exchange = await this.fetch('https://oauth.yandex.ru/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}` }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: tx.verifier }) });
      if (!exchange.ok) throw new Error('provider'); const token = await exchange.json();
      if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8192) throw new Error('token');
      const response = await this.fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: `OAuth ${token.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('provider'); const info = await response.json();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(info.id ?? ''))) throw new Error('identity');
      const providerId = `yandex:${info.id}`; if (!this.getBan(providerId)) await this.onIdentity(providerId, tx.legacy);
      const old = this.authenticate(req); if (old) this.sessions.delete(old.key);
      const existing = [...this.sessions].filter(([, v]) => v.providerId === providerId);
      while (existing.length >= 5) this.sessions.delete(existing.shift()[0]);
      const raw = secret(); this.sessions.set(hash(raw), { providerId, expires: this.now() + 7 * 86400000 }); await this.persist();
      res.writeHead(303, { ...headers, Location: '/', 'Set-Cookie': [this.cookie('labx_net_session', raw, 7 * 86400), this.cookie('labx_net_oauth', '', 0), this.cookie('labx_network', '', 0)] }).end();
    } catch { reply(502, { error: 'Вход не выполнен. Проверьте настройки OAuth или повторите позже.' }); }
    return true;
  }
}
