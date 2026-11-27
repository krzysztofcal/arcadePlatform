import { createPrivateKey, sign } from 'node:crypto';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const PUBLISHER_ROOT = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const PACKAGES = new Map([
  ['stage', 'pl.kcswh.arcadepoker.stage'],
  ['production', 'pl.kcswh.arcadepoker']
]);
const SKUS = new Set(['supporter_bronze', 'supporter_silver', 'supporter_gold']);
const MAX_BODY_BYTES = 64 * 1024;

function failure(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function encodeClaim(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function encodeToken(token) {
  if (typeof token !== 'string' || token.length === 0 || Buffer.byteLength(token) > 8192 ||
      token === '.' || token === '..' || /[\u0000-\u0020\u007f]/.test(token)) {
    throw failure('play_support_invalid_token');
  }
  try {
    return encodeURIComponent(token);
  } catch {
    throw failure('play_support_invalid_token');
  }
}

function retryAfterMs(value, now) {
  if (!value) return undefined;
  const delay = /^\d{1,8}$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

async function readJson(response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw failure('play_support_publisher_response');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('play_support_publisher_response');
  return body;
}

export function createPlaySupportPublisher({ environment, credentials, fetchImpl = fetch, now = Date.now }) {
  const packageName = PACKAGES.get(environment);
  const email = credentials?.client_email;
  let key;
  try {
    if (!packageName || typeof email !== 'string' ||
        !/^[a-z0-9][a-z0-9.-]*@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/i.test(email) ||
        typeof fetchImpl !== 'function') throw failure('play_support_publisher_config');
    key = createPrivateKey(credentials.private_key);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) {
      throw failure('play_support_publisher_config');
    }
  } catch {
    throw failure('play_support_publisher_config');
  }

  async function request(url, options, json = true, phase = 'purchase') {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      throw failure('play_support_publisher_unavailable', { phase });
    }

    if (!response.ok) {
      // Never include the URL, bearer, response body, or original error.
      const status = response.status;
      const retryAfter = retryAfterMs(response.headers.get('retry-after'), now());
      await response.body?.cancel().catch(() => {});
      throw failure('play_support_publisher_http', { phase, status, retryAfterMs: retryAfter });
    }
    if (!json) {
      await response.body?.cancel().catch(() => {});
      return;
    }
    try {
      return await readJson(response);
    } catch {
      throw failure('play_support_publisher_response', { phase });
    }
  }

  let cachedToken;
  let expiresAt = 0;
  let refreshing;
  async function fetchAccessToken() {
    const iat = Math.floor(now() / 1000);
    const header = encodeClaim({ alg: 'RS256', typ: 'JWT' });
    const payload = encodeClaim({ iss: email, scope: PUBLISHER_SCOPE, aud: TOKEN_ENDPOINT, iat, exp: iat + 300 });
    const signingInput = header + '.' + payload;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url');
    const result = await request(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signingInput + '.' + signature
      })
    }, true, 'oauth');
    if (typeof result.access_token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(result.access_token) ||
        String(result.token_type).toLowerCase() !== 'bearer' ||
        !Number.isSafeInteger(result.expires_in) || result.expires_in <= 0) {
      throw failure('play_support_publisher_response', { phase: 'oauth' });
    }

    cachedToken = result.access_token;
    expiresAt = iat * 1000 + Math.min(result.expires_in, 3600) * 1000;
    return cachedToken;
  }

  async function accessToken() {
    if (cachedToken && now() + 30_000 < expiresAt) return cachedToken;
    refreshing ??= fetchAccessToken().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  async function callPlay(path, method, json, phase = 'purchase') {
    const bearer = await accessToken();
    try {
      return await request(PUBLISHER_ROOT + '/' + packageName + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + bearer,
          Accept: 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
        },
        ...(method === 'POST' ? { body: '{}' } : {})
      }, json, phase);
    } catch (error) {
      if (error.status === 401 && cachedToken === bearer) expiresAt = 0;
      throw error;
    }
  }

  return {
    async readPurchase(token) {
      return callPlay('/purchases/productsv2/tokens/' + encodeToken(token), 'GET', true);
    },
    async listVoidedPurchases({ startMs, endMs, pageToken = null }) {
      const currentTime = now();
      if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) ||
          startMs < currentTime - 30 * 86_400_000 || startMs >= endMs || endMs > currentTime ||
          (pageToken !== null && (typeof pageToken !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(pageToken)))) {
        throw failure('play_support_invalid_void_window');
      }
      const query = new URLSearchParams({
        type: '0',
        includeQuantityBasedPartialRefund: 'true',
        maxResults: '50'
      });
      // Use the flat v3 Discovery parameters, also used by Google's curl sample.
      if (pageToken) query.set('token', pageToken);
      else {
        query.set('startTime', String(startMs));
        query.set('endTime', String(endMs));
      }
      const result = await callPlay('/purchases/voidedpurchases?' + query, 'GET', true, 'voided');
      const purchases = result.voidedPurchases ?? [];
      const pagination = result.tokenPagination;
      const nextPageToken = pagination?.nextPageToken ?? null;
      if (!Array.isArray(purchases) || purchases.length > 50 ||
          purchases.some(purchase => !purchase || typeof purchase !== 'object' || Array.isArray(purchase)) ||
          (pagination != null && (typeof pagination !== 'object' || Array.isArray(pagination))) ||
          (nextPageToken !== null && (typeof nextPageToken !== 'string' || nextPageToken === pageToken ||
            !/^[\x21-\x7e]{1,2048}$/.test(nextPageToken)))) {
        throw failure('play_support_publisher_response', { phase: 'voided' });
      }
      return { purchases, nextPageToken };
    },
    async acknowledge(sku, token) {
      if (!SKUS.has(sku)) throw failure('play_support_invalid_sku');
      return callPlay('/purchases/products/' + sku + '/tokens/' + encodeToken(token) + ':acknowledge', 'POST', false);
    }
  };
}
