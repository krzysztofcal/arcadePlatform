import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, applyPreflopAction } from "./poker-action-reducer.mjs";

function stateFixture(overrides = {}) {
  return {
    roomId: "table_action",
    handId: "h1",
    phase: "PREFLOP",
    dealerSeatNo: 1,
    turnUserId: "u1",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 }
    ],
    community: [],
    communityDealt: 0,
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
    deck: ["3H", "4H", "5H", "6H", "7H"],
    ...overrides
  };
}

test("applyPreflopAction CALL is deterministic", () => {
  const state = stateFixture();
  const first = applyPreflopAction({ pokerState: state, userId: "u1", action: "CALL", amount: 0 });
  const second = applyPreflopAction({ pokerState: stateFixture(), userId: "u1", action: "CALL", amount: 0 });

  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  assert.equal(first.state.potTotal, 4);
  assert.equal(first.state.phase, "FLOP");
  assert.equal(first.state.community.length, 3);
  assert.deepEqual(first.state.toCallByUserId, { u1: 0, u2: 0 });
});

test("applyAction first CHECK on zero-bet FLOP does not close street", () => {
  const flop = stateFixture({
    phase: "FLOP",
    community: ["3H", "4H", "5H"],
    communityDealt: 3,
    deck: ["6H", "7H"],
    currentBet: 0,
    turnUserId: "u1",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: false, u2: false }
  });

  const checked = applyAction({ pokerState: flop, userId: "u1", action: "CHECK", amount: 0 });
  assert.equal(checked.ok, true);
  assert.equal(checked.state.phase, "FLOP");
  assert.equal(checked.state.community.length, 3);
  assert.equal(checked.state.actedThisRoundByUserId.u1, true);
  assert.equal(checked.state.turnUserId, "u2");
});

test("applyAction second CHECK closes zero-bet FLOP and advances to TURN", () => {
  const flopPending = stateFixture({
    phase: "FLOP",
    community: ["3H", "4H", "5H"],
    communityDealt: 3,
    deck: ["6H", "7H"],
    currentBet: 0,
    turnUserId: "u2",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: true, u2: false }
  });

  const closed = applyAction({ pokerState: flopPending, userId: "u2", action: "CHECK", amount: 0 });
  assert.equal(closed.ok, true);
  assert.equal(closed.state.phase, "TURN");
  assert.equal(closed.state.community.length, 4);
  assert.equal(closed.state.currentBet, 0);
  assert.deepEqual(closed.state.actedThisRoundByUserId, { u1: false, u2: false });
});

test("applyAction RIVER-closing action freezes turn instead of reassigning", () => {
  const riverPending = stateFixture({
    phase: "RIVER",
    community: ["3H", "4H", "5H", "6H", "7H"],
    communityDealt: 5,
    deck: [],
    currentBet: 0,
    turnUserId: "u2",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: true, u2: false }
  });

  const closed = applyAction({ pokerState: riverPending, userId: "u2", action: "CHECK", amount: 0 });
  assert.equal(closed.ok, true);
  assert.equal(closed.state.phase, "RIVER");
  assert.equal(closed.state.turnUserId, null);
  assert.equal(closed.state.community.length, 5);
});

test("applyAction preserves private state during street progression", () => {
  const preflop = stateFixture();
  const res = applyAction({ pokerState: preflop, userId: "u1", action: "CALL", amount: 0 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.holeCardsByUserId, preflop.holeCardsByUserId);
  assert.deepEqual(res.state.deck, ["6H", "7H"]);
});

test("applyAction rejects invalid actor/phase/amount deterministically", () => {
  const invalidActor = applyAction({ pokerState: stateFixture({ phase: "FLOP" }), userId: "u2", action: "CALL", amount: 0 });
  assert.equal(invalidActor.ok, false);
  assert.equal(invalidActor.reason, "illegal_action");

  const invalidPhase = applyAction({ pokerState: stateFixture({ phase: "SHOWDOWN" }), userId: "u1", action: "CALL", amount: 0 });
  assert.equal(invalidPhase.ok, false);
  assert.equal(invalidPhase.reason, "unsupported_phase");

  const invalidAmount = applyAction({ pokerState: stateFixture({ phase: "TURN", currentBet: 2, toCallByUserId: { u1: 1, u2: 0 } }), userId: "u1", action: "RAISE", amount: 2 });
  assert.equal(invalidAmount.ok, false);
  assert.equal(invalidAmount.reason, "invalid_amount");
});
