import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyToken } from "./verify-token.mjs";

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeHs256Jwt({ secret, sub }) {
  const encodedHeader = base64urlJson({ alg: "HS256", typ: "JWT" });
  const encodedPayload = base64urlJson({ sub });
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

test("verifyToken accepts HS256 token with WS_AUTH_TEST_SECRET", () => {
  const token = makeHs256Jwt({ secret: "test-secret", sub: "user_abc" });
  const result = verifyToken({ token, env: { WS_AUTH_TEST_SECRET: "test-secret" } });
  assert.equal(result.ok, true);
  assert.equal(result.userId, "user_abc");
});

test("verifyToken rejects tampered token signature", () => {
  const token = makeHs256Jwt({ secret: "test-secret", sub: "user_abc" });
  const tampered = `${token.split(".").slice(0, 2).join(".")}.AAAA`;
  const result = verifyToken({ token: tampered, env: { WS_AUTH_TEST_SECRET: "test-secret" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth_invalid");
});

test("verifyToken rejects malformed token", () => {
  const result = verifyToken({ token: "not.a.jwt", env: { WS_AUTH_TEST_SECRET: "test-secret" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth_invalid");
});
