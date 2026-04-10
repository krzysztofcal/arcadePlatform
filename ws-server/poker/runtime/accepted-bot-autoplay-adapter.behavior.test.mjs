import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAcceptedBotAutoplayExecutor as createAcceptedBotAutoplayExecutorBase } from "./accepted-bot-autoplay-adapter.mjs";
import { initHandState, applyAction as applyRuntimeAction, advanceIfNeeded } from "../snapshot-runtime/poker-reducer.mjs";
import { buildBootstrappedPokerState, applyCoreStateAction } from "../engine/poker-engine.mjs";
import { computeSharedLegalActions } from "../shared/poker-primitives.mjs";
import { runAdvanceLoop } from "../../shared/poker-domain/poker-autoplay.mjs";
import { materializeShowdownAndPayout } from "../snapshot-runtime/poker-materialize-showdown.mjs";
import { computeShowdown } from "../snapshot-runtime/poker-showdown.mjs";
import { awardPotsAtShowdown } from "../snapshot-runtime/poker-payout.mjs";

function createAcceptedBotAutoplayExecutor(options = {}) {
  const mergedEnv = {
    WS_BOT_REACTION_MIN_MS: "0",
    WS_BOT_REACTION_MAX_MS: "0",
    ...(options.env || {})
  };
  return createAcceptedBotAutoplayExecutorBase({
    sleep: async () => {},
    random: () => 0,
    ...options,
    env: mergedEnv
  });
}

