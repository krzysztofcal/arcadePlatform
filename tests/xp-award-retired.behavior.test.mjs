import assert from "node:assert/strict";
import test from "node:test";

process.env.XP_TEST_MODE = "1";
const { handler } = await import("../netlify/functions/award-xp.mjs");

const invoke = async (body, headers = {}) => {
  const response = await handler({ httpMethod: "POST", headers, body: JSON.stringify(body) });
  return { response, payload: JSON.parse(response.body) };
};

test("legacy client-provided awards are retired without mutating XP", async () => {
  const { response, payload } = await invoke({ userId: "legacy-user", sessionId: "legacy-session", delta: 300, ts: Date.now() });
  assert.equal(response.statusCode, 410);
  assert.equal(payload.error, "legacy_award_retired");
  assert.equal(payload.endpoint, "/.netlify/functions/calculate-xp");
  assert.equal(Object.hasOwn(payload, "awarded"), false);
});

test("legacy award with an invalid bearer token returns unauthorized before retirement status", async () => {
  const { response, payload } = await invoke(
    { userId: "legacy-user", sessionId: "legacy-session", delta: 300, ts: Date.now() },
    { authorization: "Bearer invalid-token" },
  );
  assert.equal(response.statusCode, 401);
  assert.equal(payload.error, "unauthorized");
  assert.equal(Object.hasOwn(payload, "endpoint"), false);
  assert.equal(Object.hasOwn(payload, "awarded"), false);
});

test("legacy status adapter remains read-only and never generates a session id", async () => {
  const withoutSession = await invoke({ userId: "legacy-status-user", statusOnly: true });
  assert.equal(withoutSession.response.statusCode, 200);
  assert.equal(withoutSession.payload.status, "statusOnly");
  assert.equal(withoutSession.payload.totalLifetime, 0);
  assert.equal(Object.hasOwn(withoutSession.payload, "sessionId"), false);

  const suppliedSession = await invoke({ userId: "legacy-status-user", sessionId: "supplied-session", statusOnly: true });
  assert.equal(suppliedSession.response.statusCode, 200);
  assert.equal(suppliedSession.payload.sessionId, "supplied-session");
});
