import test from "node:test";
import assert from "node:assert/strict";
import { handleBotStepCommand } from "./bot-autoplay.mjs";

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
