import assert from "node:assert/strict";
import { advanceIfNeeded, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const makeBaseState = (tableId) =>
  initHandState({
    tableId,
    seats: [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
      { userId: "user-3", seatNo: 3 },
    ],
    stacks: { "user-1": 100, "user-2": 100, "user-3": 100 },
    rng: makeRng(101),
  }).state;

const markRoundComplete = (state) => ({
  ...state,
  phase: "PREFLOP",
  dealerSeatNo: 1,
  toCallByUserId: {
    ...state.toCallByUserId,
    "user-1": 0,
    "user-2": 0,
    "user-3": 0,
  },
  actedThisRoundByUserId: {
    ...state.actedThisRoundByUserId,
    "user-1": true,
    "user-2": true,
    "user-3": true,
  },
});

const run = async () => {
  {
    const base = makeBaseState("t1");
    const state = markRoundComplete({
      ...base,
      sitOutByUserId: { "user-2": true },
    });
    const advanced = advanceIfNeeded(state);
    assert.equal(advanced.state.phase, "FLOP");
    assert.notEqual(advanced.state.turnUserId, "user-2");
  }

  {
    const base = makeBaseState("t2");
    const state = markRoundComplete({
      ...base,
      leftTableByUserId: { "user-2": true },
    });
    const advanced = advanceIfNeeded(state);
    assert.equal(advanced.state.phase, "FLOP");
    assert.notEqual(advanced.state.turnUserId, "user-2");
  }

  {
    const state = initHandState({
      tableId: "t3",
      seats: [
        { userId: "user-1", seatNo: 1 },
        { userId: "user-2", seatNo: 2 },
      ],
      stacks: { "user-1": 100, "user-2": 100 },
      rng: makeRng(202),
    }).state;
    const roundComplete = {
      ...state,
      phase: "PREFLOP",
      dealerSeatNo: 1,
      sitOutByUserId: { "user-1": true, "user-2": true },
      toCallByUserId: { "user-1": 0, "user-2": 0 },
      actedThisRoundByUserId: { "user-1": true, "user-2": true },
    };
    const advanced = advanceIfNeeded(roundComplete);
    assert.equal(advanced.state.phase, "FLOP");
    assert.equal(advanced.state.turnUserId, null);
  }
};

await run();
