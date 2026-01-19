// TODO(poker-tests): add Vitest coverage for hand evaluator once Vitest is available.
const RANKS = "23456789TJQKA";
const RANK_VALUES = RANKS.split("").reduce((acc, r, idx) => {
  acc[r] = idx + 2;
  return acc;
}, {});

const parseCard = (card) => {
  if (!card || typeof card !== "string") return null;
  const trimmed = card.trim();
  if (trimmed.length < 2) return null;
  const rank = trimmed[0].toUpperCase();
  const suit = trimmed[1].toLowerCase();
  if (!RANK_VALUES[rank]) return null;
  if (!"cdhs".includes(suit)) return null;
  return { rank, suit, value: RANK_VALUES[rank] };
};

const isStraight = (values) => {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.length < 5) return null;
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const slice = unique.slice(i, i + 5);
    if (slice[0] - slice[4] === 4) return slice[0];
  }
  if (unique.includes(14) && unique.includes(5) && unique.includes(4) && unique.includes(3) && unique.includes(2)) {
    return 5;
  }
  return null;
};

const scoreFive = (cards) => {
  const parsed = cards.map(parseCard).filter(Boolean);
  if (parsed.length !== 5) return null;
  const values = parsed.map((c) => c.value).sort((a, b) => b - a);
  const suits = parsed.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);
  const straightHigh = isStraight(values);
  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => (b.count - a.count) || (b.value - a.value));

  if (isFlush && straightHigh) return [8, straightHigh];
  if (groups[0].count === 4) {
    const kicker = groups.find((g) => g.count === 1).value;
    return [7, groups[0].value, kicker];
  }
  if (groups[0].count === 3 && groups[1].count === 2) return [6, groups[0].value, groups[1].value];
  if (isFlush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0].count === 3) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.value).sort((a, b) => b - a);
    return [3, groups[0].value, ...kickers];
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const highPair = Math.max(groups[0].value, groups[1].value);
    const lowPair = Math.min(groups[0].value, groups[1].value);
    const kicker = groups.find((g) => g.count === 1).value;
    return [2, highPair, lowPair, kicker];
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.value).sort((a, b) => b - a);
    return [1, groups[0].value, ...kickers];
  }
  return [0, ...values];
};

const compareScores = (a, b) => {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
};

const evaluateHand = (cards) => {
  if (!Array.isArray(cards) || cards.length < 5) return null;
  const best = { score: null, cards: null };
  const total = cards.length;
  for (let a = 0; a < total - 4; a += 1) {
    for (let b = a + 1; b < total - 3; b += 1) {
      for (let c = b + 1; c < total - 2; c += 1) {
        for (let d = c + 1; d < total - 1; d += 1) {
          for (let e = d + 1; e < total; e += 1) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = scoreFive(five);
            if (!best.score || compareScores(score, best.score) > 0) {
              best.score = score;
              best.cards = five;
            }
          }
        }
      }
    }
  }
  return best.score ? { score: best.score, cards: best.cards } : null;
};

export { evaluateHand, compareScores };
