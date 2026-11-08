import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/index.mjs';
import { mockOAuth, login } from './auth-fixture.mjs';

async function fixture(options = {}) {
  let now = 10000; const calls = [];
  const app = await createApp({ clock: () => now, oauth: { ...mockOAuth, fetchImpl: async (url, data) => { calls.push({ url, data }); return mockOAuth.fetchImpl(url, data); } }, ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); const base = `http://127.0.0.1:${app.server.address().port}`; app.setOrigin(base);
  const begin = async () => { const res = await fetch(base + '/auth/yandex', { redirect: 'manual' }); const url = new URL(res.headers.get('location')); return { state: url.searchParams.get('state'), cookie: res.headers.get('set-cookie').split(';')[0], url }; };
  const finish = (flow, cookie = flow.cookie) => fetch(`${base}/auth/yandex/callback?state=${flow.state}&code=1001`, { redirect: 'manual', headers: { Cookie: cookie } });
  return { app, base, begin, finish, calls, tick: ms => { now += ms; } };
}
test('OAuth uses one-use browser-bound state, PKCE, exact callback and separate HttpOnly cookies', async () => {
  const f = await fixture();
  try {
    const flow = await f.begin(); assert.equal(flow.url.origin, 'https://oauth.yandex.ru'); assert.equal(flow.url.searchParams.get('redirect_uri'), `${f.base}/auth/yandex/callback`); assert.equal(flow.url.searchParams.get('scope'), 'login:info');
    assert.equal((await f.finish(flow, 'labx_net_oauth=wrong')).status, 403); assert.equal(f.calls.length, 0);
    const result = await f.finish(flow); assert.equal(result.status, 303); assert.equal((await f.finish(flow)).status, 403);
    assert.ok(result.headers.getSetCookie().some(c => c.startsWith('labx_net_session=') && c.includes('HttpOnly') && c.includes('SameSite=Lax')));
    const exchange = f.calls[0]; assert.equal(exchange.data.body.get('redirect_uri'), `${f.base}/auth/yandex/callback`);
    assert.equal(createHash('sha256').update(exchange.data.body.get('code_verifier')).digest('base64url'), flow.url.searchParams.get('code_challenge'));
    assert.ok(!flow.url.href.includes('fixture-secret')); assert.equal(f.calls[1].url, 'https://login.yandex.ru/info?format=json');
  } finally { await f.app.close(); }
});
test('expired state, missing credentials and spoofed identities cannot create profiles', async () => {
  const f = await fixture();
  try { const flow = await f.begin(); f.tick(300001); assert.equal((await f.finish(flow)).status, 403); assert.equal(f.app.profiles.size, 0); }
  finally { await f.app.close(); }
  const missing = await fixture({ oauth: {} });
  try { assert.equal((await fetch(missing.base + '/auth/yandex', { redirect: 'manual' })).status, 503); assert.equal((await fetch(missing.base + '/api/state', { headers: { 'X-Yandex-ID': '1001' } })).status, 401); assert.equal(missing.app.profiles.size, 0); }
  finally { await missing.app.close(); }
});
test('repeated login does not allocate profiles and logout revokes the credential', async () => {
  const f = await fixture();
  try {
    const a = await login(f.base, '1001'), b = await login(f.base, '1001'); assert.notEqual(a, b); assert.equal(f.app.profiles.size, 1);
    const post = origin => fetch(f.base + '/auth/logout', { method: 'POST', headers: { Origin: origin, Cookie: a } });
    assert.equal((await post('https://other.invalid')).status, 403); assert.equal((await post(f.base)).status, 200);
    assert.equal((await fetch(f.base + '/api/state', { headers: { Cookie: a } })).status, 401);
    assert.equal((await fetch(f.base + '/api/state', { headers: { Cookie: b } })).status, 200);
  } finally { await f.app.close(); }
});
test('OAuth admission is bounded before allocation and Secure cookies follow HTTPS origin', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 300; i++) assert.equal((await fetch(f.base + '/auth/yandex', { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(f.base + '/auth/yandex', { redirect: 'manual' })).status, 429); assert.equal(f.app.profiles.size, 0);
    f.app.auth.setOrigin('https://localhost:3388'); assert.ok(f.app.auth.cookie('labx_net_session', 'x', 10).includes('; Secure'));
    assert.throws(() => f.app.auth.setOrigin('http://public.example'), /HTTPS/);
  } finally { await f.app.close(); }
});
