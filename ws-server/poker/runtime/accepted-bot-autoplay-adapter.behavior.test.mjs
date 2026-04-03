import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAcceptedBotAutoplayExecutor } from "./accepted-bot-autoplay-adapter.mjs";
import { initHandState, applyAction as applyRuntimeAction, advanceIfNeeded } from "../snapshot-runtime/poker-reducer.mjs";
import { runAdvanceLoop } from "../../../shared/poker-domain/poker-autoplay.mjs";
import { materializeShowdownAndPayout } from "../snapshot-runtime/poker-materialize-showdown.mjs";
import { computeShowdown } from "../snapshot-runtime/poker-showdown.mjs";
import { awardPotsAtShowdown } from "../snapshot-runtime/poker-payout.mjs";

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

test("accepted bot autoplay showdown uses trusted private hole cards even for public showdown state", async () => {
  const logs = [];
  const calls = { persist: 0, restore: 0 };
  const privateState = {
    tableId: "t-showdown",
    handId: "h-showdown-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 40,
    sidePots: [],
    contributionsByUserId: { human_1: 20, bot_2: 20 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }, { r: "8", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 4,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 5 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-public-state-fixture.mjs", import.meta.url).href;

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {},
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });
  const result = await run({ tableId: "t-showdown", trigger: "act", requestId: "r-showdown" });
  assert.equal(result.ok, true);
  assert.equal(calls.persist, 1);
  assert.equal(calls.restore, 0);
  assert.equal(logs.some((entry) => entry.event === "ws_bot_autoplay_showdown_input_missing"), false);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "fallback_private_same_hand");
});

test("accepted bot autoplay rejects fallback when primary showdown hand identity is missing", async () => {
  const logs = [];
  const calls = { persist: 0, restore: 0, resync: 0 };
  const privateState = {
    tableId: "t-missing-handid",
    handId: "h-missing-handid-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 40,
    sidePots: [],
    contributionsByUserId: { human_1: 20, bot_2: 20 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }, { r: "8", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 19,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 20 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-public-state-missing-handid-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-missing-handid", trigger: "act", requestId: "r-missing-handid" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "showdown_missing_private_inputs");
  assert.equal(calls.persist, 0);
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 1);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "fallback_private_primary_identity_unknown_rejected");
});

test("accepted bot autoplay preserves fresh showdown gameplay fields when fallback is stale", async () => {
  const logs = [];
  const calls = { persist: 0, restore: 0, resync: 0 };
  const stalePersisted = {
    tableId: "t-stale-overlay",
    handId: "h-stale-overlay-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 40,
    sidePots: [],
    contributionsByUserId: { human_1: 20, bot_2: 20 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }, { r: "8", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...stalePersisted }),
    persistedStateVersion: () => 21,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 22 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-stale-fallback-overlay-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-stale-overlay", trigger: "act", requestId: "r-stale-overlay" });
  assert.equal(result.ok, true);
  assert.equal(calls.persist, 1);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "fallback_private_same_hand");
  const overlayLog = logs.find((entry) => entry.event === "ws_bot_autoplay_fixture_overlay_materialized");
  assert.ok(overlayLog);
  assert.equal(overlayLog.payload.bot2Contribution, 45);
  assert.equal(overlayLog.payload.humanContribution, 20);
});

