import { createHmac, randomInt, randomUUID } from "node:crypto";
import { buildApiCorsPolicy, buildCorsHeaders } from "./_shared/api-cors.mjs";

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

function corsHeaders(origin, env = process.env) {
  const policy = buildApiCorsPolicy({ configuredOrigins: env.XP_CORS_ALLOW });
  if (policy.invalidConfiguredOriginCount > 0) {
    klog("api_cors_config_invalid", { context: policy.buildContext, invalidOriginCount: policy.invalidConfiguredOriginCount });
  }
  return buildCorsHeaders({
    origin,
    policy,
    methods: "POST,OPTIONS",
    allowedHeaders: "authorization, content-type",
    credentials: true,
    baseHeaders: baseHeaders(),
  });
}

function getHeader(headers, key) {
  if (!headers || typeof headers !== "object") return undefined;
  return headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
}

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
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
  const parsed = Number(env.WS_GUEST_MINT_TTL_SEC || env.WS_MINT_TTL_SEC || "1800");
  if (!Number.isFinite(parsed) || parsed <= 0) return 1800;
  return Math.min(3600, Math.floor(parsed));
}

function signGuestToken({ sub, nickname, tableId, secret, ttlSec }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub,
    mode: "guest",
    nickname,
    tableId,
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const encodedHeader = toBase64UrlJson(header);
  const encodedPayload = toBase64UrlJson(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function randomGuestNickname() {
  const suffix = String(randomInt(1000, 10000));
  return `Guest${suffix}`;
}

export async function handler(event) {
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

  if (!origin || !originCors) {
    return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
  }

  const mintSecret = resolveMintSecret(process.env);
  if (!mintSecret) {
    klog("poker_guest_session_unconfigured", { hasAuthSecret: false });
    return { statusCode: 500, headers: originCors, body: JSON.stringify({ error: "server_error" }) };
  }

  const guestId = `guest_${randomUUID()}`;
  const tableId = `guest_table_${randomUUID()}`;
  const nickname = randomGuestNickname();
  const expiresInSec = resolveTtlSec(process.env);
  const token = signGuestToken({ sub: guestId, nickname, tableId, secret: mintSecret, ttlSec: expiresInSec });

  klog("poker_guest_session_created", { tableId, guestIdPrefix: guestId.slice(0, 12), expiresInSec });
  return {
    statusCode: 200,
    headers: originCors,
    body: JSON.stringify({ ok: true, token, userId: guestId, guestId, nickname, tableId, mode: "guest", expiresInSec }),
  };
}
