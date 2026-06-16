import assert from "node:assert/strict";
import { advanceIfNeeded, applyAction, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const run = async () => {
  {
    const seats = [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
      { userId: "user-3", seatNo: 3 },
    ];
    const stacks = { "user-1": 100, "user-2": 100, "user-3": 100 };
    const { state } = initHandState({ tableId: "t-sitout-turn", seats, stacks, rng: makeRng(91) });
    const withSitOut = {
      ...state,
      turnUserId: "user-1",
      sitOutByUserId: { "user-2": true },
    };
    const applied = applyAction(withSitOut, { type: "CHECK", userId: "user-1", requestId: "req-turn-skip" });

    assert.equal(applied.state.turnUserId, "user-3");
  }

  {
    const seats = [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
    ];
    const stacks = { "user-1": 100, "user-2": 100 };
    const { state } = initHandState({ tableId: "t-sitout-init", seats, stacks, rng: makeRng(92) });
    const settled = {
      ...state,
      phase: "SETTLED",
      turnUserId: null,
      sitOutByUserId: { "user-2": true },
    };
    const advanced = advanceIfNeeded(settled);

    assert.equal(advanced.state.phase, "SETTLED");
    assert.ok(
      advanced.events.some((event) => event.type === "HAND_RESET_SKIPPED" && event.reason === "not_enough_players")
    );
  }
};

await run();