test("accepted bot autoplay reloads trusted private showdown hole cards after boundary", async () => {
  const logs = [];
  const calls = { persist: 0, restore: 0 };
  const privateState = {
    tableId: "t-reload",
    handId: "h-reload-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 50,
    sidePots: [],
    contributionsByUserId: { human_1: 25, bot_2: 25 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }, { r: "8", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 7,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 8 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-reload-private-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {},
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-reload", trigger: "act", requestId: "r-reload" });
  assert.equal(result.ok, true);
  assert.equal(calls.persist, 1);
  assert.equal(calls.restore, 0);
  assert.equal(logs.some((entry) => entry.event === "ws_bot_autoplay_showdown_input_missing"), false);
});

test("accepted bot autoplay merges partial loop-private showdown cards with persisted trusted cards", async () => {
  const logs = [];
  const calls = { persist: 0, restore: 0, resync: 0 };
  const privateState = {
    tableId: "t-partial-merge",
    handId: "h-partial-merge-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 45,
    sidePots: [],
    contributionsByUserId: { human_1: 22, bot_2: 23 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }, { r: "8", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 9,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 10 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-partial-loop-private-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-partial-merge", trigger: "act", requestId: "r-partial-merge" });
  assert.equal(result.ok, true);
  assert.equal(calls.persist, 1);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  assert.equal(logs.some((entry) => entry.event === "ws_bot_autoplay_showdown_input_missing"), false);
});

test("accepted bot autoplay ignores malformed fallback showdown hole-card arrays", async () => {
  const logs = [];
  const calls = { restore: 0, resync: 0 };
  const privateState = {
    tableId: "t-fallback-invalid",
    handId: "h-fallback-invalid-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 35,
    sidePots: [],
    contributionsByUserId: { human_1: 17, bot_2: 18 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 10,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 11 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-reload-private-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-fallback-invalid", trigger: "act", requestId: "r-fallback-invalid" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "showdown_missing_private_inputs");
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 1);
  const focusedLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_input_missing");
  assert.ok(focusedLog);
  assert.deepEqual(focusedLog.payload.missingHoleCardsUserIds, ["human_1"]);
});

test("accepted bot autoplay emits focused showdown-input log and restores on missing trusted hole cards", async () => {
  const logs = [];
  const calls = { restore: 0, resync: 0 };
  const privateState = {
    tableId: "t-missing",
    handId: "h-missing-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 30,
    sidePots: [],
    contributionsByUserId: { human_1: 15, bot_2: 15 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 11,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 12 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-public-state-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-missing", trigger: "act", requestId: "r-missing" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "showdown_missing_private_inputs");
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 1);
  const focusedLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_input_missing");
  assert.ok(focusedLog);
  assert.deepEqual(focusedLog.payload.missingHoleCardsUserIds, ["human_1"]);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.deepEqual(preflightLog.payload.eligibleUserIds, ["human_1", "bot_2"]);
  assert.deepEqual(preflightLog.payload.showdownComparedUserIds, ["bot_2"]);
  assert.equal(preflightLog.payload.communityLen, 5);
});

test("accepted bot autoplay rejects cross-hand fallback for degraded showdown runtime state", async () => {
  const logs = [];
  const calls = { restore: 0, resync: 0 };
  const privateState = {
    tableId: "t-mismatch",
    handId: "h-current-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 30,
    sidePots: [],
    contributionsByUserId: { human_1: 15, bot_2: 15 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }, { r: "8", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState, handId: "h-fallback-other-hand" }),
    persistedStateVersion: () => 15,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 16 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-public-state-mismatch-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-mismatch", trigger: "act", requestId: "r-mismatch" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "showdown_missing_private_inputs");
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 1);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "fallback_private_hand_mismatch_rejected");
});

test("accepted bot autoplay prefers trusted runtime private showdown source when available", async () => {
  const logs = [];
  const privateState = {
    tableId: "t-runtime-source",
    handId: "h-runtime-source-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: false, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 40,
    sidePots: [],
    contributionsByUserId: { human_1: 20, bot_2: 20 },
    holeCardsByUserId: {
      human_1: [{ r: "9", s: "S" }, { r: "8", s: "S" }],
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 17,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 18 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-showdown-runtime-private-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-runtime-source", trigger: "act", requestId: "r-runtime-source" });
  assert.equal(result.ok, true);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "runtime_private");
});

test("accepted bot autoplay resolves single-winner terminal hands without showdown-only input validation", async () => {
  const logs = [];
  const calls = { persist: 0, restore: 0, resync: 0 };
  const privateState = {
    tableId: "t-single",
    handId: "h-single-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: { human_1: true, bot_2: false },
    sitOutByUserId: {},
    leftTableByUserId: {},
    pot: 20,
    sidePots: [],
    contributionsByUserId: { human_1: 10, bot_2: 10 },
    holeCardsByUserId: {
      bot_2: [{ r: "A", s: "H" }, { r: "A", s: "D" }]
    }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...privateState }),
    persistedStateVersion: () => 13,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 14 })
  };
  const moduleUrl = new URL("./fixtures/autoplay-single-winner-terminal-fixture.mjs", import.meta.url).href;
  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    env: { WS_BOT_AUTOPLAY_MODULE_PATH: moduleUrl },
    klog: (event, payload) => logs.push({ event, payload })
  });

  const result = await run({ tableId: "t-single", trigger: "act", requestId: "r-single" });
  assert.equal(result.ok, true);
  assert.equal(calls.persist, 1);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  assert.equal(logs.some((entry) => entry.event === "ws_bot_autoplay_showdown_input_missing"), false);
});

