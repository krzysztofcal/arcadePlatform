import test from "node:test";
import assert from "node:assert/strict";
import { projectRoomCoreSnapshot } from "./room-core-snapshot.mjs";

test("projectRoomCoreSnapshot derives lobby snapshot public seats/stacks when poker state is missing", () => {
  const baseInput = {
    tableId: "table_lobby",
    roomId: "table_lobby",
    coreState: { seats: { user_a: 1 }, publicStacks: { user_a: 120 } },
    members: [{ userId: "user_a", seat: 1 }],
    userId: "user_a",
    youSeat: 1
  };
  const snapshot = projectRoomCoreSnapshot(baseInput);
  const observer = projectRoomCoreSnapshot({ ...baseInput, userId: "observer", youSeat: null });

  assert.equal(snapshot.roomId, "table_lobby");
  assert.deepEqual(snapshot.hand, { handId: null, status: "LOBBY", round: null, dealerSeatNo: null });
  assert.deepEqual(snapshot.turn, { userId: "user_a", seat: 1, startedAt: null, deadlineAt: null });
  assert.deepEqual(snapshot.seats, [{ userId: "user_a", seatNo: 1, status: "ACTIVE" }]);
  assert.deepEqual(snapshot.stacks, { user_a: 120 });
  assert.deepEqual(observer.seats, snapshot.seats);
  assert.deepEqual(observer.stacks, snapshot.stacks);
  assert.deepEqual(snapshot.pot, { total: 0, sidePots: [] });
  assert.deepEqual(snapshot.private, { userId: "user_a", seat: 1, holeCards: [] });
  assert.equal(observer.private, null);
});

test("projectRoomCoreSnapshot falls back to authoritative lobby seats/stacks when poker state is empty", () => {
  const baseInput = {
    tableId: "table_lobby_empty_state",
    roomId: "table_lobby_empty_state",
    coreState: {
      seats: { user_a: 1, user_b: 2 },
      publicStacks: { user_a: 150, user_b: 90 },
      pokerState: {}
    },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    userId: "user_a",
    youSeat: 1
  };
  const seated = projectRoomCoreSnapshot(baseInput);
  const observer = projectRoomCoreSnapshot({ ...baseInput, userId: "observer", youSeat: null });

  assert.deepEqual(seated.seats, [
    { userId: "user_a", seatNo: 1, status: "ACTIVE" },
    { userId: "user_b", seatNo: 2, status: "ACTIVE" }
  ]);
  assert.deepEqual(seated.stacks, { user_a: 150, user_b: 90 });
  assert.equal(seated.hand.status, null);
  assert.deepEqual(observer.seats, seated.seats);
  assert.deepEqual(observer.stacks, seated.stacks);
  assert.equal(observer.private, null);
});

test("projectRoomCoreSnapshot preserves bot seat metadata when public seats fall back to members", () => {
  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_lobby_bots",
    roomId: "table_lobby_bots",
    coreState: {
      seats: { human_user: 1, bot_user: 2 },
      publicStacks: { human_user: 120, bot_user: 120 },
      seatDetailsByUserId: {
        human_user: { isBot: false, botProfile: null, leaveAfterHand: false },
        bot_user: { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false }
      },
      pokerState: {}
    },
    members: [
      { userId: "human_user", seat: 1 },
      { userId: "bot_user", seat: 2 }
    ],
    userId: "human_user",
    youSeat: 1
  });

  assert.deepEqual(snapshot.seats, [
    { userId: "human_user", seatNo: 1, status: "ACTIVE" },
    { userId: "bot_user", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
  ]);
});

test("projectRoomCoreSnapshot hides left-table users from public seats and stacks even when poker state retains them", () => {
  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_left_hidden",
    roomId: "table_left_hidden",
    coreState: {
      seats: { leaver_user: 1, bot_user: 2 },
      publicStacks: { leaver_user: 48, bot_user: 52 },
      seatDetailsByUserId: {
        leaver_user: { isBot: false, botProfile: null, leaveAfterHand: false },
        bot_user: { isBot: true, botProfile: "TRIVIAL", leaveAfterHand: false }
      },
      pokerState: {
        roomId: "table_left_hidden",
        handId: "hand_left_hidden",
        phase: "TURN",
        turnUserId: "bot_user",
        community: ["AS", "KD", "QC", "3H"],
        potTotal: 12,
        seats: [
          { userId: "leaver_user", seatNo: 1, status: "ACTIVE" },
          { userId: "bot_user", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
        ],
        stacks: { leaver_user: 48, bot_user: 52 },
        leftTableByUserId: { leaver_user: true, bot_user: false },
        foldedByUserId: { leaver_user: true, bot_user: false },
        sitOutByUserId: { leaver_user: false, bot_user: false }
      }
    },
    members: [{ userId: "bot_user", seat: 2 }],
    userId: "observer_user",
    youSeat: null
  });

  assert.deepEqual(snapshot.seats, [
    { userId: "bot_user", seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
  ]);
  assert.deepEqual(snapshot.stacks, { bot_user: 52 });
  assert.equal(snapshot.private, null);
});

