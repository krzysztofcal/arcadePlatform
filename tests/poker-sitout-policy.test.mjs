import assert from "node:assert/strict";
import { MISSED_TURN_THRESHOLD, applyInactivityPolicy } from "../netlify/functions/_shared/poker-inactivity-policy.mjs";
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

const makeTimedOutState = (state, nowMs) => ({
  ...state,
  turnStartedAt: nowMs - 1000,
  turnDeadlineAt: nowMs - 500,
});

const runTimeout = (state, nowMs) => {
  const timeoutState = makeTimedOutState(state, nowMs);
  const result = maybeApplyTurnTimeout({
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

  {
    const { seats, stacks } = makeBase();
    const { state } = initHandState({ tableId: "t-sitout-timeouts-2", seats, stacks, rng: makeRng(12) });
    const timeoutUserId = state.turnUserId;
    const withMissed = {
      ...state,
      missedTurnsByUserId: { [timeoutUserId]: 1 },
    };
    const second = runTimeout(withMissed, 4000);

    assert.equal(second.result.state.missedTurnsByUserId[timeoutUserId], MISSED_TURN_THRESHOLD);
    assert.equal(second.result.state.sitOutByUserId?.[timeoutUserId], undefined);
    assert.equal(second.result.state.pendingAutoSitOutByUserId?.[timeoutUserId], true);
    assert.ok(
      second.result.events.some(
        (event) =>
          event.type === "PLAYER_AUTO_SITOUT_PENDING" &&
          event.userId === timeoutUserId &&
          event.missedTurns === MISSED_TURN_THRESHOLD
      )
    );
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
      missedTurnsByUserId: { "user-2": 2 },
    };
    const advanced = advanceIfNeeded(settled);

    assert.ok(
      advanced.events.some((event) => event.type === "HAND_RESET_SKIPPED" && event.reason === "not_enough_players")
    );
    assert.ok(!advanced.events.some((event) => event.type === "HAND_RESET"));
    assert.equal(advanced.state.handId, settled.handId);
    assert.equal(advanced.state.pendingAutoSitOutByUserId?.["user-2"], undefined);
    assert.equal(Object.keys(advanced.state.missedTurnsByUserId || {}).length, 0);
    assert.equal(advanced.state.sitOutByUserId?.["user-2"], true);
  }
};

await run();
