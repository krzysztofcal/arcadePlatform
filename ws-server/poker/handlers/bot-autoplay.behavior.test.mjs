import test from "node:test";
import assert from "node:assert/strict";
import {
  createBotAutoplayObservability,
  handleBotStepCommand,
  matchesBotTimeoutSafetySuppression,
  shouldClearBotTimeoutSafetySuppression,
  shouldSuppressBotTimeoutSafetyRetry
} from "./bot-autoplay.mjs";

test("bot autoplay observability preserves first and terminal events while aggregating repeated failures", () => {
  const logs = [];
  let nowMs = 1_000;
  const observer = createBotAutoplayObservability({
    klog: (kind, data) => logs.push({ kind, data }),
    now: () => nowMs,
    summaryIntervalMs: 60_000
  });
  const failure = {
    tableId: "t1",
    handId: "h1",
    stateVersion: 12,
    turnUserId: "bot_2",
    reason: "apply_action_failed",
    error: "showdown_incomplete_community"
  };

  assert.equal(observer.log("poker_act_bot_autoplay_step_error", failure), true);
  assert.equal(observer.log("ws_bot_autoplay_failed", failure), true);
  assert.equal(observer.log("poker_act_bot_autoplay_step_error", failure), false);
  assert.equal(observer.log("ws_bot_autoplay_failed", failure), false);
  nowMs += 25;
  assert.equal(observer.log("ws_bot_timeout_safety_same_state_retry_suppressed", {
    tableId: "t1",
    handId: "h1",
    stateVersion: 12,
    turnUserId: "bot_2",
    reason: "showdown_incomplete_community"
  }), true);

  assert.deepEqual(logs.map((entry) => entry.kind), [
    "poker_act_bot_autoplay_step_error",
    "ws_bot_autoplay_failed",
    "ws_bot_timeout_safety_same_state_retry_suppressed",
    "ws_bot_autoplay_failure_summary"
  ]);
  assert.deepEqual(logs[3].data.countsByReason, {
    showdown_incomplete_community: { total: 4, logged: 2, suppressed: 2 }
  });
});

test("bot timeout safety suppresses deterministic same-state invariant retries only", () => {
  assert.equal(shouldSuppressBotTimeoutSafetyRetry({ ok: false, changed: false, reason: "showdown_incomplete_community" }), true);
  assert.equal(shouldSuppressBotTimeoutSafetyRetry({ ok: false, changed: false, reason: "showdown_missing_hole_cards" }), true);
  assert.equal(shouldSuppressBotTimeoutSafetyRetry({ ok: false, changed: false, reason: "persist_failed" }), false);
  assert.equal(shouldSuppressBotTimeoutSafetyRetry({ ok: true, changed: false, reason: "turn_not_bot" }), false);
  assert.equal(shouldSuppressBotTimeoutSafetyRetry({ ok: false, changed: true, reason: "state_invalid" }), false);
});

test("bot timeout safety suppression matches the complete unchanged turn fingerprint", () => {
  const suppressed = {
    tableId: "t1",
    handId: "h1",
    stateVersion: 12,
    turnUserId: "bot_2",
    reason: "showdown_incomplete_community"
  };
  assert.equal(matchesBotTimeoutSafetySuppression(suppressed, { ...suppressed }), true);
  assert.equal(matchesBotTimeoutSafetySuppression(suppressed, { ...suppressed, stateVersion: 13 }), false);
  assert.equal(matchesBotTimeoutSafetySuppression(suppressed, { ...suppressed, handId: "h2" }), false);
  assert.equal(matchesBotTimeoutSafetySuppression(suppressed, { ...suppressed, turnUserId: "bot_3" }), false);
});

test("bot timeout safety suppression clears only after autoplay changes state successfully", () => {
  assert.equal(shouldClearBotTimeoutSafetySuppression({ ok: true, changed: true, reason: "completed" }), true);
  assert.equal(shouldClearBotTimeoutSafetySuppression({ ok: true, changed: false, reason: "completed" }), false);
  assert.equal(shouldClearBotTimeoutSafetySuppression({ ok: true, changed: false, reason: "turn_not_bot" }), false);
  assert.equal(shouldClearBotTimeoutSafetySuppression({ ok: true, changed: false, reason: "non_action_phase" }), false);
  assert.equal(shouldClearBotTimeoutSafetySuppression({ ok: false, changed: true, reason: "persist_failed" }), false);
});

test("handleBotStepCommand broadcasts when autoplay changes state", async () => {
  const calls = { snapshots: 0 };
  const observed = [];
  const result = await handleBotStepCommand({
    tableId: "t1",
    trigger: "act",
    requestId: "r1",
    runBotStep: async (payload) => {
      observed.push(payload.trigger);
      return { ok: true, changed: true, actionCount: 1, reason: "action_cap_reached", shouldContinue: true };
    },
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(observed, ["act"]);
  assert.equal(calls.snapshots, 1);
});

test("handleBotStepCommand skips duplicate final broadcast when steps already emitted snapshots", async () => {
  const calls = { snapshots: 0 };
  const result = await handleBotStepCommand({
    tableId: "t1",
    trigger: "act",
    requestId: "r1b",
    runBotStep: async () => ({
      ok: true,
      changed: true,
      actionCount: 3,
      reason: "non_action_phase",
      broadcastedStepCount: 3,
      lastBroadcastStateVersion: 18,
      finalStateVersion: 18
    }),
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.snapshots, 0);
});

test("handleBotStepCommand falls back to final broadcast when last step snapshot did not reach final version", async () => {
  const calls = { snapshots: 0 };
  const result = await handleBotStepCommand({
    tableId: "t1",
    trigger: "act",
    requestId: "r1c",
    runBotStep: async () => ({
      ok: true,
      changed: true,
      actionCount: 3,
      reason: "non_action_phase",
      broadcastedStepCount: 2,
      lastBroadcastStateVersion: 17,
      finalStateVersion: 18
    }),
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.snapshots, 1);
});

test("handleBotStepCommand broadcasts when autoplay fails", async () => {
  const calls = { snapshots: 0 };
  const result = await handleBotStepCommand({
    tableId: "t1",
    trigger: "timeout",
    requestId: "r-timeout",
    runBotStep: async () => ({ ok: false, changed: false, actionCount: 0, reason: "persist_failed" }),
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(calls.snapshots, 1);
});

test("handleBotStepCommand does not broadcast when autoplay is a clean noop", async () => {
  const calls = { snapshots: 0 };
  const result = await handleBotStepCommand({
    tableId: "t1",
    trigger: "start_hand",
    requestId: "r2",
    runBotStep: async () => ({ ok: true, changed: false, actionCount: 0, reason: "turn_not_bot" }),
    broadcastStateSnapshots: () => {
      calls.snapshots += 1;
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.snapshots, 0);
});

for (const reason of ["completed", "turn_not_bot", "non_action_phase"]) {
  test(`handleBotStepCommand preserves ${reason} as a successful clean stop`, async () => {
    const result = await handleBotStepCommand({
      tableId: "t-clean-stop",
      trigger: "test",
      runBotStep: async () => ({ ok: true, changed: false, actionCount: 0, reason }),
      broadcastStateSnapshots: () => {
        throw new Error("clean stop must not broadcast");
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.reason, reason);
  });
}
