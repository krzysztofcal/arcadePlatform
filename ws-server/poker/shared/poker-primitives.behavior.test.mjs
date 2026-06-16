import test from "node:test";
import assert from "node:assert/strict";
import { computeSharedLegalActions, dealHoleCards, deriveDeck, toCardCodes, toHoleCardCodeMap } from "./poker-primitives.mjs";

function allUnique(cards) {
  return new Set(cards).size === cards.length;
}

test("deriveDeck produces deterministic order per seed and changes across different seeds", () => {
  const sameA = toCardCodes(deriveDeck("seed_a"));
  const sameB = toCardCodes(deriveDeck("seed_a"));
  const different = toCardCodes(deriveDeck("seed_b"));

  assert.deepEqual(sameA, sameB);
  assert.equal(sameA.length, 52);
  assert.equal(allUnique(sameA), true);
  assert.notDeepEqual(sameA, different);
});

test("dealHoleCards emits two unique cards per player with no duplicates across dealt and remainder", () => {
  const players = ["u1", "u2", "u3"];
  const dealt = dealHoleCards(deriveDeck("seed_players"), players);
  const holeByUser = toHoleCardCodeMap(dealt.holeCardsByUserId);
  const remainder = toCardCodes(dealt.deck);

  for (const userId of players) {
    assert.equal(Array.isArray(holeByUser[userId]), true);
    assert.equal(holeByUser[userId].length, 2);
  }

  const allCards = [...players.flatMap((id) => holeByUser[id]), ...remainder];
  assert.equal(allCards.length, 52);
  assert.equal(allUnique(allCards), true);
});

test("computeSharedLegalActions allows fold outside the current turn for an active live-hand participant", () => {
  const legal = computeSharedLegalActions({
    statePublic: {
      phase: "TURN",
      turnUserId: "u1",
      seats: [
        { userId: "u1", seatNo: 1 },
        { userId: "u2", seatNo: 2 },
        { userId: "u3", seatNo: 3 }
      ],
      stacks: { u1: 90, u2: 80, u3: 70 },
      betThisRoundByUserId: { u1: 10, u2: 10, u3: 10 },
      currentBet: 10,
      foldedByUserId: { u1: false, u2: false, u3: false },
      leftTableByUserId: { u1: false, u2: false, u3: false },
      sitOutByUserId: { u1: false, u2: false, u3: false }
    },
    userId: "u2"
  });

  assert.deepEqual(legal, {
    actions: ["FOLD"],
    toCall: 0,
    minRaiseTo: null,
    maxRaiseTo: null,
    maxBetAmount: null
  });
});

test("computeSharedLegalActions keeps fold available when check is legal on the acting turn", () => {
  const legal = computeSharedLegalActions({
    statePublic: {
      phase: "TURN",
      turnUserId: "u1",
      seats: [
        { userId: "u1", seatNo: 1 },
        { userId: "u2", seatNo: 2 }
      ],
      stacks: { u1: 90, u2: 80 },
      betThisRoundByUserId: { u1: 10, u2: 10 },
      currentBet: 10,
      foldedByUserId: { u1: false, u2: false },
      leftTableByUserId: { u1: false, u2: false },
      sitOutByUserId: { u1: false, u2: false }
    },
    userId: "u1"
  });

  assert.deepEqual(legal, {
    actions: ["FOLD", "CHECK", "BET"],
    toCall: 0,
    minRaiseTo: null,
    maxRaiseTo: null,
    maxBetAmount: 90
  });
});
