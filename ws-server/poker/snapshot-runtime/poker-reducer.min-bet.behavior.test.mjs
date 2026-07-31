import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, getLegalActions, initHandState } from "./poker-reducer.mjs";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const makeBase = () => {
  const seats = [
    { userId: "user-1", seatNo: 1 },
    { userId: "user-2", seatNo: 3 },
    { userId: "user-3", seatNo: 5 },
  ];
  const stacks = { "user-1": 100, "user-2": 100, "user-3": 100 };
  return { seats, stacks };
};

const makeFlop = (overrides = {}) => {
  const { seats, stacks } = makeBase();
  const { state } = initHandState({ tableId: "t-snap-bb", seats, stacks, rng: makeRng(41) });
  return {
    ...state,
    phase: "FLOP",
    community: ["3H", "4H", "5H"],
    communityDealt: 3,
    turnUserId: "user-1",
    currentBet: 0,
    lastRaiseSize: 10,
    bigBlind: 10,
    toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    betThisRoundByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    actedThisRoundByUserId: { "user-1": false, "user-2": false, "user-3": false },
    foldedByUserId: { "user-1": false, "user-2": false, "user-3": false },
    ...overrides,
  };
};

test("snapshot-runtime: opening BET below the big blind is rejected; at the big blind accepted", () => {
  const flop = makeFlop();
  const betAction = getLegalActions(flop, "user-1").find((action) => action.type === "BET");
  assert.equal(betAction.min, 10);

  assert.throws(
    () => applyAction(flop, { type: "BET", userId: "user-1", amount: 1 }),
    (error) => error?.message === "invalid_action"
  );

  const betResult = applyAction(flop, { type: "BET", userId: "user-1", amount: 10 });
  assert.equal(betResult.state.currentBet, 10);
  assert.equal(betResult.state.lastRaiseSize, 10);
});

test("snapshot-runtime: big-blind preflop option records the raised total as currentBet", () => {
  const { seats, stacks } = makeBase();
  const { state } = initHandState({ tableId: "t-snap-bb-option", seats, stacks, rng: makeRng(42) });
  const preflop = {
    ...state,
    phase: "PREFLOP",
    turnUserId: "user-1",
    currentBet: 10,
    lastRaiseSize: 10,
    bigBlind: 10,
    toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    betThisRoundByUserId: { "user-1": 10, "user-2": 10, "user-3": 10 },
    actedThisRoundByUserId: { "user-1": false, "user-2": true, "user-3": true },
    foldedByUserId: { "user-1": false, "user-2": false, "user-3": false },
    stacks: { "user-1": 90, "user-2": 90, "user-3": 90 },
  };

  const betResult = applyAction(preflop, { type: "BET", userId: "user-1", amount: 10 });
  assert.equal(betResult.state.betThisRoundByUserId["user-1"], 20);
  assert.equal(betResult.state.currentBet, 20);
  assert.equal(betResult.state.lastRaiseSize, 10);
  assert.equal(betResult.state.stacks["user-1"], 80);
  assert.equal(betResult.state.toCallByUserId["user-2"], 10);
  assert.equal(betResult.state.toCallByUserId["user-3"], 10);
});

test("snapshot-runtime: short all-in does not reopen RAISE for already-acted players", () => {
  const three = makeFlop({
    stacks: { "user-1": 100, "user-2": 100, "user-3": 13 },
  });
  const betA = applyAction(three, { type: "BET", userId: "user-1", amount: 10 });
  assert.equal(betA.state.currentBet, 10);
  const callB = applyAction(betA.state, { type: "CALL", userId: "user-2" });
  assert.equal(callB.state.currentBet, 10);
  const allInC = applyAction({ ...callB.state, stacks: { ...callB.state.stacks, "user-3": 13 } }, { type: "RAISE", userId: "user-3", amount: 13 });
  assert.equal(allInC.state.currentBet, 13);
  assert.equal(allInC.state.lastRaiseSize, 10);
  assert.deepEqual(getLegalActions(allInC.state, "user-1").map((action) => action.type), ["FOLD", "CALL"]);
});
