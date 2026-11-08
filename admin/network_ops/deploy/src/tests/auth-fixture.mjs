import assert from 'node:assert/strict';
export const mockOAuth = { clientId: 'fixture-client', clientSecret: 'fixture-secret', fetchImpl: async (url, options) => new Response(JSON.stringify(url.endsWith('/token') ? { access_token: options.body.get('code') } : { id: options.headers.Authorization.slice('OAuth '.length) })) };
export async function login(base, identity = '1001', legacyCookie = '') {
  const begin = await fetch(base + '/auth/yandex', { redirect: 'manual', headers: { Cookie: legacyCookie } });
  assert.equal(begin.status, 302); const state = new URL(begin.headers.get('location')).searchParams.get('state'), binding = begin.headers.get('set-cookie').split(';')[0];
  const end = await fetch(`${base}/auth/yandex/callback?state=${state}&code=${identity}`, { redirect: 'manual', headers: { Cookie: binding } });
  assert.equal(end.status, 303, await end.text()); return end.headers.getSetCookie().find(c => c.startsWith('labx_net_session=')).split(';')[0];
}
export async function browserLogin(browserContext, base, identity = '1001') {
  const cookie = await login(base, identity), at = cookie.indexOf('=');
  await browserContext.addCookies([{ name: cookie.slice(0, at), value: cookie.slice(at + 1), url: base, httpOnly: true, sameSite: 'Lax' }]); return cookie;
}
