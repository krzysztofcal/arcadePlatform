import assert from "node:assert/strict";
import { advanceIfNeeded, applyLeaveTable, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const makeSeats = () => [
  { userId: "user-1", seatNo: 1 },
  { userId: "user-2", seatNo: 2 },
  { userId: "user-3", seatNo: 3 },
];

const makeStacks = () => ({ "user-1": 100, "user-2": 100, "user-3": 100 });

const run = async () => {
  {
    const { state } = initHandState({ tableId: "t-leave-rejoin-1", seats: makeSeats(), stacks: makeStacks(), rng: makeRng(11) });
    const turnState = { ...state, turnUserId: "user-1", turnNo: 1 };
    const left = applyLeaveTable(turnState, { userId: "user-2", requestId: "req-leave-1" });
    const settled = { ...left.state, phase: "SETTLED", dealerSeatNo: 1, turnUserId: null };
    const advanced = advanceIfNeeded(settled);

    assert.equal(advanced.state.holeCardsByUserId["user-2"], undefined);
    assert.notEqual(advanced.state.turnUserId, "user-2");
  }

  {
    const { state } = initHandState({ tableId: "t-leave-rejoin-2", seats: makeSeats(), stacks: makeStacks(), rng: makeRng(12) });
    const left = applyLeaveTable(state, { userId: "user-2", requestId: "req-leave-2" });
    const settled = { ...left.state, phase: "SETTLED", dealerSeatNo: 1, turnUserId: null };
    const advanced = advanceIfNeeded(settled);
    const rejoinedState = {
      ...advanced.state,
      phase: "SETTLED",
      turnUserId: null,
      leftTableByUserId: { ...advanced.state.leftTableByUserId, "user-2": false },
    };
    const rejoined = advanceIfNeeded(rejoinedState);

    assert.ok(rejoined.state.holeCardsByUserId["user-2"]);
    assert.equal(rejoined.state.leftTableByUserId?.["user-2"], false);
    assert.ok(["user-1", "user-2", "user-3"].includes(rejoined.state.turnUserId));
  }
};

await run();
