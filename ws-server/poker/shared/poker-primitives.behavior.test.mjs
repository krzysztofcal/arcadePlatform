import test from "node:test";
import assert from "node:assert/strict";
import { dealHoleCards, deriveDeck, toCardCodes, toHoleCardCodeMap } from "./poker-primitives.mjs";

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
