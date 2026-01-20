const SUITS = ["S", "H", "D", "C"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const createDeck = () => {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({ r, s });
    }
  }
  return deck;
};

const shuffle = (deck, rng = Math.random) => {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
};

const dealHoleCards = (deck, playerIds) => {
  const totalNeeded = playerIds.length * 2;
  if (deck.length < totalNeeded) {
    throw new Error("not_enough_cards");
  }
  const holeCardsByUserId = {};
  let idx = 0;
  for (const id of playerIds) {
    holeCardsByUserId[id] = [];
  }
  for (let round = 0; round < 2; round += 1) {
    for (const id of playerIds) {
      holeCardsByUserId[id].push(deck[idx]);
      idx += 1;
    }
  }
  return {
    deck: deck.slice(idx),
    holeCardsByUserId,
  };
};

const dealCommunity = (deck, n) => {
  if (deck.length < n) {
    throw new Error("not_enough_cards");
  }
  return {
    deck: deck.slice(n),
    communityCards: deck.slice(0, n),
  };
};

const evaluateHand7 = (cards) => {
  const counts = new Map();
  const ranks = cards.map((card) => card.r);
  for (const r of ranks) {
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  const pairs = Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([r]) => r)
    .sort((a, b) => b - a);
  const sortedRanks = ranks.slice().sort((a, b) => b - a);
  if (pairs.length >= 2) {
    const highPair = pairs[0];
    const lowPair = pairs[1];
    const kicker = sortedRanks.find((r) => r !== highPair && r !== lowPair) || 0;
    return { cat: 2, tiebreak: [highPair, lowPair, kicker] };
  }
  if (pairs.length === 1) {
    const pairRank = pairs[0];
    const kickers = sortedRanks.filter((r) => r !== pairRank).slice(0, 3);
    return { cat: 1, tiebreak: [pairRank, ...kickers] };
  }
  return { cat: 0, tiebreak: sortedRanks.slice(0, 5) };
};

export {
  createDeck,
  shuffle,
  dealHoleCards,
  dealCommunity,
  evaluateHand7,
};
