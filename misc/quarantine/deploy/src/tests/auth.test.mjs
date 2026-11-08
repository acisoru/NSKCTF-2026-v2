import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.mjs';
import { Game } from '../server/game.mjs';

const wait = async fn => { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error('Timeout'); await new Promise(r => setTimeout(r, 15)); } };
async function fixture() {
  const requests = []; let providerUser = '123456';
  const app = await createApp({ flag: 'nskctf{auth_fixture}', oauth: { clientId: 'fixture-id', clientSecret: 'fixture-secret', publicOrigin: 'http://127.0.0.1', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url.includes('/token') ? { access_token: 'provider-access-token' } : { id: providerUser, display_name: 'Fixture' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } } });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); const base = `http://127.0.0.1:${app.server.address().port}`;
  app.auth.origin = base; app.auth.redirectUri = `${base}/auth/yandex/callback`;
  const begin = async () => {
    const res = await fetch(base + '/auth/yandex', { redirect: 'manual' });
    assert.equal(res.status, 302); const location = new URL(res.headers.get('location'));
    return { state: location.searchParams.get('state'), cookie: res.headers.get('set-cookie').split(';')[0], location };
  };
  const finish = async (flow, cookie = flow.cookie) => fetch(`${base}/auth/yandex/callback?code=fixture-code&state=${flow.state}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  const login = async () => {
    const flow = await begin(), res = await finish(flow); assert.equal(res.status, 303);
    return { cookie: res.headers.getSetCookie().find(c => c.startsWith('labx_session=')).split(';')[0], flow, res };
  };
  const sockets = [];
  async function connect(cookie, token) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie }, origin: base }); const messages = [];
    ws.on('message', b => messages.push(JSON.parse(b))); await once(ws, 'open'); ws.send(JSON.stringify({ type: 'hello', token }));
    await wait(() => messages.some(m => m.type === 'hello')); ws.send(JSON.stringify({ type: 'enter', name: 'Authenticated' })); await wait(() => messages.some(m => m.type === 'state'));
    sockets.push(ws); return { ws, messages, hello: messages.find(m => m.type === 'hello') };
  }
  return { app, base, requests, begin, finish, login, connect, setUser: uid => { providerUser = uid; }, close: async () => { sockets.forEach(s => s.terminate()); await app.close(); } };
}

test('OAuth uses browser-bound one-use state, PKCE and HttpOnly cookies', async () => {
  const f = await fixture();
  try {
    const flow = await f.begin(); assert.equal(flow.location.origin, 'https://oauth.yandex.ru'); assert.equal(flow.location.searchParams.get('redirect_uri'), `${f.base}/auth/yandex/callback`);
    assert.equal(flow.location.searchParams.get('code_challenge_method'), 'S256'); assert.equal(flow.location.searchParams.get('scope'), 'login:info');
    assert.equal((await f.finish(flow, 'labx_oauth=wrong')).status, 403);
    const result = await f.finish(flow); assert.equal(result.status, 303);
    assert.ok(result.headers.getSetCookie().some(c => c.includes('HttpOnly') && c.includes('SameSite=Lax')));
    assert.equal((await f.finish(flow)).status, 403);
    const tokenCall = f.requests.find(r => r.url.includes('/token'));
    assert.equal(createHash('sha256').update(tokenCall.options.body.get('code_verifier')).digest('base64url'), flow.location.searchParams.get('code_challenge'));
    assert.ok(!flow.location.href.includes('fixture-secret')); assert.equal(f.requests.at(-1).url, 'https://login.yandex.ru/info?format=json');
  } finally { await f.close(); }
});
test('unauthenticated sockets cannot create accounts; repeated Yandex login keeps one character', async () => {
  const f = await fixture();
  try {
    const bad = new WebSocket(f.base.replace('http', 'ws') + '/ws', { origin: f.base }); const [error] = await once(bad, 'error'); assert.match(error.message, /401/);
    const login = await f.login(), a = await f.connect(login.cookie); assert.equal(a.hello.token, undefined);
    const p = f.app.game.accounts.get('yandex:123456'); p.gold = 999; p.hp = 30;
    const again = await f.login(), b = await f.connect(again.cookie, 'forged-browser-token'); assert.equal(a.hello.id, b.hello.id);
    assert.equal(f.app.game.accounts.size, 1); assert.equal(p.gold, 999); assert.equal(p.hp, 30);
    const state = b.messages.find(m => m.type === 'state'); assert.ok(!JSON.stringify(state).includes(p.token)); assert.ok(!JSON.stringify(state).includes('provider-access-token'));
  } finally { await f.close(); }
});
test('legacy migration requires verified login, keeps progress and cannot be repeated', async () => {
  const f = await fixture();
  try {
    const legacy = f.app.game.connect(null, () => {}); f.app.game.handle(legacy, { type: 'enter' }); legacy.gold = 707; legacy.hp = 29; f.app.game.disconnect(legacy);
    const request = cookie => fetch(f.base + '/auth/migrate', { method: 'POST', headers: { Cookie: cookie, Origin: f.base, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: legacy.token }) });
    assert.equal((await request('')).status, 403);
    const { cookie } = await f.login(); assert.equal((await request(cookie)).status, 200); assert.equal((await request(cookie)).status, 409);
    const c = await f.connect(cookie); assert.equal(c.hello.id, legacy.id); assert.equal(legacy.gold, 707); assert.equal(legacy.hp, 29);
  } finally { await f.close(); }
});
test('logout rejects cross-origin requests and revokes the websocket credential', async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.login();
    const post = origin => fetch(f.base + '/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin } });
    assert.equal((await post('https://outside.invalid')).status, 403);
    assert.equal((await post(f.base)).status, 200);
    const ws = new WebSocket(f.base.replace('http', 'ws') + '/ws', { origin: f.base, headers: { Cookie: cookie } }); const [error] = await once(ws, 'error'); assert.match(error.message, /401/);
  } finally { await f.close(); }
});
test('an unfinished OAuth registration survives cleanup and restart without fresh starter items', () => {
  let now = 1000; const game = new Game({ flag: 'fixture', now: () => now }); const first = game.account('yandex:777'); now += 3600000; game.cleanup();
  assert.equal(game.account('yandex:777'), first); assert.equal(game.sessions.get(first.token), first);
  const next = new Game({ flag: 'fixture', saved: game.records() }); assert.equal(next.account('yandex:777').id, first.id); assert.equal(next.account('yandex:777').registered, false);
});
test('missing OAuth credentials fail closed and test auth cannot start in production', async () => {
  const app = await createApp({ flag: 'fixture' }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    assert.deepEqual(await (await fetch(base + '/api/session')).json(), { requiresAuth: true, configured: false, authenticated: false, loginUrl: '/auth/yandex' });
    assert.equal((await fetch(base + '/auth/yandex')).status, 503);
  } finally { await app.close(); }
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { await assert.rejects(createApp({ flag: 'fixture', testAuth: true }), /forbidden/); } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
