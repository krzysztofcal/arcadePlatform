import test from "node:test";
import assert from "node:assert/strict";
import { applyCoreStateAction, bootstrapCoreStateHand } from "./poker-engine.mjs";

function initialCore() {
  return {
    roomId: "table_engine_roll",
    version: 5,
    seats: { user_a: 1, user_b: 2 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    pokerState: null
  };
}

test("engine rollover starts next preflop hand after settled terminal action", () => {
  let coreState = bootstrapCoreStateHand({ tableId: "table_engine_roll", coreState: initialCore(), nowMs: 1000 }).coreState;
  const oldHandId = coreState.pokerState.handId;

  const folded = applyCoreStateAction({
    tableId: "table_engine_roll",
    coreState,
    handId: oldHandId,
    userId: coreState.pokerState.turnUserId,
    action: "FOLD",
    nowIso: new Date(1001).toISOString(),
    nowMs: 1001
  });

  assert.equal(folded.accepted, true);
  coreState = folded.coreState;
  assert.equal(coreState.pokerState.phase, "PREFLOP");
  assert.notEqual(coreState.pokerState.handId, oldHandId);
  assert.deepEqual(coreState.pokerState.community, []);
  assert.equal(coreState.pokerState.communityDealt, 0);
  assert.equal(coreState.pokerState.turnUserId !== null, true);
});
