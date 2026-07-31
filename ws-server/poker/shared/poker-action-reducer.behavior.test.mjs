import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, applyPreflopAction } from "./poker-action-reducer.mjs";
import { computeSharedLegalActions } from "../shared/poker-primitives.mjs";
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

test("applyAction keeps current hand turn order on handSeats when seated joiner appears only in seats", () => {
  const flop = stateFixture({
    phase: "FLOP",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    handSeats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 }
    ],
    stacks: { u1: 99, u2: 98, u3: 100 },
    holeCardsByUserId: { u1: ["AS", "KD"], u2: ["2C", "2D"] },
    community: ["3H", "4H", "5H"],
    communityDealt: 3,
    deck: ["6H", "7H"],
    currentBet: 0,
    turnUserId: "u1",
    toCallByUserId: { u1: 0, u2: 0, u3: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0, u3: 0 },
    actedThisRoundByUserId: { u1: false, u2: false, u3: false },
    foldedByUserId: { u1: false, u2: false, u3: false },
    contributionsByUserId: { u1: 2, u2: 2, u3: 100 }
  });

  const checked = applyAction({ pokerState: flop, userId: "u1", action: "CHECK", amount: 0 });
  assert.equal(checked.ok, true);
  assert.equal(checked.state.turnUserId, "u2");
  assert.deepEqual(computeSharedLegalActions({ statePublic: checked.state, userId: "u3" }).actions, []);
});

