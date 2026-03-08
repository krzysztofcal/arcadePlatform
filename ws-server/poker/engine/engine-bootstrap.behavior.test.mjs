import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapCoreStateHand } from "./poker-engine.mjs";

function coreStateBase() {
  return {
    roomId: "table_engine",
    version: 2,
    seats: { user_a: 1, user_b: 2, user_c: 3 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 },
      { userId: "user_c", seat: 3 }
    ],
    pokerState: null
  };
}

test("engine bootstrap creates deterministic preflop hand with expected invariants", () => {
  const nowMs = 1_700_000_000_000;
  const result = bootstrapCoreStateHand({
    tableId: "table_engine",
    coreState: coreStateBase(),
    nowMs
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.bootstrap, "started");
  assert.equal(result.stateVersion, 3);

  const pokerState = result.coreState.pokerState;
  assert.equal(pokerState.phase, "PREFLOP");
  assert.equal(pokerState.dealerSeatNo, 1);
  assert.equal(pokerState.turnUserId, "user_a");
  assert.equal(pokerState.currentBet, 2);
  assert.equal(pokerState.potTotal, 3);
  assert.equal(pokerState.turnStartedAt, nowMs);
  assert.ok(pokerState.turnDeadlineAt > nowMs);
  assert.equal(Array.isArray(pokerState.seats), true);
  assert.equal(typeof pokerState.roomId, "string");
});
