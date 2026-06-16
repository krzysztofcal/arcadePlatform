import assert from "node:assert/strict";
import { initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const makeBase = () => {
  const seats = [
    { userId: "user-1", seatNo: 1 },
    { userId: "user-2", seatNo: 2 },
  ];
  const stacks = { "user-1": 100, "user-2": 100 };
  return { seats, stacks };
};

const applyTimeout = (state, nowMs) =>
  maybeApplyTurnTimeout({
    tableId: state.tableId,
    state: { ...state, turnStartedAt: nowMs - 1000, turnDeadlineAt: nowMs - 500 },
    privateState: state,
    nowMs,
  });

const run = async () => {
  const { seats, stacks } = makeBase();
  const { state } = initHandState({ tableId: "t-timeout-no-effects", seats, stacks, rng: makeRng(71) });
  const baseState = {
    ...state,
    sitOutByUserId: { "user-2": true },
    leftTableByUserId: { "user-2": true },
  };
  const result = applyTimeout(baseState, 2000);

  assert.equal(result.applied, true);
  assert.equal(result.state.sitOutByUserId?.["user-2"], true);
  assert.equal(result.state.leftTableByUserId?.["user-2"], true);
  assert.equal(result.state.sitOutByUserId?.[result.action.userId], undefined);
  assert.equal(result.state.leftTableByUserId?.[result.action.userId], undefined);
};

await run();
