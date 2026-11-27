import { createPublicKey, verify as verifySignature } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const VALID_KID = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_KEYSET_BYTES = 64 * 1024;

async function loadKeys(fetchImpl) {
  const response = await fetchImpl(CERTS_URL, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('play_support_push_keys_unavailable');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_KEYSET_BYTES) throw new Error('play_support_push_keys_unavailable');
    chunks.push(chunk);
  }
  const { keys: jwks } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(jwks) || jwks.length > 32) throw new Error('play_support_push_keys_unavailable');
  const keys = new Map();
  for (const jwk of jwks) {
    if (jwk?.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig' ||
        typeof jwk.kid !== 'string' || !VALID_KID.test(jwk.kid)) continue;
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    if (key.asymmetricKeyDetails.modulusLength < 2048 || keys.has(jwk.kid)) continue;
    keys.set(jwk.kid, key);
  }
  if (!keys.size) throw new Error('play_support_push_keys_unavailable');
  const maxAge = Number(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i.exec(response.headers.get('cache-control') || '')?.[1]);
  // Align the minimum key reuse window with the refresh rate limit.
  return { keys, ttl: (Number.isFinite(maxAge) ? Math.max(30, Math.min(maxAge, 3600)) : 300) * 1000 };
}

export function createPlaySupportPushVerifier({ audience, serviceAccountEmail, fetchImpl = fetch, now = Date.now }) {
  if (typeof audience !== 'string' || audience.length < 1 || audience.length > 1024 ||
      typeof serviceAccountEmail !== 'string' || !serviceAccountEmail.endsWith('.gserviceaccount.com')) {
    throw new Error('play_support_push_config');
  }
  let keys = new Map();
  let expiresAt = 0;
  let refreshAfter = 0;
  let refreshing;
  let previousRefreshFailed = false;

  async function findKey(kid) {
    const time = now();
    if (time < expiresAt && keys.has(kid)) return keys.get(kid);
    if (!refreshing && time >= refreshAfter) {
      refreshAfter = time + 30_000;
      refreshing = loadKeys(fetchImpl).then(result => {
        keys = result.keys;
        expiresAt = now() + result.ttl;
        previousRefreshFailed = false;
      }).catch(() => {
        previousRefreshFailed = true;
      }).finally(() => {
        refreshing = undefined;
      });
    }
    if (refreshing) await refreshing;
    if (previousRefreshFailed || (now() >= expiresAt && time < refreshAfter)) {
      throw new Error('play_support_push_keys_unavailable');
    }
    return keys.get(kid);
  }

  return async function verifyPushAuthorization(authorization) {
    if (typeof authorization !== 'string' || authorization.length > 8192) return false;
    const jwt = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!jwt) return false;

    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(jwt[1], 'base64url'));
      claims = JSON.parse(Buffer.from(jwt[2], 'base64url'));
    } catch {
      return false;
    }
    const time = Math.floor(now() / 1000);
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !VALID_KID.test(header.kid) ||
        !ISSUERS.has(claims?.iss) || claims.aud !== audience ||
        claims.email !== serviceAccountEmail || claims.email_verified !== true ||
        !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
        claims.exp <= time || claims.iat > time + 30 ||
        claims.exp <= claims.iat || claims.exp - claims.iat > 3630) return false;

    const key = await findKey(header.kid);
    if (!key) return false;
    try {
      return verifySignature('RSA-SHA256', Buffer.from(jwt[1] + '.' + jwt[2]),
        key, Buffer.from(jwt[3], 'base64url'));
    } catch {
      return false;
    }
  };
}
