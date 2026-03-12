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

function withEnv(next){
  const prev = {
    WS_MINT_ENABLED: process.env.WS_MINT_ENABLED,
    WS_AUTH_HS256_SECRET: process.env.WS_AUTH_HS256_SECRET,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    XP_CORS_ALLOW: process.env.XP_CORS_ALLOW,
    URL: process.env.URL
  };
  try {
    return next();
  } finally {
    process.env.WS_MINT_ENABLED = prev.WS_MINT_ENABLED;
    process.env.WS_AUTH_HS256_SECRET = prev.WS_AUTH_HS256_SECRET;
    process.env.SUPABASE_JWT_SECRET = prev.SUPABASE_JWT_SECRET;
    process.env.XP_CORS_ALLOW = prev.XP_CORS_ALLOW;
    process.env.URL = prev.URL;
  }
}

test("ws-mint-token returns token for authenticated request", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const bearer = signHs256Jwt({ sub: "user_test_123", secret: process.env.SUPABASE_JWT_SECRET });
    const res = await handler({
      httpMethod: "POST",
      headers: {
        origin: "https://app.example.test",
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json"
      },
      body: "{}"
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body || "{}");
    assert.equal(body.ok, true);
    assert.equal(typeof body.token, "string");
    assert.ok(body.token.length > 20);
  });
});

test("ws-mint-token rejects missing auth", async () => {
  await withEnv(async () => {
    process.env.WS_MINT_ENABLED = "1";
    process.env.WS_AUTH_HS256_SECRET = "ws_auth_secret_123456789";
    process.env.SUPABASE_JWT_SECRET = "supabase_secret_123456789";
    process.env.XP_CORS_ALLOW = "https://app.example.test";

    const res = await handler({
      httpMethod: "POST",
      headers: {
        origin: "https://app.example.test",
        "content-type": "application/json"
      },
      body: "{}"
    });

    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body || "{}");
    assert.notEqual(body.ok, true);
    assert.equal(typeof body.token, "undefined");
  });
});
