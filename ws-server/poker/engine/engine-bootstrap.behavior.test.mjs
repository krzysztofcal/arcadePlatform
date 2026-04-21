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
  assert.deepEqual(pokerState.handSeats, pokerState.seats);
  assert.equal(typeof pokerState.roomId, "string");
});

test("bootstrap maps dealer/SB/BB/UTG deterministically for 2-player and 3-player tables", () => {
  const twoPlayerCore = {
    roomId: "table_engine_2p",
    version: 0,
    seats: { user_a: 1, user_b: 2 },
    members: [
      { userId: "user_a", seat: 1 },
      { userId: "user_b", seat: 2 }
    ],
    pokerState: null
  };

  const twoPlayer = bootstrapCoreStateHand({ tableId: "table_engine_2p", coreState: twoPlayerCore, nowMs: 1_000 });
  assert.equal(twoPlayer.changed, true);
  assert.equal(twoPlayer.coreState.pokerState.dealerSeatNo, 1);
  assert.equal(twoPlayer.coreState.pokerState.turnUserId, "user_a");
  assert.equal(twoPlayer.coreState.pokerState.betThisRoundByUserId.user_a, 1);
  assert.equal(twoPlayer.coreState.pokerState.betThisRoundByUserId.user_b, 2);

  const threePlayer = bootstrapCoreStateHand({ tableId: "table_engine", coreState: coreStateBase(), nowMs: 1_000 });
  assert.equal(threePlayer.changed, true);
  assert.equal(threePlayer.coreState.pokerState.dealerSeatNo, 1);
  assert.equal(threePlayer.coreState.pokerState.turnUserId, "user_a");
  assert.equal(threePlayer.coreState.pokerState.betThisRoundByUserId.user_b, 1);
  assert.equal(threePlayer.coreState.pokerState.betThisRoundByUserId.user_c, 2);
});

test("bootstrap no-op paths preserve stable result shape", () => {
  const insufficientPlayers = {
    roomId: "table_engine_short",
    version: 4,
    seats: { user_a: 1 },
    members: [{ userId: "user_a", seat: 1 }],
    pokerState: null
  };

  const notEligible = bootstrapCoreStateHand({
    tableId: "table_engine_short",
    coreState: insufficientPlayers,
    nowMs: 1_111
  });
  assert.equal(notEligible.ok, true);
  assert.equal(notEligible.changed, false);
  assert.equal(notEligible.bootstrap, "not_eligible");
  assert.equal(notEligible.stateVersion, 4);
  assert.equal(notEligible.coreState, insufficientPlayers);

  const alreadyLiveCore = bootstrapCoreStateHand({
    tableId: "table_engine",
    coreState: coreStateBase(),
    nowMs: 1_000
  }).coreState;

  const alreadyLive = bootstrapCoreStateHand({
    tableId: "table_engine",
    coreState: alreadyLiveCore,
    nowMs: 1_001
  });
  assert.equal(alreadyLive.ok, true);
  assert.equal(alreadyLive.changed, false);
  assert.equal(alreadyLive.bootstrap, "already_live");
  assert.equal(alreadyLive.handId, alreadyLiveCore.pokerState.handId);
  assert.equal(alreadyLive.stateVersion, alreadyLiveCore.version);
  assert.equal(alreadyLive.coreState, alreadyLiveCore);
});