test("accepted bot autoplay handles mixed human+bot runtime path through showdown and next hand", async () => {
  const seats = [
    { userId: "bot_2", seatNo: 1, isBot: true },
    { userId: "human_1", seatNo: 2, isBot: false }
  ];
  const stacks = { human_1: 100, bot_2: 100 };
  let persistedState = initHandState({ tableId: "t-mixed-runtime", seats, stacks }).state;
  persistedState = { ...persistedState, handId: "h-mixed-runtime-1" };
  let persistedVersion = 40;
  const calls = { persist: 0, restore: 0, resync: 0 };

  const logs = [];
  const seatOrder = seats.slice().sort((a, b) => a.seatNo - b.seatNo).map((seat) => seat.userId);
  const maybeMaterialize = (privateState) => {
    const eligible = seatOrder.filter((userId) => !privateState.foldedByUserId?.[userId] && !privateState.leftTableByUserId?.[userId] && !privateState.sitOutByUserId?.[userId]);
    const handId = typeof privateState.handId === "string" ? privateState.handId : "";
    const showdownHandId = typeof privateState.showdown?.handId === "string" ? privateState.showdown.handId : "";
    const alreadyMaterialized = !!handId && !!showdownHandId && handId === showdownHandId;
    if (alreadyMaterialized || (eligible.length > 1 && privateState.phase !== "SHOWDOWN")) return privateState;
    return materializeShowdownAndPayout({
      state: privateState,
      seatUserIdsInOrder: seatOrder,
      holeCardsByUserId: privateState.holeCardsByUserId,
      computeShowdown,
      awardPotsAtShowdown,
      klog: () => {}
    }).nextState;
  };

  const tableManager = {
    persistedPokerState: () => persistedState,
    persistedStateVersion: () => persistedVersion,
    tableSnapshot: () => ({ seats }),
    applyAction: ({ userId, action, amount }) => {
      const applied = applyRuntimeAction(persistedState, { type: action, userId, amount });
      const advanced = runAdvanceLoop(applied.state, [], [], advanceIfNeeded);
      persistedState = maybeMaterialize(advanced.nextState);
      persistedVersion += 1;
      return { accepted: true, changed: true, replayed: false, stateVersion: persistedVersion };
    }
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    klog: (event, payload) => logs.push({ event, payload })
  });
  let guard = 0;
  while (persistedState.phase !== "SETTLED" && guard < 40) {
    if (persistedState.phase === "PREFLOP" || persistedState.phase === "FLOP" || persistedState.phase === "TURN" || persistedState.phase === "RIVER") {
      if (persistedState.turnUserId === "human_1") {
        tableManager.applyAction({ userId: "human_1", action: "CHECK" });
      } else {
        const result = await run({ tableId: "t-mixed-runtime", trigger: "act", requestId: "r-mixed-runtime-" + guard });
        assert.equal(result.ok, true);
      }
    } else {
      persistedState = advanceIfNeeded(persistedState).state;
      persistedVersion += 1;
    }
    guard += 1;
  }

  assert.equal(persistedState.phase, "SETTLED");
  assert.ok(persistedState.showdown);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  assert.equal(logs.some((entry) => entry.event === "ws_bot_autoplay_showdown_preflight"), true);

  persistedState = advanceIfNeeded(persistedState).state;
  persistedVersion += 1;
  for (let i = 0; i < 6 && !["PREFLOP", "FLOP", "TURN", "RIVER"].includes(persistedState.phase); i += 1) {
    persistedState = advanceIfNeeded(persistedState).state;
    persistedVersion += 1;
  }

  const nextHandResult = await run({ tableId: "t-mixed-runtime", trigger: "act", requestId: "r-mixed-runtime-next" });
  assert.equal(nextHandResult.ok, true);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
});