test("projectRoomCoreSnapshot marks folded seats from authoritative folded state when public seats omit status", () => {
  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_fold_projection",
    roomId: "table_fold_projection",
    coreState: {
      seats: { user_a: 1, user_b: 2 },
      pokerState: {
        roomId: "table_fold_projection",
        handId: "hand_fold_projection",
        phase: "TURN",
        turnUserId: "user_b",
        community: ["AS", "KD", "QC", "3H"],
        potTotal: 10,
        stacks: { user_a: 98, user_b: 92 },
        foldedByUserId: { user_a: true, user_b: false },
        leftTableByUserId: { user_a: false, user_b: false },
        sitOutByUserId: { user_a: false, user_b: false },
        holeCardsByUserId: { user_a: ["AH", "AD"], user_b: ["2C", "2D"] },
        deck: ["QS"]
      }
    },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    userId: "user_b",
    youSeat: 2
  });

  assert.deepEqual(snapshot.seats, [
    { userId: "user_a", seatNo: 1, status: "FOLDED" },
    { userId: "user_b", seatNo: 2, status: "ACTIVE" }
  ]);
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
  assert.deepEqual(seated.lastBettingRoundActionByUserId, {});
  assert.deepEqual(seated.private, { userId: "seated_user", seat: 2, holeCards: ["AH", "AD"] });
  assert.deepEqual(observer.hand, seated.hand);
  assert.deepEqual(observer.board, seated.board);
  assert.deepEqual(observer.turn, seated.turn);
  assert.deepEqual(observer.pot, seated.pot);
  assert.deepEqual(observer.seats, seated.seats);
  assert.deepEqual(observer.stacks, seated.stacks);
  assert.deepEqual(observer.legalActions, { seat: null, actions: [] });
  assert.equal(seated.turn.startedAt, null);
  assert.equal(seated.turn.deadlineAt, null);
  assert.equal(observer.private, null);
});

test("projectRoomCoreSnapshot exposes last betting-round actions with canonical labels", () => {
  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_action_badges",
    roomId: "table_action_badges",
    coreState: {
      seats: { user_a: 1, user_b: 2 },
      pokerState: {
        roomId: "table_action_badges",
        handId: "hand_actions",
        phase: "TURN",
        dealerSeatNo: 1,
        turnUserId: "user_b",
        community: ["AS", "KD", "QC", "3H"],
        potTotal: 14,
        stacks: { user_a: 92, user_b: 88 },
        betThisRoundByUserId: { user_a: 4, user_b: 4 },
        toCallByUserId: { user_a: 0, user_b: 0 },
        actedThisRoundByUserId: { user_a: true, user_b: true },
        lastBettingRoundActionByUserId: { user_a: "call", user_b: "raise", ignored: "weird" },
        foldedByUserId: { user_a: false, user_b: false },
        leftTableByUserId: { user_a: false, user_b: false },
        sitOutByUserId: { user_a: false, user_b: false },
        holeCardsByUserId: { user_a: ["AH", "AD"], user_b: ["2C", "2D"] },
        handSeed: "sensitive",
        deck: ["QS"]
      }
    },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    userId: "user_a",
    youSeat: 1
  });

  assert.deepEqual(snapshot.lastBettingRoundActionByUserId, { user_a: "call", user_b: "raise" });
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
  assert.deepEqual(seated.showdown.revealedShowdownParticipants, [
    { userId: "seated_user", holeCards: ["AH", "AD"] },
    { userId: "other_user", holeCards: ["2C", "2D"] }
  ]);
  assert.deepEqual(seated.handSettlement.payouts, { other_user: 6 });
  assert.equal(observer.private, null);
  assert.equal(observer.showdown.potsAwarded[0].eligibleUserIds.includes("seated_user"), true);
  assert.deepEqual(seated.private, { userId: "seated_user", seat: 1, holeCards: ["AH", "AD"] });
});

test("projectRoomCoreSnapshot does not reveal showdown participant cards when hand ends by folds", () => {
  const snapshot = projectRoomCoreSnapshot({
    tableId: "table_settled_folded",
    roomId: "table_settled_folded",
    coreState: {
      seats: { user_a: 1, user_b: 2 },
      pokerState: {
        roomId: "table_settled_folded",
        handId: "hand_settled_folded",
        phase: "SETTLED",
        showdown: {
          handId: "hand_settled_folded",
          winners: ["user_a"],
          potsAwarded: [{ amount: 4, winners: ["user_a"] }],
          potAwardedTotal: 4,
          reason: "all_folded"
        },
        handSettlement: {
          handId: "hand_settled_folded",
          settledAt: "2026-03-01T00:00:00.000Z",
          payouts: { user_a: 4 }
        },
        holeCardsByUserId: { user_a: ["AS", "KH"], user_b: ["2C", "2D"] }
      }
    },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    userId: "user_a",
    youSeat: 1
  });

  assert.equal("revealedShowdownParticipants" in snapshot.showdown, false);
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
