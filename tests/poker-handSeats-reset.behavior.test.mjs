import assert from "node:assert/strict";
import { advanceIfNeeded, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const seats = [
  { userId: "user-1", seatNo: 1 },
  { userId: "user-2", seatNo: 2 },
];
const stacks = { "user-1": 0, "user-2": 100 };
const { state } = initHandState({ tableId: "t-handseats-reset", seats, stacks, rng: makeRng(123) });
const settled = {
  ...state,
  phase: "SETTLED",
  turnUserId: null,
  handSeats: seats.slice(),
  stacks,
};

const result = advanceIfNeeded(settled);

assert.equal(result.state.handSeats, null);
assert.deepEqual(result.state.seats, seats);
assert.deepEqual(result.state.stacks, stacks);
assert.ok(result.events.some((event) => event.type === "HAND_RESET_SKIPPED"));