test("accepted bot autoplay settles showdown and allows next hand to continue", async () => {
  const seats = [{ userId: "bot_1", seatNo: 1, isBot: true }, { userId: "bot_2", seatNo: 2, isBot: true }];
  const stacks = { bot_1: 100, bot_2: 100 };
  let state = initHandState({ tableId: "t-next-hand", seats, stacks }).state;

  while (state.phase !== "RIVER") {
    if (state.phase === "HAND_DONE" || state.phase === "SHOWDOWN" || state.phase === "SETTLED") {
      break;
    }
    const acted = applyRuntimeAction(state, { type: "CHECK", userId: state.turnUserId });
    const advanced = runAdvanceLoop(acted.state, [], [], advanceIfNeeded);
    state = advanced.nextState;
  }

  if (state.phase !== "RIVER") {
    throw new Error(`expected_river_phase:${state.phase}`);
  }

  let persistedState = { ...state, handId: "h-next-1", turnUserId: "bot_1" };
  let persistedVersion = 20;
  const calls = { persist: 0, restore: 0, resync: 0 };

  const seatOrder = seats.slice().sort((a, b) => a.seatNo - b.seatNo).map((seat) => seat.userId);
  const maybeMaterialize = (privateState) => {
    const eligible = seatOrder.filter((userId) => !privateState.foldedByUserId?.[userId] && !privateState.leftTableByUserId?.[userId] && !privateState.sitOutByUserId?.[userId]);
    const handId = typeof privateState.handId === "string" ? privateState.handId : "";
    const showdownHandId = typeof privateState.showdown?.handId === "string" ? privateState.showdown.handId : "";
    const alreadyMaterialized = !!handId && !!showdownHandId && handId === showdownHandId;
    if (alreadyMaterialized || (eligible.length > 1 && privateState.phase !== "SHOWDOWN")) return privateState;
    return materializeShowdownAndPayout({
      state: privateState,
      seatUserIdsInOrder: seatOrder,
      holeCardsByUserId: privateState.holeCardsByUserId,
      computeShowdown,
      awardPotsAtShowdown,
      klog: () => {}
    }).nextState;
  };

  const tableManager = {
    persistedPokerState: () => persistedState,
    persistedStateVersion: () => persistedVersion,
    tableSnapshot: () => ({ seats }),
    applyAction: ({ userId, action, amount }) => {
      const applied = applyRuntimeAction(persistedState, { type: action, userId, amount });
      const advanced = runAdvanceLoop(applied.state, [], [], advanceIfNeeded);
      persistedState = maybeMaterialize(advanced.nextState);
      persistedVersion += 1;
      return { accepted: true, changed: true, replayed: false, stateVersion: persistedVersion };
    }
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    persistMutatedState: async () => {
      calls.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => {
      calls.restore += 1;
      return { ok: true };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    klog: () => {}
  });

  const showdownRun = await run({ tableId: "t-next-hand", trigger: "act", requestId: "r-next-hand-1" });
  assert.equal(showdownRun.ok, true);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  assert.equal(persistedState.phase, "SETTLED");
  assert.ok(persistedState.showdown);

  persistedState = advanceIfNeeded(persistedState).state;
  persistedVersion += 1;
  for (let i = 0; i < 6 && !["PREFLOP", "FLOP", "TURN", "RIVER"].includes(persistedState.phase); i += 1) {
    persistedState = advanceIfNeeded(persistedState).state;
    persistedVersion += 1;
  }

  const nextHandRun = await run({ tableId: "t-next-hand", trigger: "act", requestId: "r-next-hand-2" });
  assert.equal(nextHandRun.ok, true);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  assert.equal(nextHandRun.reason === "turn_not_bot" || nextHandRun.actionCount > 0 || nextHandRun.reason === "not_action_phase", true);
});
