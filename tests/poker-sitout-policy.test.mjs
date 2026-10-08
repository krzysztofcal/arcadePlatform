import assert from "node:assert/strict";
import { MISSED_TURN_THRESHOLD, applyInactivityPolicy } from "../netlify/functions/_shared/poker-inactivity-policy.mjs";
import { advanceIfNeeded, applyAction, initHandState } from "../netlify/functions/_shared/poker-reducer.mjs";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";
import * as wsReducer from "../ws-server/poker/snapshot-runtime/poker-reducer.mjs";
import { maybeApplyTurnTimeout as wsTurnTimeout } from "../ws-server/poker/snapshot-runtime/poker-turn-timeout.mjs";

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

const makeTimedOutState = (state, nowMs) => ({
  ...state,
  turnStartedAt: nowMs - 1000,
  turnDeadlineAt: nowMs - 500,
});

const runTimeout = (state, nowMs, applyTimeout = maybeApplyTurnTimeout) => {
  const timeoutState = makeTimedOutState(state, nowMs);
  const result = applyTimeout({
    tableId: timeoutState.tableId,
    state: timeoutState,
    privateState: timeoutState,
    nowMs,
  });
  assert.equal(result.applied, true);
  return { timeoutState, result };
};

const run = async () => {
  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-timeouts", seats, stacks, rng: makeRng(11) });
    const first = runTimeout(state, 2000);
    const timeoutUserId = first.result.action.userId;

    assert.equal(first.result.state.missedTurnsByUserId[timeoutUserId], 1);
    assert.notEqual(first.result.state.sitOutByUserId?.[timeoutUserId], true);
  }

  for (const reducer of [
    { initHandState, applyAction, advanceIfNeeded, timeout: maybeApplyTurnTimeout },
    { ...wsReducer, timeout: wsTurnTimeout },
  ]) {
    const seats = [1, 2, 3].map(n => ({ userId: "user-" + n, seatNo: n }));
    const stacks = Object.fromEntries(seats.map(seat => [seat.userId, 100]));
    let { state } = reducer.initHandState({ tableId: "t-sitout-cross-hand", seats, stacks, rng: makeRng(12) });
    state.handId = "sitout-first-hand";
    const first = runTimeout(state, 4000, reducer.timeout);
    const inactive = first.result.action.userId;
    state = first.result.state;
    while (state.phase !== "HAND_DONE" && state.phase !== "SHOWDOWN" && state.phase !== "SETTLED") {
      state = reducer.applyAction(state, { type: "FOLD", userId: state.turnUserId, requestId: "finish-first:" + state.turnNo }).state;
    }
    state = materializeShowdownAndPayout({ state, seatUserIdsInOrder: seats.map(seat => seat.userId), holeCardsByUserId: state.holeCardsByUserId, awardPotsAtShowdown }).nextState;
    assert.equal(state.phase, "SETTLED");
    const firstHand = state.handId;
    state = reducer.advanceIfNeeded(state).state;
    assert.notEqual(state.handId, firstHand);
    assert.equal(state.missedTurnsByUserId[inactive], 1, "first timeout evidence must survive real next-hand reset");
    while (state.turnUserId !== inactive) {
      state = reducer.applyAction(state, { type: "CHECK", userId: state.turnUserId, requestId: "next-turn:" + state.turnNo }).state;
    }
    const second = runTimeout(state, 6000, reducer.timeout);
    assert.equal(second.result.state.missedTurnsByUserId[inactive], MISSED_TURN_THRESHOLD);
    assert.equal(second.result.state.pendingAutoSitOutByUserId[inactive], true);
    assert.notEqual(second.result.state.sitOutByUserId[inactive], true, "sitout waits for the safe boundary");
    assert.ok(second.result.events.some(event => event.type === "PLAYER_AUTO_SITOUT_PENDING" && event.userId === inactive));
    state = second.result.state;
    while (state.phase !== "HAND_DONE" && state.phase !== "SHOWDOWN" && state.phase !== "SETTLED") {
      state = reducer.applyAction(state, { type: "FOLD", userId: state.turnUserId, requestId: "finish-second:" + state.turnNo }).state;
    }
    state = materializeShowdownAndPayout({ state, seatUserIdsInOrder: seats.map(seat => seat.userId), holeCardsByUserId: state.holeCardsByUserId, awardPotsAtShowdown }).nextState;
    assert.equal(state.phase, "SETTLED");
    state = reducer.advanceIfNeeded(state).state;
    assert.equal(state.sitOutByUserId[inactive], true);
    assert.equal(state.holeCardsByUserId[inactive], undefined, "sat-out player receives no later hand cards");
    assert.notEqual(state.turnUserId, inactive);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-pending-idempotent", seats, stacks, rng: makeRng(18) });
    const timeoutUserId = state.turnUserId;
    const withMissed = {
      ...state,
      missedTurnsByUserId: { [timeoutUserId]: MISSED_TURN_THRESHOLD },
    };
    const first = applyInactivityPolicy(withMissed, []);
    const second = applyInactivityPolicy(first.state, first.events);

    const pendingEvents = second.events.filter(
      (event) =>
        event.type === "PLAYER_AUTO_SITOUT_PENDING" &&
        event.userId === timeoutUserId &&
        event.missedTurns === MISSED_TURN_THRESHOLD
    );
    assert.equal(pendingEvents.length, 1);
    assert.equal(second.state.pendingAutoSitOutByUserId?.[timeoutUserId], true);
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

    assert.ok(advanced.events.some((event) => event.type === "HAND_RESET"));
    assert.notEqual(advanced.state.turnUserId, "user-1");
    assert.notEqual(advanced.state.dealerSeatNo, 1);
    assert.equal(advanced.state.holeCardsByUserId["user-1"], undefined);
    assert.equal(advanced.state.foldedByUserId["user-1"], false);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-clear", seats, stacks, rng: makeRng(33) });
    const withSitOut = {
      ...state,
      sitOutByUserId: { [state.turnUserId]: true },
      pendingAutoSitOutByUserId: { [state.turnUserId]: true },
    };
    const applied = applyAction(withSitOut, {
      type: "CHECK",
      userId: withSitOut.turnUserId,
      requestId: "req:manual",
    });

    assert.equal(applied.state.sitOutByUserId[withSitOut.turnUserId], false);
    assert.equal(applied.state.pendingAutoSitOutByUserId?.[withSitOut.turnUserId], undefined);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-fold", seats, stacks, rng: makeRng(44) });
    const withSitOut = {
      ...state,
      sitOutByUserId: { [state.turnUserId]: true },
      pendingAutoSitOutByUserId: { [state.turnUserId]: true },
    };
    const applied = applyAction(withSitOut, {
      type: "FOLD",
      userId: withSitOut.turnUserId,
      requestId: "req:manual-fold",
    });

    assert.equal(applied.state.sitOutByUserId[withSitOut.turnUserId], true);
    assert.equal(applied.state.pendingAutoSitOutByUserId?.[withSitOut.turnUserId], true);
  }

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-skip-two", seats, stacks, rng: makeRng(55) });
    const settled = {
      ...state,
      phase: "SETTLED",
      turnUserId: null,
      sitOutByUserId: { "user-1": true },
      pendingAutoSitOutByUserId: { "user-2": true },
      missedTurnsByUserId: { "user-2": 2, "user-1": 1, "removed-user": 1 },
      leftTableByUserId: { "user-1": true },
    };
    const advanced = advanceIfNeeded(settled);

    assert.ok(
      advanced.events.some((event) => event.type === "HAND_RESET_SKIPPED" && event.reason === "not_enough_players")
    );
    assert.ok(!advanced.events.some((event) => event.type === "HAND_RESET"));
    assert.equal(advanced.state.handId, settled.handId);
    assert.equal(advanced.state.pendingAutoSitOutByUserId?.["user-2"], undefined);
    assert.deepEqual(advanced.state.missedTurnsByUserId, { "user-2": 2 });
    assert.equal(advanced.state.sitOutByUserId?.["user-2"], true);
  }
};

await run();
