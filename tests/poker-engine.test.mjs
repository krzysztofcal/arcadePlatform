import assert from "node:assert/strict";
import {
  createDeck,
  shuffle,
  dealHoleCards,
  dealCommunity,
  evaluateHand7,
} from "../netlify/functions/_shared/poker-engine.mjs";

const compareRank = (a, b) => {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a.tiebreak[i] || 0) - (b.tiebreak[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const runCreateDeckTest = () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  const seen = new Set();
  deck.forEach((card) => {
    assert.ok(card && typeof card === "object");
    assert.ok("r" in card);
    assert.ok("s" in card);
    const key = `${card.r}${card.s}`;
    seen.add(key);
  });
  assert.equal(seen.size, 52);
};

const runShuffleDeterminismTest = () => {
  const seq = [0.1, 0.9, 0.5, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.05];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const deck = createDeck();
  const shuffledA = shuffle(deck, rng);
  i = 0;
  const shuffledB = shuffle(deck, rng);
  assert.deepEqual(shuffledA, shuffledB);
};

const runDealHoleCardsTest = () => {
  const deck = createDeck();
  const deckSnapshot = deck.map((card) => ({ ...card }));
  const result = dealHoleCards(deck, ["u1", "u2", "u3"]);
  assert.equal(result.holeCardsByUserId.u1.length, 2);
  assert.equal(result.holeCardsByUserId.u2.length, 2);
  assert.equal(result.holeCardsByUserId.u3.length, 2);
  const allDealt = Object.values(result.holeCardsByUserId).flat();
  assert.equal(allDealt.length, 6);
  const seen = new Set(allDealt.map((card) => `${card.r}${card.s}`));
  assert.equal(seen.size, 6);
  assert.equal(result.deck.length, 46);
  assert.deepEqual(deck, deckSnapshot);
};

const runEvaluateHand7Test = () => {
  const highCard = [
    { r: 14, s: "S" },
    { r: 13, s: "H" },
    { r: 11, s: "D" },
    { r: 9, s: "C" },
    { r: 7, s: "S" },
    { r: 5, s: "H" },
    { r: 2, s: "D" },
  ];
  const onePair = [
    { r: 10, s: "S" },
    { r: 10, s: "H" },
    { r: 12, s: "D" },
    { r: 9, s: "C" },
    { r: 7, s: "S" },
    { r: 5, s: "H" },
    { r: 2, s: "D" },
  ];
  const twoPair = [
    { r: 11, s: "S" },
    { r: 11, s: "H" },
    { r: 8, s: "D" },
    { r: 8, s: "C" },
    { r: 14, s: "H" },
    { r: 6, s: "S" },
    { r: 3, s: "D" },
  ];
  const threeKind = [
    { r: 9, s: "S" },
    { r: 9, s: "H" },
    { r: 9, s: "D" },
    { r: 13, s: "C" },
    { r: 7, s: "S" },
    { r: 4, s: "H" },
    { r: 2, s: "D" },
  ];
  const fourKind = [
    { r: 13, s: "S" },
    { r: 13, s: "H" },
    { r: 13, s: "D" },
    { r: 13, s: "C" },
    { r: 8, s: "H" },
    { r: 5, s: "S" },
    { r: 2, s: "C" },
  ];
  const highRank = evaluateHand7(highCard);
  const pairRank = evaluateHand7(onePair);
  const twoPairRank = evaluateHand7(twoPair);
  const threeKindRank = evaluateHand7(threeKind);
  const fourKindRank = evaluateHand7(fourKind);
  assert.ok(compareRank(fourKindRank, threeKindRank) > 0);
  assert.ok(compareRank(threeKindRank, twoPairRank) > 0);
  assert.ok(compareRank(twoPairRank, pairRank) > 0);
  assert.ok(compareRank(pairRank, highRank) > 0);
};

const runDealCommunityTest = () => {
  const deck = createDeck();
  const deckSnapshot = deck.map((card) => ({ ...card }));
  const { deck: d2, communityCards } = dealCommunity(deck, 5);
  assert.equal(communityCards.length, 5);
  assert.equal(d2.length, 47);
  const seen = new Set(communityCards.map((card) => `${card.r}${card.s}`));
  assert.equal(seen.size, 5);
  assert.deepEqual(deck, deckSnapshot);
};

runCreateDeckTest();
runShuffleDeterminismTest();
runDealHoleCardsTest();
runEvaluateHand7Test();
runDealCommunityTest();
