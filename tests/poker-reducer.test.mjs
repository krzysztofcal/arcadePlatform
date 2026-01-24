import assert from "node:assert/strict";
import {
  advanceIfNeeded,
  applyAction,
  getLegalActions,
  initHandState,
} from "../netlify/functions/_shared/poker-reducer.mjs";

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

const run = async () => {
  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(1) });
    const actionsZero = getLegalActions(state, state.turnUserId).map((action) => action.type);
    assert.deepEqual(actionsZero, ["CHECK", "BET"]);

    const nextState = {
      ...state,
      toCallByUserId: { ...state.toCallByUserId, [state.turnUserId]: 5 },
    };
    const actionsCall = getLegalActions(nextState, state.turnUserId).map((action) => action.type);
    assert.deepEqual(actionsCall, ["FOLD", "CALL", "RAISE"]);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(2) });
    assert.deepEqual(getLegalActions(state, "user-3"), []);
    assert.throws(
      () => applyAction(state, { type: "CHECK", userId: "user-3" }),
      (error) => error?.message === "invalid_action"
    );
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(5) });
    const noTurnState = { ...state, turnUserId: null };
    assert.deepEqual(getLegalActions(noTurnState, "user-1"), []);
    assert.throws(
      () => applyAction(noTurnState, { type: "CHECK", userId: "user-1" }),
      (error) => error?.message === "invalid_action"
    );
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(8) });
    assert.throws(
      () => applyAction(state, { type: "CHECK", userId: "user-not-turn" }),
      (error) => error?.message === "invalid_action"
    );
  }

  {
    const seats = [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 3 },
      { userId: "user-3", seatNo: 5 },
    ];
    const stacks = { "user-1": 0, "user-2": 50, "user-3": 50 };
    const { state } = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(10) });
    assert.notEqual(state.turnUserId, "user-1");
    assert.ok(["user-2", "user-3"].includes(state.turnUserId));
  }

  {
    const { seats, stacks } = makeBase();
    let result = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(3) });
    let state = { ...result.state, turnUserId: "user-1" };

    result = applyAction(state, { type: "BET", userId: "user-1", amount: 10 });
    state = result.state;
    assert.equal(state.pot, 10);
    assert.equal(state.stacks["user-1"], 90);
    assert.equal(state.toCallByUserId["user-2"], 10);
    assert.equal(state.toCallByUserId["user-3"], 10);

    result = applyAction(state, { type: "CALL", userId: "user-2" });
    state = result.state;
    assert.equal(state.pot, 20);
    assert.equal(state.stacks["user-2"], 90);
    assert.equal(state.toCallByUserId["user-2"], 0);

    result = applyAction(state, { type: "FOLD", userId: "user-3" });
    state = result.state;
    assert.equal(state.foldedByUserId["user-3"], true);
  }

  {
    const { seats, stacks } = makeBase();
    let result = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(4) });
    let state = { ...result.state, turnUserId: "user-1" };
    result = applyAction(state, { type: "BET", userId: "user-1", amount: 10 });
    state = result.state;
    result = applyAction(state, { type: "CALL", userId: "user-2" });
    state = result.state;
    result = applyAction(state, { type: "FOLD", userId: "user-3" });
    state = result.state;

    const advanced = advanceIfNeeded(state);
    state = advanced.state;
    assert.equal(state.phase, "FLOP");
    assert.equal(state.community.length, 3);
    assert.equal(state.toCallByUserId["user-1"], 0);
    assert.equal(state.betThisRoundByUserId["user-1"], 0);
    assert.equal(state.actedThisRoundByUserId["user-1"], false);
  }

  {
    const { seats, stacks } = makeBase();
    let result = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(6) });
    let state = { ...result.state, turnUserId: "user-1" };

    result = applyAction(state, { type: "FOLD", userId: "user-1" });
    state = result.state;
    result = applyAction(state, { type: "FOLD", userId: "user-2" });
    state = result.state;
    assert.equal(state.phase, "HAND_DONE");
    assert.ok(result.events.some((event) => event.type === "HAND_DONE" && event.winnerUserId === "user-3"));
  }

  {
    const seats = [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 3 },
      { userId: "user-3", seatNo: 5 },
    ];
    const stacks = { "user-1": 100, "user-2": 100, "user-3": 3 };
    let result = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(7) });
    let state = { ...result.state, turnUserId: "user-1" };

    result = applyAction(state, { type: "BET", userId: "user-1", amount: 10 });
    state = result.state;
    result = applyAction(state, { type: "CALL", userId: "user-2" });
    state = result.state;
    result = applyAction(state, { type: "CALL", userId: "user-3" });
    state = result.state;

    const advanced = advanceIfNeeded(state);
    state = advanced.state;
    assert.equal(state.phase, "FLOP");
    assert.equal(state.community.length, 3);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(9) });
    const brokeUser = state.seats[0].userId;
    const bettingUsers = state.seats.slice(1).map((seat) => seat.userId);
    const nextState = {
      ...state,
      phase: "PREFLOP",
      stacks: { ...state.stacks, [brokeUser]: 0 },
      foldedByUserId: { ...state.foldedByUserId, [brokeUser]: false },
      actedThisRoundByUserId: {
        ...state.actedThisRoundByUserId,
        [brokeUser]: false,
        [bettingUsers[0]]: true,
        [bettingUsers[1]]: true,
      },
      toCallByUserId: {
        ...state.toCallByUserId,
        [brokeUser]: 0,
        [bettingUsers[0]]: 0,
        [bettingUsers[1]]: 0,
      },
    };
    const advanced = advanceIfNeeded(nextState);
    assert.equal(advanced.state.phase, "FLOP");
  }

  {
    const { seats } = makeBase();
    const stacks = { "user-1": 0, "user-2": 0, "user-3": 0 };
    const { state } = initHandState({ tableId: "t1", seats, stacks, rng: makeRng(11) });
    const stuckState = {
      ...state,
      phase: "PREFLOP",
      stacks,
      foldedByUserId: {
        ...state.foldedByUserId,
        "user-1": false,
        "user-2": false,
        "user-3": false,
      },
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
    };
    const advanced = advanceIfNeeded(stuckState);
    assert.equal(advanced.state.phase, "SHOWDOWN");
    assert.equal(advanced.state.turnUserId, null);
    assert.ok(advanced.events.some((event) => event.type === "SHOWDOWN_STARTED"));
  }
};

await run();
