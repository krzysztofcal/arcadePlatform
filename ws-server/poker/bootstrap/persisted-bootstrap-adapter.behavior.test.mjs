import test from "node:test";
import assert from "node:assert/strict";
import { adaptPersistedBootstrap } from "./persisted-bootstrap-adapter.mjs";

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

test("adapter preserves live-hand retained left state seats even when persisted seat rows are already inactive", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_retained_state_seat",
    tableRow: { id: "table_retained_state_seat", max_players: 6 },
    seatRows: [
      { user_id: "user_left", seat_no: 1, status: "INACTIVE", is_bot: false, stack: 120 },
      { user_id: "bot_a", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 80 }
    ],
    stateRow: {
      version: 11,
      state: {
        phase: "TURN",
        seats: [
          { userId: "user_left", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_a", seatNo: 2, status: "ACTIVE", isBot: true }
        ],
        stacks: { user_left: 120, bot_a: 80 },
        leftTableByUserId: { user_left: true, bot_a: false }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.members, [{ userId: "bot_a", seat: 2 }]);
  assert.deepEqual(result.table.coreState.seats, { bot_a: 2 });
  assert.deepEqual(result.table.coreState.pokerState.seats, [
    { userId: "user_left", seatNo: 1, status: "ACTIVE" },
    { userId: "bot_a", seatNo: 2, status: "ACTIVE", isBot: true }
  ]);
});

test("adapter preserves waiting-for-next-hand seats even when persisted seat rows are already inactive", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_waiting_state_seat",
    tableRow: { id: "table_waiting_state_seat", max_players: 6 },
    seatRows: [
      { user_id: "user_waiting", seat_no: 1, status: "INACTIVE", is_bot: false, stack: 120 },
      { user_id: "bot_a", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 80 }
    ],
    stateRow: {
      version: 11,
      state: {
        phase: "HAND_DONE",
        seats: [
          { userId: "user_waiting", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_a", seatNo: 2, status: "ACTIVE", isBot: true }
        ],
        stacks: { user_waiting: 120, bot_a: 80 },
        leftTableByUserId: { user_waiting: true, bot_a: false },
        waitingForNextHandByUserId: { user_waiting: true, bot_a: false }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.members, [{ userId: "bot_a", seat: 2 }]);
  assert.deepEqual(result.table.coreState.seats, { bot_a: 2 });
  assert.deepEqual(result.table.coreState.pokerState.seats, [
    { userId: "user_waiting", seatNo: 1, status: "ACTIVE" },
    { userId: "bot_a", seatNo: 2, status: "ACTIVE", isBot: true }
  ]);
});

test("adapter drops inactive left-only state seats after the live hand has ended", () => {
  const result = adaptPersistedBootstrap({
    tableId: "table_left_only_state_seat",
    tableRow: { id: "table_left_only_state_seat", max_players: 6 },
    seatRows: [
      { user_id: "user_left", seat_no: 1, status: "INACTIVE", is_bot: false, stack: 120 },
      { user_id: "bot_a", seat_no: 2, status: "ACTIVE", is_bot: true, stack: 80 }
    ],
    stateRow: {
      version: 11,
      state: {
        phase: "HAND_DONE",
        seats: [
          { userId: "user_left", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_a", seatNo: 2, status: "ACTIVE", isBot: true }
        ],
        stacks: { user_left: 120, bot_a: 80 },
        leftTableByUserId: { user_left: true, bot_a: false }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.table.coreState.members, [{ userId: "bot_a", seat: 2 }]);
  assert.deepEqual(result.table.coreState.seats, { bot_a: 2 });
  assert.deepEqual(result.table.coreState.pokerState.seats, [
    { userId: "bot_a", seatNo: 2, status: "ACTIVE", isBot: true }
  ]);
});
