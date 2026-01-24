import assert from "node:assert/strict";
import {
  HAND_CATEGORY,
  evaluateBestHand,
  compareHands,
} from "../netlify/functions/_shared/poker-eval.mjs";

const c = (r, s) => ({ r, s });
const E = (cards) => evaluateBestHand(cards);
const cmp = (a, b) => compareHands(E(a), E(b));

const runInvalidInputTests = () => {
  assert.throws(
    () => evaluateBestHand([c("A", "S"), c("K", "H"), c("Q", "D"), c("J", "C")]),
    (err) => err && err.message === "insufficient_cards",
  );
  assert.throws(
    () => evaluateBestHand([c("A", "S"), c("A", "S"), c("Q", "D"), c("J", "C"), c("9", "H")]),
    (err) => err && err.message === "duplicate_card",
  );
  assert.throws(
    () => evaluateBestHand([c("Z", "S"), c("A", "H"), c("Q", "D"), c("J", "C"), c("9", "H")]),
    (err) => err && err.message === "invalid_card",
  );
  assert.throws(
    () => evaluateBestHand([c("A", "S"), c("K", null), c("Q", "D"), c("J", "C"), c("9", "H")]),
    (err) => err && err.message === "invalid_card",
  );
};

const runCategoryOrderingTests = () => {
  const highCard = [c("A", "S"), c("K", "D"), c("Q", "H"), c("9", "C"), c("7", "S"), c("4", "D"), c("2", "H")];
  const pair = [c("J", "S"), c("J", "D"), c("A", "H"), c("K", "C"), c("9", "S"), c("5", "D"), c("2", "H")];
  const twoPair = [c("Q", "H"), c("Q", "S"), c("8", "D"), c("8", "S"), c("A", "C"), c("4", "H"), c("2", "D")];
  const trips = [c("K", "S"), c("K", "H"), c("K", "D"), c("A", "C"), c("9", "S"), c("4", "H"), c("2", "D")];
  const straight = [c("9", "S"), c("8", "D"), c("7", "H"), c("6", "C"), c("5", "S"), c("A", "D"), c("2", "H")];
  const flush = [c("A", "S"), c("Q", "S"), c("9", "S"), c("6", "S"), c("3", "S"), c("2", "D"), c("4", "H")];
  const fullHouse = [c("T", "S"), c("T", "H"), c("T", "D"), c("2", "S"), c("2", "D"), c("9", "C"), c("4", "H")];
  const quads = [c("9", "S"), c("9", "H"), c("9", "D"), c("9", "C"), c("A", "H"), c("4", "D"), c("2", "S")];
  const straightFlush = [c("A", "S"), c("K", "S"), c("Q", "S"), c("J", "S"), c("T", "S"), c("2", "D"), c("3", "C")];

  assert.ok(cmp(pair, highCard) > 0);
  assert.ok(cmp(twoPair, pair) > 0);
  assert.ok(cmp(trips, twoPair) > 0);
  assert.ok(cmp(straight, trips) > 0);
  assert.ok(cmp(flush, straight) > 0);
  assert.ok(cmp(fullHouse, flush) > 0);
  assert.ok(cmp(quads, fullHouse) > 0);
  assert.ok(cmp(straightFlush, quads) > 0);
};

const runWheelStraightTest = () => {
  const wheel = [c("A", "S"), c("2", "D"), c("3", "H"), c("4", "C"), c("5", "S"), c("9", "H"), c("K", "D")];
  const result = E(wheel);
  assert.equal(result.category, HAND_CATEGORY.STRAIGHT);
  assert.equal(result.ranks[0], 5);
};

const runTieTest = () => {
  const handA = [c("A", "S"), c("K", "S"), c("Q", "S"), c("J", "S"), c("T", "S"), c("2", "D"), c("3", "C")];
  const handB = [c("A", "H"), c("K", "H"), c("Q", "H"), c("J", "H"), c("T", "H"), c("2", "C"), c("3", "D")];
  assert.equal(compareHands(E(handA), E(handB)), 0);
};

const runFlushTieBreakTest = () => {
  const flushA = [c("A", "S"), c("Q", "S"), c("9", "S"), c("6", "S"), c("3", "S"), c("2", "D"), c("4", "H")];
  const flushK = [c("K", "H"), c("Q", "H"), c("9", "H"), c("6", "H"), c("3", "H"), c("2", "S"), c("4", "D")];
  assert.ok(cmp(flushA, flushK) > 0);
};

runInvalidInputTests();
runCategoryOrderingTests();
runWheelStraightTest();
runTieTest();
runFlushTieBreakTest();
