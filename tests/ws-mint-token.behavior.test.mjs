import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const ORIGINAL_ENV = { ...process.env };

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function signJwt({ payload, secret }) {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

async function loadHandler() {
  const mod = await import(`../netlify/functions/ws-mint-token.mjs?cache=${Date.now()}_${Math.random()}`);
  return mod.handler;
}

function postEvent({ headers = {}, body }) {
  return { httpMethod: "POST", headers, body: body == null ? "" : JSON.stringify(body) };
}

test.beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.WS_MINT_ENABLED = "1";
  process.env.WS_MINT_ADMIN_SECRET = "secret-secret-secret";
  process.env.WS_AUTH_HS256_SECRET = "ws-hs-secret";
  process.env.SUPABASE_JWT_SECRET = "sb-jwt-secret";
  process.env.XP_CORS_ALLOW = "https://app.example.test";
});

test.after(() => {
  process.env = ORIGINAL_ENV;
});

test("admin mode mints token for arbitrary subject; missing origin is allowed", async () => {
  const handler = await loadHandler();
  const response = await handler(
    postEvent({ headers: { "x-ws-mint-secret": "secret-secret-secret" }, body: { sub: "user_admin_minted" } })
  );
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "admin");
  assert.equal(payload.userId, "user_admin_minted");
  assert.equal(typeof payload.token, "string");
  assert.ok(payload.token.length > 20);
});

test("admin mode rejects wrong secret", async () => {
  const handler = await loadHandler();
  const response = await handler(
    postEvent({ headers: { "x-ws-mint-secret": "wrong" }, body: { sub: "user_admin_minted" } })
  );
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error, "unauthorized");
});

test("admin mode rejects missing or invalid sub", async () => {
  const handler = await loadHandler();

  const missingSub = await handler(postEvent({ headers: { "x-ws-mint-secret": "secret-secret-secret" }, body: {} }));
  assert.equal(missingSub.statusCode, 400);
  assert.equal(JSON.parse(missingSub.body).error, "invalid_request");

  const invalidSub = await handler(
    postEvent({ headers: { "x-ws-mint-secret": "secret-secret-secret" }, body: { sub: "   " } })
  );
  assert.equal(invalidSub.statusCode, 400);
  assert.equal(JSON.parse(invalidSub.body).error, "invalid_request");
});

test("user mode mints for authenticated user and ignores requested sub", async () => {
  const handler = await loadHandler();
  const nowSec = Math.floor(Date.now() / 1000);
  const bearer = signJwt({
    secret: "sb-jwt-secret",
    payload: { sub: "real_user", exp: nowSec + 3600, iat: nowSec - 1 },
  });

  const response = await handler(
    postEvent({
      headers: {
        origin: "https://app.example.test",
        authorization: `Bearer ${bearer}`,
      },
      body: { sub: "impersonation_attempt" },
    })
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.mode, "user");
  assert.equal(payload.userId, "real_user");
  assert.equal(typeof payload.token, "string");
});

test("user mode rejects disallowed origin", async () => {
  const handler = await loadHandler();
  const response = await handler(
    postEvent({
      headers: { origin: "https://evil.example", authorization: "Bearer something" },
      body: {},
    })
  );
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error, "forbidden_origin");
});

test("user mode rejects missing or invalid authorization", async () => {
  const handler = await loadHandler();

  const missing = await handler(postEvent({ headers: { origin: "https://app.example.test" }, body: {} }));
  assert.equal(missing.statusCode, 401);

  const invalid = await handler(
    postEvent({
      headers: { origin: "https://app.example.test", authorization: "Bearer not-a-jwt" },
      body: {},
    })
  );
  assert.equal(invalid.statusCode, 401);
});

test("logs never contain minted token body", async () => {
  const handler = await loadHandler();
  const originalLog = console.log;
  const originalStdoutWrite = process.stdout.write;
  const captured = [];
  console.log = (...args) => {
    captured.push(args.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "));
  };
  process.stdout.write = function patchedWrite(chunk, encoding, callback) {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString(encoding || "utf8"));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    const response = await handler(
      postEvent({ headers: { "x-ws-mint-secret": "secret-secret-secret" }, body: { sub: "user_admin_minted" } })
    );
    assert.equal(response.statusCode, 200);
    const token = JSON.parse(response.body).token;
    assert.ok(token);
    assert.equal(captured.some((line) => line.includes(token)), false);
  } finally {
    console.log = originalLog;
    process.stdout.write = originalStdoutWrite;
  }
});
