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
    const { state } = initHandState({ tableId: "t1", seats: makeSeats(), stacks: makeStacks(), rng: makeRng(11) });
    const turnState = { ...state, turnUserId: "user-1", turnNo: 1 };
    const result = applyLeaveTable(turnState, { userId: "user-1", requestId: "req-1" });
    const nextState = result.state;

    assert.equal(nextState.leftTableByUserId["user-1"], true);
    assert.equal(nextState.sitOutByUserId["user-1"], false);
    assert.equal(nextState.missedTurnsByUserId["user-1"], 0);
    assert.equal(nextState.turnUserId, "user-2");
    assert.ok(result.events.some((event) => event.type === "PLAYER_LEFT_TABLE"));
    assert.ok(
      result.events.some(
        (event) => event.type === "TURN_SKIPPED_BY_LEAVE" && event.fromUserId === "user-1" && event.toUserId === "user-2"
      )
    );
  }

  {
    const base = initHandState({ tableId: "t2", seats: makeSeats(), stacks: makeStacks(), rng: makeRng(22) });
    const settled = {
      ...base.state,
      phase: "SETTLED",
      dealerSeatNo: 1,
      leftTableByUserId: { "user-1": true },
    };
    const advanced = advanceIfNeeded(settled);
    const nextState = advanced.state;

    assert.equal(nextState.dealerSeatNo, 2);
    assert.notEqual(nextState.turnUserId, "user-1");
    assert.equal(nextState.holeCardsByUserId["user-1"], undefined);
  }

  {
    const seats = [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
    ];
    const stacks = { "user-1": 100, "user-2": 100 };
    const base = initHandState({ tableId: "t3", seats, stacks, rng: makeRng(33) });
    const settled = {
      ...base.state,
      phase: "SETTLED",
      dealerSeatNo: 1,
      leftTableByUserId: { "user-1": true },
    };
    const advanced = advanceIfNeeded(settled);

    assert.ok(advanced.events.some((event) => event.type === "HAND_RESET_SKIPPED" && event.reason === "not_enough_players"));
    assert.ok(!advanced.events.some((event) => event.type === "HAND_RESET"));
  }

  {
    const { state } = initHandState({ tableId: "t4", seats: makeSeats(), stacks: makeStacks(), rng: makeRng(44) });
    const turnState = { ...state, turnUserId: "user-1", turnNo: 1 };
    const first = applyLeaveTable(turnState, { userId: "user-1", requestId: "req-2" });
    const second = applyLeaveTable(first.state, { userId: "user-1", requestId: "req-3" });

    assert.equal(second.state.leftTableByUserId["user-1"], true);
    assert.equal(second.state.sitOutByUserId["user-1"], false);
    assert.equal(second.state.missedTurnsByUserId["user-1"], 0);
  }
};

await run();
