import assert from "node:assert/strict";
import { applyAction, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

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
    { userId: "user-2", seatNo: 2 },
  ];
  const stacks = { "user-1": 100, "user-2": 100 };
  return { seats, stacks };
};

const run = async () => {
  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-timeout-check", seats, stacks, rng: makeRng(31) });
    const nowMs = 2000;
    const timeoutState = { ...state, turnStartedAt: 1000, turnDeadlineAt: 1500 };
    const timeoutResult = maybeApplyTurnTimeout({
      tableId: timeoutState.tableId,
      state: timeoutState,
      privateState: timeoutState,
      nowMs,
    });

    assert.equal(timeoutResult.applied, true);
    assert.equal(timeoutResult.action.type, "CHECK");
    assert.equal(timeoutResult.action.userId, timeoutState.turnUserId);
    assert.equal(timeoutResult.state.lastActionRequestIdByUserId[timeoutState.turnUserId], timeoutResult.requestId);
  }


  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-timeout-check-equality", seats, stacks, rng: makeRng(33) });
    const nowMs = 1500;
    const timeoutState = { ...state, turnStartedAt: 1000, turnDeadlineAt: 1500 };
    const timeoutResult = maybeApplyTurnTimeout({
      tableId: timeoutState.tableId,
      state: timeoutState,
      privateState: timeoutState,
      nowMs,
    });

    assert.equal(timeoutResult.applied, true);
    assert.equal(timeoutResult.action.type, "CHECK");
    assert.equal(timeoutResult.action.userId, timeoutState.turnUserId);
    assert.equal(timeoutResult.state.lastActionRequestIdByUserId[timeoutState.turnUserId], timeoutResult.requestId);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-timeout-fold", seats, stacks, rng: makeRng(32) });
    const betResult = applyAction(state, { type: "BET", userId: state.turnUserId, amount: 10 });
    const bettingState = betResult.state;
    assert.notEqual(bettingState.turnUserId, state.turnUserId);
    const nowMs = 5000;
    const timeoutState = { ...bettingState, turnStartedAt: 4000, turnDeadlineAt: 4500 };
    const timeoutResult = maybeApplyTurnTimeout({
      tableId: timeoutState.tableId,
      state: timeoutState,
      privateState: timeoutState,
      nowMs,
    });

    assert.equal(timeoutResult.applied, true);
    assert.equal(timeoutResult.action.type, "FOLD");
    assert.equal(timeoutResult.action.userId, timeoutState.turnUserId);
    assert.equal(timeoutResult.state.lastActionRequestIdByUserId[timeoutState.turnUserId], timeoutResult.requestId);
  }
};

await run();
