import assert from "node:assert/strict";
import { applyAction, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";
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
  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-timeout-missed-twice", seats, stacks, rng: makeRng(61) });
    const first = applyTimeout(state, 2000);

    assert.equal(first.applied, true);
    const timeoutUserId = first.action.userId;

    const second = applyTimeout({ ...first.state, turnUserId: timeoutUserId }, 4000);

    assert.equal(second.applied, true);
    assert.equal(second.state.missedTurnsByUserId[timeoutUserId], 2);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-timeout-manual-reset", seats, stacks, rng: makeRng(62) });
    const timeoutResult = applyTimeout(state, 3000);
    const timeoutUserId = timeoutResult.action.userId;
    const manualState = { ...timeoutResult.state, turnUserId: timeoutUserId };
    const applied = applyAction(manualState, {
      type: "CHECK",
      userId: timeoutUserId,
      requestId: "req:manual",
    });

    assert.equal(applied.state.missedTurnsByUserId[timeoutUserId], 0);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-timeout-manual-clean", seats, stacks, rng: makeRng(63) });
    const applied = applyAction(state, {
      type: "CHECK",
      userId: state.turnUserId,
      requestId: "req:manual-clean",
    });

    assert.equal(applied.state.missedTurnsByUserId[state.turnUserId], 0);
  }
};

await run();
