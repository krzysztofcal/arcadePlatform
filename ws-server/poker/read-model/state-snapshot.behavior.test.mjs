import test from "node:test";
import assert from "node:assert/strict";
import { createTableManager } from "../table/table-manager.mjs";
import { buildStateSnapshotPayload } from "./state-snapshot.mjs";

test("buildStateSnapshotPayload returns canonical room-core payload for seated authenticated user", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const wsA = {};
  const wsB = {};

  const joinB = tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_A", requestId: "join-b" });
  assert.equal(joinB.ok, true);
  const joinA = tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_A", requestId: "join-a" });
  assert.equal(joinA.ok, true);

  const tableSnapshot = tableManager.tableSnapshot("table_A", "user_a");
  const payload = buildStateSnapshotPayload({ tableSnapshot, userId: "user_a" });

  assert.equal(Number.isInteger(payload.stateVersion), true);
  assert.equal(typeof payload.table, "object");
  assert.equal(typeof payload.you, "object");
  assert.equal(typeof payload.public, "object");
  assert.deepEqual(payload.table.members, [
    { userId: "user_b", seat: 1 },
    { userId: "user_a", seat: 2 }
  ]);
  assert.equal(payload.you.userId, "user_a");
  assert.equal(payload.you.seat, 2);
  assert.deepEqual(payload.private, { userId: "user_a", seat: 2, holeCards: [] });

  assert.deepEqual(payload.public.hand, { handId: null, status: "LOBBY", round: null, dealerSeatNo: null });
  assert.deepEqual(payload.public.board, { cards: [] });
  assert.deepEqual(payload.public.pot, { total: 0, sidePots: [] });
  assert.deepEqual(payload.public.turn, { userId: "user_b", seat: 1, startedAt: null, deadlineAt: null });
  assert.deepEqual(payload.public.legalActions, { seat: null, actions: [] });
  assert.deepEqual(payload.public.betThisRoundByUserId, {});
  assert.deepEqual(payload.public.committedByUserId, {});
});

test("buildStateSnapshotPayload for observer never exposes private branch", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const wsA = {};
  const wsB = {};

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_B", requestId: "join-a" }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_B", requestId: "join-b" }).ok, true);

  const tableSnapshot = tableManager.tableSnapshot("table_B", "observer_user");
  const payload = buildStateSnapshotPayload({ tableSnapshot, userId: "observer_user" });

  assert.equal(payload.you.userId, "observer_user");
  assert.equal(payload.you.seat, null);
  assert.equal("private" in payload, false);
  assert.equal("players" in payload.you, false);
  assert.equal(payload.public.turn.userId, "user_a");
});

test("buildStateSnapshotPayload missing table snapshot returns canonical empty room-core shape", () => {
  const tableManager = createTableManager({ maxSeats: 6 });

  const tableSnapshot = tableManager.tableSnapshot("missing_table", "user_x");
  const payload = buildStateSnapshotPayload({ tableSnapshot, userId: "user_x" });

  assert.equal(payload.stateVersion, 0);
  assert.deepEqual(payload.table.members, []);
  assert.equal(payload.table.memberCount, 0);
  assert.equal(payload.you.seat, null);
  assert.equal(payload.public.roomId, "missing_table");
  assert.deepEqual(payload.public.board.cards, []);
  assert.deepEqual(payload.public.pot, { total: 0, sidePots: [] });
  assert.deepEqual(payload.public.legalActions, { seat: null, actions: [] });
  assert.equal("private" in payload, false);
});

