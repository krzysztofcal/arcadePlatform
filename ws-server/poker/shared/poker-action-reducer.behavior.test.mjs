import test from "node:test";
import assert from "node:assert/strict";
import { applyPreflopAction } from "./poker-action-reducer.mjs";

function stateFixture() {
  return {
    roomId: "table_action",
    handId: "h1",
    phase: "PREFLOP",
    turnUserId: "u1",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 }
    ],
    community: [],
    potTotal: 3,
    sidePots: [],
    currentBet: 2,
    lastRaiseSize: 2,
    stacks: { u1: 99, u2: 98 },
    toCallByUserId: { u1: 1, u2: 0 },
    betThisRoundByUserId: { u1: 1, u2: 2 },
    actedThisRoundByUserId: { u1: false, u2: false },
    foldedByUserId: { u1: false, u2: false },
    contributionsByUserId: { u1: 1, u2: 2 },
    holeCardsByUserId: { u1: ["AS", "KD"], u2: ["2C", "2D"] },
    deck: ["3H"]
  };
}

test("applyPreflopAction CALL is deterministic", () => {
  const state = stateFixture();
  const first = applyPreflopAction({ pokerState: state, userId: "u1", action: "CALL", amount: 0 });
  const second = applyPreflopAction({ pokerState: stateFixture(), userId: "u1", action: "CALL", amount: 0 });

  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  assert.equal(first.state.potTotal, 4);
  assert.equal(first.state.turnUserId, null);
  assert.deepEqual(first.state.toCallByUserId, { u1: 0, u2: 0 });
});

test("applyPreflopAction rejects invalid actor/phase/amount", () => {
  const invalidActor = applyPreflopAction({ pokerState: stateFixture(), userId: "u2", action: "CALL", amount: 0 });
  assert.equal(invalidActor.ok, false);
  assert.equal(invalidActor.reason, "illegal_action");

  const invalidPhaseState = stateFixture();
  invalidPhaseState.phase = "SHOWDOWN";
  const invalidPhase = applyPreflopAction({ pokerState: invalidPhaseState, userId: "u1", action: "CALL", amount: 0 });
  assert.equal(invalidPhase.ok, false);
  assert.equal(invalidPhase.reason, "unsupported_phase");

  const invalidAmount = applyPreflopAction({ pokerState: stateFixture(), userId: "u1", action: "RAISE", amount: 2 });
  assert.equal(invalidAmount.ok, false);
  assert.equal(invalidAmount.reason, "invalid_amount");
});

test("applyPreflopAction does not change or rely on private state projections", () => {
  const state = stateFixture();
  const result = applyPreflopAction({ pokerState: state, userId: "u1", action: "FOLD", amount: 0 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.holeCardsByUserId, state.holeCardsByUserId);
  assert.deepEqual(result.state.deck, state.deck);
});