test("applyAction never returns the turn to a player who left during the hand", () => {
  const flop = stateFixture({
    phase: "FLOP",
    seats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    handSeats: [
      { userId: "u1", seatNo: 1 },
      { userId: "u2", seatNo: 2 },
      { userId: "u3", seatNo: 3 }
    ],
    community: ["3H", "4H", "5H"],
    communityDealt: 3,
    deck: ["6H", "7H"],
    currentBet: 0,
    turnUserId: "u1",
    stacks: { u1: 99, u2: 98, u3: 100 },
    toCallByUserId: { u1: 0, u2: 0, u3: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0, u3: 0 },
    actedThisRoundByUserId: { u1: false, u2: false, u3: false },
    foldedByUserId: { u1: false, u2: false, u3: false },
    leftTableByUserId: { u2: true },
    contributionsByUserId: { u1: 2, u2: 2, u3: 2 },
    holeCardsByUserId: { u1: ["AS", "KD"], u2: ["2C", "2D"], u3: ["QS", "QH"] }
  });

  const checked = applyAction({ pokerState: flop, userId: "u1", action: "CHECK", amount: 0 });
  assert.equal(checked.ok, true);
  assert.equal(checked.state.phase, "FLOP");
  assert.equal(checked.state.turnUserId, "u3");
  assert.deepEqual(computeSharedLegalActions({ statePublic: checked.state, userId: "u2" }).actions, []);
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
  assert.equal(closed.state.showdown.handsByUserId.u1.category, 9);
  assert.equal(closed.state.showdown.handsByUserId.u1.name, "STRAIGHT_FLUSH");
  assert.deepEqual(closed.state.showdown.handsByUserId.u1.ranks, [7]);
  assert.equal(closed.state.showdown.handsByUserId.u1.best5.length, 5);
  assert.equal(closed.state.showdown.handsByUserId.u2.category, 9);
  assert.equal(closed.state.showdown.handsByUserId.u2.name, "STRAIGHT_FLUSH");
  assert.deepEqual(closed.state.showdown.handsByUserId.u2.ranks, [7]);
  assert.equal(closed.state.showdown.handsByUserId.u2.best5.length, 5);
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

test("applyAction restores missing board cards from handSeed when private deck is absent", () => {
  const handSeed = "ws_seed_table_action_board_restore";
  const dealt = dealHoleCards(deriveDeck(handSeed), ["u1", "u2"]);
  const fullCommunity = toCardCodes(dealt.deck.slice(0, 5));
  const turnDeck = toCardCodes(dealt.deck.slice(4));
  const remainingDeck = toCardCodes(dealt.deck.slice(5));
  const flopPending = stateFixture({
    handSeed,
    phase: "FLOP",
    community: fullCommunity.slice(0, 3),
    communityDealt: 3,
    deck: [],
    currentBet: 0,
    turnUserId: "u2",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: true, u2: false }
  });

  const advancedToTurn = applyAction({ pokerState: flopPending, userId: "u2", action: "CHECK", amount: 0 });
  assert.equal(advancedToTurn.ok, true);
  assert.equal(advancedToTurn.state.phase, "TURN");
  assert.deepEqual(advancedToTurn.state.community, fullCommunity.slice(0, 4));
  assert.deepEqual(advancedToTurn.state.deck, turnDeck);
  assert.equal(advancedToTurn.state.communityDealt, 4);

  const turnPending = {
    ...advancedToTurn.state,
    currentBet: 0,
    turnUserId: "u2",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: true, u2: false }
  };
  const advancedToRiver = applyAction({ pokerState: turnPending, userId: "u2", action: "CHECK", amount: 0 });
  assert.equal(advancedToRiver.ok, true);
  assert.equal(advancedToRiver.state.phase, "RIVER");
  assert.deepEqual(advancedToRiver.state.community, fullCommunity);
  assert.deepEqual(advancedToRiver.state.deck, remainingDeck);
  assert.equal(advancedToRiver.state.communityDealt, 5);

  const riverPending = {
    ...advancedToRiver.state,
    currentBet: 0,
    turnUserId: "u2",
    toCallByUserId: { u1: 0, u2: 0 },
    betThisRoundByUserId: { u1: 0, u2: 0 },
    actedThisRoundByUserId: { u1: true, u2: false }
  };
  const settled = applyAction({ pokerState: riverPending, userId: "u2", action: "CHECK", amount: 0 });
  assert.equal(settled.ok, true);
  assert.equal(settled.state.phase, "SETTLED");
  assert.deepEqual(settled.state.community, fullCommunity);
  assert.deepEqual(settled.state.deck, remainingDeck);
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

test("all-in keeps the sole funded opponent on preflop until it calls or folds", () => {
  const allInPending = stateFixture({
    seats: [
      { userId: "human", seatNo: 1 },
      { userId: "bot_fold", seatNo: 2 },
      { userId: "bot_call", seatNo: 3 }
    ],
    handSeats: [
      { userId: "human", seatNo: 1 },
      { userId: "bot_fold", seatNo: 2 },
      { userId: "bot_call", seatNo: 3 }
    ],
    turnUserId: "bot_fold",
    currentBet: 488,
    lastRaiseSize: 486,
    potTotal: 491,
    stacks: { human: 0, bot_fold: 13, bot_call: 96 },
    toCallByUserId: { human: 0, bot_fold: 487, bot_call: 486 },
    betThisRoundByUserId: { human: 488, bot_fold: 1, bot_call: 2 },
    actedThisRoundByUserId: { human: true, bot_fold: false, bot_call: false },
    foldedByUserId: { human: false, bot_fold: false, bot_call: false },
    contributionsByUserId: { human: 488, bot_fold: 1, bot_call: 2 },
    holeCardsByUserId: {
      human: ["AS", "AD"],
      bot_fold: ["KS", "KD"],
      bot_call: ["QS", "QD"]
    }
  });

  const folded = applyAction({ pokerState: allInPending, userId: "bot_fold", action: "FOLD", amount: 0 });

  assert.equal(folded.ok, true);
  assert.equal(folded.state.phase, "PREFLOP");
  assert.equal(folded.state.turnUserId, "bot_call");
  assert.equal(folded.state.toCallByUserId.bot_call, 486);

  const called = applyAction({ pokerState: folded.state, userId: "bot_call", action: "CALL", amount: 0 });

  assert.equal(called.ok, true);
  assert.equal(called.state.phase, "SETTLED");
  assert.equal(called.state.contributionsByUserId.bot_call, 98);
  assert.equal(called.state.showdown.potAwardedTotal, 587);
  assert.equal(Object.values(called.state.handSettlement.payouts).reduce((total, amount) => total + amount, 0), 587);
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

// ---------------------------------------------------------------------------
// Big-blind minimum opening bet, full-raise contract and reopening rights
// (Issue #814). Fixtures model a 5/10 table: bigBlind = 10.
// ---------------------------------------------------------------------------

function bbFlop(overrides = {}) {
  return {
    roomId: "table_bb",
    handId: "h_bb",
    phase: "FLOP",
    dealerSeatNo: 1,
    turnUserId: "a",
    seats: [
      { userId: "a", seatNo: 1 },
      { userId: "b", seatNo: 2 },
      { userId: "c", seatNo: 3 }
    ],
    community: ["3H", "4H", "5H"],
    communityDealt: 3,
    deck: ["6S", "7S", "8S", "9S", "TS"],
    potTotal: 30,
    sidePots: [],
    currentBet: 0,
    lastRaiseSize: 10,
    bigBlind: 10,
    stacks: { a: 100, b: 100, c: 100 },
    toCallByUserId: { a: 0, b: 0, c: 0 },
    betThisRoundByUserId: { a: 0, b: 0, c: 0 },
    actedThisRoundByUserId: { a: false, b: false, c: false },
    foldedByUserId: { a: false, b: false, c: false },
    contributionsByUserId: { a: 10, b: 10, c: 10 },
    holeCardsByUserId: { a: ["AS", "KD"], b: ["2C", "2D"], c: ["3C", "3D"] },
    ...overrides
  };
}

test("BET below the big blind is rejected; BET at the big blind is accepted", () => {
  const legal = computeSharedLegalActions({ statePublic: bbFlop(), userId: "a" });
  assert.deepEqual(legal.actions, ["FOLD", "CHECK", "BET"]);
  assert.equal(legal.minBetAmount, 10);
  assert.equal(legal.maxBetAmount, 100);

  const below = applyAction({ pokerState: bbFlop(), userId: "a", action: "BET", amount: 1 });
  assert.equal(below.ok, false);
  assert.equal(below.reason, "invalid_amount");

  const atBb = applyAction({ pokerState: bbFlop(), userId: "a", action: "BET", amount: 10 });
  assert.equal(atBb.ok, true);
  assert.equal(atBb.state.currentBet, 10);
  assert.equal(atBb.state.lastRaiseSize, 10);
});

test("a player with a stack below the big blind may bet all-in only", () => {
  const short = bbFlop({ turnUserId: "c", stacks: { a: 100, b: 100, c: 3 } });
  const legal = computeSharedLegalActions({ statePublic: short, userId: "c" });
  assert.equal(legal.minBetAmount, 3);
  assert.equal(legal.maxBetAmount, 3);

  const rejected = applyAction({ pokerState: short, userId: "c", action: "BET", amount: 2 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "invalid_amount");

  const allIn = applyAction({ pokerState: short, userId: "c", action: "BET", amount: 3 });
  assert.equal(allIn.ok, true);
  assert.equal(allIn.state.betThisRoundByUserId.c, 3);
  assert.equal(allIn.state.lastRaiseSize, 10);
});

test("BB preflop option: BET is an increment over the posted blind", () => {
  // 5/10 preflop: dealer a, sb b (posted 5), bb c (posted 10); everyone called,
  // action is back on the big blind with toCall = 0.
  const preflop = {
    roomId: "table_bb_preflop",
    handId: "h_bb_preflop",
    phase: "PREFLOP",
    dealerSeatNo: 1,
    turnUserId: "c",
    seats: [
      { userId: "a", seatNo: 1 },
      { userId: "b", seatNo: 2 },
      { userId: "c", seatNo: 3 }
    ],
    community: [],
    communityDealt: 0,
    deck: ["6S", "7S", "8S", "9S", "TS"],
    potTotal: 30,
    sidePots: [],
    currentBet: 10,
    lastRaiseSize: 10,
    bigBlind: 10,
    stacks: { a: 90, b: 90, c: 90 },
    toCallByUserId: { a: 0, b: 0, c: 0 },
    betThisRoundByUserId: { a: 10, b: 10, c: 10 },
    actedThisRoundByUserId: { a: true, b: true, c: false },
    foldedByUserId: { a: false, b: false, c: false },
    contributionsByUserId: { a: 10, b: 10, c: 10 },
    holeCardsByUserId: { a: ["AS", "KD"], b: ["2C", "2D"], c: ["3C", "3D"] }
  };

  const legal = computeSharedLegalActions({ statePublic: preflop, userId: "c" });
  assert.equal(legal.minBetAmount, 10);
  assert.equal(legal.maxBetAmount, 90);

  const miniRaise = applyAction({ pokerState: preflop, userId: "c", action: "BET", amount: 1 });
  assert.equal(miniRaise.ok, false);
  assert.equal(miniRaise.reason, "invalid_amount");

  const fullRaise = applyAction({ pokerState: preflop, userId: "c", action: "BET", amount: 10 });
  assert.equal(fullRaise.ok, true);
  assert.equal(fullRaise.state.betThisRoundByUserId.c, 20);
  assert.equal(fullRaise.state.currentBet, 20);

  const shortStack = { ...preflop, stacks: { a: 90, b: 90, c: 3 } };
  const allInBet = applyAction({ pokerState: shortStack, userId: "c", action: "BET", amount: 3 });
  assert.equal(allInBet.ok, true);
  assert.equal(allInBet.state.betThisRoundByUserId.c, 13);
});

test("full raise minimum stays based on the previous full bet/raise", () => {
  const bet = applyAction({ pokerState: bbFlop(), userId: "a", action: "BET", amount: 10 });
  assert.equal(bet.ok, true);

  const shortRaise = applyAction({ pokerState: bet.state, userId: "b", action: "RAISE", amount: 15 });
  assert.equal(shortRaise.ok, false);
  assert.equal(shortRaise.reason, "invalid_amount");

  const fullRaise = applyAction({ pokerState: bet.state, userId: "b", action: "RAISE", amount: 20 });
  assert.equal(fullRaise.ok, true);
  assert.equal(fullRaise.state.currentBet, 20);
  assert.equal(fullRaise.state.lastRaiseSize, 10);
});

test("short all-in raise does not lower the full-raise size", () => {
  const three = bbFlop({ stacks: { a: 100, b: 13, c: 100 } });
  const bet = applyAction({ pokerState: three, userId: "a", action: "BET", amount: 10 });
  assert.equal(bet.ok, true);

  const shortAllIn = applyAction({ pokerState: bet.state, userId: "b", action: "RAISE", amount: 13 });
  assert.equal(shortAllIn.ok, true);
  assert.equal(shortAllIn.state.currentBet, 13);
  assert.equal(shortAllIn.state.lastRaiseSize, 10);

  const legalC = computeSharedLegalActions({ statePublic: shortAllIn.state, userId: "c" });
  assert.equal(legalC.minRaiseTo, 23);
});

test("short all-in does not reopen RAISE for already-acted players", () => {
  const three = bbFlop({ stacks: { a: 100, b: 100, c: 13 } });
  const betA = applyAction({ pokerState: three, userId: "a", action: "BET", amount: 10 });
  assert.equal(betA.ok, true);
  const callB = applyAction({ pokerState: betA.state, userId: "b", action: "CALL", amount: 0 });
  assert.equal(callB.ok, true);
  const allInC = applyAction({ pokerState: callB.state, userId: "c", action: "RAISE", amount: 13 });
  assert.equal(allInC.ok, true);
  assert.equal(allInC.state.currentBet, 13);
  assert.equal(allInC.state.lastRaiseSize, 10);

  const legalA = computeSharedLegalActions({ statePublic: allInC.state, userId: "a" });
  assert.deepEqual(legalA.actions, ["FOLD", "CALL"]);

  const raiseA = applyAction({ pokerState: allInC.state, userId: "a", action: "RAISE", amount: 25 });
  assert.equal(raiseA.ok, false);
  assert.equal(raiseA.reason, "illegal_action");

  const callA = applyAction({ pokerState: allInC.state, userId: "a", action: "CALL", amount: 0 });
  assert.equal(callA.ok, true);
  const legalB = computeSharedLegalActions({ statePublic: callA.state, userId: "b" });
  assert.deepEqual(legalB.actions, ["FOLD", "CALL"]);
});

test("check-raise stays legal for a player who already acted but faces a full bet", () => {
  const flop = bbFlop({
    seats: [
      { userId: "a", seatNo: 1 },
      { userId: "b", seatNo: 2 }
    ],
    stacks: { a: 100, b: 100 },
    toCallByUserId: { a: 0, b: 0 },
    betThisRoundByUserId: { a: 0, b: 0 },
    actedThisRoundByUserId: { a: false, b: false },
    foldedByUserId: { a: false, b: false },
    contributionsByUserId: { a: 10, b: 10 },
    holeCardsByUserId: { a: ["AS", "KD"], b: ["2C", "2D"] }
  });
  const checkA = applyAction({ pokerState: flop, userId: "a", action: "CHECK", amount: 0 });
  assert.equal(checkA.ok, true);
  const betB = applyAction({ pokerState: checkA.state, userId: "b", action: "BET", amount: 10 });
  assert.equal(betB.ok, true);

  const legalA = computeSharedLegalActions({ statePublic: betB.state, userId: "a" });
  assert.ok(legalA.actions.includes("RAISE"));
  assert.equal(legalA.minRaiseTo, 20);
});

test("cumulative short all-ins reopen betting once toCall reaches a full raise", () => {
  const four = bbFlop({
    seats: [
      { userId: "a", seatNo: 1 },
      { userId: "b", seatNo: 2 },
      { userId: "c", seatNo: 3 },
      { userId: "d", seatNo: 4 }
    ],
    stacks: { a: 100, b: 100, c: 14, d: 20 },
    toCallByUserId: { a: 0, b: 0, c: 0, d: 0 },
    betThisRoundByUserId: { a: 0, b: 0, c: 0, d: 0 },
    actedThisRoundByUserId: { a: false, b: false, c: false, d: false },
    foldedByUserId: { a: false, b: false, c: false, d: false },
    contributionsByUserId: { a: 10, b: 10, c: 10, d: 10 },
    holeCardsByUserId: {
      a: ["AS", "KD"],
      b: ["2C", "2D"],
      c: ["3C", "3D"],
      d: ["4C", "4D"]
    }
  });

  const betA = applyAction({ pokerState: four, userId: "a", action: "BET", amount: 10 });
  assert.equal(betA.ok, true);
  const callB = applyAction({ pokerState: betA.state, userId: "b", action: "CALL", amount: 0 });
  assert.equal(callB.ok, true);
  const allInC = applyAction({ pokerState: callB.state, userId: "c", action: "RAISE", amount: 14 });
  assert.equal(allInC.ok, true);
  assert.equal(allInC.state.lastRaiseSize, 10);
  const allInD = applyAction({ pokerState: allInC.state, userId: "d", action: "RAISE", amount: 20 });
  assert.equal(allInD.ok, true);

  const after = allInD.state;
  assert.equal(after.currentBet, 20);
  assert.equal(after.lastRaiseSize, 10);

  const legalA = computeSharedLegalActions({ statePublic: after, userId: "a" });
  assert.ok(legalA.actions.includes("RAISE"));
  assert.equal(legalA.toCall, 10);
  assert.equal(legalA.minRaiseTo, 30);

  const callA = applyAction({ pokerState: after, userId: "a", action: "CALL", amount: 0 });
  assert.equal(callA.ok, true);
  const legalB = computeSharedLegalActions({ statePublic: callA.state, userId: "b" });
  assert.ok(legalB.actions.includes("RAISE"));
  assert.equal(legalB.toCall, 10);
  assert.equal(legalB.minRaiseTo, 30);
});
