import assert from "node:assert/strict";
import { advanceIfNeeded, applyAction, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";
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

const forceTimeout = (state, nowMs) => {
  const timeoutState = {
    ...state,
    turnStartedAt: nowMs - 1000,
    turnDeadlineAt: nowMs - 500,
  };
  const timeoutResult = maybeApplyTurnTimeout({
    tableId: timeoutState.tableId,
    state: timeoutState,
    privateState: timeoutState,
    nowMs,
  });
  assert.equal(timeoutResult.applied, true);
  const appliedPrivate = applyAction(timeoutState, { ...timeoutResult.action, requestId: timeoutResult.requestId });
  const nextState = {
    ...appliedPrivate.state,
    missedTurnsByUserId: timeoutResult.state.missedTurnsByUserId,
    sitOutByUserId: timeoutResult.state.sitOutByUserId,
    lastActionRequestIdByUserId: timeoutResult.state.lastActionRequestIdByUserId,
  };
  return { timeoutResult, state: nextState };
};

const run = async () => {
  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-timeouts", seats, stacks, rng: makeRng(11) });
    const first = forceTimeout(state, 2000);
    const timeoutUserId = first.timeoutResult.action.userId;
    assert.equal(first.timeoutResult.state.missedTurnsByUserId[timeoutUserId], 1);

    const manual = applyAction(first.state, {
      type: "CHECK",
      userId: first.state.turnUserId,
      requestId: "req:manual-check",
    });
    assert.equal(manual.state.turnUserId, timeoutUserId);
    const second = forceTimeout(manual.state, 4000);

    assert.equal(second.timeoutResult.state.sitOutByUserId[timeoutUserId], true);
  }

  {
    const seats = [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
      { userId: "user-3", seatNo: 3 },
    ];
    const stacks = { "user-1": 100, "user-2": 100, "user-3": 100 };
    const { state } = initHandState({ tableId: "t-sitout-skip", seats, stacks, rng: makeRng(22) });
    const settled = {
      ...state,
      phase: "SETTLED",
      turnUserId: null,
      sitOutByUserId: { "user-1": true },
    };
    const advanced = advanceIfNeeded(settled);

    assert.notEqual(advanced.state.turnUserId, "user-1");
    assert.notEqual(advanced.state.dealerSeatNo, 1);
    assert.equal(advanced.state.holeCardsByUserId["user-1"], undefined);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-clear", seats, stacks, rng: makeRng(33) });
    const withSitOut = {
      ...state,
      sitOutByUserId: { [state.turnUserId]: true },
    };
    const applied = applyAction(withSitOut, {
      type: "CHECK",
      userId: withSitOut.turnUserId,
      requestId: "req:manual",
    });

    assert.equal(applied.state.sitOutByUserId[withSitOut.turnUserId], false);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-fold", seats, stacks, rng: makeRng(44) });
    const withSitOut = {
      ...state,
      sitOutByUserId: { [state.turnUserId]: true },
    };
    const applied = applyAction(withSitOut, {
      type: "FOLD",
      userId: withSitOut.turnUserId,
      requestId: "req:manual-fold",
    });

    assert.equal(applied.state.sitOutByUserId[withSitOut.turnUserId], true);
  }
};

await run();
