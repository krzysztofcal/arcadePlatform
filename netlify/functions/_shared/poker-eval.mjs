const HAND_CATEGORY = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  TRIPS: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  QUADS: 8,
  STRAIGHT_FLUSH: 9,
};

const CATEGORY_NAME = {
  1: "HIGH_CARD",
  2: "PAIR",
  3: "TWO_PAIR",
  4: "TRIPS",
  5: "STRAIGHT",
  6: "FLUSH",
  7: "FULL_HOUSE",
  8: "QUADS",
  9: "STRAIGHT_FLUSH",
};

const normalizeRank = (r) => {
  if (typeof r === "number" && Number.isInteger(r)) {
    if (r >= 2 && r <= 14) return r;
    return null;
  }
  if (typeof r !== "string") return null;
  const v = r.trim().toUpperCase();
  if (v === "A") return 14;
  if (v === "K") return 13;
  if (v === "Q") return 12;
  if (v === "J") return 11;
  if (v === "T") return 10;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n >= 2 && n <= 10) return n;
  }
  return null;
};

const normalizeSuit = (s) => {
  if (typeof s !== "string") return null;
  const v = s.trim();
  if (!v) return null;
  return v.toUpperCase();
};

const cardKey = (card) => `${card.rank}-${card.suit}`;

const assertValidCards = (cards) => {
  if (!Array.isArray(cards)) throw new Error("invalid_card");
  if (cards.length < 5) throw new Error("insufficient_cards");
  const seen = new Set();
  return cards.map((card) => {
    if (!card || typeof card !== "object") throw new Error("invalid_card");
    if (!("r" in card) || !("s" in card)) throw new Error("invalid_card");
    const rank = normalizeRank(card.r);
    const suit = normalizeSuit(card.s);
    if (!rank || !suit) throw new Error("invalid_card");
    const normalized = { rank, suit, raw: card };
    const key = cardKey(normalized);
    if (seen.has(key)) throw new Error("duplicate_card");
    seen.add(key);
    return normalized;
  });
};

