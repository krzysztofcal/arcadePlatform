import test from "node:test";
import assert from "node:assert/strict";
import { applyCoreStateAction, bootstrapCoreStateHand } from "./poker-engine.mjs";

function initialCore() {
  return {
    roomId: "table_engine_act",
    version: 0,
    seats: { user_a: 1, user_b: 2 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    pokerState: null
  };
}

test("engine action progression advances PREFLOP->FLOP->TURN with monotonic versions", () => {
  let coreState = bootstrapCoreStateHand({ tableId: "table_engine_act", coreState: initialCore(), nowMs: 1000 }).coreState;

  const preflopCall = applyCoreStateAction({
    tableId: "table_engine_act",
    coreState,
    handId: coreState.pokerState.handId,
    userId: "user_a",
    action: "CALL",
    nowIso: new Date(1001).toISOString(),
    nowMs: 1001
  });
  assert.equal(preflopCall.accepted, true);
  assert.equal(preflopCall.stateVersion, coreState.version + 1);
  coreState = preflopCall.coreState;

  const preflopCheck = applyCoreStateAction({
    tableId: "table_engine_act",
    coreState,
    handId: coreState.pokerState.handId,
    userId: "user_b",
    action: "CHECK",
    nowIso: new Date(1002).toISOString(),
    nowMs: 1002
  });
  assert.equal(preflopCheck.accepted, true);
  coreState = preflopCheck.coreState;
  assert.equal(coreState.pokerState.phase, "FLOP");
  assert.equal(coreState.pokerState.community.length, 3);

  const flopCheck1 = applyCoreStateAction({
    tableId: "table_engine_act",
    coreState,
    handId: coreState.pokerState.handId,
    userId: coreState.pokerState.turnUserId,
    action: "CHECK",
    nowIso: new Date(1003).toISOString(),
    nowMs: 1003
  });
  assert.equal(flopCheck1.accepted, true);
  coreState = flopCheck1.coreState;

  const flopCheck2 = applyCoreStateAction({
    tableId: "table_engine_act",
    coreState,
    handId: coreState.pokerState.handId,
    userId: coreState.pokerState.turnUserId,
    action: "CHECK",
    nowIso: new Date(1004).toISOString(),
    nowMs: 1004
  });
  assert.equal(flopCheck2.accepted, true);
  assert.equal(flopCheck2.stateVersion, coreState.version + 1);
  coreState = flopCheck2.coreState;

  assert.equal(coreState.pokerState.phase, "TURN");
  assert.equal(coreState.pokerState.community.length, 4);

  const deterministicReplay = applyCoreStateAction({
    tableId: "table_engine_act",
    coreState: flopCheck1.coreState,
    handId: flopCheck1.coreState.pokerState.handId,
    userId: flopCheck1.coreState.pokerState.turnUserId,
    action: "CHECK",
    nowIso: new Date(1004).toISOString(),
    nowMs: 1004
  });
  assert.deepEqual(deterministicReplay.coreState.pokerState, coreState.pokerState);
});

test("engine action accounting parity: PREFLOP raise/call updates fields exactly once", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_act", coreState: initialCore(), nowMs: 2_000 });
  const initial = boot.coreState;

  const raised = applyCoreStateAction({
    tableId: "table_engine_act",
    coreState: initial,
    handId: initial.pokerState.handId,
    userId: initial.pokerState.turnUserId,
    action: "RAISE",
    amount: 6,
    nowIso: new Date(2_001).toISOString(),
    nowMs: 2_001
  });

  assert.equal(raised.accepted, true);
  assert.equal(raised.stateVersion, initial.version + 1);
  assert.equal(raised.coreState.pokerState.potTotal, 8);
  assert.equal(raised.coreState.pokerState.currentBet, 6);
  assert.equal(raised.coreState.pokerState.toCallByUserId.user_a, 0);
  assert.equal(raised.coreState.pokerState.toCallByUserId.user_b, 4);
  assert.equal(raised.coreState.pokerState.betThisRoundByUserId.user_a, 6);
  assert.equal(raised.coreState.pokerState.betThisRoundByUserId.user_b, 2);
  assert.equal(raised.coreState.pokerState.actedThisRoundByUserId.user_a, true);
  assert.equal(raised.coreState.pokerState.actedThisRoundByUserId.user_b, false);
  assert.equal(raised.coreState.pokerState.contributionsByUserId.user_a, 6);
  assert.equal(raised.coreState.pokerState.contributionsByUserId.user_b, 2);
  assert.equal(raised.coreState.pokerState.turnUserId, "user_b");

  const called = applyCoreStateAction({
    tableId: "table_engine_act",
    coreState: raised.coreState,
    handId: raised.coreState.pokerState.handId,
    userId: "user_b",
    action: "CALL",
    nowIso: new Date(2_002).toISOString(),
    nowMs: 2_002
  });

  assert.equal(called.accepted, true);
  assert.equal(called.stateVersion, raised.stateVersion + 1);
  assert.equal(called.coreState.pokerState.phase, "FLOP");
  assert.equal(called.coreState.pokerState.potTotal, 12);
  assert.equal(called.coreState.pokerState.currentBet, 0);
  assert.equal(called.coreState.pokerState.betThisRoundByUserId.user_a, 0);
  assert.equal(called.coreState.pokerState.betThisRoundByUserId.user_b, 0);
  assert.equal(called.coreState.pokerState.toCallByUserId.user_a, 0);
  assert.equal(called.coreState.pokerState.toCallByUserId.user_b, 0);
  assert.equal(called.coreState.pokerState.actedThisRoundByUserId.user_a, false);
  assert.equal(called.coreState.pokerState.actedThisRoundByUserId.user_b, false);
  assert.equal(called.coreState.pokerState.contributionsByUserId.user_a, 6);
  assert.equal(called.coreState.pokerState.contributionsByUserId.user_b, 6);
  assert.equal(called.coreState.pokerState.turnUserId, "user_b");
});

test("engine action application is deterministic for identical pre-state/action/timestamp", () => {
  const boot = bootstrapCoreStateHand({ tableId: "table_engine_act", coreState: initialCore(), nowMs: 3_000 });
  const preState = boot.coreState;
  const actionArgs = {
    tableId: "table_engine_act",
    coreState: preState,
    handId: preState.pokerState.handId,
    userId: preState.pokerState.turnUserId,
    action: "CALL",
    nowIso: new Date(3_001).toISOString(),
    nowMs: 3_001
  };

  const first = applyCoreStateAction(actionArgs);
  const second = applyCoreStateAction(actionArgs);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(first.stateVersion, preState.version + 1);
  assert.equal(second.stateVersion, preState.version + 1);
  assert.deepEqual(first.coreState.pokerState, second.coreState.pokerState);
});
