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
