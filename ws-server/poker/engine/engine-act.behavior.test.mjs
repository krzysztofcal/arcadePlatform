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
