import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

import { withEnv } from "./helpers/xp-test-helpers.mjs";
import { handler as pokerGuestSessionHandler } from "../netlify/functions/poker-guest-session.mjs";
import { verifyToken } from "../ws-server/poker/auth/verify-token.mjs";

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeGuestJwt({ secret, sub, tableId, nickname = "Guest1234", expOffsetSec = 3600 }) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub,
    mode: "guest",
    nickname,
    tableId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
  };
  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(payload);
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function guestSessionEvent(method) {
  return {
    httpMethod: method,
    headers: { origin: "https://arcade.test" },
  };
}

test("guest session endpoint mints an expiring guest token that verifies", async () => {
  await withEnv({
    URL: "https://arcade.test",
    WS_AUTH_TEST_SECRET: "guest-secret",
  }, async () => {
    const response = await pokerGuestSessionHandler(guestSessionEvent("POST"));
    const body = JSON.parse(response.body);

    assert.equal(response.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mode, "guest");
    assert.equal(typeof body.token, "string");
    assert.equal(typeof body.tableId, "string");
    assert.ok(body.tableId.startsWith("guest_table_"));
    assert.ok(body.nickname.startsWith("Guest"));

    const verified = verifyToken({ token: body.token, env: { WS_AUTH_TEST_SECRET: "guest-secret" } });
    assert.equal(verified.ok, true);
    assert.equal(verified.identityMode, "guest");
    assert.equal(verified.tableId, body.tableId);
    assert.equal(verified.nickname, body.nickname);
  });
});

test("expired guest token is rejected", () => {
  const token = makeGuestJwt({
    secret: "guest-secret",
    sub: "guest_expired",
    tableId: "guest_table_expired",
    expOffsetSec: -60,
  });

  const result = verifyToken({ token, env: { WS_AUTH_TEST_SECRET: "guest-secret" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth_expired");
});
