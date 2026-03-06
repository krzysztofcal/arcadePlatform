import test from "node:test";
import assert from "node:assert/strict";
import { createConnState } from "./conn-state.mjs";
import { touchSession } from "./session.mjs";

test("createConnState keeps top-level and nested sessionId consistent with explicit resume fields", () => {
  const connState = createConnState(() => "2026-02-28T00:00:00Z");
  assert.equal(typeof connState.sessionId, "string");
  assert.equal(connState.sessionId, connState.session.sessionId);
  assert.equal(connState.userId, null);
  assert.equal(connState.session.userId, null);
  assert.equal(connState.session.latestDeliveredSeq, 0);
  assert.equal(connState.session.replayWindowSize > 0, true);
  assert.equal(connState.session.replayByTableId instanceof Map, true);
  assert.equal(connState.session.latestDeliveredSeqByTableId instanceof Map, true);
});

test("touching session preserves replay metadata and sessionId", () => {
  const connState = createConnState(() => "2026-02-28T00:00:00Z");
  connState.session.latestDeliveredSeq = 2;
  connState.session.replayByTableId.set("table_1", [{ seq: 1, frame: { type: "table_state", seq: 1 } }]);
  connState.session.latestDeliveredSeqByTableId.set("table_1", 2);

  touchSession(connState.session, () => "2026-02-28T00:00:10Z");

  assert.equal(connState.session.sessionId, connState.sessionId);
  assert.equal(connState.session.latestDeliveredSeq, 2);
  assert.equal(connState.session.replayByTableId.get("table_1").length, 1);
  assert.equal(connState.session.latestDeliveredSeqByTableId.get("table_1"), 2);
});
