import test from "node:test";
import assert from "node:assert/strict";
import { adaptPersistedBootstrap } from "./persisted-bootstrap-adapter.mjs";
import { dealHoleCards, deriveDeck, toCardCodes } from "../shared/poker-primitives.mjs";

test("adapter maps persisted rows into deterministic ws table/core state", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_1",
    tableRow: { id: "table_1", max_players: 6 },
    seatRows: [
      { user_id: "user_b", seat_no: 4, status: "ACTIVE", is_bot: false, stack: 80 },
      { user_id: "user_a", seat_no: 2, status: "ACTIVE", is_bot: false, stack: 120 },
      { user_id: "user_x", seat_no: 3, status: "LEFT", is_bot: false }
    ],
    stateRow: { version: 12, state: { phase: "PREFLOP", handId: "h1" } }
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

test("adapter restores replacement bot identity from persisted state when seat rows still reference prior bot id", () => {
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
