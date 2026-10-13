import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCoreStateAction,
  applyCoreStateTurnTimeout,
  bootstrapCoreStateHand,
  buildNextHandStateFromSettled,
  decideCoreStateTurnTimeout
} from "./poker-engine.mjs";

import { stampTurnDeadline } from "../shared/poker-turn-timeout.mjs";

function initialCore() {
  return {
    roomId: "table_engine_timeout",
    version: 0,
    seats: { user_a: 1, user_b: 2 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    publicStacks: { user_a: 100, user_b: 100 },
    pokerState: null
  };
}

test("engine timeout apply is idempotent when invoked twice at same clock", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_timeout", coreState: initialCore(), nowMs: 1000 });
  const deadline = boot.coreState.pokerState.turnDeadlineAt;

  const first = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: boot.coreState,
    nowMs: deadline + 1
  });
  assert.equal(first.changed, true);

  const second = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: first.coreState,
    nowMs: deadline + 1
  });
  assert.equal(second.changed, false);
  assert.notEqual(first.stateVersion, boot.coreState.version);
  assert.equal(second.stateVersion, first.stateVersion);
});

test("timeout decision chooses actor/action deterministically for due timeout", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_timeout", coreState: initialCore(), nowMs: 2_000 });
  const deadline = boot.coreState.pokerState.turnDeadlineAt;

  const decision = decideCoreStateTurnTimeout({ coreState: boot.coreState, nowMs: deadline + 1 });
  assert.equal(decision.due, true);
  assert.equal(decision.decision.actorUserId, "user_a");
  assert.equal(decision.decision.action.type, "FOLD");

  const applied = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: boot.coreState,
    nowMs: deadline + 1
  });

  assert.equal(applied.changed, true);
  assert.equal(applied.actorUserId, "user_a");
  assert.equal(applied.action, "FOLD");
  assert.equal(applied.stateVersion, boot.coreState.version + 1);
});

test("timeout is stable no-op when not due or no live hand exists", () => {
  const coreNoHand = initialCore();
  const noHandDecision = decideCoreStateTurnTimeout({ coreState: coreNoHand, nowMs: 1_000 });
  assert.equal(noHandDecision.due, false);
  assert.equal(noHandDecision.reason, "hand_not_live");

  const noHandApply = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: coreNoHand,
    nowMs: 1_000
  });
  assert.equal(noHandApply.changed, false);
  assert.equal(noHandApply.reason, "hand_not_live");
  assert.equal(noHandApply.stateVersion, coreNoHand.version);

  const boot = bootstrapCoreStateHand({ tableId: "table_engine_timeout", coreState: initialCore(), nowMs: 3_000 });
  const notDueDecision = decideCoreStateTurnTimeout({ coreState: boot.coreState, nowMs: 3_001 });
  assert.equal(notDueDecision.due, false);
  assert.equal(notDueDecision.reason, "deadline_unexpired");

  const notDueApply = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: boot.coreState,
    nowMs: 3_001
  });
  assert.equal(notDueApply.changed, false);
  assert.equal(notDueApply.reason, "deadline_unexpired");
  assert.equal(notDueApply.stateVersion, boot.coreState.version);
});

test("repeat timeout sweep at identical clock cannot double-apply same turn", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_timeout", coreState: initialCore(), nowMs: 5_000 });
  const deadline = boot.coreState.pokerState.turnDeadlineAt;
  const sweepNow = deadline + 1;

  const first = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: boot.coreState,
    nowMs: sweepNow
  });
  assert.equal(first.changed, true);

  const second = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: first.coreState,
    nowMs: sweepNow
  });

  assert.equal(second.changed, false);
  assert.equal(second.stateVersion, first.stateVersion);

  const third = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: first.coreState,
    nowMs: sweepNow
  });
  assert.equal(third.changed, false);
  assert.equal(third.stateVersion, first.stateVersion);
});

