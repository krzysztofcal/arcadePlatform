import assert from "node:assert/strict";
import { applyAction, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const seats = [
  { userId: "u1", seatNo: 1 },
  { userId: "u2", seatNo: 2 },
];

const stacks = { u1: 100, u2: 100 };

const { state } = initHandState({ tableId: "table-left", seats, stacks, rng: makeRng(42) });
const input = {
  ...state,
  turnUserId: "u1",
  leftTableByUserId: { ...(state.leftTableByUserId || {}), u1: true },
};

assert.throws(
  () => applyAction(input, { type: "CHECK", userId: "u1", requestId: "rid-left-user" }),
  (error) => error?.message === "invalid_player"
);

assert.equal(input.turnUserId, "u1");
assert.equal(input.leftTableByUserId.u1, true);

process.stdout.write("poker-reducer left-player applyAction invalid-player unit test passed\n");
