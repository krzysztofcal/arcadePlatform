import assert from "node:assert/strict";
import { __testOnly_resetToNextHand } from "../netlify/functions/_shared/poker-reducer.mjs";

const assertSkippedAndCleared = (result) => {
  assert.equal(result.state.handSeats, null);
  assert.ok(result.events.some((event) => event.type === "HAND_RESET_SKIPPED" && event.reason === "not_enough_players"));
};

{
  const state = {
    tableId: "t-handseats-reset-empty",
    phase: "SETTLED",
    seats: [],
    handSeats: [{ userId: "u1", seatNo: 1 }],
    stacks: {},
    sitOutByUserId: {},
    pendingAutoSitOutByUserId: {},
    leftTableByUserId: {},
    dealerSeatNo: 1,
    turnNo: 1,
  };

  const result = __testOnly_resetToNextHand(state);
  assertSkippedAndCleared(result);
}

{
  const state = {
    tableId: "t-handseats-reset-eligible",
    phase: "SETTLED",
    seats: [{ userId: "u1", seatNo: 1 }],
    handSeats: [{ userId: "u1", seatNo: 1 }],
    stacks: { u1: 100 },
    sitOutByUserId: {},
    pendingAutoSitOutByUserId: {},
    leftTableByUserId: {},
    dealerSeatNo: 1,
    turnNo: 1,
  };

  const result = __testOnly_resetToNextHand(state);
  assertSkippedAndCleared(result);
}

{
  const state = {
    tableId: "t-handseats-reset-waiting",
    phase: "SETTLED",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 }
    ],
    handSeats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 }
    ],
    stacks: { u1: 100, u2: 140 },
    sitOutByUserId: { u1: false, u2: false },
    pendingAutoSitOutByUserId: {},
    waitingForNextHandByUserId: { u1: true },
    leftTableByUserId: { u1: true, u2: false },
    dealerSeatNo: 1,
    turnNo: 1,
  };

  const result = __testOnly_resetToNextHand(state, { rng: () => 0.5 });
  assert.equal(result.state.phase, "PREFLOP");
  assert.equal(result.state.leftTableByUserId.u1, false);
  assert.deepEqual(result.state.waitingForNextHandByUserId, {});
  assert.equal(Array.isArray(result.state.holeCardsByUserId.u1), true);
  assert.equal(result.state.holeCardsByUserId.u1.length, 2);
  assert.ok(result.events.some((event) => event.type === "HAND_RESET"));
}