test("timeout on a turn with legal CHECK applies CHECK and advances turn", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_timeout", coreState: initialCore(), nowMs: 8_000 });

  const called = applyCoreStateAction({
    tableId: "table_engine_timeout",
    coreState: boot.coreState,
    handId: boot.coreState.pokerState.handId,
    userId: boot.coreState.pokerState.turnUserId,
    action: "CALL",
    nowIso: new Date(8_001).toISOString(),
    nowMs: 8_001
  });

  const flopState = called.coreState;
  const deadline = flopState.pokerState.turnDeadlineAt;
  const dueDecision = decideCoreStateTurnTimeout({ coreState: flopState, nowMs: deadline + 1 });
  assert.equal(dueDecision.due, true);
  assert.equal(dueDecision.decision.action.type, "CHECK");

  const timeout = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: flopState,
    nowMs: deadline + 1
  });

  assert.equal(timeout.changed, true);
  assert.equal(timeout.action, "CHECK");
  assert.equal(timeout.coreState.pokerState.missedTurnsByUserId.user_b, 1);
  assert.equal(timeout.actorUserId, "user_b");
  assert.equal(timeout.coreState.pokerState.phase, "FLOP");
  assert.equal(timeout.coreState.pokerState.turnUserId, "user_a");
});

test("timeout can fold a deferred-leave human even when runtime membership already excludes them", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_timeout", coreState: initialCore(), nowMs: 10_000 });
  const actorUserId = boot.coreState.pokerState.turnUserId;
  const actorSeat = boot.coreState.seats[actorUserId];
  const deadline = boot.coreState.pokerState.turnDeadlineAt;

  const deferredCore = {
    ...boot.coreState,
    seats: { user_b: 2 },
    members: [{ userId: "user_b", seat: 2 }],
    pokerState: {
      ...boot.coreState.pokerState,
      leftTableByUserId: { [actorUserId]: true }
    }
  };

  const timeout = applyCoreStateTurnTimeout({
    tableId: "table_engine_timeout",
    coreState: deferredCore,
    nowMs: deadline + 1
  });

  assert.equal(timeout.changed, true);
  assert.equal(timeout.actorUserId, actorUserId);
  assert.equal(timeout.action, "FOLD");
  assert.equal(timeout.coreState.pokerState.foldedByUserId[actorUserId], true);
  assert.equal(timeout.coreState.pokerState.leftTableByUserId[actorUserId], true);
  assert.equal(timeout.coreState.seats[actorUserId], undefined);
  assert.equal(timeout.coreState.members.some((member) => member.userId === actorUserId), false);
  assert.equal(timeout.coreState.pokerState.phase, "SETTLED");
  assert.equal(timeout.coreState.pokerState.turnUserId, null);
  assert.equal(actorSeat, 1);
});