test("buildStateSnapshotPayload keeps authoritative seated members after disconnect cleanup", () => {
  const tableManager = createTableManager({ maxSeats: 6, presenceTtlMs: 10 });
  const wsA = {};
  const wsB = {};
  const tableId = "table_disconnect_payload";

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId, requestId: "join-a", nowTs: 100 }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId, requestId: "join-b", nowTs: 100 }).ok, true);

  const updates = tableManager.cleanupConnection({ ws: wsB, userId: "user_b", nowTs: 101, activeSockets: [] });
  assert.equal(updates.length, 1);

  const tableState = tableManager.tableState(tableId);
  assert.deepEqual(tableState.members, [{ userId: "user_a", seat: 1 }]);

  const tableSnapshot = tableManager.tableSnapshot(tableId, "observer_user");
  assert.deepEqual(tableSnapshot.members, [
    { userId: "user_a", seat: 1 },
    { userId: "user_b", seat: 2 }
  ]);
  const payload = buildStateSnapshotPayload({ tableSnapshot, userId: "observer_user" });

  assert.deepEqual(payload.table.members, [
    { userId: "user_a", seat: 1 },
    { userId: "user_b", seat: 2 }
  ]);
  assert.equal(payload.table.memberCount, payload.table.members.length);
});


test("buildStateSnapshotPayload projects bootstrapped PREFLOP state from table manager", () => {
  const tableManager = createTableManager({ maxSeats: 6 });
  const wsA = {};
  const wsB = {};

  assert.equal(tableManager.join({ ws: wsA, userId: "user_a", tableId: "table_live", requestId: "join-a" }).ok, true);
  assert.equal(tableManager.join({ ws: wsB, userId: "user_b", tableId: "table_live", requestId: "join-b" }).ok, true);
  const boot = tableManager.bootstrapHand("table_live");
  assert.equal(boot.ok, true);

  const seatedPayload = buildStateSnapshotPayload({ tableSnapshot: tableManager.tableSnapshot("table_live", "user_a"), userId: "user_a" });
  const observerPayload = buildStateSnapshotPayload({ tableSnapshot: tableManager.tableSnapshot("table_live", "observer"), userId: "observer" });

  assert.equal(seatedPayload.public.hand.status, "PREFLOP");
  assert.equal(seatedPayload.public.hand.dealerSeatNo, 1);
  assert.equal(typeof seatedPayload.public.hand.handId, "string");
  assert.deepEqual(seatedPayload.public.stacks, { user_a: 99, user_b: 98 });
  assert.deepEqual(seatedPayload.public.pot, { total: 3, sidePots: [] });
  assert.deepEqual(seatedPayload.public.seats, [
    { userId: "user_a", seatNo: 1, status: "ACTIVE" },
    { userId: "user_b", seatNo: 2, status: "ACTIVE" }
  ]);
  assert.deepEqual(seatedPayload.public.legalActions, { seat: 1, actions: ["FOLD", "CALL", "RAISE"] });
  assert.deepEqual(seatedPayload.public.actionConstraints, { toCall: 1, minRaiseTo: 4, maxRaiseTo: 100, maxBetAmount: null });
  assert.deepEqual(seatedPayload.public.betThisRoundByUserId, { user_a: 1, user_b: 2 });
  assert.deepEqual(seatedPayload.public.committedByUserId, {});
  assert.deepEqual(seatedPayload.public.lastBettingRoundActionByUserId, {});
  assert.equal(Array.isArray(seatedPayload.private.holeCards), true);
  assert.equal(seatedPayload.private.holeCards.length, 2);
  assert.equal("private" in observerPayload, false);
  assert.deepEqual(observerPayload.public, {
    ...seatedPayload.public,
    legalActions: { seat: null, actions: [] },
    actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null }
  });
  assert.equal(seatedPayload.table.memberCount, seatedPayload.table.members.length);
});

test("buildStateSnapshotPayload keeps committed chips distinct from current-round bets", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_distinct_commit",
      roomId: "table_distinct_commit",
      stateVersion: 15,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      memberCount: 2,
      youSeat: 1,
      hand: { handId: "h_distinct_commit", status: "TURN", round: "TURN", dealerSeatNo: 2 },
      board: { cards: ["AS", "KD", "QC", "3H"] },
      stacks: { user_a: 91, user_b: 86 },
      betThisRoundByUserId: { user_a: 4, user_b: 8 },
      committedByUserId: { user_a: 9, user_b: 14 },
      pot: { total: 23, sidePots: [] },
      turn: { userId: "user_a", seat: 1, startedAt: null, deadlineAt: null },
      legalActions: { seat: 1, actions: ["CHECK"] },
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      private: { holeCards: ["AS", "AD"] }
    }
  });

  assert.deepEqual(payload.public.betThisRoundByUserId, { user_a: 4, user_b: 8 });
  assert.deepEqual(payload.public.committedByUserId, { user_a: 9, user_b: 14 });
});

