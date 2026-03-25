import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAcceptedBotAutoplayExecutor } from "./accepted-bot-autoplay-adapter.mjs";

test("autoplay adapter resolves shared autoplay from neutral shared module path", () => {
  const source = fs.readFileSync(new URL("./accepted-bot-autoplay-adapter.mjs", import.meta.url), "utf8");
  assert.match(source, /\.\.\/\.\.\/\.\.\/shared\/poker-domain\/poker-autoplay\.mjs/);
  assert.doesNotMatch(source, /netlify\/functions\/_shared/);

  const sharedSource = fs.readFileSync(new URL("../../../shared/poker-domain/poker-autoplay.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(sharedSource, /netlify\/functions\/_shared/);
});

test("accepted bot autoplay executes and persists when bot is on turn", async () => {
  const calls = { persist: 0 };
  const state = {
    version: 2,
    tableId: "t1",
    handId: "h1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    stacks: { human_1: 100, bot_2: 100 }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...state }),
    persistedStateVersion: () => 2,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 3 })
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r1" });
  assert.equal(result.ok, true);
  assert.equal(calls.persist > 0, true);
});

test("accepted bot autoplay no-ops when next turn is not a bot", async () => {
  const tableManager = {
    persistedPokerState: () => ({
      version: 2,
      tableId: "t1",
      handId: "h1",
      phase: "PREFLOP",
      turnUserId: "human_1",
      seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
      stacks: { human_1: 100, bot_2: 100 }
    }),
    persistedStateVersion: () => 2,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => {
      throw new Error("unexpected_apply");
    }
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "start_hand", requestId: "r2" });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "turn_not_bot");
});

test("accepted bot autoplay no-ops on non-action phase boundary", async () => {
  const tableManager = {
    persistedPokerState: () => ({
      version: 4,
      tableId: "t1",
      handId: "h1",
      phase: "SETTLED",
      turnUserId: null,
      seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }]
    }),
    persistedStateVersion: () => 4,
    tableSnapshot: () => ({ seats: [] }),
    applyAction: () => {
      throw new Error("unexpected_apply");
    }
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r4" });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "not_action_phase");
});

test("accepted bot autoplay restores and resyncs on persistence conflict", async () => {
  const calls = { restore: 0, resync: 0 };
  const tableManager = {
    persistedPokerState: () => ({
      version: 2,
      tableId: "t1",
      handId: "h1",
      phase: "PREFLOP",
      turnUserId: "bot_2",
      seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
      stacks: { human_1: 100, bot_2: 100 }
    }),
    persistedStateVersion: () => 2,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 3 })
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => ({ ok: false, reason: "persistence_conflict" }),
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r3" });
  assert.equal(result.ok, true);
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 1);
});

test("accepted bot autoplay unavailable shared helper returns safe non-fatal result", async () => {
  const run = createAcceptedBotAutoplayExecutor({
    tableManager: {
      persistedPokerState: () => ({
        version: 2,
        tableId: "t1",
        handId: "h1",
        phase: "PREFLOP",
        turnUserId: "bot_2",
        seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
        stacks: { human_1: 100, bot_2: 100 }
      }),
      persistedStateVersion: () => 2,
      tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
      applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 3 })
    },
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: "./missing-autoplay-module-for-test.mjs" },
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r5" });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "autoplay_unavailable");
  assert.equal(result.changed, false);
  assert.equal(result.noop, true);
});
