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
  assert.deepEqual(snapshot.turn, { userId: "user_a", seat: 1 });
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
  assert.deepEqual(observer.legalActions, { seat: null, actions: [] });
  assert.equal(observer.private, null);
});
