import { createHmac } from "node:crypto";
import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";

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
  if (process.env.WS_MINT_ENABLED !== "1") {
    return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
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
    klog("ws_mint_token_ok", { mode: "admin", userId: sub, expiresInSec });
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
  klog("ws_mint_token_ok", { mode: "user", userId, expiresInSec });
  return {
    statusCode: 200,
    headers: originCors,
    body: JSON.stringify({ ok: true, token: wsToken, userId, mode: "user", expiresInSec }),
  };
}
