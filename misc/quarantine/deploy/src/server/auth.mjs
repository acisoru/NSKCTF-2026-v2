import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
function cookie(req, name) {
  const values = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export class YandexAuth {
  constructor({ clientId = '', clientSecret = '', publicOrigin = 'http://localhost:3387', dataDir, fetchImpl = fetch, now = () => Date.now(), onIdentity = async () => {}, isBlocked = () => false } = {}) {
    const origin = new URL(publicOrigin);
    if (origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('PUBLIC_ORIGIN must be HTTPS, except localhost development');
    this.origin = origin.origin; this.redirectUri = `${this.origin}/auth/yandex/callback`;
    this.clientId = clientId; this.clientSecret = clientSecret; this.dataDir = dataDir; this.fetch = fetchImpl; this.now = now; this.onIdentity = onIdentity;
    this.transactions = new Map(); this.sessions = new Map(); this.writes = Promise.resolve();
    this.isBlocked = isBlocked;
  }
  get configured() { return !!(this.clientId && this.clientSecret); }
  async load() {
    if (!this.dataDir) return;
    try {
      const records = JSON.parse(await readFile(join(this.dataDir, 'auth-sessions.json'), 'utf8'));
      if (!Array.isArray(records)) throw new Error('Invalid auth session store');
      for (const [key, value] of records) if (/^[a-f0-9]{64}$/.test(key) && typeof value.providerId === 'string' && value.expires > this.now()) this.sessions.set(key, value);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  persist() {
    if (!this.dataDir) return Promise.resolve();
    const records = JSON.stringify([...this.sessions]);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await writeFile(join(this.dataDir, 'auth-sessions.tmp'), records, { mode: 0o600 });
      await rename(join(this.dataDir, 'auth-sessions.tmp'), join(this.dataDir, 'auth-sessions.json'));
    });
    return this.writes;
  }
  setCookie(name, value, age) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${this.origin.startsWith('https:') ? '; Secure' : ''}`; }
  authenticate(req) {
    const token = cookie(req, 'labx_session'); if (!token) return null;
    const key = hash(token), session = this.sessions.get(key);
    if (!session || session.expires <= this.now() || this.isBlocked(session.providerId)) { this.sessions.delete(key); return null; }
    return { ...session, key };
  }
  validSession(key) { const session = this.sessions.get(key); return !!session && session.expires > this.now() && !this.isBlocked(session.providerId); }
  revokeProvider(providerId) { for (const [key, session] of this.sessions) if (session.providerId === providerId) this.sessions.delete(key); return this.persist(); }
  prune() {
    for (const [k, v] of this.transactions) if (v.expires < this.now()) this.transactions.delete(k);
    for (const [k, v] of this.sessions) if (v.expires < this.now()) this.sessions.delete(k);
  }
  async route(req, res, url, headers) {
    if (!['/auth/yandex', '/auth/yandex/callback', '/auth/logout', '/api/session'].includes(url.pathname)) return false;
    const reply = (status, body, extra = {}) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/session') {
      if (req.method !== 'GET') { reply(405, { error: 'method' }); return true; }
      reply(200, { requiresAuth: true, configured: this.configured, authenticated: !!this.authenticate(req), loginUrl: '/auth/yandex' }); return true;
    }
    if (url.pathname === '/auth/logout') {
      if (req.method !== 'POST' || req.headers.origin !== this.origin) { reply(403, { error: 'origin' }); return true; }
      const session = this.authenticate(req); if (session) this.sessions.delete(session.key); await this.persist();
      reply(200, { ok: true }, { 'Set-Cookie': this.setCookie('labx_session', '', 0) }); return true;
    }
    if (req.method !== 'GET') { reply(405, { error: 'method' }); return true; }
    if (!this.configured) { reply(503, { error: 'Yandex OAuth is not configured' }); return true; }
    if (url.pathname === '/auth/yandex') {
      if (req.headers.host !== new URL(this.origin).host) { res.writeHead(303, { ...headers, Location: `${this.origin}/auth/yandex` }).end(); return true; }
      this.prune(); if (this.transactions.size >= 1000) { reply(429, { error: 'busy' }); return true; }
      const state = secret(), binding = secret(), verifier = secret();
      this.transactions.set(state, { binding: hash(binding), verifier, expires: this.now() + 5 * 60 * 1000 });
      const authorize = new URL('https://oauth.yandex.ru/authorize');
      authorize.search = new URLSearchParams({ response_type: 'code', client_id: this.clientId, redirect_uri: this.redirectUri, scope: 'login:info', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      res.writeHead(302, { ...headers, Location: authorize.href, 'Set-Cookie': this.setCookie('labx_oauth', binding, 300) }).end(); return true;
    }
    const state = url.searchParams.get('state'), transaction = this.transactions.get(state), binding = cookie(req, 'labx_oauth');
    if (!transaction || transaction.expires <= this.now() || !binding || hash(binding) !== transaction.binding) { reply(403, { error: 'Invalid or expired OAuth state' }); return true; }
    this.transactions.delete(state);
    const code = url.searchParams.get('code');
    if (!code || code.length > 2048 || url.searchParams.has('error')) { reply(400, { error: 'Authorization was not completed' }); return true; }
    try {
      const tokenResponse = await this.fetch('https://oauth.yandex.ru/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: transaction.verifier }),
      });
      if (!tokenResponse.ok) throw new Error('token');
      const token = await tokenResponse.json(); if (typeof token.access_token !== 'string' || token.access_token.length > 8192 || !token.access_token) throw new Error('token');
      const profileResponse = await this.fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: `OAuth ${token.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!profileResponse.ok) throw new Error('profile');
      const profile = await profileResponse.json();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(profile.id ?? ''))) throw new Error('identity');
      const providerId = `yandex:${profile.id}`;
      if (this.isBlocked(providerId)) { reply(403, { error: 'Аккаунт заблокирован администратором' }); return true; }
      await this.onIdentity(providerId);
      const previous = this.authenticate(req); if (previous) this.sessions.delete(previous.key);
      const raw = secret(); this.sessions.set(hash(raw), { providerId, expires: this.now() + 7 * 86400000 }); await this.persist();
      res.writeHead(303, { ...headers, Location: '/', 'Set-Cookie': [this.setCookie('labx_session', raw, 7 * 86400), this.setCookie('labx_oauth', '', 0)] }).end();
    } catch { reply(502, { error: 'Yandex authorization failed. Start login again.' }); }
    return true;
  }
}
