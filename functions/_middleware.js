// Gate every request (pages and API) behind Cloudflare Access.
// Fails closed: with no Access configuration and no local DEV_USER, nothing is served.

let keyCache = { at: 0, keys: null };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function accessKeys(teamDomain) {
  if (keyCache.keys && Date.now() - keyCache.at < 3600_000) return keyCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('could not load Access keys');
  const { keys } = await res.json();
  keyCache = { at: Date.now(), keys };
  return keys;
}

async function verifyAccessJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = parseJson(b64urlToBytes(parts[0]));
  const payload = parseJson(b64urlToBytes(parts[1]));
  if (header.alg !== 'RS256') return null;

  const teamDomain = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const jwk = (await accessKeys(teamDomain)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  return typeof payload.email === 'string' ? payload.email : null;
}

function deny(status, message) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function onRequest(context) {
  const { request, env } = context;
  let email = null;

  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const cookie = request.headers.get('cookie') || '';
    const token =
      request.headers.get('cf-access-jwt-assertion') ||
      (cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/) || [])[1];
    if (!token) return deny(401, 'Sign-in required.');
    try {
      email = await verifyAccessJwt(token, env);
    } catch {
      email = null;
    }
    if (!email) return deny(401, 'Sign-in could not be verified.');
  } else if (env.DEV_USER) {
    // Local development only (.dev.vars). Never set DEV_USER in Cloudflare.
    email = env.DEV_USER;
  } else {
    return deny(503, 'Not configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD. See README.');
  }

  email = email.trim().toLowerCase();
  const allowed = (env.ALLOWED_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return deny(403, 'This account is not allowed.');

  context.data.email = email;
  const res = await context.next();
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'no-referrer');
  out.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  return out;
}
