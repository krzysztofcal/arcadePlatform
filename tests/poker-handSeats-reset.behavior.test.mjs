import assert from "node:assert/strict";
import { resetToNextHand } from "../netlify/functions/_shared/poker-reducer.mjs";

const state = {
  tableId: "t-handseats-reset",
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

const result = resetToNextHand(state);

assert.equal(result.state.handSeats, null);
assert.ok(result.events.some((event) => event.type === "HAND_RESET_SKIPPED" && event.reason === "not_enough_players"));
