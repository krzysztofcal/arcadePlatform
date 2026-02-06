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

const run = async () => {
  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-missed-turns", seats, stacks, rng: makeRng(101) });
    const nowMs = 2000;
    const timeoutState = {
      ...state,
      turnStartedAt: 1000,
      turnDeadlineAt: 1500,
      missedTurnsByUserId: {},
    };
    const timeoutResult = maybeApplyTurnTimeout({
      tableId: timeoutState.tableId,
      state: timeoutState,
      privateState: timeoutState,
      nowMs,
    });

    assert.equal(timeoutResult.applied, true);
    assert.equal(timeoutResult.state.missedTurnsByUserId[timeoutState.turnUserId], 1);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-missed-reset", seats, stacks, rng: makeRng(202) });
    const withMissed = {
      ...state,
      missedTurnsByUserId: { [state.turnUserId]: 3 },
    };
    const applied = applyAction(withMissed, { type: "CHECK", userId: state.turnUserId, requestId: "req:1" });

    assert.equal(applied.state.missedTurnsByUserId[state.turnUserId], 0);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-missed-reset-hand", seats, stacks, rng: makeRng(303) });
    const doneState = {
      ...state,
      phase: "HAND_DONE",
      missedTurnsByUserId: { "user-1": 2, "user-2": 1 },
    };
    const advanced = advanceIfNeeded(doneState);

    assert.equal(Object.keys(advanced.state.missedTurnsByUserId || {}).length, 0);
    assert.ok(advanced.events.some((event) => event.type === "HAND_RESET"));
  }
};

await run();
