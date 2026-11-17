// Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }));

const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud123', ALLOWED_EMAILS: 'a@x.com, b@x.com' };
const now = () => Math.floor(Date.now() / 1000);

async function token(claims, key = privateKey) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const body = b64url(JSON.stringify({ iss: 'https://team.cloudflareaccess.com', aud: ['aud123'], exp: now() + 60, email: 'A@x.com', ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
async function run(headers, e = env) {
  const data = {};
  const res = await onRequest({ request: new Request('https://app.example/', { headers }), env: e, data, next: async () => new Response('ok') });
  return { status: res.status, email: data.email };
}

test('valid token passes and email is normalised', async () => {
  assert.deepEqual(await run({ 'cf-access-jwt-assertion': await token({}) }), { status: 200, email: 'a@x.com' });
});
test('cookie token also works', async () => {
  assert.equal((await run({ cookie: `foo=1; CF_Authorization=${await token({})}` })).status, 200);
});
test('missing token is rejected', async () => assert.equal((await run({})).status, 401));
test('a bare email header is not trusted', async () =>
  assert.equal((await run({ 'cf-access-authenticated-user-email': 'a@x.com' })).status, 401));
test('expired token is rejected', async () =>
  assert.equal((await run({ 'cf-access-jwt-assertion': await token({ exp: now() - 5 }) })).status, 401));
test('wrong audience is rejected', async () =>
  assert.equal((await run({ 'cf-access-jwt-assertion': await token({ aud: ['other'] }) })).status, 401));
test('wrong issuer is rejected', async () =>
  assert.equal((await run({ 'cf-access-jwt-assertion': await token({ iss: 'https://evil.cloudflareaccess.com' }) })).status, 401));
test('forged signature is rejected', async () => {
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  assert.equal((await run({ 'cf-access-jwt-assertion': await token({}, other.privateKey) })).status, 401);
});
test('email outside the allowlist is rejected', async () =>
  assert.equal((await run({ 'cf-access-jwt-assertion': await token({ email: 'c@x.com' }) })).status, 403));
test('unconfigured deployment serves nothing', async () => assert.equal((await run({}, {})).status, 503));