test("authoritative timeouts survive hand boundaries, commit sitout safely, and manual activity resets penalty", () => {
  const tableId = "table_engine_timeout";
  const initial = initialCore();
  initial.seats.user_c = 3;
  initial.members.push({ userId: "user_c", seat: 3 });
  initial.publicStacks.user_c = 100;
  let core = bootstrapCoreStateHand({ tableId, coreState: initial, nowMs: 1000 }).coreState;
  const inactive = core.pokerState.turnUserId;
  const first = applyCoreStateTurnTimeout({ tableId, coreState: core, nowMs: core.pokerState.turnDeadlineAt + 1 });
  core = first.coreState;
  assert.equal(core.pokerState.missedTurnsByUserId?.[inactive], 1);
  assert.equal(applyCoreStateTurnTimeout({ tableId, coreState: core, nowMs: core.pokerState.turnStartedAt }).changed, false);

  function act(current, userId, action) {
    const result = applyCoreStateAction({ tableId, coreState: current, handId: current.pokerState.handId, userId, action, nowMs: 2000 });
    assert.equal(result.accepted, true, result.reason);
    return result.coreState;
  }
  function settle(current) {
    for (let i = 0; i < 3 && current.pokerState.phase !== "SETTLED"; i++) current = act(current, current.pokerState.turnUserId, "FOLD");
    assert.equal(current.pokerState.phase, "SETTLED");
    return current;
  }
  function rollover(current) {
    const next = buildNextHandStateFromSettled({ tableId, coreState: current, settledState: current.pokerState, nextVersion: current.version + 1 });
    assert.ok(next);
    return { ...current, version: current.version + 1, pokerState: stampTurnDeadline(next, 3000) };
  }
  function reachInactive(current) {
    for (let i = 0; i < 3 && current.pokerState.turnUserId !== inactive; i++) {
      const actor = current.pokerState.turnUserId;
      current = act(current, actor, current.pokerState.toCallByUserId[actor] > 0 ? "CALL" : "CHECK");
    }
    assert.equal(current.pokerState.turnUserId, inactive);
    return current;
  }
  core = reachInactive(rollover(settle(core)));
  assert.equal(core.pokerState.missedTurnsByUserId[inactive], 1);
  // Simulate the durable JSON round-trip used by restore before the next timeout.
  core = JSON.parse(JSON.stringify(core));
  let active = act(core, inactive, core.pokerState.toCallByUserId[inactive] > 0 ? "CALL" : "CHECK");
  assert.equal(active.pokerState.missedTurnsByUserId[inactive], undefined);
  active = reachInactive(active);
  const resetTimeout = applyCoreStateTurnTimeout({ tableId, coreState: active, nowMs: active.pokerState.turnDeadlineAt + 1 });
  assert.equal(resetTimeout.coreState.pokerState.missedTurnsByUserId[inactive], 1);

  const second = applyCoreStateTurnTimeout({ tableId, coreState: core, nowMs: core.pokerState.turnDeadlineAt + 1 });
  core = second.coreState;
  assert.equal(core.pokerState.missedTurnsByUserId[inactive], 2);
  assert.equal(core.pokerState.pendingAutoSitOutByUserId[inactive], true);
  assert.notEqual(core.pokerState.sitOutByUserId[inactive], true);
  assert.ok(core.pokerState.handSeats.some(seat => seat.userId === inactive));
  core = settle(core);
  const stack = core.pokerState.stacks[inactive];
  core = rollover(core);
  assert.equal(core.pokerState.sitOutByUserId[inactive], true);
  assert.equal(core.pokerState.pendingAutoSitOutByUserId[inactive], undefined);
  assert.equal(core.seats[inactive], initial.seats[inactive]);
  assert.equal(core.pokerState.stacks[inactive], stack);
  assert.equal(core.pokerState.handSeats.some(seat => seat.userId === inactive), false);
  assert.equal(core.pokerState.holeCardsByUserId[inactive], undefined);
  assert.notEqual(core.pokerState.turnUserId, inactive);
  assert.notEqual(core.pokerState.dealerSeatNo, initial.seats[inactive]);
  core = rollover(settle(core));
  assert.equal(core.pokerState.stacks[inactive], stack, "later hand charges no blind to sat-out player");
});

