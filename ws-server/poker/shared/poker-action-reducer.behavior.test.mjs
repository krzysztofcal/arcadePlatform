import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, applyPreflopAction } from "./poker-action-reducer.mjs";
import { dealHoleCards, deriveDeck, toCardCodes } from "../shared/poker-primitives.mjs";

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
  assert.deepEqual(closed.state.lastBettingRoundActionByUserId, { u1: null, u2: null });
});

test("applyAction records last betting-round action labels including all-in", () => {
  const preflopCall = stateFixture({
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    stacks: { u1: 99, u2: 98, u3: 97 },
    toCallByUserId: { u1: 1, u2: 0, u3: 2 },
    betThisRoundByUserId: { u1: 1, u2: 2, u3: 0 },
    actedThisRoundByUserId: { u1: false, u2: false, u3: false },
    foldedByUserId: { u1: false, u2: false, u3: false },
    contributionsByUserId: { u1: 1, u2: 2, u3: 0 },
    holeCardsByUserId: { u1: ["AS", "KD"], u2: ["2C", "2D"], u3: ["3C", "3D"] }
  });
  const called = applyAction({ pokerState: preflopCall, userId: "u1", action: "CALL", amount: 0 });
  assert.equal(called.ok, true);
  assert.equal(called.state.lastBettingRoundActionByUserId.u1, "call");

  const flopCheck = stateFixture({
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
  const checked = applyAction({ pokerState: flopCheck, userId: "u1", action: "CHECK", amount: 0 });
  assert.equal(checked.state.lastBettingRoundActionByUserId.u1, "check");

  const foldPending = stateFixture();
  const folded = applyAction({ pokerState: foldPending, userId: "u1", action: "FOLD", amount: 0 });
  assert.equal(folded.state.lastBettingRoundActionByUserId.u1, "fold");

  const allInRaise = stateFixture({
    phase: "TURN",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    currentBet: 8,
    lastRaiseSize: 4,
    turnUserId: "u1",
    stacks: { u1: 12, u2: 18, u3: 22 },
    toCallByUserId: { u1: 4, u2: 0, u3: 0 },
    betThisRoundByUserId: { u1: 4, u2: 8, u3: 8 },
    actedThisRoundByUserId: { u1: false, u2: true, u3: true },
    foldedByUserId: { u1: false, u2: false, u3: false },
    contributionsByUserId: { u1: 4, u2: 8, u3: 8 },
    holeCardsByUserId: { u1: ["AS", "KD"], u2: ["2C", "2D"], u3: ["3C", "3D"] }
  });
  const raisedAllIn = applyAction({ pokerState: allInRaise, userId: "u1", action: "RAISE", amount: 16 });
  assert.equal(raisedAllIn.ok, true);
  assert.equal(raisedAllIn.state.lastBettingRoundActionByUserId.u1, "all_in");
});

test("applyAction RIVER-closing action settles hand with showdown metadata", () => {
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
  assert.equal(closed.state.phase, "SETTLED");
  assert.equal(closed.state.turnUserId, null);
  assert.equal(closed.state.community.length, 5);
  assert.equal(closed.state.potTotal, 0);
  assert.deepEqual(closed.state.showdown.winners, ["u1", "u2"]);
  assert.equal(closed.state.handSettlement.handId, riverPending.handId);

  const replay = applyAction({ pokerState: riverPending, userId: "u2", action: "CHECK", amount: 0 });
  assert.deepEqual(closed.state.showdown, replay.state.showdown);
  assert.deepEqual(closed.state.handSettlement, replay.state.handSettlement);
});

test("applyAction repairs missing river community from handSeed before showdown settlement", () => {
  const handSeed = "ws_seed_table_action_river_repair";
  const dealt = dealHoleCards(deriveDeck(handSeed), ["u1", "u2"]);
  const fullCommunity = toCardCodes(dealt.deck.slice(0, 5));
  const remainingDeck = toCardCodes(dealt.deck.slice(5));
  const riverPending = stateFixture({
    handSeed,
    phase: "RIVER",
    community: fullCommunity.slice(0, 4),
    communityDealt: 5,
    deck: remainingDeck,
    currentBet: 0,
    turnUserId: "u2",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: true, u2: false }
  });

  const closed = applyAction({ pokerState: riverPending, userId: "u2", action: "CHECK", amount: 0 });

  assert.equal(closed.ok, true);
  assert.equal(closed.state.phase, "SETTLED");
  assert.deepEqual(closed.state.community, fullCommunity);
  assert.equal(closed.state.communityDealt, 5);
  assert.equal(closed.state.turnUserId, null);
});

test("applyAction fold-win awards full pot exactly once and settles", () => {
  const foldPending = stateFixture({
    phase: "PREFLOP",
    turnUserId: "u1",
    stacks: { u1: 99, u2: 98 },
    foldedByUserId: { u1: false, u2: false },
    actedThisRoundByUserId: { u1: false, u2: false }
  });

  const folded = applyAction({ pokerState: foldPending, userId: "u1", action: "FOLD", amount: 0 });
  assert.equal(folded.ok, true);
  assert.equal(folded.state.phase, "SETTLED");
  assert.equal(folded.state.turnUserId, null);
  assert.equal(folded.state.potTotal, 0);
  assert.equal(folded.state.stacks.u2, 101);
  assert.equal(folded.state.showdown.reason, "all_folded");
  assert.deepEqual(folded.state.handSettlement.payouts, { u2: 3 });

  const replay = applyAction({ pokerState: foldPending, userId: "u1", action: "FOLD", amount: 0 });
  assert.deepEqual(folded.state.showdown, replay.state.showdown);
  assert.deepEqual(folded.state.handSettlement, replay.state.handSettlement);
});

test("applyAction accepts out-of-turn fold without stealing the current turn", () => {
  const pending = stateFixture({
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    turnUserId: "u1",
    stacks: { u1: 99, u2: 98, u3: 97 },
    toCallByUserId: { u1: 1, u2: 0, u3: 2 },
    betThisRoundByUserId: { u1: 1, u2: 2, u3: 0 },
    actedThisRoundByUserId: { u1: false, u2: false, u3: false },
    foldedByUserId: { u1: false, u2: false, u3: false },
    contributionsByUserId: { u1: 1, u2: 2, u3: 0 },
    holeCardsByUserId: { u1: ["AS", "KD"], u2: ["2C", "2D"], u3: ["3C", "3D"] }
  });

  const folded = applyAction({ pokerState: pending, userId: "u2", action: "FOLD", amount: 0 });

  assert.equal(folded.ok, true);
  assert.equal(folded.state.turnUserId, "u1");
  assert.equal(folded.state.foldedByUserId.u2, true);
  assert.equal(folded.state.lastBettingRoundActionByUserId.u2, "fold");
});

test("applyAction out-of-turn fold does not advance the street or force showdown", () => {
  const pending = stateFixture({
    phase: "TURN",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    turnUserId: "u1",
    community: ["3H", "4H", "5H", "6H"],
    communityDealt: 4,
    deck: ["7H"],
    currentBet: 0,
    toCallByUserId: { u1: 0, u2: 0, u3: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0, u3: 0 },
    actedThisRoundByUserId: { u1: false, u2: true, u3: true },
    foldedByUserId: { u1: false, u2: false, u3: false },
    contributionsByUserId: { u1: 1, u2: 2, u3: 0 },
    holeCardsByUserId: { u1: ["AS", "KD"], u2: ["2C", "2D"], u3: ["3C", "3D"] }
  });

  const folded = applyAction({ pokerState: pending, userId: "u2", action: "FOLD", amount: 0 });

  assert.equal(folded.ok, true);
  assert.equal(folded.state.phase, "TURN");
  assert.deepEqual(folded.state.community, ["3H", "4H", "5H", "6H"]);
  assert.equal(folded.state.turnUserId, "u1");
  assert.equal(folded.state.showdown, undefined);
  assert.equal(folded.state.handSettlement, undefined);
});

test("applyAction showdown side-pot payout remains deterministic", () => {
  const riverSidePot = stateFixture({
    phase: "RIVER",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    turnUserId: "u3",
    community: ["2H", "3H", "4H", "9C", "KD"],
    communityDealt: 5,
    deck: [],
    currentBet: 0,
    stacks: { u1: 1, u2: 1, u3: 1 },
    toCallByUserId: { u1: 0, u2: 0, u3: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0, u3: 0 },
    actedThisRoundByUserId: { u1: true, u2: true, u3: false },
    foldedByUserId: { u1: false, u2: false, u3: false },
    contributionsByUserId: { u1: 100, u2: 50, u3: 50 },
    potTotal: 200,
    holeCardsByUserId: {
      u1: ["AS", "AD"],
      u2: ["5H", "6H"],
      u3: ["KC", "KS"]
    }
  });

  const settled = applyAction({ pokerState: riverSidePot, userId: "u3", action: "CHECK", amount: 0 });
  assert.equal(settled.ok, true);
  assert.equal(settled.state.phase, "SETTLED");
  assert.equal(settled.state.potTotal, 0);
  assert.equal(settled.state.stacks.u1, 51);
  assert.equal(settled.state.stacks.u2, 151);
  assert.equal(settled.state.stacks.u3, 1);
  assert.deepEqual(settled.state.handSettlement.payouts, { u1: 50, u2: 150 });
});

test("applyAction terminal-closing replay remains deterministic", () => {
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

  const first = applyAction({ pokerState: riverPending, userId: "u2", action: "CHECK", amount: 0 });
  const second = applyAction({ pokerState: stateFixture({
    phase: "RIVER",
    community: ["3H", "4H", "5H", "6H", "7H"],
    communityDealt: 5,
    deck: [],
    currentBet: 0,
    turnUserId: "u2",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: true, u2: false }
  }), userId: "u2", action: "CHECK", amount: 0 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.state.phase, "SETTLED");
  assert.equal(second.state.phase, "SETTLED");
  assert.deepEqual(first.state.showdown, second.state.showdown);
  assert.deepEqual(first.state.handSettlement, second.state.handSettlement);
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
