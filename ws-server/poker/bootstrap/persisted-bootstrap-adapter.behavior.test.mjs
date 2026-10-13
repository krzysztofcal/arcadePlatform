import test from "node:test";
import assert from "node:assert/strict";
import { adaptPersistedBootstrap } from "./persisted-bootstrap-adapter.mjs";
import { dealHoleCards, deriveDeck, toCardCodes } from "../shared/poker-primitives.mjs";
import { applyAction } from "../shared/poker-action-reducer.mjs";
import { createTableManager } from "../table/table-manager.mjs";

test("adapter maps persisted rows into deterministic ws table/core state", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_1",
    tableRow: { id: "table_1", max_players: 6 },
    seatRows: [
      { user_id: "user_b", seat_no: 4, status: "ACTIVE", is_bot: false, stack: 80 },
      { user_id: "user_a", seat_no: 2, status: "ACTIVE", is_bot: false, stack: 120 },
      { user_id: "user_x", seat_no: 3, status: "LEFT", is_bot: false }
    ],
    stateRow: { version: 12, state: { phase: "PREFLOP", handId: "h1", stacks: { user_a: 120, user_b: 80 } } }
  });

  assert.equal(result.ok, true);
  assert.equal(result.table.coreState.version, 12);
  assert.deepEqual(result.table.coreState.members, [
    { userId: "user_a", seat: 2 },
    { userId: "user_b", seat: 4 }
  ]);
  assert.deepEqual(result.table.coreState.seats, { user_a: 2, user_b: 4 });
  assert.deepEqual(result.table.coreState.publicStacks, { user_a: 120, user_b: 80 });
});

test("adapter rejects malformed persisted state", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_2",
    tableRow: { id: "table_2", max_players: 6 },
    seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
    stateRow: { version: "bad", state: null }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
});

test("adapter accepts legacy stringified persisted poker state JSON", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_legacy",
    tableRow: { id: "table_legacy", max_players: 6 },
    seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
    stateRow: {
      version: 4,
      state: JSON.stringify({
        phase: "PREFLOP",
        stacks: { user_a: 100 },
        hand: { handId: "h_legacy", pots: JSON.stringify([{ amount: 120 }]) }
      })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.table.coreState.version, 4);
  assert.equal(result.table.coreState.pokerState.phase, "PREFLOP");
  assert.deepEqual(result.table.coreState.pokerState.hand, {
    handId: "h_legacy",
    pots: [{ amount: 120 }]
  });
});

test("adapter still rejects scalar string persisted poker state", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_scalar",
    tableRow: { id: "table_scalar", max_players: 6 },
    seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
    stateRow: { version: 2, state: "legacy-scalar" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
});

test("adapter still rejects malformed stringified persisted poker state", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_bad_json",
    tableRow: { id: "table_bad_json", max_players: 6 },
    seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
    stateRow: { version: 2, state: "{\"phase\":" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
});

test("adapter drops stale state seats that are no longer ACTIVE in persisted seat rows", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_stale_state_seats",
    tableRow: { id: "table_stale_state_seats", max_players: 6 },
    seatRows: [
      { user_id: "user_a", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 120 },
      { user_id: "user_b", seat_no: 2, status: "INACTIVE", is_bot: false, stack: 0 }
    ],
    stateRow: {
      version: 10,
      state: {
        phase: "HAND_DONE",
        stacks: { user_a: 120 },
        seats: [
          { userId: "user_a", seatNo: 1, status: "ACTIVE" },
          { userId: "user_b", seatNo: 2, status: "ACTIVE" }
        ]
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.members, [{ userId: "user_a", seat: 1 }]);
  assert.deepEqual(result.table.coreState.seats, { user_a: 1 });
  assert.deepEqual(result.table.coreState.pokerState.seats, [{ userId: "user_a", seatNo: 1, status: "ACTIVE" }]);
});