test("buildStateSnapshotPayload serializes last betting-round action labels", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_action_badges",
      roomId: "table_action_badges",
      stateVersion: 13,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      memberCount: 2,
      youSeat: 1,
      hand: { handId: "h_actions", status: "TURN", round: "TURN", dealerSeatNo: 2 },
      board: { cards: ["AS", "KD", "QC", "3H"] },
      pot: { total: 14, sidePots: [] },
      turn: { userId: "user_b", seat: 2, startedAt: 1710000000000, deadlineAt: 1710000015000 },
      legalActions: { seat: 1, actions: ["FOLD", "CALL"] },
      actionConstraints: { toCall: 4, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      lastBettingRoundActionByUserId: { user_a: "call", user_b: "raise", ignored: "bad" },
      private: { holeCards: ["AS", "AD"] }
    }
  });

  assert.deepEqual(payload.public.lastBettingRoundActionByUserId, { user_a: "call", user_b: "raise" });
});

test("buildStateSnapshotPayload serializes folded seat statuses for live table snapshots", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_folded_seats",
      roomId: "table_folded_seats",
      stateVersion: 14,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      memberCount: 2,
      youSeat: 1,
      seats: [
        { userId: "user_a", seatNo: 1, status: "FOLDED" },
        { userId: "user_b", seatNo: 2, status: "ACTIVE" }
      ],
      hand: { handId: "h_folded", status: "TURN", round: "TURN", dealerSeatNo: 2 },
      board: { cards: ["AS", "KD", "QC", "3H"] },
      pot: { total: 14, sidePots: [] },
      turn: { userId: "user_b", seat: 2, startedAt: 1710000000000, deadlineAt: 1710000015000 },
      legalActions: { seat: 1, actions: [] },
      actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      private: { holeCards: ["AS", "AD"] }
    }
  });

  assert.deepEqual(payload.public.seats, [
    { userId: "user_a", seatNo: 1, status: "FOLDED" },
    { userId: "user_b", seatNo: 2, status: "ACTIVE" }
  ]);
});

test("buildStateSnapshotPayload includes terminal showdown/settlement fields when present", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_terminal",
      roomId: "table_terminal",
      stateVersion: 10,
      members: [{ userId: "user_a", seat: 1 }],
      memberCount: 1,
      youSeat: 1,
      hand: { handId: "h_terminal", status: "SETTLED", round: null, dealerSeatNo: 1 },
      board: { cards: ["2H", "3H", "4H", "9C", "KD"] },
      pot: { total: 0, sidePots: [] },
      turn: { userId: null, seat: null, startedAt: null, deadlineAt: null },
      legalActions: { seat: 1, actions: [] },
      actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      private: { holeCards: ["AS", "AD"] },
      showdown: {
        handId: "h_terminal",
        winners: ["user_a"],
        potsAwarded: [{ amount: 5, winners: ["user_a"] }],
        potAwardedTotal: 5,
        reason: "computed",
        revealedShowdownParticipants: [{ userId: "user_a", holeCards: ["AS", "AD"] }]
      },
      handSettlement: {
        handId: "h_terminal",
        settledAt: "2026-03-01T00:00:00.000Z",
        payouts: { user_a: 5 }
      }
    }
  });

  assert.deepEqual(payload.public.showdown.winners, ["user_a"]);
  assert.deepEqual(payload.public.showdown.revealedShowdownParticipants, [{ userId: "user_a", holeCards: ["AS", "AD"] }]);
  assert.equal(payload.public.showdown.potAwardedTotal, 5);
  assert.deepEqual(payload.public.turn, { userId: null, seat: null, startedAt: null, deadlineAt: null });
  assert.deepEqual(payload.public.actionConstraints, { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null });
  assert.deepEqual(payload.public.handSettlement.payouts, { user_a: 5 });
  assert.deepEqual(payload.private, { userId: "user_a", seat: 1, holeCards: ["AS", "AD"] });
});