for (const isSinglePlayer of [false, true]) {
  test(`terminal inactivity survives real hands and restore, mode=${isSinglePlayer}`, () => {
    const tableId = 'table_engine_timeout';
    const initial = initialCore();
    initial.seats.user_c = 3;
    initial.members.push({ userId: 'user_c', seat: 3 });
    initial.publicStacks.user_c = 100;
    let nowMs = 1000;
    let core = bootstrapCoreStateHand({ tableId, coreState: initial, nowMs }).coreState;
    const inactive = core.pokerState.turnUserId;
    const limit = isSinglePlayer ? 3 : 2;
    const act = (action) => {
      const result = applyCoreStateAction({ tableId, coreState: core, handId: core.pokerState.handId,
        userId: core.pokerState.turnUserId, action, nowMs: ++nowMs });
      assert.equal(result.accepted, true, result.reason);
      core = result.coreState;
    };
    for (let miss = 1; miss <= limit; miss++) {
      while (core.pokerState.turnUserId !== inactive) {
        const actor = core.pokerState.turnUserId;
        act(core.pokerState.toCallByUserId[actor] > 0 ? 'CALL' : 'CHECK');
      }
      assert.equal(core.pokerState.turnDeadlineAt - core.pokerState.turnStartedAt, 20000);
      nowMs = core.pokerState.turnDeadlineAt + 1;
      const result = applyCoreStateTurnTimeout({ tableId, coreState: core, nowMs, isSinglePlayer });
      assert.equal(result.changed, true);
      core = JSON.parse(JSON.stringify(result.coreState));
      assert.equal(core.pokerState.missedTurnsByUserId[inactive], miss);
      assert.equal(!!core.pokerState.inactivityEjectionByUserId?.[inactive], miss === limit);
      if (miss === limit) {
        assert.equal(core.pokerState.inactivityEjectionByUserId[inactive].isSinglePlayer, isSinglePlayer);
        const late = applyCoreStateAction({ tableId, coreState: core, handId: core.pokerState.handId,
          userId: inactive, action: 'CHECK', nowMs: ++nowMs });
        assert.equal(late.accepted, false);
      }
      while (core.pokerState.phase !== 'SETTLED') act('FOLD');
      const next = buildNextHandStateFromSettled({ tableId, coreState: core, settledState: core.pokerState, nextVersion: core.version + 1 });
      assert.ok(next);
      core = { ...core, version: core.version + 1, pokerState: stampTurnDeadline(next, ++nowMs) };
    }
    assert.ok(core.pokerState.inactivityEjectionByUserId[inactive]);
    assert.equal(core.pokerState.handSeats.some(seat => seat.userId === inactive), false);
  });
}

test('missing server deadline fails closed without a missed decision or ejection', () => {
  const core = bootstrapCoreStateHand({ tableId: 'table_engine_timeout', coreState: initialCore(), nowMs: 1000 }).coreState;
  for (const invalid of [null, undefined, '', false]) {
    core.pokerState.turnDeadlineAt = invalid;
    const result = applyCoreStateTurnTimeout({ tableId: 'table_engine_timeout', coreState: core, nowMs: 999999 });
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'deadline_missing');
    assert.equal(result.coreState.pokerState.inactivityEjectionByUserId?.user_a, undefined);
  }
});

test('accepted manual action wins deadline race and resets penalty; committed timeout wins against late manual action', () => {
  const tableId = 'table_engine_timeout';
  const boot = bootstrapCoreStateHand({ tableId, coreState: initialCore(), nowMs: 1000 }).coreState;
  const userId = boot.pokerState.turnUserId;
  boot.pokerState.missedTurnsByUserId = { [userId]: 1 };
  const nowMs = boot.pokerState.turnDeadlineAt;
  const manual = applyCoreStateAction({ tableId, coreState: boot, handId: boot.pokerState.handId, userId, action: 'FOLD', nowMs });
  assert.equal(manual.accepted, true);
  assert.equal(manual.coreState.pokerState.missedTurnsByUserId[userId], undefined);
  assert.equal(applyCoreStateTurnTimeout({ tableId, coreState: manual.coreState, nowMs }).changed, false);
  const timeout = applyCoreStateTurnTimeout({ tableId, coreState: boot, nowMs });
  assert.equal(timeout.coreState.pokerState.inactivityEjectionByUserId[userId].isSinglePlayer, false);
  const late = applyCoreStateAction({ tableId, coreState: timeout.coreState, handId: timeout.coreState.pokerState.handId, userId, action: 'FOLD', nowMs });
  assert.equal(late.accepted, false);
  assert.ok(timeout.coreState.pokerState.inactivityEjectionByUserId[userId]);
});