test("adapter rehydrates runtime hand data for retained live-hand leaver during persisted restore", () => {
  const handSeed = "seed_adapter_restore_turn";
  const seatOrder = ["user_a", "bot_1", "bot_2"];
  const dealt = dealHoleCards(deriveDeck(handSeed), seatOrder);
  const turnCommunity = toCardCodes(dealt.deck.slice(0, 4));
  const riverDeck = toCardCodes(dealt.deck.slice(4));

  const result = adaptPersistedBootstrap({
    tableId: "table_live_restore",
    tableRow: { id: "table_live_restore", max_players: 6, status: "OPEN" },
    seatRows: [
      { user_id: "user_a", seat_no: 1, status: "INACTIVE", is_bot: false, stack: 0 },
      { user_id: "bot_1", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 101 },
      { user_id: "bot_2", seat_no: 3, status: "ACTIVE", is_bot: true, stack: 99 }
    ],
    stateRow: {
      version: 18,
      state: {
        tableId: "table_live_restore",
        handId: "hand_live_restore",
        handSeed,
        phase: "TURN",
        community: turnCommunity,
        communityDealt: 4,
        leftTableByUserId: { user_a: true },
        turnUserId: "bot_2",
        seats: [
          { userId: "user_a", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_1", seatNo: 2, status: "ACTIVE", isBot: true },
          { userId: "bot_2", seatNo: 3, status: "ACTIVE", isBot: true }
        ],
        stacks: { bot_1: 101, bot_2: 99 }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.members, [
    { userId: "bot_1", seat: 2 },
    { userId: "bot_2", seat: 3 }
  ]);
  assert.deepEqual(result.table.coreState.pokerState.seats, [
    { userId: "user_a", seatNo: 1, status: "ACTIVE" },
    { userId: "bot_1", seatNo: 2, status: "ACTIVE", isBot: true },
    { userId: "bot_2", seatNo: 3, status: "ACTIVE", isBot: true }
  ]);
  assert.deepEqual(result.table.coreState.pokerState.community, turnCommunity);
  assert.deepEqual(result.table.coreState.pokerState.deck, riverDeck);
  assert.deepEqual(result.table.coreState.pokerState.holeCardsByUserId.user_a, toCardCodes(dealt.holeCardsByUserId.user_a));
  assert.deepEqual(result.table.coreState.pokerState.holeCardsByUserId.bot_1, toCardCodes(dealt.holeCardsByUserId.bot_1));
  assert.deepEqual(result.table.coreState.pokerState.holeCardsByUserId.bot_2, toCardCodes(dealt.holeCardsByUserId.bot_2));
});

test("adapter rejects a legacy live all-in hand that cannot reconstruct the showdown board", () => {
  const tableId = "table_legacy_all_in_without_seed";
  const persistedState = {
    tableId,
    handId: "hand_legacy_all_in_without_seed",
    phase: "PREFLOP",
    community: [],
    communityDealt: 0,
    turnUserId: "bot_call",
    seats: [
      { userId: "human", seatNo: 1, status: "ACTIVE" },
      { userId: "bot_fold", seatNo: 2, status: "ACTIVE", isBot: true },
      { userId: "bot_call", seatNo: 3, status: "ACTIVE", isBot: true }
    ],
    handSeats: [
      { userId: "human", seatNo: 1, status: "ACTIVE" },
      { userId: "bot_fold", seatNo: 2, status: "ACTIVE", isBot: true },
      { userId: "bot_call", seatNo: 3, status: "ACTIVE", isBot: true }
    ],
    currentBet: 488,
    lastRaiseSize: 486,
    potTotal: 491,
    stacks: { human: 0, bot_fold: 13, bot_call: 96 },
    toCallByUserId: { human: 0, bot_fold: 487, bot_call: 486 },
    betThisRoundByUserId: { human: 488, bot_fold: 1, bot_call: 2 },
    actedThisRoundByUserId: { human: true, bot_fold: true, bot_call: false },
    foldedByUserId: { human: false, bot_fold: true, bot_call: false },
    contributionsByUserId: { human: 488, bot_fold: 1, bot_call: 2 }
  };
  const before = structuredClone(persistedState);

  assert.throws(
    () => applyAction({ pokerState: persistedState, userId: "bot_call", action: "CALL", amount: 0 }),
    { message: "showdown_incomplete_community" }
  );
  assert.deepEqual(persistedState, before);

  const result = adaptPersistedBootstrap({
    tableId,
    tableRow: { id: tableId, max_players: 6, status: "OPEN" },
    seatRows: [
      { user_id: "human", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 0 },
      { user_id: "bot_fold", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 13 },
      { user_id: "bot_call", seat_no: 3, status: "ACTIVE", is_bot: true, stack: 96 }
    ],
    stateRow: { version: 332, state: persistedState }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
  assert.equal(result.reason, "live_hand_runtime_unrecoverable");
  assert.deepEqual(persistedState, before);
});

test("adapter rejects an unrecoverable all-in hand with invalid or duplicate private runtime cards", () => {
  const tableId = "table_invalid_private_runtime_cards";
  const persistedState = {
    tableId,
    handId: "hand_invalid_private_runtime_cards",
    phase: "TURN",
    community: ["AS", "KD", "QC", "JH"],
    communityDealt: 4,
    deck: ["AS"],
    holeCardsByUserId: {
      human: ["2C", "2D"],
      bot_call: ["not-a-card", "3D"]
    },
    turnUserId: "bot_call",
    seats: [
      { userId: "human", seatNo: 1, status: "ACTIVE" },
      { userId: "bot_call", seatNo: 2, status: "ACTIVE", isBot: true }
    ],
    handSeats: [
      { userId: "human", seatNo: 1, status: "ACTIVE" },
      { userId: "bot_call", seatNo: 2, status: "ACTIVE", isBot: true }
    ],
    currentBet: 100,
    potTotal: 200,
    stacks: { human: 0, bot_call: 50 },
    toCallByUserId: { human: 0, bot_call: 50 },
    foldedByUserId: { human: false, bot_call: false }
  };

  const result = adaptPersistedBootstrap({
    tableId,
    tableRow: { id: tableId, max_players: 6, status: "OPEN" },
    seatRows: [
      { user_id: "human", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 0 },
      { user_id: "bot_call", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 50 }
    ],
    stateRow: { version: 333, state: persistedState }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
  assert.equal(result.reason, "live_hand_runtime_unrecoverable");
});

test("adapter preserves persisted live-hand identity when seat rows still reference a prior bot", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_replacement_bot_restore",
    tableRow: { id: "table_replacement_bot_restore", max_players: 6, status: "OPEN" },
    seatRows: [
      { user_id: "user_a", seat_no: 1, status: "INACTIVE", is_bot: false, stack: 0 },
      { user_id: "bot_old_2", seat_no: 2, status: "ACTIVE", is_bot: true, bot_profile: "TRIVIAL", stack: 1 },
      { user_id: "bot_keep_3", seat_no: 3, status: "ACTIVE", is_bot: true, bot_profile: "TRIVIAL", stack: 87 }
    ],
    stateRow: {
      version: 22,
      state: {
        tableId: "table_replacement_bot_restore",
        handId: "hand_replacement_bot_restore",
        handSeed: "seed_replacement_bot_restore",
        phase: "TURN",
        community: ["2c", "3d", "4h", "5s"],
        communityDealt: 4,
        turnUserId: "bot_auto_2_38",
        leftTableByUserId: { user_a: true },
        seats: [
          { userId: "user_a", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_auto_2_38", seatNo: 2, status: "ACTIVE" },
          { userId: "bot_keep_3", seatNo: 3, status: "ACTIVE", isBot: true }
        ],
        stacks: {
          bot_auto_2_38: 100,
          bot_keep_3: 87
        }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.members, [
    { userId: "bot_auto_2_38", seat: 2 },
    { userId: "bot_keep_3", seat: 3 }
  ]);
  assert.deepEqual(result.table.coreState.seats, {
    bot_auto_2_38: 2,
    bot_keep_3: 3
  });
  assert.deepEqual(result.table.coreState.publicStacks, {
    bot_auto_2_38: 100,
    bot_keep_3: 87
  });
  assert.deepEqual(result.table.coreState.pokerState.stacks, {
    bot_auto_2_38: 100,
    bot_keep_3: 87
  });
  assert.equal(result.table.coreState.seatDetailsByUserId.bot_auto_2_38?.isBot, true);
  assert.equal(result.table.coreState.seatDetailsByUserId.bot_auto_2_38?.botProfile, "TRIVIAL");
  assert.equal(result.table.coreState.pokerState.turnUserId, "bot_auto_2_38");
  assert.deepEqual(result.table.coreState.pokerState.seats, [
    { userId: "user_a", seatNo: 1, status: "ACTIVE" },
    { userId: "bot_auto_2_38", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
    { userId: "bot_keep_3", seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
  ]);
  assert.equal(result.table.presenceByUserId.has("bot_auto_2_38"), true);
  assert.equal(result.table.presenceByUserId.has("bot_old_2"), false);
});

test("adapter restores settled replacement identity from the current persisted seat row", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_replacement_bot_restore_settled",
    tableRow: {
      id: "table_replacement_bot_restore_settled",
      max_players: 6,
      status: "OPEN",
      buy_in: 500,
      lifecycle_kind: "CONTINUOUS_BOT",
      managed_profile_key: "CONTINUOUS_BOT_DEFAULT"
    },
    seatRows: [
      { user_id: "bot_current_2", seat_no: 2, status: "ACTIVE", is_bot: true, bot_profile: "TRIVIAL", stack: 500 },
      { user_id: "bot_keep_3", seat_no: 3, status: "ACTIVE", is_bot: true, bot_profile: "TRIVIAL", stack: 87 }
    ],
    stateRow: {
      version: 23,
      state: {
        tableId: "table_replacement_bot_restore_settled",
        handId: "hand_replacement_bot_restore_settled",
        phase: "SETTLED",
        dealerUserId: "bot_old_2",
        lastAggressorUserId: "bot_old_2",
        winnerUserId: "bot_old_2",
        seats: [
          { userId: "bot_old_2", seatNo: 2, status: "ACTIVE", isBot: true },
          { userId: "bot_keep_3", seatNo: 3, status: "ACTIVE", isBot: true }
        ],
        handSeats: [
          { userId: "bot_old_2", seatNo: 2, status: "ACTIVE", isBot: true },
          { userId: "bot_keep_3", seatNo: 3, status: "ACTIVE", isBot: true }
        ],
        stacks: { bot_old_2: 1, bot_keep_3: 87 },
        contributionsByUserId: { bot_old_2: 12, bot_keep_3: 12 },
        foldedByUserId: { bot_old_2: false, bot_keep_3: true },
        holeCardsByUserId: { bot_old_2: ["AS", "KD"], bot_keep_3: ["2C", "2D"] },
        privateCardsByUserId: { bot_old_2: ["AS", "KD"] }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.members, [
    { userId: "bot_current_2", seat: 2 },
    { userId: "bot_keep_3", seat: 3 }
  ]);
  assert.deepEqual(result.table.coreState.seats, {
    bot_current_2: 2,
    bot_keep_3: 3
  });
  assert.deepEqual(result.table.coreState.pokerState.stacks, {
    bot_current_2: 500,
    bot_keep_3: 87
  });
  assert.equal(result.table.coreState.pokerState.seats[0].userId, "bot_current_2");
  assert.equal(result.table.coreState.pokerState.stacks.bot_old_2, undefined);
  assert.deepEqual(result.table.coreState.pokerState.handSeats, [
    { userId: "bot_old_2", seatNo: 2, status: "ACTIVE", isBot: true },
    { userId: "bot_keep_3", seatNo: 3, status: "ACTIVE", isBot: true }
  ]);
  assert.deepEqual(result.table.coreState.pokerState.contributionsByUserId, {
    bot_old_2: 12,
    bot_keep_3: 12
  });
  assert.deepEqual(result.table.coreState.pokerState.holeCardsByUserId, {
    bot_old_2: ["AS", "KD"],
    bot_keep_3: ["2C", "2D"]
  });
  assert.equal(result.table.coreState.pokerState.dealerUserId, "bot_old_2");
  assert.equal(result.table.coreState.pokerState.lastAggressorUserId, "bot_old_2");
  assert.equal(result.table.coreState.pokerState.winnerUserId, "bot_old_2");
  assert.equal(result.table.presenceByUserId.has("bot_current_2"), true);
  assert.equal(result.table.presenceByUserId.has("bot_old_2"), false);

  const tableManager = createTableManager({
    maxSeats: 6,
    tableBootstrapLoader: async () => ({ ok: false })
  });
  assert.equal(tableManager.restoreTableFromPersisted(result.table.tableId, result.table).ok, true);
  const prepared = tableManager.prepareSettledHandRollover({
    tableId: result.table.tableId,
    nowMs: 1_000,
    allowManagedBotsOnly: true,
    managedBotProfile: { minBotCount: 2, targetBotCount: 3, maxBotCount: 3 }
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.changed, true);
  assert.deepEqual(prepared.nextCoreState.pokerState.handSeats.map((seat) => seat.userId).sort(), [
    "bot_current_2",
    "bot_keep_3"
  ]);
  assert.equal(prepared.nextCoreState.pokerState.stacks.bot_old_2, undefined);
});

test("adapter fails closed instead of remapping a settled human identity", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_settled_human_identity_conflict",
    tableRow: { id: "table_settled_human_identity_conflict", max_players: 6, status: "OPEN" },
    seatRows: [
      { user_id: "human_current", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 },
      { user_id: "bot_keep", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 100 }
    ],
    stateRow: {
      version: 24,
      state: {
        tableId: "table_settled_human_identity_conflict",
        phase: "SETTLED",
        seats: [
          { userId: "human_old", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_keep", seatNo: 2, status: "ACTIVE", isBot: true }
        ],
        stacks: { human_old: 100, bot_keep: 100 },
        winnerUserId: "human_old",
        holeCardsByUserId: { human_old: ["AS", "KD"] }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
  assert.equal(result.message, "persisted_seat_identity_conflict");
});

test("adapter keeps authoritative human stack while retaining bot seat projection", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_public_stack_restore",
    tableRow: { id: "table_public_stack_restore", max_players: 6, status: "OPEN" },
    seatRows: [
      { user_id: "user_a", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 150 },
      { user_id: "bot_2", seat_no: 2, status: "ACTIVE", is_bot: true, bot_profile: "TRIVIAL", stack: 100 }
    ],
    stateRow: {
      version: 11,
      state: {
        tableId: "table_public_stack_restore",
        phase: "PREFLOP",
        handId: "hand_public_stack_restore",
        turnUserId: "user_a",
        seats: [
          { userId: "user_a", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_2", seatNo: 2, status: "ACTIVE", isBot: true }
        ],
        stacks: {
          user_a: 149,
          bot_2: 98
        }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.publicStacks, {
    user_a: 149,
    bot_2: 100
  });
});

test("adapter restores an out-of-chips human at zero despite a stale positive seat projection", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_busted_restore",
    tableRow: { id: "table_busted_restore", max_players: 6, status: "OPEN" },
    seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }],
    stateRow: { version: 4, state: { phase: "PREFLOP", handId: "next_hand", handSeats: [], seats: [], stacks: { user_a: 0 } } }
  });
  assert.equal(result.ok, true);
  assert.equal(result.table.coreState.publicStacks.user_a, 0);
});

test("adapter fails closed when an active human has no authoritative state stack", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_ambiguous_restore",
    tableRow: { id: "table_ambiguous_restore", max_players: 6, status: "OPEN" },
    seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 }],
    stateRow: { version: 4, state: { phase: "PREFLOP", handId: "hand" } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_persisted_state");
  assert.equal(result.message, "human_stack_ambiguous");
});

test("adapter carries only the trusted managed lifecycle binding into runtime metadata", () => {
  const managed = adaptPersistedBootstrap({
    tableId: "table_managed_meta",
    tableRow: {
      id: "table_managed_meta",
      max_players: 6,
      status: "OPEN",
      stakes: { sb: 1, bb: 2 },
      lifecycle_kind: "CONTINUOUS_BOT",
      managed_profile_key: "CONTINUOUS_BOT_DEFAULT",
      rotation_due_at: "2026-07-29T12:00:00.000Z"
    },
    seatRows: [
      { user_id: "bot_a", seat_no: 1, status: "ACTIVE", is_bot: true, bot_profile: "NORMAL", stack: 100 },
      { user_id: "bot_b", seat_no: 2, status: "ACTIVE", is_bot: true, bot_profile: "NORMAL", stack: 100 }
    ],
    stateRow: {
      version: 0,
      state: { tableId: "table_managed_meta", phase: "INIT", seats: [
        { userId: "bot_a", seatNo: 1, isBot: true },
        { userId: "bot_b", seatNo: 2, isBot: true }
      ], stacks: { bot_a: 100, bot_b: 100 } }
    }
  });
  assert.equal(managed.ok, true);
  assert.equal(managed.table.tableMeta.lifecycleKind, "CONTINUOUS_BOT");
  assert.equal(managed.table.tableMeta.managedProfileKey, "CONTINUOUS_BOT_DEFAULT");
  assert.equal(managed.table.tableMeta.rotationDueAtMs, Date.parse("2026-07-29T12:00:00.000Z"));

  const untrusted = adaptPersistedBootstrap({
    tableId: "table_untrusted_meta",
    tableRow: {
      id: "table_untrusted_meta",
      max_players: 6,
      status: "OPEN",
      lifecycle_kind: "CONTINUOUS_BOT",
      managed_profile_key: "OTHER"
    },
    seatRows: [],
    stateRow: { version: 0, state: { tableId: "table_untrusted_meta", phase: "INIT", seats: [], stacks: {} } }
  });
  assert.equal(untrusted.ok, true);
  assert.equal(untrusted.table.tableMeta.lifecycleKind, "STANDARD");
  assert.equal(untrusted.table.tableMeta.managedProfileKey, null);
});

test("adapter carries is_single_player flag into runtime tableMeta on bootstrap/restart", () => {
  const bootstrapped = adaptPersistedBootstrap({
    tableId: "table_sp_bootstrap",
    tableRow: {
      id: "table_sp_bootstrap",
      max_players: 6,
      status: "OPEN",
      buy_in: 500,
      stakes: { sb: 5, bb: 10 },
      lifecycle_kind: "STANDARD",
      is_single_player: true
    },
    seatRows: [
      { user_id: "human_owner", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 500 },
      { user_id: "bot_1", seat_no: 2, status: "ACTIVE", is_bot: true, bot_profile: "NORMAL", stack: 500 }
    ],
    stateRow: {
      version: 1,
      state: {
        tableId: "table_sp_bootstrap",
        phase: "INIT",
        seats: [
          { userId: "human_owner", seatNo: 1, isBot: false },
          { userId: "bot_1", seatNo: 2, isBot: true }
        ],
        stacks: { human_owner: 500, bot_1: 500 }
      }
    }
  });

  assert.equal(bootstrapped.ok, true);
  assert.equal(bootstrapped.table.tableMeta.isSinglePlayer, true);
  assert.equal(bootstrapped.table.tableMeta.buyIn, 500);
});

test("adapter preserves unknown mode and trusts an explicit Online flag", () => {
  for (const isSinglePlayer of [undefined, false]) {
    const multiplayer = adaptPersistedBootstrap({
      tableId: "table_multi_bootstrap",
      tableRow: {
        id: "table_multi_bootstrap",
        max_players: 6,
        status: "OPEN",
        buy_in: 1000,
        stakes: { sb: 10, bb: 20 },
        lifecycle_kind: "STANDARD",
        is_single_player: isSinglePlayer
      },
      seatRows: [],
      stateRow: { version: 0, state: { tableId: "table_multi_bootstrap", phase: "INIT", seats: [], stacks: {} } }
    });

    assert.equal(multiplayer.ok, true);
    assert.equal(multiplayer.table.tableMeta.isSinglePlayer, isSinglePlayer === false ? false : null);
  }
});

test("tableManager hydrates persisted single player table with isSinglePlayer: true upon restart", async () => {
  const manager = createTableManager({
    tableBootstrapLoader: async ({ tableId }) => {
      if (tableId === "sp_table_restart") {
        return adaptPersistedBootstrap({
          tableId: "sp_table_restart",
          tableRow: {
            id: "sp_table_restart",
            max_players: 6,
            status: "OPEN",
            buy_in: 500,
            stakes: { sb: 5, bb: 10 },
            is_single_player: true
          },
          seatRows: [{ user_id: "human_owner", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 500 }],
          stateRow: { version: 1, state: { tableId: "sp_table_restart", phase: "INIT", seats: [{ userId: "human_owner", seatNo: 1 }], stacks: { human_owner: 500 } } }
        });
      }
      return { ok: false, code: "table_not_found" };
    }
  });

  const ensured = await manager.ensureTableLoaded("sp_table_restart");
  assert.equal(ensured.ok, true);
  const meta = manager.tableMeta("sp_table_restart");
  assert.equal(meta.isSinglePlayer, true);
  assert.equal(meta.buyIn, 500);
});

for (const isSinglePlayer of [false, true]) for (const phase of ['HAND_DONE', 'SETTLED']) test(`completed inactivity survives real bootstrap/refresh without pending ghost or repeated Leave, Single Player=${isSinglePlayer}, phase=${phase}`, async () => {
  const { buildStateSnapshotPayload } = await import('../read-model/state-snapshot.mjs');
  const { listPendingInactivityLeaveEntries, reconcileInactivityEjectionsCommand } = await import('../handlers/leave.mjs');
  const tableId = 'completed-inactivity-' + isSinglePlayer;
  const rows = { tableId,
    tableRow: { id: tableId, status: isSinglePlayer ? 'CLOSED' : 'OPEN', max_players: 6, buy_in: 100, is_single_player: isSinglePlayer },
    seatRows: isSinglePlayer ? [{ user_id: 'removed', seat_no: 1, status: 'INACTIVE', is_bot: false, stack: 0 }]
      : [{ user_id: 'remaining', seat_no: 1, status: 'ACTIVE', is_bot: false, stack: 100 }],
    stateRow: { version: 20, state: { tableId, phase, handId: '',
      // Old hand identity can remain after cash-out; it is not current ownership.
      seats: [{ userId: 'removed', seatNo: 1 }], handSeats: [{ userId: 'removed', seatNo: 1 }],
      stacks: isSinglePlayer ? {} : { remaining: 100 }, leftTableByUserId: { removed: true },
      inactivityEjectionByUserId: { removed: { handId: 'settled-hand', isSinglePlayer } },
      missedTurnsByUserId: { removed: isSinglePlayer ? 3 : 2 } } }
  };
  const manager = createTableManager();
  for (let refresh = 0; refresh < 3; refresh++) {
    const restored = adaptPersistedBootstrap(JSON.parse(JSON.stringify(rows)));
    assert.equal(restored.ok, true, restored.message);
    manager.restoreTableFromPersisted(tableId, restored.table);
    const ws = {};
    assert.equal(manager.resync({ tableId, ws, userId: 'removed', nowTs: 1000 + refresh }).ok, true);
    const snapshot = manager.tableSnapshot(tableId, 'removed');
    const payload = buildStateSnapshotPayload({ tableSnapshot: snapshot, userId: 'removed' });
    assert.equal(payload.private.inactivity.status, 'removed');
    assert.equal(payload.private.playerState.status, 'REMOVED');
    assert.equal(snapshot.seats.some(seat => seat.userId === 'removed'), false);
    assert.equal(snapshot.members.some(member => member.userId === 'removed'), false);
    assert.equal(snapshot.youSeat, null);
    if (!isSinglePlayer) assert.deepEqual(snapshot.seats.map(seat => [seat.userId, seat.seatNo]), [['remaining', 1]]);
    assert.deepEqual(payload.public.legalActions.actions, []);
    assert.deepEqual(listPendingInactivityLeaveEntries(manager.persistedPokerState(tableId)), []);
    await reconcileInactivityEjectionsCommand({ tableId, tableManager: manager,
      loadAuthoritativeLeaveExecutor: async () => { assert.fail('completed Leave must not reload executor or cash out'); },
      restoreTableFromPersisted: async () => { assert.fail('completed result must not run settlement restore'); },
      broadcastStateSnapshots: () => {}, broadcastTableState: () => {} });
    assert.equal(manager.persistedStateVersion(tableId), 20);
    assert.equal(manager.persistedPokerState(tableId).missedTurnsByUserId.removed, isSinglePlayer ? 3 : 2);
  }
});

for (const isSinglePlayer of [false, true]) test(`transport reconnect and refresh preserve committed inactivity count, Single Player=${isSinglePlayer}`, () => {
  const tableId = 'reconnect-count-' + isSinglePlayer;
  const count = isSinglePlayer ? 2 : 1;
  const rows = { tableId,
    tableRow: { status: 'OPEN', max_players: 6, is_single_player: isSinglePlayer },
    seatRows: [{ user_id: 'human', seat_no: 1, status: 'ACTIVE', is_bot: false, stack: 100 }],
    stateRow: { version: 9, state: { phase: 'PREFLOP', seats: [{ userId: 'human', seatNo: 1 }], stacks: { human: 100 },
      missedTurnsByUserId: { human: count }, turnDeadlineTs: 21000 } }
  };
  const manager = createTableManager();
  for (let refresh = 0; refresh < 3; refresh++) {
    const restored = adaptPersistedBootstrap(JSON.parse(JSON.stringify(rows)));
    assert.equal(restored.ok, true);
    manager.restoreTableFromPersisted(tableId, restored.table);
    const before = JSON.stringify(manager.persistedPokerState(tableId));
    const ws = {};
    manager.subscribe({ tableId, userId: 'human', ws, nowTs: 1000 });
    manager.resync({ tableId, userId: 'human', ws, nowTs: 2000 });
    manager.cleanupConnection({ ws, userId: 'human', nowTs: 3000, activeSockets: [] });
    manager.resync({ tableId, userId: 'human', ws: {}, nowTs: 4000 });
    assert.equal(JSON.stringify(manager.persistedPokerState(tableId)), before);
    assert.equal(manager.persistedStateVersion(tableId), 9);
    assert.equal(manager.persistedPokerState(tableId).missedTurnsByUserId.human, count);
    assert.equal(manager.persistedPokerState(tableId).inactivityEjectionByUserId?.human, undefined);
  }
});

test('bootstrap preserves pending zero-stack and live-hand inactivity claims without active membership', async () => {
  const { buildStateSnapshotPayload } = await import('../read-model/state-snapshot.mjs');
  for (const variant of ['zero-stack', 'live-hand', 'active-owner']) {
    const tableId = 'pending-' + variant;
    const state = { phase: variant === 'live-hand' ? 'RIVER' : 'HAND_DONE',
      seats: [{ userId: 'human', seatNo: 1 }], handSeats: [{ userId: 'human', seatNo: 1 }],
      stacks: variant === 'zero-stack' ? { human: 0 } : {}, leftTableByUserId: { human: true },
      inactivityEjectionByUserId: { human: { handId: 'hand', isSinglePlayer: false } }, missedTurnsByUserId: { human: 2 } };
    const restored = adaptPersistedBootstrap({ tableId, tableRow: { status: 'OPEN', max_players: 6 },
      seatRows: variant === 'active-owner' ? [{ user_id: 'human', seat_no: 1, status: 'ACTIVE', stack: 100 }] : [],
      stateRow: { version: 10, state } });
    assert.equal(restored.ok, true, restored.message);
    const manager = createTableManager();
    manager.restoreTableFromPersisted(tableId, restored.table);
    manager.resync({ tableId, userId: 'human', ws: {}, nowTs: 1000 });
    const snapshot = manager.tableSnapshot(tableId, 'human');
    const payload = buildStateSnapshotPayload({ tableSnapshot: snapshot, userId: 'human' });
    assert.equal(payload.private.inactivity.status, 'pending');
    assert.equal(payload.private.playerState.status, 'EJECTION_PENDING');
    assert.equal(snapshot.members.some(member => member.userId === 'human'), false);
    assert.deepEqual(payload.public.legalActions.actions, []);
    assert.deepEqual(manager.persistedPokerState(tableId).stacks, state.stacks);
    assert.deepEqual(manager.persistedPokerState(tableId).handSeats, state.handSeats);
  }
});