test("autoplay adapter resolves shared autoplay from neutral shared module path", () => {
  const source = fs.readFileSync(new URL("./accepted-bot-autoplay-adapter.mjs", import.meta.url), "utf8");
  assert.match(source, /\.\.\/\.\.\/shared\/poker-domain\/poker-autoplay\.mjs/);
  assert.doesNotMatch(source, /netlify\/functions\/_shared/);

  const sharedSource = fs.readFileSync(new URL("../../shared/poker-domain/poker-autoplay.mjs", import.meta.url), "utf8");
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

test("accepted bot autoplay waits a human-like reaction delay before acting", async () => {
  const observed = { sleepMs: [], persist: 0 };
  const nowMs = Date.now();
  const state = {
    version: 2,
    tableId: "t1",
    handId: "h1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    turnDeadlineAt: nowMs + 20_000,
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
    env: { WS_BOT_REACTION_MIN_MS: "2000", WS_BOT_REACTION_MAX_MS: "4000" },
    now: () => nowMs,
    random: () => 0.5,
    sleep: async (ms) => {
      observed.sleepMs.push(ms);
    },
    persistMutatedState: async () => {
      observed.persist += 1;
      return { ok: true };
    },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r-delay" });
  assert.equal(result.ok, true);
  assert.deepEqual(observed.sleepMs, [3000]);
  assert.equal(observed.persist, 1);
});

test("accepted bot autoplay clamps reaction delay to the remaining turn window", async () => {
  const observed = [];
  const nowMs = Date.now();
  const state = {
    version: 2,
    tableId: "t1",
    handId: "h1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    turnDeadlineAt: nowMs + 900,
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
    env: { WS_BOT_REACTION_MIN_MS: "2000", WS_BOT_REACTION_MAX_MS: "4000" },
    now: () => nowMs,
    random: () => 0.99,
    sleep: async (ms) => {
      observed.push(ms);
    },
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r-delay-clamp" });
  assert.equal(result.ok, true);
  assert.deepEqual(observed, [750]);
});

test("accepted bot autoplay aborts cleanly when turn changes during reaction delay", async () => {
  const nowMs = Date.now();
  let currentState = {
    version: 2,
    tableId: "t1",
    handId: "h1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    turnDeadlineAt: nowMs + 20_000,
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    stacks: { human_1: 100, bot_2: 100 }
  };
  const tableManager = {
    persistedPokerState: () => ({ ...currentState }),
    persistedStateVersion: () => 2,
    tableSnapshot: (_tableId, turnUserId) => ({
      seats: [
        { userId: "human_1", seatNo: 1, isBot: false },
        { userId: "bot_2", seatNo: 2, isBot: turnUserId === "bot_2" }
      ]
    }),
    applyAction: () => {
      throw new Error("unexpected_apply");
    }
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    env: { WS_BOT_REACTION_MIN_MS: "2000", WS_BOT_REACTION_MAX_MS: "2000" },
    now: () => nowMs,
    sleep: async () => {
      currentState = {
        ...currentState,
        turnUserId: "human_1"
      };
    },
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r-delay-turn-change" });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "turn_changed_during_delay");
});

test("accepted bot autoplay waits before each bot action in bots-only hands", async () => {
  const seats = [{ userId: "bot_1", seatNo: 1, isBot: true }, { userId: "bot_2", seatNo: 2, isBot: true }];
  const stacks = { bot_1: 100, bot_2: 100 };
  let persistedState = { ...initHandState({ tableId: "t-delay-bots-only", seats, stacks }).state, handId: "h-delay-bots-only-1" };
  let persistedVersion = 20;
  const observedSleepMs = [];
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
    env: { WS_BOT_REACTION_MIN_MS: "2000", WS_BOT_REACTION_MAX_MS: "2000" },
    sleep: async (ms) => {
      observedSleepMs.push(ms);
    },
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t-delay-bots-only", trigger: "act", requestId: "r-delay-bots-only" });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "non_action_phase");
  assert.equal(persistedState.phase, "SETTLED");
  assert.ok(result.actionCount > 1);
  assert.equal(result.actionCount, observedSleepMs.length);
  assert.deepEqual(observedSleepMs, Array(result.actionCount).fill(2000));
});

test("accepted bot autoplay aborts during a later delayed bot step when turn stops being authoritative bot turn", async () => {
  const seats = [{ userId: "bot_1", seatNo: 1, isBot: true }, { userId: "bot_2", seatNo: 2, isBot: true }];
  const stacks = { bot_1: 100, bot_2: 100 };
  let persistedState = initHandState({ tableId: "t-delay-bots-race", seats, stacks }).state;
  let persistedVersion = 30;
  let sleepCallCount = 0;
  let authoritativeBotTurnLost = false;
  const tableManager = {
    persistedPokerState: () => persistedState,
    persistedStateVersion: () => persistedVersion,
    tableSnapshot: (_tableId, turnUserId) => ({
      seats: seats.map((seat) => ({
        ...seat,
        isBot: authoritativeBotTurnLost && seat.userId === turnUserId ? false : true
      }))
    }),
    applyAction: ({ userId, action, amount }) => {
      const applied = applyRuntimeAction(persistedState, { type: action, userId, amount });
      const advanced = runAdvanceLoop(applied.state, [], [], advanceIfNeeded);
      persistedState = advanced.nextState;
      persistedVersion += 1;
      return { accepted: true, changed: true, replayed: false, stateVersion: persistedVersion };
    }
  };

  const run = createAcceptedBotAutoplayExecutor({
    tableManager,
    env: { WS_BOT_REACTION_MIN_MS: "2000", WS_BOT_REACTION_MAX_MS: "2000" },
    sleep: async () => {
      sleepCallCount += 1;
      if (sleepCallCount === 2) {
        authoritativeBotTurnLost = true;
      }
    },
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    klog: () => {}
  });

  const result = await run({ tableId: "t-delay-bots-race", trigger: "act", requestId: "r-delay-bots-race" });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.actionCount, 1);
  assert.equal(result.reason, "turn_changed_during_delay");
  assert.equal(sleepCallCount, 2);
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

test("accepted bot autoplay restores locally on persistence conflict without forced resync", async () => {
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
  assert.equal(calls.resync, 0);
});

test("accepted bot autoplay emits resync only when restore fails after persistence conflict", async () => {
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
      return { ok: false, reason: "restore_failed" };
    },
    broadcastResyncRequired: () => {
      calls.resync += 1;
    },
    klog: () => {}
  });

  const result = await run({ tableId: "t1", trigger: "act", requestId: "r3b" });
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

test("accepted bot autoplay accepts fallback supplement when primary showdown hand identity is missing", async () => {
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
  assert.equal(result.ok, true);
  assert.equal(calls.persist, 1);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "fallback_private_primary_identity_unknown");
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
  assert.equal(calls.resync, 0);
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
  assert.equal(calls.resync, 0);
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
  assert.equal(calls.resync, 0);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "fallback_private_hand_mismatch_rejected");
});

test("accepted bot autoplay does not treat untrusted fallback handId drift as trusted mismatch", async () => {
  const logs = [];
  const calls = { restore: 0, resync: 0 };
  const privateState = {
    tableId: "t-untrusted-fallback-mismatch",
    handId: "h-current-1",
    phase: "PREFLOP",
    turnUserId: "bot_2",
    seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }],
    community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }, { r: "2", s: "D" }],
    stacks: { human_1: 100, bot_2: 100 },
    foldedByUserId: [],
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
    persistedStateVersion: () => 25,
    tableSnapshot: () => ({ seats: [{ userId: "human_1", seatNo: 1 }, { userId: "bot_2", seatNo: 2, isBot: true }] }),
    applyAction: () => ({ accepted: true, changed: true, replayed: false, stateVersion: 26 })
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

  const result = await run({ tableId: "t-untrusted-fallback-mismatch", trigger: "act", requestId: "r-untrusted-fallback-mismatch" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "showdown_missing_private_inputs");
  assert.equal(calls.restore, 1);
  assert.equal(calls.resync, 0);
  const preflightLog = logs.find((entry) => entry.event === "ws_bot_autoplay_showdown_preflight");
  assert.ok(preflightLog);
  assert.equal(preflightLog.payload.trustedStateSource, "fallback_private_untrusted_rejected");
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

test("accepted bot autoplay handles engine poker state through river showdown without resync", async () => {
  const tableId = "t-engine-runtime";
  let coreState = {
    roomId: tableId,
    version: 14,
    maxSeats: 6,
    members: [
      { userId: "bot_1", seat: 1 },
      { userId: "bot_2", seat: 2 }
    ],
    seats: {
      bot_1: 1,
      bot_2: 2
    },
    seatDetailsByUserId: {
      bot_1: { isBot: true, botProfile: null, leaveAfterHand: false },
      bot_2: { isBot: true, botProfile: null, leaveAfterHand: false }
    },
    publicStacks: {
      bot_1: 100,
      bot_2: 100
    },
    pokerState: null
  };
  coreState = {
    ...coreState,
    pokerState: buildBootstrappedPokerState({
      tableId,
      coreState,
      startingStacks: { bot_1: 100, bot_2: 100 },
      handVersion: coreState.version
    })
  };

  let prepGuard = 0;
  while (coreState.pokerState?.phase !== "RIVER" && prepGuard < 30) {
    const liveState = coreState.pokerState;
    const legal = computeSharedLegalActions({ statePublic: liveState, userId: liveState.turnUserId });
    const action = legal.actions.includes("CHECK")
      ? "CHECK"
      : legal.actions.includes("CALL")
        ? "CALL"
        : "FOLD";
    const applied = applyCoreStateAction({
      tableId,
      coreState,
      handId: liveState.handId,
      userId: liveState.turnUserId,
      requestId: `engine-prep-${prepGuard}`,
      action,
      amount: null,
      nowIso: new Date().toISOString(),
      nowMs: Date.now()
    });
    assert.equal(applied.accepted, true);
    coreState = applied.coreState;
    prepGuard += 1;
  }

  assert.equal(coreState.pokerState?.phase, "RIVER");
  const previousHandId = coreState.pokerState.handId;
  const previousVersion = coreState.version;
  const calls = { persist: 0, restore: 0, resync: 0 };

  const tableManager = {
    persistedPokerState: () => ({ ...coreState.pokerState }),
    persistedStateVersion: () => coreState.version,
    tableSnapshot: () => ({
      seats: (coreState.pokerState?.seats || []).map((seat) => ({ ...seat, isBot: true }))
    }),
    applyAction: ({ handId, userId, requestId, action, amount, nowIso }) => {
      const applied = applyCoreStateAction({
        tableId,
        coreState,
        handId,
        userId,
        requestId,
        action,
        amount,
        nowIso,
        nowMs: Date.now()
      });
      if (applied.accepted && applied.changed) {
        coreState = applied.coreState;
      }
      return {
        accepted: applied.accepted,
        changed: applied.changed,
        replayed: false,
        stateVersion: applied.stateVersion,
        reason: applied.reason || null
      };
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

  const result = await run({ tableId, trigger: "act", requestId: "engine-runtime-river", frameTs: new Date().toISOString() });
  assert.equal(result.ok, true);
  assert.equal(calls.restore, 0);
  assert.equal(calls.resync, 0);
  assert.ok(calls.persist > 0);
  assert.ok(coreState.version > previousVersion);
  assert.notEqual(coreState.pokerState?.handId, previousHandId);
  assert.equal(["PREFLOP", "FLOP", "TURN", "RIVER"].includes(coreState.pokerState?.phase), true);
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
