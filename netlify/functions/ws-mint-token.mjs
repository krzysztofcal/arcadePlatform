import { createHmac, timingSafeEqual } from "node:crypto";

function klog(kind, data) {
  const payload = data && typeof data === "object" ? ` ${JSON.stringify(data)}` : "";
  process.stdout.write(`[klog] ${kind}${payload}\n`);
}

function baseHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
}

function corsAllowList(env = process.env) {
  const fromEnv = (env.XP_CORS_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const siteUrl = env.URL;
  if (siteUrl && !fromEnv.includes(siteUrl)) {
    fromEnv.push(siteUrl);
  }
  return fromEnv;
}

function corsHeaders(origin, env = process.env) {
  const headers = baseHeaders();
  if (!origin) {
    return headers;
  }

  const allow = corsAllowList(env);
  const isNetlifyDomain = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
  if (!isNetlifyDomain && !allow.includes(origin)) {
    return null;
  }

  return {
    ...headers,
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  };
}

function extractBearerToken(headers) {
  const headerValue = headers?.authorization || headers?.Authorization || headers?.AUTHORIZATION;
  if (!headerValue || typeof headerValue !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : null;
}

function decodeBase64UrlJson(segment) {
  if (!segment) return null;
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function safeCompareBase64Url(a, b) {
  if (!a || !b) return false;
  let left;
  let right;
  try {
    left = Buffer.from(a, "base64url");
    right = Buffer.from(b, "base64url");
  } catch {
    return false;
  }
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function verifySupabaseJwt(token, env = process.env) {
  if (!token) {
    return { valid: false, userId: null, reason: "missing_token" };
  }
  const secret = env.SUPABASE_JWT_SECRET || env.SUPABASE_JWT_SECRET_V2 || "";
  if (!secret) {
    return { valid: false, userId: null, reason: "missing_jwt_secret" };
  }

  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return { valid: false, userId: null, reason: "malformed_token" };
  }

  const header = decodeBase64UrlJson(headerSegment);
  const payload = decodeBase64UrlJson(payloadSegment);
  if (!header || !payload) {
    return { valid: false, userId: null, reason: "invalid_encoding" };
  }

  if (header.alg !== "HS256") {
    return { valid: false, userId: null, reason: "unsupported_alg" };
  }

  const expectedSig = createHmac("sha256", secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
  if (!safeCompareBase64Url(signatureSegment, expectedSig)) {
    return { valid: false, userId: null, reason: "invalid_signature" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || Number(payload.exp) <= nowSec) {
    return { valid: false, userId: null, reason: "expired" };
  }

  const userId = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!userId) {
    return { valid: false, userId: null, reason: "missing_sub" };
  }

  return { valid: true, userId, reason: "ok" };
}

function getHeader(headers, key) {
  if (!headers || typeof headers !== "object") return undefined;
  return headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
}

function parseJsonBody(rawBody) {
  if (rawBody == null || rawBody === "") {
    return { ok: true, value: {} };
  }
  if (typeof rawBody !== "string") {
    return { ok: false };
  }
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signWsToken({ sub, secret, ttlSec }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub,
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const encodedHeader = toBase64UrlJson(header);
  const encodedPayload = toBase64UrlJson(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function resolveMintSecret(env) {
  if (typeof env.WS_AUTH_HS256_SECRET === "string" && env.WS_AUTH_HS256_SECRET.length > 0) {
    return env.WS_AUTH_HS256_SECRET;
  }
  if (typeof env.WS_AUTH_TEST_SECRET === "string" && env.WS_AUTH_TEST_SECRET.length > 0) {
    return env.WS_AUTH_TEST_SECRET;
  }
  return null;
}

function resolveTtlSec(env) {
  const parsed = Number(env.WS_MINT_TTL_SEC || "300");
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return Math.min(3600, Math.floor(parsed));
}

function invalidRequest(headers) {
  return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid_request" }) };
}

export async function handler(event) {
  if (process.env.WS_MINT_ENABLED === "0") {
    return { statusCode: 503, headers: baseHeaders(), body: JSON.stringify({ error: "disabled" }) };
  }

  const origin = getHeader(event.headers, "origin");
  const originCors = corsHeaders(origin);
  const optionsHeaders = originCors || baseHeaders();

  if (event.httpMethod === "OPTIONS") {
    if (origin && !originCors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    return { statusCode: 204, headers: optionsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: optionsHeaders, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const mintSecret = resolveMintSecret(process.env);
  if (!mintSecret) {
    klog("ws_mint_token_unconfigured", { hasAuthSecret: false });
    return { statusCode: 500, headers: optionsHeaders, body: JSON.stringify({ error: "server_error" }) };
  }

  const adminHeader = getHeader(event.headers, "x-ws-mint-secret");
  const hasAdminHeader = typeof adminHeader === "string" && adminHeader.length > 0;
  const adminSecret = process.env.WS_MINT_ADMIN_SECRET;
  const bodyParsed = parseJsonBody(event.body);
  if (!bodyParsed.ok) {
    return invalidRequest(optionsHeaders);
  }

  const expiresInSec = resolveTtlSec(process.env);

  if (hasAdminHeader) {
    if (typeof adminSecret !== "string" || adminSecret.length < 16 || adminHeader !== adminSecret) {
      klog("ws_mint_token_admin_unauthorized", { hasAdminSecret: !!adminSecret });
      return { statusCode: 401, headers: optionsHeaders, body: JSON.stringify({ error: "unauthorized" }) };
    }

    const subRaw = bodyParsed.value.sub;
    const sub = typeof subRaw === "string" ? subRaw.trim() : "";
    if (!sub || sub.length > 128) {
      return invalidRequest(optionsHeaders);
    }

    const token = signWsToken({ sub, secret: mintSecret, ttlSec: expiresInSec });
    return {
      statusCode: 200,
      headers: optionsHeaders,
      body: JSON.stringify({ ok: true, token, userId: sub, mode: "admin", expiresInSec }),
    };
  }

  if (!origin || !originCors) {
    return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    klog("ws_mint_token_user_unauthorized", { reason: auth.reason || "invalid" });
    return { statusCode: 401, headers: originCors, body: JSON.stringify({ error: "unauthorized" }) };
  }

  const userId = auth.userId;
  const wsToken = signWsToken({ sub: userId, secret: mintSecret, ttlSec: expiresInSec });
  return {
    statusCode: 200,
    headers: originCors,
    body: JSON.stringify({ ok: true, token: wsToken, userId, mode: "user", expiresInSec }),
  };
}
