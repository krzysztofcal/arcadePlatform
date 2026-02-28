import test from "node:test";
import assert from "node:assert/strict";
import { createConnState } from "./conn-state.mjs";

test("createConnState keeps top-level and nested sessionId consistent", () => {
  const connState = createConnState(() => "2026-02-28T00:00:00Z");
  assert.equal(typeof connState.sessionId, "string");
  assert.equal(connState.sessionId, connState.session.sessionId);
  assert.equal(connState.userId, null);
  assert.equal(connState.session.userId, null);
});
