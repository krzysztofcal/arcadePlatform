import test from "node:test";
import assert from "node:assert/strict";
import { projectRoomCoreSnapshot } from "./room-core-snapshot.mjs";

test("projectRoomCoreSnapshot derives lobby snapshot when poker state is missing", () => {
  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_lobby",
    roomId: "table_lobby",
    coreState: { seats: {} },
    members: [{ userId: "user_a", seat: 1 }],
    userId: "user_a",
    youSeat: 1
  });

  assert.equal(snapshot.roomId, "table_lobby");
  assert.deepEqual(snapshot.hand, { handId: null, status: "LOBBY", round: null });
  assert.deepEqual(snapshot.turn, { userId: "user_a", seat: 1, startedAt: null, deadlineAt: null });
  assert.deepEqual(snapshot.pot, { total: 0, sidePots: [] });
  assert.deepEqual(snapshot.private, { userId: "user_a", seat: 1, holeCards: [] });
});

test("projectRoomCoreSnapshot reuses poker legal-actions/public stripping semantics", () => {
  const coreState = {
    seats: { seated_user: 2, other_user: 1 },
    pokerState: {
      roomId: "table_stateful",
      handId: "hand_42",
      phase: "PREFLOP",
      turnUserId: "seated_user",
      community: ["AS", "KD"],
      pot: 75,
      sidePots: [{ total: 10 }],
      stacks: { seated_user: 150, other_user: 300 },
      betThisRoundByUserId: { seated_user: 25, other_user: 25 },
      currentBet: 25,
      foldedByUserId: { seated_user: false, other_user: false },
      leftTableByUserId: { seated_user: false, other_user: false },
      sitOutByUserId: { seated_user: false, other_user: false },
      holeCardsByUserId: { seated_user: ["AH", "AD"], other_user: ["2C", "2D"] },
      handSeed: "sensitive",
      deck: ["QS"]
    }
  };

  const seated = projectRoomCoreSnapshot({
    tableId: "table_stateful",
    roomId: "table_stateful",
    coreState,
    members: [
      { userId: "other_user", seat: 1 },
      { userId: "seated_user", seat: 2 }
    ],
    userId: "seated_user",
    youSeat: 2
  });
  const observer = projectRoomCoreSnapshot({
    tableId: "table_stateful",
    roomId: "table_stateful",
    coreState,
    members: [
      { userId: "other_user", seat: 1 },
      { userId: "seated_user", seat: 2 }
    ],
    userId: "observer",
    youSeat: null
  });

  assert.equal(seated.hand.handId, "hand_42");
  assert.equal(seated.hand.status, "PREFLOP");
  assert.deepEqual(seated.board.cards, ["AS", "KD"]);
  assert.deepEqual(seated.legalActions.actions, ["CHECK", "BET"]);
  assert.deepEqual(seated.private, { userId: "seated_user", seat: 2, holeCards: ["AH", "AD"] });
  assert.deepEqual(observer.hand, seated.hand);
  assert.deepEqual(observer.board, seated.board);
  assert.deepEqual(observer.turn, seated.turn);
  assert.deepEqual(observer.pot, seated.pot);
  assert.deepEqual(observer.legalActions, { seat: null, actions: [] });
  assert.equal(seated.turn.startedAt, null);
  assert.equal(seated.turn.deadlineAt, null);
  assert.equal(observer.private, null);
});

test("projectRoomCoreSnapshot projects settled showdown fields without leaking private cards", () => {
  const coreState = {
    seats: { seated_user: 1, other_user: 2 },
    pokerState: {
      roomId: "table_settled",
      handId: "hand_settled_1",
      phase: "SETTLED",
      turnUserId: "seated_user",
      community: ["2H", "3H", "4H", "9C", "KD"],
      potTotal: 0,
      sidePots: [],
      showdown: {
        handId: "hand_settled_1",
        winners: ["other_user"],
        potsAwarded: [{ amount: 6, winners: ["other_user"], eligibleUserIds: ["seated_user", "other_user"] }],
        potAwardedTotal: 6,
        reason: "computed"
      },
      handSettlement: {
        handId: "hand_settled_1",
        settledAt: "2026-03-01T00:00:00.000Z",
        payouts: { other_user: 6 }
      },
      holeCardsByUserId: { seated_user: ["AH", "AD"], other_user: ["2C", "2D"] },
      deck: []
    }
  };

  const seated = projectRoomCoreSnapshot({
    tableId: "table_settled",
    roomId: "table_settled",
    coreState,
    members: [
      { userId: "seated_user", seat: 1 },
      { userId: "other_user", seat: 2 }
    ],
    userId: "seated_user",
    youSeat: 1
  });
  const observer = projectRoomCoreSnapshot({
    tableId: "table_settled",
    roomId: "table_settled",
    coreState,
    members: [
      { userId: "seated_user", seat: 1 },
      { userId: "other_user", seat: 2 }
    ],
    userId: "observer",
    youSeat: null
  });

  assert.equal(seated.hand.status, "SETTLED");
  assert.equal(seated.pot.total, 0);
  assert.deepEqual(seated.turn, { userId: null, seat: null, startedAt: null, deadlineAt: null });
  assert.deepEqual(seated.showdown.winners, ["other_user"]);
  assert.deepEqual(seated.handSettlement.payouts, { other_user: 6 });
  assert.equal(observer.private, null);
  assert.equal(observer.showdown.potsAwarded[0].eligibleUserIds.includes("seated_user"), true);
  assert.deepEqual(seated.private, { userId: "seated_user", seat: 1, holeCards: ["AH", "AD"] });
});

