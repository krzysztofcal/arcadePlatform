import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handler } from "../netlify/functions/ws-mint-token.mjs";

function toBase64UrlJson(value){
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signHs256Jwt({ sub, secret, ttlSec = 300 }){
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub, iat: nowSec, exp: nowSec + ttlSec };
  const encodedHeader = toBase64UrlJson(header);
  const encodedPayload = toBase64UrlJson(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function unsignedJwt({ sub, alg = "ES256", ttlSec = 300 }){
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg, typ: "JWT" };
  const payload = { sub, iat: nowSec, exp: nowSec + ttlSec };
  return `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}.signature`;
}

async function withEnv(next){
  const prev = {
    WS_MINT_ENABLED: process.env.WS_MINT_ENABLED,
    WS_AUTH_HS256_SECRET: process.env.WS_AUTH_HS256_SECRET,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    SUPABASE_JWT_SECRET_V2: process.env.SUPABASE_JWT_SECRET_V2,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_URL_V2: process.env.SUPABASE_URL_V2,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_ANON_KEY_V2: process.env.SUPABASE_ANON_KEY_V2,
    XP_CORS_ALLOW: process.env.XP_CORS_ALLOW,
    URL: process.env.URL
  };
  try {
    return await next();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function postMint({ bearer, origin = "https://app.example.test" } = {}){
  const headers = {
    origin,
    "content-type": "application/json"
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return handler({
    httpMethod: "POST",
    headers,
    body: "{}"
  });
}

test("ws-mint-token returns token for authenticated request", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const bearer = signHs256Jwt({ sub: "user_test_123", secret: process.env.SUPABASE_JWT_SECRET });
    const res = await postMint({ bearer });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body || "{}");
    assert.equal(body.ok, true);
    assert.equal(typeof body.token, "string");
    assert.ok(body.token.length > 20);
  });
});

test("ws-mint-token verifies unsupported Supabase JWT alg with remote auth fallback", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.SUPABASE_URL = "https://stageabc.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const previousFetch = globalThis.fetch;
    let receivedAuthorization = null;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://stageabc.supabase.co/auth/v1/user");
      assert.equal(options.headers.apikey, "service-role");
      receivedAuthorization = options.headers.authorization;
      return { ok: true, json: async () => ({ id: "stage-user-123", email: "stage@example.test" }) };
    };

    try {
      const bearer = unsignedJwt({ sub: "ignored-local-sub", alg: "ES256" });
      const res = await postMint({ bearer });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body || "{}");
      assert.equal(body.ok, true);
      assert.equal(body.userId, "stage-user-123");
      assert.equal(typeof body.token, "string");
      assert.ok(body.token.length > 20);
      assert.equal(receivedAuthorization, `Bearer ${bearer}`);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("ws-mint-token rejects unsupported Supabase JWT alg when remote auth rejects it", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.SUPABASE_URL = "https://stageabc.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "invalid_token" }) });

    try {
      const bearer = unsignedJwt({ sub: "ignored-local-sub", alg: "ES256" });
      const res = await postMint({ bearer });
      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.body || "{}");
      assert.notEqual(body.ok, true);
      assert.equal(typeof body.token, "undefined");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("ws-mint-token keeps legacy unsupported_alg failure when remote auth is not configured", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("remote auth should not be called");
    };

    try {
      const bearer = unsignedJwt({ sub: "ignored-local-sub", alg: "ES256" });
      const res = await postMint({ bearer });
      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.body || "{}");
      assert.notEqual(body.ok, true);
      assert.equal(typeof body.token, "undefined");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("ws-mint-token keeps missing_jwt_secret failure when no local or remote verifier is configured", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const bearer = unsignedJwt({ sub: "ignored-local-sub", alg: "ES256" });
    const res = await postMint({ bearer });
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body || "{}");
    assert.notEqual(body.ok, true);
    assert.equal(typeof body.token, "undefined");
  });
});

test("ws-mint-token remote fallback supports v2 Supabase URL and anon key env vars", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.SUPABASE_URL_V2 = "https://stagev2.supabase.co/auth/callback?next=/poker";
    process.env.SUPABASE_ANON_KEY_V2 = "anon-v2";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://stagev2.supabase.co/auth/v1/user");
      assert.equal(options.headers.apikey, "anon-v2");
      return { ok: true, json: async () => ({ id: "stage-v2-user" }) };
    };

    try {
      const bearer = unsignedJwt({ sub: "ignored-local-sub", alg: "ES256" });
      const res = await postMint({ bearer });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body || "{}");
      assert.equal(body.ok, true);
      assert.equal(body.userId, "stage-v2-user");
      assert.equal(typeof body.token, "string");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("ws-mint-token rejects missing auth", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const res = await postMint();

    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body || "{}");
    assert.notEqual(body.ok, true);
    assert.equal(typeof body.token, "undefined");
  });
});
