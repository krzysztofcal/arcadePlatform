import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCoreStateAction,
  applyCoreStateTurnTimeout,
  bootstrapCoreStateHand,
  decideCoreStateTurnTimeout
} from "./poker-engine.mjs";

function initialCore() {
  return {
    roomId: "table_engine_timeout",
    version: 0,
    seats: { user_a: 1, user_b: 2 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
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
  assert.equal(timeout.actorUserId, "user_b");
  assert.equal(timeout.coreState.pokerState.phase, "FLOP");
  assert.equal(timeout.coreState.pokerState.turnUserId, "user_a");
});