const compareRankVectors = (a, b) => {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

const byRankDesc = (a, b) => {
  if (a.rank !== b.rank) return b.rank - a.rank;
  return a.suit.localeCompare(b.suit);
};

const findStraight = (ranksDesc) => {
  const set = new Set(ranksDesc);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high -= 1) {
    let ok = true;
    for (let i = 0; i < 5; i += 1) {
      if (!set.has(high - i)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const ranks = [];
      for (let i = 0; i < 5; i += 1) ranks.push(high - i);
      return { high, ranks };
    }
  }
  return null;
};

const pickStraightCards = (ranks, cardsByRank) => {
  return ranks.map((r) => {
    const actual = r === 1 ? 14 : r;
    const list = cardsByRank.get(actual) || [];
    return list[0];
  });
};

const evaluateBestHand = (cards) => {
  const normalized = assertValidCards(cards);
  const allCardsSorted = normalized.slice().sort(byRankDesc);
  const cardsByRank = new Map();
  const cardsBySuit = new Map();

  normalized.forEach((card) => {
    if (!cardsByRank.has(card.rank)) cardsByRank.set(card.rank, []);
    cardsByRank.get(card.rank).push(card);
    if (!cardsBySuit.has(card.suit)) cardsBySuit.set(card.suit, []);
    cardsBySuit.get(card.suit).push(card);
  });

  cardsByRank.forEach((list) => list.sort((a, b) => a.suit.localeCompare(b.suit)));
  cardsBySuit.forEach((list) => list.sort(byRankDesc));

  const uniqueRanksDesc = Array.from(cardsByRank.keys()).sort((a, b) => b - a);
  const ranksByCount = { 4: [], 3: [], 2: [], 1: [] };
  uniqueRanksDesc.forEach((rank) => {
    const count = cardsByRank.get(rank).length;
    if (!ranksByCount[count]) ranksByCount[count] = [];
    ranksByCount[count].push(rank);
  });

  let bestStraightFlush = null;
  const suitNames = Array.from(cardsBySuit.keys()).sort();
  suitNames.forEach((suit) => {
    const suited = cardsBySuit.get(suit);
    if (suited.length < 5) return;
    const suitRanks = Array.from(new Set(suited.map((c) => c.rank))).sort((a, b) => b - a);
    const straight = findStraight(suitRanks);
    if (!straight) return;
    const cardsByRankSuit = new Map();
    suited.forEach((card) => {
      if (!cardsByRankSuit.has(card.rank)) cardsByRankSuit.set(card.rank, []);
      cardsByRankSuit.get(card.rank).push(card);
    });
    cardsByRankSuit.forEach((list) => list.sort((a, b) => a.suit.localeCompare(b.suit)));
    const candidate = {
      high: straight.high === 1 ? 5 : straight.high,
      ranks: straight.ranks,
      suit,
      cards: pickStraightCards(straight.ranks, cardsByRankSuit),
    };
    if (!bestStraightFlush) {
      bestStraightFlush = candidate;
      return;
    }
    if (candidate.high > bestStraightFlush.high) {
      bestStraightFlush = candidate;
      return;
    }
    if (candidate.high === bestStraightFlush.high && suit.localeCompare(bestStraightFlush.suit) < 0) {
      bestStraightFlush = candidate;
    }
  });

  if (bestStraightFlush) {
    const ranks = [bestStraightFlush.high === 1 ? 5 : bestStraightFlush.high];
    return {
      category: HAND_CATEGORY.STRAIGHT_FLUSH,
      name: CATEGORY_NAME[HAND_CATEGORY.STRAIGHT_FLUSH],
      ranks,
      best5: bestStraightFlush.cards.map((c) => c.raw),
      key: `${HAND_CATEGORY.STRAIGHT_FLUSH}:${ranks.join(",")}`,
    };
  }

  if (ranksByCount[4].length) {
    const quadRank = ranksByCount[4][0];
    const quadCards = cardsByRank.get(quadRank).slice(0, 4);
    const kicker = allCardsSorted.find((card) => card.rank !== quadRank);
    const ranks = [quadRank, kicker.rank];
    return {
      category: HAND_CATEGORY.QUADS,
      name: CATEGORY_NAME[HAND_CATEGORY.QUADS],
      ranks,
      best5: [...quadCards, kicker].map((c) => c.raw),
      key: `${HAND_CATEGORY.QUADS}:${ranks.join(",")}`,
    };
  }

  if (ranksByCount[3].length) {
    const tripRank = ranksByCount[3][0];
    const pairRank = ranksByCount[2].find((rank) => rank !== tripRank) || ranksByCount[3][1];
    if (pairRank) {
      const tripCards = cardsByRank.get(tripRank).slice(0, 3);
      const pairCards = cardsByRank.get(pairRank).slice(0, 2);
      const ranks = [tripRank, pairRank];
      return {
        category: HAND_CATEGORY.FULL_HOUSE,
        name: CATEGORY_NAME[HAND_CATEGORY.FULL_HOUSE],
        ranks,
        best5: [...tripCards, ...pairCards].map((c) => c.raw),
        key: `${HAND_CATEGORY.FULL_HOUSE}:${ranks.join(",")}`,
      };
    }
  }

  let bestFlush = null;
  suitNames.forEach((suit) => {
    const suited = cardsBySuit.get(suit);
    if (suited.length < 5) return;
    const top = suited.slice(0, 5);
    const ranks = top.map((c) => c.rank);
    if (!bestFlush) {
      bestFlush = { suit, ranks, cards: top };
      return;
    }
    const cmp = compareRankVectors(ranks, bestFlush.ranks);
    if (cmp > 0) {
      bestFlush = { suit, ranks, cards: top };
      return;
    }
    if (cmp === 0 && suit.localeCompare(bestFlush.suit) < 0) {
      bestFlush = { suit, ranks, cards: top };
    }
  });

  if (bestFlush) {
    return {
      category: HAND_CATEGORY.FLUSH,
      name: CATEGORY_NAME[HAND_CATEGORY.FLUSH],
      ranks: bestFlush.ranks,
      best5: bestFlush.cards.map((c) => c.raw),
      key: `${HAND_CATEGORY.FLUSH}:${bestFlush.ranks.join(",")}`,
    };
  }

  const straight = findStraight(uniqueRanksDesc);
  if (straight) {
    const ranks = [straight.high === 1 ? 5 : straight.high];
    const best5 = pickStraightCards(straight.ranks, cardsByRank);
    return {
      category: HAND_CATEGORY.STRAIGHT,
      name: CATEGORY_NAME[HAND_CATEGORY.STRAIGHT],
      ranks,
      best5: best5.map((c) => c.raw),
      key: `${HAND_CATEGORY.STRAIGHT}:${ranks.join(",")}`,
    };
  }

  if (ranksByCount[3].length) {
    const tripRank = ranksByCount[3][0];
    const tripCards = cardsByRank.get(tripRank).slice(0, 3);
    const kickers = allCardsSorted.filter((card) => card.rank !== tripRank).slice(0, 2);
    const ranks = [tripRank, ...kickers.map((c) => c.rank)];
    return {
      category: HAND_CATEGORY.TRIPS,
      name: CATEGORY_NAME[HAND_CATEGORY.TRIPS],
      ranks,
      best5: [...tripCards, ...kickers].map((c) => c.raw),
      key: `${HAND_CATEGORY.TRIPS}:${ranks.join(",")}`,
    };
  }

  if (ranksByCount[2].length >= 2) {
    const highPair = ranksByCount[2][0];
    const lowPair = ranksByCount[2][1];
    const highPairCards = cardsByRank.get(highPair).slice(0, 2);
    const lowPairCards = cardsByRank.get(lowPair).slice(0, 2);
    const kicker = allCardsSorted.find((card) => card.rank !== highPair && card.rank !== lowPair);
    const ranks = [highPair, lowPair, kicker.rank];
    return {
      category: HAND_CATEGORY.TWO_PAIR,
      name: CATEGORY_NAME[HAND_CATEGORY.TWO_PAIR],
      ranks,
      best5: [...highPairCards, ...lowPairCards, kicker].map((c) => c.raw),
      key: `${HAND_CATEGORY.TWO_PAIR}:${ranks.join(",")}`,
    };
  }

  if (ranksByCount[2].length) {
    const pairRank = ranksByCount[2][0];
    const pairCards = cardsByRank.get(pairRank).slice(0, 2);
    const kickers = allCardsSorted.filter((card) => card.rank !== pairRank).slice(0, 3);
    const ranks = [pairRank, ...kickers.map((c) => c.rank)];
    return {
      category: HAND_CATEGORY.PAIR,
      name: CATEGORY_NAME[HAND_CATEGORY.PAIR],
      ranks,
      best5: [...pairCards, ...kickers].map((c) => c.raw),
      key: `${HAND_CATEGORY.PAIR}:${ranks.join(",")}`,
    };
  }

  const bestHigh = allCardsSorted.slice(0, 5);
  const ranks = bestHigh.map((c) => c.rank);
  return {
    category: HAND_CATEGORY.HIGH_CARD,
    name: CATEGORY_NAME[HAND_CATEGORY.HIGH_CARD],
    ranks,
    best5: bestHigh.map((c) => c.raw),
    key: `${HAND_CATEGORY.HIGH_CARD}:${ranks.join(",")}`,
  };
};

const compareHands = (a, b) => {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  return compareRankVectors(a.ranks, b.ranks);
};

export { HAND_CATEGORY, evaluateBestHand, compareHands };