test("buildStateSnapshotPayload omits revealed showdown participant cards for all-folded settlements", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_terminal_folded",
      roomId: "table_terminal_folded",
      stateVersion: 11,
      members: [{ userId: "user_a", seat: 1 }],
      memberCount: 1,
      youSeat: 1,
      hand: { handId: "h_terminal_folded", status: "SETTLED", round: null, dealerSeatNo: 1 },
      board: { cards: ["2H", "3H", "4H", "9C", "KD"] },
      pot: { total: 0, sidePots: [] },
      turn: { userId: null, seat: null, startedAt: null, deadlineAt: null },
      legalActions: { seat: 1, actions: [] },
      actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      showdown: {
        handId: "h_terminal_folded",
        winners: ["user_a"],
        potsAwarded: [{ amount: 5, winners: ["user_a"] }],
        potAwardedTotal: 5,
        reason: "all_folded"
      }
    }
  });

  assert.equal("revealedShowdownParticipants" in payload.public.showdown, false);
});

test("buildStateSnapshotPayload serializes fresh next hand without stale terminal fields", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_next_hand",
      roomId: "table_next_hand",
      stateVersion: 11,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      memberCount: 2,
      youSeat: 1,
      hand: { handId: "h_next", status: "PREFLOP", round: "PREFLOP", dealerSeatNo: 2 },
      board: { cards: [] },
      pot: { total: 3, sidePots: [] },
      turn: { userId: "user_a", seat: 1 },
      legalActions: { seat: 1, actions: ["FOLD", "CALL", "RAISE"] },
      private: { holeCards: ["AS", "AD"] }
    }
  });

  assert.equal(payload.public.hand.status, "PREFLOP");
  assert.equal(payload.public.hand.dealerSeatNo, 2);
  assert.deepEqual(payload.public.board.cards, []);
  assert.equal("showdown" in payload.public, false);
  assert.equal("handSettlement" in payload.public, false);
  assert.deepEqual(payload.private.holeCards, ["AS", "AD"]);
});


test("buildStateSnapshotPayload serializes turn timer metadata for live hand", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_timer",
      roomId: "table_timer",
      stateVersion: 12,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      memberCount: 2,
      youSeat: 1,
      hand: { handId: "h_timer", status: "PREFLOP", round: "PREFLOP", dealerSeatNo: 2 },
      board: { cards: [] },
      pot: { total: 3, sidePots: [] },
      turn: { userId: "user_a", seat: 1, startedAt: 1710000000000, deadlineAt: 1710000015000 },
      legalActions: { seat: 1, actions: ["FOLD", "CALL", "RAISE"] },
      private: { holeCards: ["AS", "AD"] }
    }
  });

  assert.deepEqual(payload.public.turn, { userId: "user_a", seat: 1, startedAt: 1710000000000, deadlineAt: 1710000015000 });
  assert.deepEqual(payload.private, { userId: "user_a", seat: 1, holeCards: ["AS", "AD"] });
});

test("buildStateSnapshotPayload keeps next-hand timer metadata and omits stale terminal fields", () => {
  const payload = buildStateSnapshotPayload({
    userId: "user_a",
    tableSnapshot: {
      tableId: "table_next_hand_timer",
      roomId: "table_next_hand_timer",
      stateVersion: 13,
      members: [
        { userId: "user_a", seat: 1 },
        { userId: "user_b", seat: 2 }
      ],
      memberCount: 2,
      youSeat: 1,
      hand: { handId: "h_next_timer", status: "PREFLOP", round: "PREFLOP", dealerSeatNo: 2 },
      board: { cards: [] },
      pot: { total: 3, sidePots: [] },
      turn: { userId: "user_a", seat: 1, startedAt: 1710000020000, deadlineAt: 1710000035000 },
      legalActions: { seat: 1, actions: ["FOLD", "CALL", "RAISE"] },
      private: { holeCards: ["AS", "AD"] }
    }
  });

  assert.equal(payload.public.turn.startedAt, 1710000020000);
  assert.equal(payload.public.turn.deadlineAt, 1710000035000);
  assert.equal("showdown" in payload.public, false);
  assert.equal("handSettlement" in payload.public, false);
});