test("projectRoomCoreSnapshot omits terminal fields for fresh next-hand PREFLOP state", () => {
  const coreState = {
    seats: { seated_user: 1, other_user: 2 },
    pokerState: {
      roomId: "table_next_hand",
      handId: "hand_next_2",
      phase: "PREFLOP",
      turnUserId: "seated_user",
      community: [],
      potTotal: 3,
      sidePots: [],
      toCallByUserId: { seated_user: 1, other_user: 0 },
      betThisRoundByUserId: { seated_user: 1, other_user: 2 },
      currentBet: 2,
      stacks: { seated_user: 99, other_user: 98 },
      foldedByUserId: { seated_user: false, other_user: false },
      holeCardsByUserId: { seated_user: ["AS", "KD"], other_user: ["2C", "2D"] },
      handSeed: "sensitive_new_seed",
      deck: ["3H"]
    }
  };

  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_next_hand",
    roomId: "table_next_hand",
    coreState,
    members: [
      { userId: "seated_user", seat: 1 },
      { userId: "other_user", seat: 2 }
    ],
    userId: "seated_user",
    youSeat: 1
  });

  assert.equal(snapshot.hand.status, "PREFLOP");
  assert.deepEqual(snapshot.board.cards, []);
  assert.equal("showdown" in snapshot, false);
  assert.equal("handSettlement" in snapshot, false);
  assert.deepEqual(snapshot.private, { userId: "seated_user", seat: 1, holeCards: ["AS", "KD"] });
});


test("projectRoomCoreSnapshot projects turn timer metadata for a live hand", () => {
  const coreState = {
    seats: { seated_user: 2, other_user: 1 },
    pokerState: {
      roomId: "table_live_timer",
      handId: "hand_timer_1",
      phase: "PREFLOP",
      turnUserId: "seated_user",
      turnStartedAt: 1710000000000,
      turnDeadlineAt: 1710000015000,
      community: [],
      potTotal: 3,
      sidePots: [],
      stacks: { seated_user: 99, other_user: 98 },
      betThisRoundByUserId: { seated_user: 1, other_user: 2 },
      currentBet: 2,
      foldedByUserId: { seated_user: false, other_user: false },
      leftTableByUserId: { seated_user: false, other_user: false },
      sitOutByUserId: { seated_user: false, other_user: false },
      holeCardsByUserId: { seated_user: ["AH", "AD"], other_user: ["2C", "2D"] }
    }
  };

  const seated = projectRoomCoreSnapshot({
    tableId: "table_live_timer",
    roomId: "table_live_timer",
    coreState,
    members: [
      { userId: "other_user", seat: 1 },
      { userId: "seated_user", seat: 2 }
    ],
    userId: "seated_user",
    youSeat: 2
  });
  const observer = projectRoomCoreSnapshot({
    tableId: "table_live_timer",
    roomId: "table_live_timer",
    coreState,
    members: [
      { userId: "other_user", seat: 1 },
      { userId: "seated_user", seat: 2 }
    ],
    userId: "observer",
    youSeat: null
  });

  assert.equal(seated.turn.startedAt, 1710000000000);
  assert.equal(seated.turn.deadlineAt, 1710000015000);
  assert.deepEqual(observer.turn, seated.turn);
  assert.equal(observer.private, null);
});

test("projectRoomCoreSnapshot clears turn timer metadata for settled hands even with stale turn metadata", () => {
  const coreState = {
    seats: { seated_user: 1, other_user: 2 },
    pokerState: {
      roomId: "table_settled_timer",
      handId: "hand_settled_timer",
      phase: "SETTLED",
      turnUserId: "seated_user",
      turnStartedAt: 1710000000000,
      turnDeadlineAt: 1710000015000,
      community: ["2H", "3H", "4H", "9C", "KD"],
      potTotal: 0,
      sidePots: [],
      holeCardsByUserId: { seated_user: ["AH", "AD"], other_user: ["2C", "2D"] }
    }
  };

  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_settled_timer",
    roomId: "table_settled_timer",
    coreState,
    members: [
      { userId: "seated_user", seat: 1 },
      { userId: "other_user", seat: 2 }
    ],
    userId: "seated_user",
    youSeat: 1
  });

  assert.equal(snapshot.hand.status, "SETTLED");
  assert.equal(snapshot.pot.total, 0);
  assert.equal(snapshot.turn.userId, null);
  assert.equal(snapshot.turn.seat, null);
  assert.equal(snapshot.turn.startedAt, null);
  assert.equal(snapshot.turn.deadlineAt, null);
  assert.deepEqual(snapshot.private, { userId: "seated_user", seat: 1, holeCards: ["AH", "AD"] });
});
