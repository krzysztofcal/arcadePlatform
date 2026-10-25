// GENERATED from shared accepted WS rules and strategy. Do not edit.
(() => {
  // ws-server/poker/shared/settlement/poker-eval.mjs
  var HAND_CATEGORY = {
    HIGH_CARD: 1,
    PAIR: 2,
    TWO_PAIR: 3,
    TRIPS: 4,
    STRAIGHT: 5,
    FLUSH: 6,
    FULL_HOUSE: 7,
    QUADS: 8,
    STRAIGHT_FLUSH: 9
  };
  var CATEGORY_NAME = {
    1: "HIGH_CARD",
    2: "PAIR",
    3: "TWO_PAIR",
    4: "TRIPS",
    5: "STRAIGHT",
    6: "FLUSH",
    7: "FULL_HOUSE",
    8: "QUADS",
    9: "STRAIGHT_FLUSH"
  };
  var normalizeRank = (r) => {
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
  var normalizeSuit = (s) => {
    if (typeof s !== "string") return null;
    const v = s.trim();
    if (!v) return null;
    return v.toUpperCase();
  };
  var cardKey = (card) => `${card.rank}-${card.suit}`;
  var assertValidCards = (cards) => {
    if (!Array.isArray(cards)) throw new Error("invalid_card");
    if (cards.length < 5) throw new Error("insufficient_cards");
    const seen = /* @__PURE__ */ new Set();
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
  var compareRankVectors = (a, b) => {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      const diff = (a[i] || 0) - (b[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  };
  var byRankDesc = (a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    return a.suit.localeCompare(b.suit);
  };
  var findStraight = (ranksDesc) => {
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
  var pickStraightCards = (ranks, cardsByRank) => {
    return ranks.map((r) => {
      const actual = r === 1 ? 14 : r;
      const list = cardsByRank.get(actual) || [];
      return list[0];
    });
  };
  var evaluateBestHand = (cards) => {
    const normalized = assertValidCards(cards);
    const allCardsSorted = normalized.slice().sort(byRankDesc);
    const cardsByRank = /* @__PURE__ */ new Map();
    const cardsBySuit = /* @__PURE__ */ new Map();
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
      const straight2 = findStraight(suitRanks);
      if (!straight2) return;
      const cardsByRankSuit = /* @__PURE__ */ new Map();
      suited.forEach((card) => {
        if (!cardsByRankSuit.has(card.rank)) cardsByRankSuit.set(card.rank, []);
        cardsByRankSuit.get(card.rank).push(card);
      });
      cardsByRankSuit.forEach((list) => list.sort((a, b) => a.suit.localeCompare(b.suit)));
      const candidate = {
        high: straight2.high === 1 ? 5 : straight2.high,
        ranks: straight2.ranks,
        suit,
        cards: pickStraightCards(straight2.ranks, cardsByRankSuit)
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
      const ranks2 = [bestStraightFlush.high === 1 ? 5 : bestStraightFlush.high];
      return {
        category: HAND_CATEGORY.STRAIGHT_FLUSH,
        name: CATEGORY_NAME[HAND_CATEGORY.STRAIGHT_FLUSH],
        ranks: ranks2,
        best5: bestStraightFlush.cards.map((c) => c.raw),
        key: `${HAND_CATEGORY.STRAIGHT_FLUSH}:${ranks2.join(",")}`
      };
    }
    if (ranksByCount[4].length) {
      const quadRank = ranksByCount[4][0];
      const quadCards = cardsByRank.get(quadRank).slice(0, 4);
      const kicker = allCardsSorted.find((card) => card.rank !== quadRank);
      const ranks2 = [quadRank, kicker.rank];
      return {
        category: HAND_CATEGORY.QUADS,
        name: CATEGORY_NAME[HAND_CATEGORY.QUADS],
        ranks: ranks2,
        best5: [...quadCards, kicker].map((c) => c.raw),
        key: `${HAND_CATEGORY.QUADS}:${ranks2.join(",")}`
      };
    }
    if (ranksByCount[3].length) {
      const tripRank = ranksByCount[3][0];
      const pairRank = ranksByCount[2].find((rank) => rank !== tripRank) || ranksByCount[3][1];
      if (pairRank) {
        const tripCards = cardsByRank.get(tripRank).slice(0, 3);
        const pairCards = cardsByRank.get(pairRank).slice(0, 2);
        const ranks2 = [tripRank, pairRank];
        return {
          category: HAND_CATEGORY.FULL_HOUSE,
          name: CATEGORY_NAME[HAND_CATEGORY.FULL_HOUSE],
          ranks: ranks2,
          best5: [...tripCards, ...pairCards].map((c) => c.raw),
          key: `${HAND_CATEGORY.FULL_HOUSE}:${ranks2.join(",")}`
        };
      }
    }
    let bestFlush = null;
    suitNames.forEach((suit) => {
      const suited = cardsBySuit.get(suit);
      if (suited.length < 5) return;
      const top = suited.slice(0, 5);
      const ranks2 = top.map((c) => c.rank);
      if (!bestFlush) {
        bestFlush = { suit, ranks: ranks2, cards: top };
        return;
      }
      const cmp = compareRankVectors(ranks2, bestFlush.ranks);
      if (cmp > 0) {
        bestFlush = { suit, ranks: ranks2, cards: top };
        return;
      }
      if (cmp === 0 && suit.localeCompare(bestFlush.suit) < 0) {
        bestFlush = { suit, ranks: ranks2, cards: top };
      }
    });
    if (bestFlush) {
      return {
        category: HAND_CATEGORY.FLUSH,
        name: CATEGORY_NAME[HAND_CATEGORY.FLUSH],
        ranks: bestFlush.ranks,
        best5: bestFlush.cards.map((c) => c.raw),
        key: `${HAND_CATEGORY.FLUSH}:${bestFlush.ranks.join(",")}`
      };
    }
    const straight = findStraight(uniqueRanksDesc);
    if (straight) {
      const ranks2 = [straight.high === 1 ? 5 : straight.high];
      const best5 = pickStraightCards(straight.ranks, cardsByRank);
      return {
        category: HAND_CATEGORY.STRAIGHT,
        name: CATEGORY_NAME[HAND_CATEGORY.STRAIGHT],
        ranks: ranks2,
        best5: best5.map((c) => c.raw),
        key: `${HAND_CATEGORY.STRAIGHT}:${ranks2.join(",")}`
      };
    }
    if (ranksByCount[3].length) {
      const tripRank = ranksByCount[3][0];
      const tripCards = cardsByRank.get(tripRank).slice(0, 3);
      const kickers = allCardsSorted.filter((card) => card.rank !== tripRank).slice(0, 2);
      const ranks2 = [tripRank, ...kickers.map((c) => c.rank)];
      return {
        category: HAND_CATEGORY.TRIPS,
        name: CATEGORY_NAME[HAND_CATEGORY.TRIPS],
        ranks: ranks2,
        best5: [...tripCards, ...kickers].map((c) => c.raw),
        key: `${HAND_CATEGORY.TRIPS}:${ranks2.join(",")}`
      };
    }
    if (ranksByCount[2].length >= 2) {
      const highPair = ranksByCount[2][0];
      const lowPair = ranksByCount[2][1];
      const highPairCards = cardsByRank.get(highPair).slice(0, 2);
      const lowPairCards = cardsByRank.get(lowPair).slice(0, 2);
      const kicker = allCardsSorted.find((card) => card.rank !== highPair && card.rank !== lowPair);
      const ranks2 = [highPair, lowPair, kicker.rank];
      return {
        category: HAND_CATEGORY.TWO_PAIR,
        name: CATEGORY_NAME[HAND_CATEGORY.TWO_PAIR],
        ranks: ranks2,
        best5: [...highPairCards, ...lowPairCards, kicker].map((c) => c.raw),
        key: `${HAND_CATEGORY.TWO_PAIR}:${ranks2.join(",")}`
      };
    }
    if (ranksByCount[2].length) {
      const pairRank = ranksByCount[2][0];
      const pairCards = cardsByRank.get(pairRank).slice(0, 2);
      const kickers = allCardsSorted.filter((card) => card.rank !== pairRank).slice(0, 3);
      const ranks2 = [pairRank, ...kickers.map((c) => c.rank)];
      return {
        category: HAND_CATEGORY.PAIR,
        name: CATEGORY_NAME[HAND_CATEGORY.PAIR],
        ranks: ranks2,
        best5: [...pairCards, ...kickers].map((c) => c.raw),
        key: `${HAND_CATEGORY.PAIR}:${ranks2.join(",")}`
      };
    }
    const bestHigh = allCardsSorted.slice(0, 5);
    const ranks = bestHigh.map((c) => c.rank);
    return {
      category: HAND_CATEGORY.HIGH_CARD,
      name: CATEGORY_NAME[HAND_CATEGORY.HIGH_CARD],
      ranks,
      best5: bestHigh.map((c) => c.raw),
      key: `${HAND_CATEGORY.HIGH_CARD}:${ranks.join(",")}`
    };
  };
  var compareHands = (a, b) => {
    if (a.category !== b.category) return a.category > b.category ? 1 : -1;
    return compareRankVectors(a.ranks, b.ranks);
  };

  // ws-server/poker/handlers/reaction.mjs
  var POST_FLOP_STREETS = /* @__PURE__ */ new Set(["FLOP", "TURN", "RIVER"]);
  var REACTION_KEYS = Object.freeze([
    "hello",
    "nice_hand",
    "well_played",
    "thinking",
    "haha",
    "wow",
    "bad_beat",
    "nice_bluff",
    "good_luck",
    "thanks",
    "cheers",
    "gg",
    "hurry_up",
    "you_are_bluffing",
    "i_was_bluffing",
    "lucky",
    "congrats",
    "not_this_time",
    "all_in_oh_no",
    "all_in_that_hurts",
    "all_in_no_way",
    "all_in_come_on",
    "all_in_censored",
    "ambient_hmm",
    "ambient_interesting",
    "ambient_lets_see",
    "ambient_well_see",
    "ambient_watching",
    "ambient_good_move",
    "ambient_bold",
    "ambient_nice",
    "ambient_tough_one",
    "ambient_here_we_go",
    "ambient_your_move",
    "ambient_lets_play",
    "ambient_thinking"
  ]);
  var HUMAN_REACTION_KEYS = Object.freeze([
    "hello",
    "nice_hand",
    "well_played",
    "thinking",
    "haha",
    "wow",
    "bad_beat",
    "nice_bluff",
    "good_luck",
    "thanks",
    "cheers",
    "gg",
    "hurry_up"
  ]);
  var REACTION_KEY_SET = new Set(REACTION_KEYS);
  var HUMAN_REACTION_KEY_SET = new Set(HUMAN_REACTION_KEYS);
  var BOT_REACTION_KEYS_BY_ACTION = Object.freeze({
    BET: Object.freeze(["wow", "haha"]),
    ALL_IN: Object.freeze(["wow", "haha"]),
    FOLD: Object.freeze(["not_this_time"])
  });
  var BOT_REACTION_PROBABILITY_BY_ACTION = Object.freeze({ BET: 0.6, ALL_IN: 0.6, FOLD: 0.7 });
  var ALL_IN_LOSS_REACTION_KEYS = Object.freeze([
    "all_in_oh_no",
    "all_in_that_hurts",
    "all_in_no_way",
    "all_in_come_on",
    "all_in_censored"
  ]);
  var AMBIENT_REACTION_KEYS = Object.freeze([
    "ambient_hmm",
    "ambient_interesting",
    "ambient_lets_see",
    "ambient_well_see",
    "ambient_watching",
    "ambient_good_move",
    "ambient_bold",
    "ambient_nice",
    "ambient_tough_one",
    "ambient_here_we_go",
    "ambient_your_move",
    "ambient_lets_play",
    "ambient_thinking"
  ]);
  function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function isPositiveSeatNo(value) {
    return Number.isInteger(value) && value > 0;
  }
  function samplePasses(random, probability, reactionSettings) {
    if (reactionSettings?.enabled === false) return false;
    const frequencyPercent = Number.isInteger(Number(reactionSettings?.frequencyPercent)) ? Math.min(100, Math.max(1, Number(reactionSettings.frequencyPercent))) : 100;
    const sample = Number(random());
    return Number.isFinite(sample) && sample >= 0 && sample < probability * frequencyPercent / 100;
  }
  function normalizeBotSeats(value) {
    if (!Array.isArray(value)) return [];
    const seen = /* @__PURE__ */ new Set();
    return value.map((entry) => ({
      userId: normalizeString(entry?.userId),
      seatNo: Number(entry?.seatNo)
    })).filter((entry) => entry.userId && isPositiveSeatNo(entry.seatNo) && !seen.has(entry.userId) && seen.add(entry.userId)).sort((left, right) => left.seatNo - right.seatNo);
  }
  function normalizeHandSeats(value) {
    if (!Array.isArray(value)) return [];
    const seen = /* @__PURE__ */ new Set();
    return value.map((entry) => ({ userId: normalizeString(entry?.userId), seatNo: Number(entry?.seatNo) })).filter((entry) => entry.userId && isPositiveSeatNo(entry.seatNo) && !seen.has(entry.userId) && seen.add(entry.userId)).sort((left, right) => left.seatNo - right.seatNo);
  }
  function winnerSeats(state, handSeats) {
    const winners = new Set(Array.isArray(state?.showdown?.winners) ? state.showdown.winners.map(normalizeString).filter(Boolean) : []);
    return handSeats.filter((seat) => winners.has(seat.userId));
  }
  function normalFoldWin(state, handSeats, winners) {
    if (winners.length !== 1 || handSeats.length < 2) return false;
    const winnerUserId = winners[0].userId;
    return handSeats.every((seat) => seat.userId === winnerUserId || state?.foldedByUserId?.[seat.userId] === true && state?.leftTableByUserId?.[seat.userId] !== true && state?.sitOutByUserId?.[seat.userId] !== true);
  }
  function canBotSpeakAfterSettlement(state, handSeats, bot) {
    return !!bot && handSeats.some((seat) => seat.userId === bot.userId) && state?.leftTableByUserId?.[bot.userId] !== true && state?.sitOutByUserId?.[bot.userId] !== true;
  }
  function canBotReactToSettlement(state, handSeats, bot, winners) {
    return canBotSpeakAfterSettlement(state, handSeats, bot) && !winners.some((winner) => winner.userId === bot.userId);
  }
  var PRIMARY_RANK_COUNT_BY_CATEGORY = Object.freeze({ 2: 1, 3: 2, 4: 1, 8: 1 });
  function validRankVector(hand) {
    return Number.isInteger(Number(hand?.category)) && Array.isArray(hand?.ranks) && hand.ranks.length > 0 && hand.ranks.every((rank) => Number.isInteger(Number(rank))) ? hand.ranks.map(Number) : null;
  }
  function looksLuckyComparedWith(winningHand, losingHand) {
    const winningRanks = validRankVector(winningHand);
    const losingRanks = validRankVector(losingHand);
    const category = Number(winningHand?.category);
    if (!winningRanks || !losingRanks || category !== Number(losingHand?.category)) return false;
    const differingIndexes = [];
    for (let index = 0; index < Math.max(winningRanks.length, losingRanks.length); index += 1) {
      if ((winningRanks[index] ?? 0) !== (losingRanks[index] ?? 0)) differingIndexes.push(index);
    }
    if (differingIndexes.length === 0) return false;
    const firstDifference = differingIndexes[0];
    const primaryRankCount = PRIMARY_RANK_COUNT_BY_CATEGORY[category];
    const kickerDecided = Number.isInteger(primaryRankCount) && firstDifference >= primaryRankCount;
    const narrowRankDifference = Math.abs((winningRanks[firstDifference] ?? 0) - (losingRanks[firstDifference] ?? 0)) === 1;
    const almostIdentical = differingIndexes.length === 1 && Math.abs((winningRanks[firstDifference] ?? 0) - (losingRanks[firstDifference] ?? 0)) <= 1;
    return kickerDecided || narrowRankDifference || almostIdentical;
  }
  function luckyWinner(state, handSeats, winners) {
    const comparedHands = state?.showdown?.handsByUserId;
    const riverChangedWinnerUserIds = new Set(Array.isArray(state?.riverChangedWinnerUserIds) ? state.riverChangedWinnerUserIds.map(normalizeString).filter(Boolean) : []);
    if (!comparedHands || typeof comparedHands !== "object") {
      return winners.find((winner) => riverChangedWinnerUserIds.has(winner.userId)) || null;
    }
    const winnerUserIds = new Set(winners.map((winner) => winner.userId));
    const losers = handSeats.filter((seat) => !winnerUserIds.has(seat.userId));
    return winners.find((winner) => riverChangedWinnerUserIds.has(winner.userId) || losers.some((loser) => looksLuckyComparedWith(comparedHands[winner.userId], comparedHands[loser.userId]))) || null;
  }
  function isCompleteReactionSettlement(state) {
    if (!state || state.phase !== "SETTLED") return false;
    const handId = normalizeString(state.handId);
    return !!handId && handId === normalizeString(state?.handSettlement?.handId) && handId === normalizeString(state?.showdown?.handId) && Array.isArray(state.handSeats) && Array.isArray(state.showdown?.winners) && !!state.handSettlement?.payouts && typeof state.handSettlement.payouts === "object" && !Array.isArray(state.handSettlement.payouts);
  }
  function classifyRaiseReaction({ actorUserId, actorSeatNo, street, botSeats, reactionSettings, random = Math.random } = {}) {
    const normalizedActorUserId = normalizeString(actorUserId);
    const normalizedStreet = normalizeString(street).toUpperCase();
    if (!POST_FLOP_STREETS.has(normalizedStreet) || !normalizedActorUserId || !isPositiveSeatNo(actorSeatNo) || !samplePasses(random, 0.6, reactionSettings)) return null;
    const reactor = normalizeBotSeats(botSeats).find((bot) => bot.userId !== normalizedActorUserId);
    return reactor ? {
      botUserId: reactor.userId,
      botSeatNo: reactor.seatNo,
      targetSeatNo: actorSeatNo,
      reactionKey: "you_are_bluffing"
    } : null;
  }
  function classifyAmbientReaction({ botSeats, reactionSettings, random = Math.random } = {}) {
    const bots = normalizeBotSeats(botSeats);
    if (bots.length === 0 || !samplePasses(random, 0.5, reactionSettings)) return null;
    const botSample = Number(random());
    const botIndex = Number.isFinite(botSample) && botSample >= 0 && botSample < 1 ? Math.floor(botSample * bots.length) : 0;
    const keySample = Number(random());
    const keyIndex = Number.isFinite(keySample) && keySample >= 0 && keySample < 1 ? Math.floor(keySample * AMBIENT_REACTION_KEYS.length) : 0;
    const bot = bots[botIndex] || bots[0];
    return { botUserId: bot.userId, botSeatNo: bot.seatNo, reactionKey: AMBIENT_REACTION_KEYS[keyIndex] || AMBIENT_REACTION_KEYS[0] };
  }
  function isPlayerAllIn(userId, handStartStacks, contributions) {
    const start = handStartStacks?.[userId];
    const contrib = contributions?.[userId];
    if (typeof start !== "number" || !Number.isInteger(start) || start <= 0) return false;
    if (typeof contrib !== "number" || !Number.isInteger(contrib) || contrib < 0) return false;
    return contrib === start;
  }
  function isLostAllInCandidate(botUserId, state) {
    if (!state?.showdown?.handsByUserId || typeof state.showdown.handsByUserId !== "object" || !state.showdown.handsByUserId[botUserId]) {
      return false;
    }
    if (state?.foldedByUserId?.[botUserId] === true || state?.leftTableByUserId?.[botUserId] === true || state?.sitOutByUserId?.[botUserId] === true) {
      return false;
    }
    if (Array.isArray(state?.showdown?.winners) && state.showdown.winners.includes(botUserId)) {
      return false;
    }
    const payouts = state?.handSettlement?.payouts;
    if (!payouts || typeof payouts !== "object") {
      return false;
    }
    let payout = 0;
    if (Object.hasOwn(payouts, botUserId)) {
      const rawPayout = payouts[botUserId];
      if (typeof rawPayout !== "number" || !Number.isInteger(rawPayout) || rawPayout < 0) {
        return false;
      }
      payout = rawPayout;
    }
    if (payout > 0) {
      return false;
    }
    return isPlayerAllIn(botUserId, state?.handStartStacksByUserId, state?.contributionsByUserId);
  }
  function sampleAllInLossReactionKey(random = Math.random) {
    const r = typeof random === "function" ? random() : Math.random();
    const clamped = Math.min(Math.max(Number(r) || 0, 0), 0.999999);
    const index = Math.floor(clamped * ALL_IN_LOSS_REACTION_KEYS.length);
    return ALL_IN_LOSS_REACTION_KEYS[index] || ALL_IN_LOSS_REACTION_KEYS[0];
  }
  function classifySettlementReaction({ state, botSeats, reactionSettings, random = Math.random } = {}) {
    if (reactionSettings?.enabled === false || !isCompleteReactionSettlement(state)) return null;
    const handId = normalizeString(state.handId);
    const handSeats = normalizeHandSeats(state.handSeats);
    const bots = normalizeBotSeats(botSeats);
    const botByUserId = new Map(bots.map((bot) => [bot.userId, bot]));
    const winners = winnerSeats(state, handSeats);
    if (normalFoldWin(state, handSeats, winners)) {
      const winner = winners[0];
      const winningBot = botByUserId.get(winner.userId);
      if (canBotSpeakAfterSettlement(state, handSeats, winningBot) && samplePasses(random, 0.75, reactionSettings)) {
        return { botUserId: winningBot.userId, botSeatNo: winningBot.seatNo, reactionKey: "i_was_bluffing", handId };
      }
      const reactor2 = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
      if (reactor2 && samplePasses(random, 0.75, reactionSettings)) {
        return { botUserId: reactor2.userId, botSeatNo: reactor2.seatNo, targetSeatNo: winner.seatNo, reactionKey: "nice_bluff", handId };
      }
    }
    const lostAllInBot = bots.find((bot) => canBotSpeakAfterSettlement(state, handSeats, bot) && isLostAllInCandidate(bot.userId, state));
    if (lostAllInBot && samplePasses(random, 1, reactionSettings)) {
      const hands = state?.showdown?.handsByUserId;
      const isHeadsUp = Boolean(hands && typeof hands === "object" && Object.keys(hands).length === 2);
      const winnersList = state?.showdown?.winners;
      const singleWinner = Array.isArray(winnersList) && winnersList.length === 1 ? winnersList[0] : null;
      const isRiverReversal = Boolean(singleWinner && Array.isArray(state?.riverChangedWinnerUserIds) && state.riverChangedWinnerUserIds.includes(singleWinner));
      if (isHeadsUp && singleWinner && isRiverReversal) {
        return {
          botUserId: lostAllInBot.userId,
          botSeatNo: lostAllInBot.seatNo,
          reactionKey: "bad_beat",
          handId
        };
      }
      return {
        botUserId: lostAllInBot.userId,
        botSeatNo: lostAllInBot.seatNo,
        reactionKey: sampleAllInLossReactionKey(random),
        handId
      };
    }
    const comparedHands = state?.showdown?.handsByUserId;
    const luckyTarget = luckyWinner(state, handSeats, winners);
    const luckyReactor = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
    if (luckyTarget && luckyReactor && samplePasses(random, 0.7, reactionSettings)) {
      return { botUserId: luckyReactor.userId, botSeatNo: luckyReactor.seatNo, targetSeatNo: luckyTarget.seatNo, reactionKey: "lucky", handId };
    }
    if (comparedHands && typeof comparedHands === "object" && Object.keys(comparedHands).length >= 2) {
      const strongWinner = winners.find((winner) => Number(comparedHands?.[winner.userId]?.category) >= 4);
      const reactor2 = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
      if (strongWinner && reactor2 && samplePasses(random, 0.9, reactionSettings)) {
        return { botUserId: reactor2.userId, botSeatNo: reactor2.seatNo, targetSeatNo: strongWinner.seatNo, reactionKey: "nice_hand", handId };
      }
    }
    const bigBlind = Number(state.bigBlind);
    if (Number.isInteger(bigBlind) && bigBlind > 0) {
      const largeWinner = winners.find((winner) => {
        const payout = Number(state?.handSettlement?.payouts?.[winner.userId]);
        return botByUserId.has(winner.userId) && Number.isFinite(payout) && payout >= 20 * bigBlind;
      });
      if (largeWinner && samplePasses(random, 1, reactionSettings)) {
        const bot = botByUserId.get(largeWinner.userId);
        return { botUserId: bot.userId, botSeatNo: bot.seatNo, reactionKey: "wow", handId };
      }
    }
    const firstWinner = winners[0];
    const reactor = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
    if (firstWinner && reactor && samplePasses(random, 0.8, reactionSettings)) {
      const selection = Number(random());
      const reactionKey = Number.isFinite(selection) && selection >= 0.5 && selection < 1 ? "congrats" : "well_played";
      return { botUserId: reactor.userId, botSeatNo: reactor.seatNo, targetSeatNo: firstWinner.seatNo, reactionKey, handId };
    }
    return null;
  }

  // poker/offline/browser-crypto.mjs
  var digests = /* @__PURE__ */ new Map();
  async function prepareSeed(seed) {
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    digests.clear();
    digests.set(seed, new DataView(bytes));
  }
  function createHash(algorithm) {
    if (algorithm !== "sha256") throw new Error("Unsupported offline digest");
    let seed;
    return {
      update(value) {
        seed = value;
        return this;
      },
      digest() {
        const view = digests.get(seed);
        if (!view) throw new Error("Offline seed must be prepared before dealing");
        return { readUInt32BE(offset) {
          return view.getUint32(offset, false);
        } };
      }
    };
  }
  var browser_crypto_default = { createHash };

  // ws-server/poker/shared/poker-primitives.mjs
  var SUITS = ["S", "H", "D", "C"];
  var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  var ACTION_PHASES = /* @__PURE__ */ new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);
  var RANK_TO_CODE = {
    14: "A",
    13: "K",
    12: "Q",
    11: "J",
    10: "T",
    9: "9",
    8: "8",
    7: "7",
    6: "6",
    5: "5",
    4: "4",
    3: "3",
    2: "2"
  };
  function createDeck() {
    const deck = [];
    for (const s of SUITS) {
      for (const r of RANKS) {
        deck.push({ r, s });
      }
    }
    return deck;
  }
  function asSeed(seed) {
    return typeof seed === "string" && seed.trim() ? seed.trim() : "ws-default-seed";
  }
  function deriveDeck(seed) {
    const deck = createDeck();
    const digest = browser_crypto_default.createHash("sha256").update(asSeed(seed)).digest();
    let state = digest.readUInt32BE(0) ^ digest.readUInt32BE(4) ^ digest.readUInt32BE(8) ^ digest.readUInt32BE(12);
    if (state === 0) {
      state = 2654435769;
    }
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }
  function dealHoleCards(deck, playerIds) {
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
      holeCardsByUserId
    };
  }
  function asCardCode(card) {
    if (typeof card === "string") {
      return card;
    }
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      return null;
    }
    const rank = RANK_TO_CODE[card.r];
    const suit = typeof card.s === "string" ? card.s.trim().toUpperCase() : "";
    if (!rank || !suit) {
      return null;
    }
    return `${rank}${suit}`;
  }
  function toCardCodes(cards) {
    if (!Array.isArray(cards)) {
      return [];
    }
    return cards.map(asCardCode).filter((card) => typeof card === "string" && card.length > 0);
  }
  function toHoleCardCodeMap(holeCardsByUserId) {
    if (!holeCardsByUserId || typeof holeCardsByUserId !== "object" || Array.isArray(holeCardsByUserId)) {
      return {};
    }
    const normalized = {};
    for (const [userId, cards] of Object.entries(holeCardsByUserId)) {
      normalized[userId] = toCardCodes(cards);
    }
    return normalized;
  }
  function toSafeInt(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.trunc(num);
  }
  function maxFromMap(value) {
    if (!value || typeof value !== "object") return 0;
    const nums = Object.values(value).map((entry) => toSafeInt(entry, 0)).filter((entry) => entry > 0);
    if (nums.length === 0) return 0;
    return Math.max(...nums);
  }
  function deriveCurrentBet(state) {
    const currentBet = toSafeInt(state.currentBet, null);
    if (currentBet == null || currentBet < 0) return maxFromMap(state.betThisRoundByUserId);
    return currentBet;
  }
  function deriveLastRaiseSize(state, currentBet) {
    const lastRaiseSize = toSafeInt(state.lastRaiseSize, null);
    if (lastRaiseSize == null || lastRaiseSize <= 0) return currentBet > 0 ? currentBet : 0;
    return lastRaiseSize;
  }
  function deriveBigBlind(state) {
    const bigBlind = toSafeInt(state?.bigBlind, 0);
    return bigBlind > 0 ? bigBlind : 1;
  }
  function canRaise(state, userId, toCall, lastRaiseSize) {
    return !state?.actedThisRoundByUserId?.[userId] || toCall >= lastRaiseSize;
  }
  function isActivePlayer(state, userId) {
    if (!state || !userId) return false;
    if (state.leftTableByUserId && state.leftTableByUserId[userId]) return false;
    if (state.sitOutByUserId && state.sitOutByUserId[userId]) return false;
    const folded = !!(state.foldedByUserId && state.foldedByUserId[userId]);
    const allIn = !!(state.allInByUserId && state.allInByUserId[userId]);
    return !folded && !allIn;
  }
  function isSeatedPlayer(state, userId) {
    if (!state || !userId) {
      return false;
    }
    const phase = typeof state?.phase === "string" ? state.phase : "";
    const seats = ACTION_PHASES.has(phase) && Array.isArray(state?.handSeats) && state.handSeats.length > 0 ? state.handSeats : state?.seats;
    if (Array.isArray(seats)) {
      return seats.some((seat) => seat && seat.userId === userId);
    }
    return !!(state.stacks && typeof state.stacks === "object" && Object.prototype.hasOwnProperty.call(state.stacks, userId));
  }
  function computeLegalActionsForSeatedPlayer(state, userId) {
    const stack = toSafeInt(state.stacks?.[userId], 0);
    const currentUserBet = toSafeInt(state.betThisRoundByUserId?.[userId], 0);
    const currentBet = deriveCurrentBet(state);
    const lastRaiseSize = deriveLastRaiseSize(state, currentBet);
    const toCall = Math.max(0, currentBet - currentUserBet);
    if (stack <= 0) {
      return { actions: [], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (toCall > 0) {
      const actions2 = ["FOLD", "CALL"];
      const maxRaiseTo = stack + currentUserBet;
      const rawMinRaiseTo = currentBet + lastRaiseSize;
      const minRaiseTo = maxRaiseTo > 0 ? Math.min(rawMinRaiseTo, maxRaiseTo) : rawMinRaiseTo;
      const mayRaise = canRaise(state, userId, toCall, lastRaiseSize) && maxRaiseTo > currentBet;
      if (mayRaise) actions2.push("RAISE");
      return {
        actions: actions2,
        toCall,
        minRaiseTo: mayRaise ? minRaiseTo : null,
        maxRaiseTo,
        maxBetAmount: null,
        minBetAmount: null
      };
    }
    const actions = ["FOLD", "CHECK"];
    if (stack > 0) actions.push("BET");
    const minBetAmount = Math.min(deriveBigBlind(state), stack);
    return { actions, toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: stack, minBetAmount };
  }
  function computeSharedLegalActions({ statePublic, userId } = {}) {
    const state = statePublic || {};
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    const phase = typeof state.phase === "string" ? state.phase : "";
    if (!ACTION_PHASES.has(phase)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (!userId || typeof userId !== "string") {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (!isSeatedPlayer(state, userId) || !isActivePlayer(state, userId)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    const turnUserId = typeof state.turnUserId === "string" ? state.turnUserId : "";
    if (!turnUserId) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (turnUserId !== userId) {
      const toCall = Math.max(0, deriveCurrentBet(state) - toSafeInt(state.betThisRoundByUserId?.[userId], 0));
      return { actions: ["FOLD"], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    return computeLegalActionsForSeatedPlayer(state, userId);
  }
  function computeProjectedLegalActions({ statePublic, userId } = {}) {
    const state = statePublic || {};
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    const phase = typeof state.phase === "string" ? state.phase : "";
    if (!ACTION_PHASES.has(phase)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (!userId || typeof userId !== "string") {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (!isSeatedPlayer(state, userId) || !isActivePlayer(state, userId)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    return computeLegalActionsForSeatedPlayer(state, userId);
  }

  // ws-server/poker/shared/settlement/poker-materialize-showdown.mjs
  var getHandId = (state) => typeof state?.handId === "string" && state.handId.trim() ? state.handId.trim() : "";
  var normalizeChipAmount = (name, value) => {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || Math.floor(amount) !== amount) {
      throw new Error(`showdown_invalid_${name}`);
    }
    return amount;
  };
  var normalizeSeatOrder = (seatUserIdsInOrder2, state) => {
    if (Array.isArray(seatUserIdsInOrder2) && seatUserIdsInOrder2.length > 0) {
      const seen2 = /* @__PURE__ */ new Set();
      const out2 = [];
      for (const raw of seatUserIdsInOrder2) {
        if (typeof raw !== "string") throw new Error("showdown_invalid_seats");
        const userId = raw.trim();
        if (!userId || seen2.has(userId)) throw new Error("showdown_invalid_seats");
        seen2.add(userId);
        out2.push(userId);
      }
      return out2;
    }
    if (!Array.isArray(state?.seats)) return [];
    const ordered = state.seats.slice().sort((a, b) => Number(a?.seatNo ?? 0) - Number(b?.seatNo ?? 0));
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const seat of ordered) {
      if (typeof seat?.userId !== "string") continue;
      const userId = seat.userId.trim();
      if (!userId) continue;
      if (seen.has(userId)) throw new Error("showdown_invalid_seats");
      seen.add(userId);
      out.push(userId);
    }
    return out;
  };
  var listEligibleUserIds = ({ state, seatUserIdsInOrder: seatUserIdsInOrder2 }) => {
    const seatOrder = normalizeSeatOrder(seatUserIdsInOrder2, state);
    if (seatOrder.length === 0) throw new Error("showdown_invalid_seats");
    const stacks = state.stacks || {};
    const eligible = [];
    for (const userId of seatOrder) {
      if (state.foldedByUserId?.[userId]) continue;
      if (state.leftTableByUserId?.[userId]) continue;
      if (state.sitOutByUserId?.[userId]) continue;
      if (!Object.prototype.hasOwnProperty.call(stacks, userId)) continue;
      normalizeChipAmount("stack", stacks[userId]);
      eligible.push(userId);
    }
    return { eligibleUserIds: eligible, seatOrder };
  };
  var ensureCommunityComplete = (state) => {
    if (!Array.isArray(state.community)) throw new Error("showdown_incomplete_community");
    if (state.community.length > 5) throw new Error("showdown_invalid_community");
    if (state.community.length !== 5) throw new Error("showdown_incomplete_community");
    return state.community.slice();
  };
  var copyStacks = (stacks) => {
    const source = stacks && typeof stacks === "object" && !Array.isArray(stacks) ? stacks : {};
    const out = {};
    for (const [userId, amount] of Object.entries(source)) {
      if (typeof userId !== "string" || !userId.trim()) continue;
      out[userId] = normalizeChipAmount("stack", amount);
    }
    return out;
  };
  var diffPayouts = (prevStacks, nextStacks) => {
    const payouts = {};
    const allUserIds = /* @__PURE__ */ new Set([...Object.keys(prevStacks || {}), ...Object.keys(nextStacks || {})]);
    for (const userId of allUserIds) {
      const before = normalizeChipAmount("stack", prevStacks?.[userId] ?? 0);
      const after = normalizeChipAmount("stack", nextStacks?.[userId] ?? 0);
      const delta = after - before;
      if (delta < 0) throw new Error("showdown_invalid_stack_delta");
      if (delta > 0) payouts[userId] = delta;
    }
    return payouts;
  };
  var normalizeWinnerIds = (raw) => {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const value of raw) {
      if (typeof value !== "string") continue;
      const userId = value.trim();
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      out.push(userId);
    }
    return out;
  };
  var buildPayoutsFromPotsAwarded = (potsAwarded) => {
    const payouts = {};
    if (!Array.isArray(potsAwarded)) return payouts;
    for (const pot of potsAwarded) {
      const amount = normalizeChipAmount("pot", pot?.amount ?? 0);
      const winners = normalizeWinnerIds(pot?.winners);
      if (winners.length === 0 || amount === 0) continue;
      const share = Math.floor(amount / winners.length);
      let remainder = amount - share * winners.length;
      let distributed = 0;
      for (const userId of winners) {
        const bonus = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        const add = share + bonus;
        payouts[userId] = (payouts[userId] || 0) + add;
        distributed += add;
      }
      if (distributed !== amount) throw new Error("showdown_invalid_pot_distribution");
    }
    return payouts;
  };
  var ensureExistingSettlementMatches = ({ state, handId }) => {
    const settlementHandId = typeof state?.handSettlement?.handId === "string" && state.handSettlement.handId.trim() ? state.handSettlement.handId.trim() : "";
    if (!settlementHandId || settlementHandId !== handId) {
      throw new Error("showdown_settlement_hand_mismatch");
    }
  };
  var finalizeSettlement = ({ state, handId, payouts, nowIso, klog }) => {
    if (state?.handSettlement) {
      ensureExistingSettlementMatches({ state, handId });
      return state;
    }
    const settledAt = typeof nowIso === "string" ? nowIso : (/* @__PURE__ */ new Date()).toISOString();
    const nextState = {
      ...state,
      phase: "SETTLED",
      turnUserId: null,
      turnStartedAt: null,
      turnDeadlineAt: null,
      handSettlement: {
        handId,
        settledAt,
        payouts
      }
    };
    if (typeof klog === "function") {
      klog("poker_hand_settled", {
        tableId: state?.tableId ?? null,
        handId,
        payouts
      });
    }
    return nextState;
  };
  var materializeShowdownAndPayout = ({
    state,
    seatUserIdsInOrder: seatUserIdsInOrder2,
    holeCardsByUserId,
    computeShowdown: computeShowdown2,
    awardPotsAtShowdown: awardPotsAtShowdown2,
    klog,
    nowIso
  }) => {
    if (!state || typeof state !== "object" || Array.isArray(state)) return { nextState: state };
    const handId = getHandId(state);
    const showdownHandId = typeof state.showdown?.handId === "string" && state.showdown.handId.trim() ? state.showdown.handId.trim() : "";
    if (state.showdown) {
      if (!handId) return { nextState: state };
      if (!showdownHandId || showdownHandId !== handId) throw new Error("showdown_hand_mismatch");
      if (normalizeChipAmount("pot", state.pot) > 0) throw new Error("showdown_pot_not_zero");
      if (state.handSettlement) {
        ensureExistingSettlementMatches({ state, handId });
        return { nextState: state };
      }
      const payouts2 = buildPayoutsFromPotsAwarded(state.showdown?.potsAwarded);
      const payoutTotal = Object.values(payouts2).reduce((sum, value) => sum + normalizeChipAmount("pot", value), 0);
      const expectedTotal = normalizeChipAmount(
        "pot",
        state.showdown?.potAwardedTotal ?? state.showdown?.potAwarded ?? 0
      );
      if (payoutTotal !== expectedTotal) throw new Error("showdown_invalid_settlement_total");
      if (typeof klog === "function") {
        klog("poker_settlement_backfilled", {
          tableId: state?.tableId ?? null,
          handId,
          reason: "missing_handSettlement"
        });
      }
      return {
        nextState: finalizeSettlement({
          state,
          handId,
          payouts: payouts2,
          nowIso,
          klog
        })
      };
    }
    if (!handId) throw new Error("showdown_missing_hand_id");
    const { eligibleUserIds, seatOrder } = listEligibleUserIds({ state, seatUserIdsInOrder: seatUserIdsInOrder2 });
    if (eligibleUserIds.length === 0) {
      if (typeof klog === "function") klog("poker_showdown_no_eligible", { handId: state.handId ?? null });
      return { nextState: state };
    }
    if (eligibleUserIds.length === 1) {
      const winnerUserId = eligibleUserIds[0];
      const potAmount = normalizeChipAmount("pot", state.pot);
      const nextStacks2 = { ...copyStacks(state.stacks) };
      nextStacks2[winnerUserId] = normalizeChipAmount("stack", nextStacks2[winnerUserId] ?? 0) + potAmount;
      const awardedAt = typeof nowIso === "string" ? nowIso : (/* @__PURE__ */ new Date()).toISOString();
      const withShowdown = {
        ...state,
        stacks: nextStacks2,
        pot: 0,
        showdown: {
          winners: [winnerUserId],
          potsAwarded: [{ amount: potAmount, winners: [winnerUserId], eligibleUserIds: [winnerUserId] }],
          potAwardedTotal: potAmount,
          potAwarded: potAmount,
          reason: "all_folded",
          awardedAt,
          handId
        }
      };
      return {
        nextState: finalizeSettlement({
          state: withShowdown,
          handId,
          payouts: { [winnerUserId]: potAmount },
          nowIso,
          klog
        })
      };
    }
    if (typeof awardPotsAtShowdown2 !== "function") throw new Error("showdown_invalid_compute");
    if (typeof computeShowdown2 !== "function") throw new Error("showdown_invalid_compute");
    const community = ensureCommunityComplete(state);
    const prevStacks = copyStacks(state.stacks);
    const awardResult = awardPotsAtShowdown2({
      state: {
        ...state,
        community,
        communityDealt: community.length,
        holeCardsByUserId
      },
      seatUserIdsInOrder: seatOrder,
      computeShowdown: computeShowdown2,
      nowIso
    });
    if (!awardResult?.nextState?.showdown || !Array.isArray(awardResult.nextState.showdown.winners)) {
      throw new Error("showdown_missing_result");
    }
    const nextStacks = copyStacks(awardResult.nextState.stacks);
    const payouts = diffPayouts(prevStacks, nextStacks);
    return {
      nextState: finalizeSettlement({
        state: {
          ...awardResult.nextState,
          stacks: nextStacks,
          pot: 0,
          showdown: { ...awardResult.nextState.showdown, handId }
        },
        handId,
        payouts,
        nowIso,
        klog
      })
    };
  };

  // ws-server/poker/shared/settlement/poker-side-pots.mjs
  var normalizeContribution = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    if (num <= 0) return 0;
    return Math.floor(num);
  };
  var normalizeContributions = ({ contributionsByUserId, participantUserIds, eligibleUserIds }) => {
    const userIds = Array.isArray(participantUserIds) ? participantUserIds : eligibleUserIds;
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
    const source = contributionsByUserId && typeof contributionsByUserId === "object" ? contributionsByUserId : {};
    return userIds.map((userId) => ({
      userId,
      contribution: normalizeContribution(source[userId])
    }));
  };
  var resolveUncalledReturn = (normalized) => {
    if (!Array.isArray(normalized) || normalized.length < 2) return null;
    const ranked = normalized.slice().sort((a, b) => b.contribution - a.contribution);
    const highest = ranked[0];
    const secondHighestContribution = ranked[1].contribution;
    if (highest.contribution <= secondHighestContribution) return null;
    return {
      userId: highest.userId,
      amount: highest.contribution - secondHighestContribution,
      minContribution: secondHighestContribution,
      maxContribution: highest.contribution
    };
  };
  var buildSidePots = ({ contributionsByUserId, participantUserIds, eligibleUserIds }) => {
    if (!Array.isArray(eligibleUserIds) || eligibleUserIds.length === 0) return [];
    const normalized = normalizeContributions({ contributionsByUserId, participantUserIds, eligibleUserIds });
    const eligibleUserIdSet = new Set(eligibleUserIds);
    const uncalledReturn = resolveUncalledReturn(normalized);
    const contestable = normalized.map(({ userId, contribution }) => ({
      userId,
      contribution: uncalledReturn?.userId === userId ? uncalledReturn.minContribution : contribution
    }));
    const levels = [...new Set(contestable.map(({ contribution }) => contribution).filter((value) => value > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    levels.forEach((level) => {
      const participants = contestable.filter(({ contribution }) => contribution >= level).map(({ userId }) => userId);
      const delta = level - prev;
      const amount = delta * participants.length;
      if (amount > 0) {
        const eligibleForBand = participants.filter((userId) => eligibleUserIdSet.has(userId));
        if (eligibleForBand.length > 0) {
          pots.push({
            amount,
            eligibleUserIds: eligibleForBand,
            minContribution: prev,
            maxContribution: level
          });
        } else if (pots.length > 0) {
          const target = pots[pots.length - 1];
          target.amount += amount;
          target.maxContribution = level;
        } else {
          pots.push({
            amount,
            eligibleUserIds: eligibleUserIds.slice(),
            minContribution: prev,
            maxContribution: level
          });
        }
      }
      prev = level;
    });
    if (uncalledReturn) {
      pots.push({
        amount: uncalledReturn.amount,
        eligibleUserIds: [uncalledReturn.userId],
        minContribution: uncalledReturn.minContribution,
        maxContribution: uncalledReturn.maxContribution,
        returnUserId: uncalledReturn.userId
      });
    }
    return pots;
  };

  // ws-server/poker/shared/settlement/poker-state-utils.mjs
  var isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  var RANKS2 = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  var SUITS2 = ["S", "H", "D", "C"];
  var RANK_SET = new Set(RANKS2);
  var SUIT_SET = new Set(SUITS2);

  // ws-server/poker/shared/settlement/poker-payout.mjs
  var normalizePotAmount = (value) => {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("showdown_invalid_pot");
    }
    return Math.floor(amount);
  };
  var normalizeSidePots = (sidePots) => {
    if (!Array.isArray(sidePots) || sidePots.length === 0) return null;
    return sidePots.map((pot) => {
      if (!isPlainObject(pot) || !Array.isArray(pot.eligibleUserIds)) {
        throw new Error("showdown_invalid_side_pots");
      }
      return {
        amount: normalizePotAmount(pot.amount),
        eligibleUserIds: pot.eligibleUserIds.slice(),
        ...typeof pot.returnUserId === "string" && pot.returnUserId ? { returnUserId: pot.returnUserId } : {}
      };
    });
  };
  var listShowdownUserIds = (state, seatUserIdsInOrder2) => {
    return seatUserIdsInOrder2.filter((userId) => typeof userId === "string" && !state.foldedByUserId?.[userId] && !state.leftTableByUserId?.[userId] && !state.sitOutByUserId?.[userId] && !state.pendingAutoSitOutByUserId?.[userId]);
  };
  var ensureHoleCardsPresent = ({ holeCardsByUserId, userId }) => {
    const holeCards = holeCardsByUserId?.[userId];
    if (!Array.isArray(holeCards) || holeCards.length !== 2) {
      throw new Error("showdown_missing_hole_cards");
    }
    return holeCards;
  };
  var awardPotsAtShowdown = ({ state, seatUserIdsInOrder: seatUserIdsInOrder2, computeShowdown: computeShowdown2, nowIso }) => {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("showdown_invalid_state");
    }
    if (!Array.isArray(seatUserIdsInOrder2) || seatUserIdsInOrder2.length === 0) {
      throw new Error("showdown_no_players");
    }
    if (typeof computeShowdown2 !== "function") {
      throw new Error("showdown_invalid_compute");
    }
    const showdownUserIds = listShowdownUserIds(state, seatUserIdsInOrder2);
    if (showdownUserIds.length === 0) {
      throw new Error("showdown_no_players");
    }
    const community = Array.isArray(state.community) ? state.community.slice() : [];
    if (community.length !== 5) {
      throw new Error("showdown_invalid_community");
    }
    const holeCardsByUserId = state.holeCardsByUserId || {};
    const showdownUserIdSet = new Set(showdownUserIds);
    for (const userId of showdownUserIds) {
      ensureHoleCardsPresent({ holeCardsByUserId, userId });
    }
    let pots = normalizeSidePots(state.sidePots);
    if (!pots && isPlainObject(state.contributionsByUserId)) {
      pots = buildSidePots({
        contributionsByUserId: state.contributionsByUserId,
        participantUserIds: seatUserIdsInOrder2,
        eligibleUserIds: showdownUserIds
      }).map((pot) => ({
        amount: normalizePotAmount(pot.amount),
        eligibleUserIds: pot.eligibleUserIds.slice(),
        ...pot.returnUserId ? { returnUserId: pot.returnUserId } : {}
      }));
      if (pots.length === 0) {
        pots = null;
      }
    }
    if (!pots) {
      pots = [{ amount: normalizePotAmount(state.pot ?? 0), eligibleUserIds: showdownUserIds.slice() }];
    }
    const nextStacks = { ...state.stacks };
    const potsAwarded = [];
    const handsByUserId = {};
    const winnersUnion = /* @__PURE__ */ new Set();
    const seatUserIdSet = new Set(seatUserIdsInOrder2);
    let potAwardedTotal = 0;
    for (const pot of pots) {
      const amount = normalizePotAmount(pot.amount);
      const returnUserId = typeof pot.returnUserId === "string" ? pot.returnUserId : "";
      if (returnUserId) {
        if (!seatUserIdSet.has(returnUserId) || pot.eligibleUserIds.length !== 1 || pot.eligibleUserIds[0] !== returnUserId) {
          throw new Error("showdown_invalid_return");
        }
        const baseStack = Number(nextStacks[returnUserId] ?? 0);
        if (!Number.isFinite(baseStack)) {
          throw new Error("showdown_invalid_stack");
        }
        nextStacks[returnUserId] = baseStack + amount;
        potAwardedTotal += amount;
        potsAwarded.push({ amount, winners: [returnUserId], eligibleUserIds: [returnUserId], returnUserId });
        continue;
      }
      const eligibleSet = new Set(Array.isArray(pot.eligibleUserIds) ? pot.eligibleUserIds : []);
      const eligible = seatUserIdsInOrder2.filter((userId) => showdownUserIdSet.has(userId) && eligibleSet.has(userId));
      if (eligible.length === 0) {
        throw new Error("showdown_pot_without_eligible_player");
      }
      const players = eligible.map((userId) => ({ userId, holeCards: ensureHoleCardsPresent({ holeCardsByUserId, userId }) }));
      const result = computeShowdown2({ community, players });
      const winners = Array.isArray(result?.winners) ? result.winners : [];
      if (result?.handsByUserId && typeof result.handsByUserId === "object" && !Array.isArray(result.handsByUserId)) {
        for (const [userId, hand] of Object.entries(result.handsByUserId)) {
          if (typeof userId !== "string" || !userId) continue;
          if (!hand || typeof hand !== "object" || Array.isArray(hand)) continue;
          handsByUserId[userId] = {
            category: hand.category ?? null,
            name: hand.name ?? null,
            ranks: Array.isArray(hand.ranks) ? hand.ranks.slice() : [],
            best5: Array.isArray(hand.best5) ? hand.best5.slice() : []
          };
        }
      }
      if (winners.length === 0) {
        throw new Error("showdown_no_winners");
      }
      const winnersValid = winners.every((userId) => eligibleSet.has(userId));
      if (!winnersValid) {
        throw new Error("showdown_winners_invalid");
      }
      const winnersInSeatOrder = seatUserIdsInOrder2.filter((userId) => winners.includes(userId));
      if (winnersInSeatOrder.length === 0) {
        throw new Error("showdown_winners_invalid");
      }
      const share = Math.floor(amount / winnersInSeatOrder.length);
      let remainder = amount - share * winnersInSeatOrder.length;
      for (const userId of winnersInSeatOrder) {
        const baseStack = Number(nextStacks[userId] ?? 0);
        if (!Number.isFinite(baseStack)) {
          throw new Error("showdown_invalid_stack");
        }
        const bonus = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        nextStacks[userId] = baseStack + share + bonus;
        winnersUnion.add(userId);
      }
      potAwardedTotal += amount;
      potsAwarded.push({ amount, winners: winnersInSeatOrder, eligibleUserIds: eligible });
    }
    const showdownWinners = seatUserIdsInOrder2.filter((userId) => winnersUnion.has(userId));
    const awardedAt = typeof nowIso === "string" ? nowIso : (/* @__PURE__ */ new Date()).toISOString();
    const showdown = {
      winners: showdownWinners,
      potsAwarded,
      potAwardedTotal,
      potAwarded: potAwardedTotal,
      reason: "computed",
      awardedAt
    };
    if (Object.keys(handsByUserId).length > 0) {
      showdown.handsByUserId = handsByUserId;
    }
    return {
      nextState: {
        ...state,
        stacks: nextStacks,
        pot: 0,
        showdown
      },
      payout: {
        winners: showdownWinners,
        potsAwarded,
        potAwardedTotal
      }
    };
  };

  // ws-server/poker/shared/settlement/poker-showdown.mjs
  var isPlainObject2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  var normalizeRank2 = (value) => {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value >= 2 && value <= 14 ? value : null;
    }
    if (typeof value !== "string") return null;
    const v = value.trim().toUpperCase();
    if (v === "A") return 14;
    if (v === "K") return 13;
    if (v === "Q") return 12;
    if (v === "J") return 11;
    if (v === "T") return 10;
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      return n >= 2 && n <= 10 ? n : null;
    }
    return null;
  };
  var SUIT_SET2 = /* @__PURE__ */ new Set(["H", "D", "C", "S"]);
  var normalizeSuit2 = (value) => {
    if (typeof value !== "string") return null;
    const v = value.trim().toUpperCase();
    return SUIT_SET2.has(v) ? v : null;
  };
  var cardKey2 = (card) => {
    const rank = normalizeRank2(card?.r);
    const suit = normalizeSuit2(card?.s);
    if (!rank || !suit) return "";
    return `${rank}-${suit}`;
  };
  var validateCards = (cards, seen) => {
    if (!Array.isArray(cards)) return { ok: false };
    for (const card of cards) {
      if (!isPlainObject2(card)) return { ok: false };
      const key = cardKey2(card);
      if (!key || seen.has(key)) return { ok: false };
      seen.add(key);
    }
    return { ok: true };
  };
  var validatePlayers = (players, seenCards) => {
    if (!Array.isArray(players) || players.length === 0) return { ok: false };
    const seenUsers = /* @__PURE__ */ new Set();
    for (const player of players) {
      if (!isPlainObject2(player)) return { ok: false };
      if (typeof player.userId !== "string" || !player.userId.trim()) return { ok: false };
      if (seenUsers.has(player.userId)) return { ok: false };
      seenUsers.add(player.userId);
      if (!Array.isArray(player.holeCards) || player.holeCards.length !== 2) return { ok: false };
      const validCards = validateCards(player.holeCards, seenCards);
      if (!validCards.ok) return { ok: false };
    }
    return { ok: true };
  };
  var computeShowdown = ({ community, players }) => {
    try {
      if (!Array.isArray(community) || community.length !== 5) throw new Error("invalid_state");
      const seenCards = /* @__PURE__ */ new Set();
      if (!validateCards(community, seenCards).ok) throw new Error("invalid_state");
      if (!validatePlayers(players, seenCards).ok) throw new Error("invalid_state");
      const handsByUserId = {};
      let bestHand = null;
      const winners = [];
      for (const player of players) {
        const holeCards = player.holeCards.slice();
        const combined = community.concat(holeCards);
        const hand = evaluateBestHand(combined);
        handsByUserId[player.userId] = {
          category: hand.category,
          name: hand.name,
          ranks: hand.ranks,
          best5: hand.best5,
          key: hand.key
        };
        if (!bestHand) {
          bestHand = hand;
          winners.push(player.userId);
          continue;
        }
        const cmp = compareHands(hand, bestHand);
        if (cmp > 0) {
          bestHand = hand;
          winners.length = 0;
          winners.push(player.userId);
        } else if (cmp === 0) {
          winners.push(player.userId);
        }
      }
      if (!winners.length) throw new Error("invalid_state");
      return {
        winners,
        handsByUserId
      };
    } catch (error) {
      if (error?.message === "invalid_state") {
        throw error;
      }
      throw new Error("invalid_state");
    }
  };

  // ws-server/poker/shared/poker-action-reducer.mjs
  var SUPPORTED_ACTIONS = /* @__PURE__ */ new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE"]);
  var NEXT_PHASE = {
    PREFLOP: "FLOP",
    FLOP: "TURN",
    TURN: "RIVER"
  };
  var ACTION_PHASES2 = /* @__PURE__ */ new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);
  function toInt(value) {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.trunc(value);
  }
  function normalizeAction(action) {
    if (typeof action !== "string") {
      return null;
    }
    const normalized = action.trim().toUpperCase();
    if (!SUPPORTED_ACTIONS.has(normalized)) {
      return null;
    }
    return normalized;
  }
  function asStateCopy(state) {
    return {
      ...state,
      stacks: { ...state.stacks || {} },
      toCallByUserId: { ...state.toCallByUserId || {} },
      betThisRoundByUserId: { ...state.betThisRoundByUserId || {} },
      actedThisRoundByUserId: { ...state.actedThisRoundByUserId || {} },
      lastBettingRoundActionByUserId: { ...state.lastBettingRoundActionByUserId || {} },
      foldedByUserId: { ...state.foldedByUserId || {} },
      contributionsByUserId: { ...state.contributionsByUserId || {} },
      sidePots: Array.isArray(state.sidePots) ? state.sidePots.slice() : [],
      community: Array.isArray(state.community) ? state.community.slice() : [],
      deck: Array.isArray(state.deck) ? state.deck.slice() : []
    };
  }
  function cardCodeToCard(cardCode) {
    if (typeof cardCode !== "string") {
      return null;
    }
    const code = cardCode.trim().toUpperCase();
    if (!/^(10|[2-9TJQKA])[CDHS]$/.test(code)) {
      return null;
    }
    const suit = code.slice(-1);
    const rankCode = code.slice(0, -1);
    const rank = rankCode === "A" ? 14 : rankCode === "K" ? 13 : rankCode === "Q" ? 12 : rankCode === "J" ? 11 : rankCode === "T" ? 10 : Number(rankCode);
    if (!Number.isInteger(rank) || rank < 2 || rank > 14) {
      return null;
    }
    return { r: rank, s: suit };
  }
  function toShowdownHoleCardsByUserId(holeCardsByUserId) {
    const entries = Object.entries(holeCardsByUserId || {});
    const normalized = {};
    for (const [userId, cards] of entries) {
      if (typeof userId !== "string") {
        continue;
      }
      if (!Array.isArray(cards)) {
        continue;
      }
      const parsed = cards.map(cardCodeToCard);
      if (parsed.length === 2 && parsed.every(Boolean)) {
        normalized[userId] = parsed;
      }
    }
    return normalized;
  }
  function seatUserIdsInOrder(state) {
    return orderedSeats(state).map((seat) => seat.userId);
  }
  function deriveBoardStateFromHandSeed(state, communityCount) {
    const handSeed = typeof state?.handSeed === "string" ? state.handSeed.trim() : "";
    const seatOrder = seatUserIdsInOrder(state);
    if (!handSeed || seatOrder.length === 0 || !Number.isInteger(communityCount) || communityCount < 0 || communityCount > 5) {
      return null;
    }
    try {
      const dealt = dealHoleCards(deriveDeck(handSeed), seatOrder);
      const derivedDeck = toCardCodes(dealt.deck);
      return {
        community: derivedDeck.slice(0, communityCount),
        deck: derivedDeck.slice(communityCount)
      };
    } catch {
      return null;
    }
  }
  function resolveSettlementCommunity(state) {
    const community = Array.isArray(state?.community) ? state.community.slice() : [];
    if (community.length === 5) {
      return community;
    }
    const derivedBoardState = deriveBoardStateFromHandSeed(state, 5);
    return Array.isArray(derivedBoardState?.community) && derivedBoardState.community.length === 5 ? derivedBoardState.community : community;
  }
  function eligibleUserIdsForSettlement(state) {
    return seatUserIdsInOrder(state).filter((userId) => !state.foldedByUserId?.[userId] && !state.leftTableByUserId?.[userId] && !state.sitOutByUserId?.[userId]);
  }
  function settleHandState(state, nowIso) {
    const handId = typeof state.handId === "string" ? state.handId : "";
    if (!handId) {
      return state;
    }
    const settlementCommunity = resolveSettlementCommunity(state);
    const materialized = materializeShowdownAndPayout({
      state: {
        ...state,
        pot: Number(state.potTotal ?? state.pot ?? 0),
        community: settlementCommunity.map(cardCodeToCard).filter(Boolean)
      },
      seatUserIdsInOrder: seatUserIdsInOrder(state),
      holeCardsByUserId: toShowdownHoleCardsByUserId(state.holeCardsByUserId),
      computeShowdown,
      awardPotsAtShowdown,
      nowIso
    });
    if (!materialized?.nextState || materialized.nextState === state) {
      return state;
    }
    return {
      ...state,
      ...materialized.nextState,
      phase: "SETTLED",
      turnUserId: null,
      turnStartedAt: null,
      turnDeadlineAt: null,
      community: settlementCommunity,
      communityDealt: settlementCommunity.length,
      holeCardsByUserId: { ...state.holeCardsByUserId || {} },
      deck: Array.isArray(state.deck) ? state.deck.slice() : [],
      potTotal: Number(materialized.nextState.pot ?? state.potTotal ?? 0),
      sidePots: []
    };
  }
  function shouldSettleByFold(state) {
    return eligibleUserIdsForSettlement(state).length <= 1;
  }
  function shouldSettleAtShowdown(state) {
    return state.phase === "RIVER" && isBettingClosed(state);
  }
  function orderedSeats(state) {
    const phase = typeof state?.phase === "string" ? state.phase : "";
    const seats = ACTION_PHASES2.has(phase) && Array.isArray(state?.handSeats) && state.handSeats.length > 0 ? state.handSeats : state?.seats;
    return (Array.isArray(seats) ? seats : []).filter((seat) => typeof seat?.userId === "string" && Number.isInteger(seat?.seatNo)).slice().sort((a, b) => a.seatNo - b.seatNo || a.userId.localeCompare(b.userId));
  }
  function isSelectableActor(state, userId) {
    if (state.foldedByUserId?.[userId] || state.leftTableByUserId?.[userId] || state.sitOutByUserId?.[userId]) {
      return false;
    }
    const stack = Number(state.stacks?.[userId] ?? 0);
    return stack > 0;
  }
  function resolveNextTurnUserId(state, currentUserId) {
    const seats = orderedSeats(state);
    if (seats.length === 0) {
      return null;
    }
    const activeUserIds = seats.map((seat) => seat.userId).filter((userId) => isSelectableActor(state, userId));
    if (activeUserIds.length === 0) {
      return null;
    }
    if (activeUserIds.length === 1) {
      const onlyUserId = activeUserIds[0];
      return Number(state.toCallByUserId?.[onlyUserId] ?? 0) > 0 ? onlyUserId : null;
    }
    const currentIndex = seats.findIndex((seat) => seat.userId === currentUserId);
    if (currentIndex === -1) {
      return activeUserIds[0];
    }
    for (let offset = 1; offset <= seats.length; offset += 1) {
      const nextSeat = seats[(currentIndex + offset) % seats.length];
      if (isSelectableActor(state, nextSeat.userId)) {
        return nextSeat.userId;
      }
    }
    return null;
  }
  function recomputeToCall(state) {
    const currentBet = Number(state.currentBet ?? 0);
    for (const seat of orderedSeats(state)) {
      const userId = seat.userId;
      const userBet = Number(state.betThisRoundByUserId?.[userId] ?? 0);
      state.toCallByUserId[userId] = Math.max(0, currentBet - userBet);
    }
  }
  function isBettingClosed(state) {
    const seats = orderedSeats(state);
    const active2 = seats.filter((seat) => isSelectableActor(state, seat.userId));
    if (active2.length === 0) {
      return true;
    }
    if (active2.length === 1) {
      return Number(state.toCallByUserId?.[active2[0].userId] ?? 0) === 0;
    }
    const allMatched = active2.every((seat) => Number(state.toCallByUserId?.[seat.userId] ?? 0) === 0);
    if (!allMatched) {
      return false;
    }
    if (Number(state.currentBet ?? 0) > 0) {
      return true;
    }
    return active2.every((seat) => state.actedThisRoundByUserId?.[seat.userId] === true);
  }
  function nextPhase(phase) {
    return typeof phase === "string" ? NEXT_PHASE[phase] ?? null : null;
  }
  function revealCommunityCards(state, count) {
    const normalized = Number.isInteger(count) && count > 0 ? count : 0;
    if (normalized === 0) {
      return;
    }
    const deck = Array.isArray(state.deck) ? state.deck : [];
    const community = Array.isArray(state.community) ? state.community : [];
    const revealedCount = Number.isInteger(state.communityDealt) ? Math.max(community.length, Math.min(5, state.communityDealt)) : community.length;
    const targetCommunityCount = Math.min(5, revealedCount + normalized);
    const missingCount = Math.max(0, targetCommunityCount - community.length);
    const dealt = deck.slice(0, missingCount);
    if (dealt.length === missingCount) {
      state.community = community.concat(dealt);
      state.deck = deck.slice(dealt.length);
      state.communityDealt = targetCommunityCount;
      return;
    }
    const derivedBoardState = deriveBoardStateFromHandSeed(state, targetCommunityCount);
    if (Array.isArray(derivedBoardState?.community) && derivedBoardState.community.length === targetCommunityCount) {
      state.community = derivedBoardState.community;
      state.deck = Array.isArray(derivedBoardState.deck) ? derivedBoardState.deck : [];
      state.communityDealt = targetCommunityCount;
      return;
    }
    state.community = community.concat(dealt);
    state.deck = deck.slice(dealt.length);
    state.communityDealt = Math.max(revealedCount, state.community.length);
  }
  function resetRoundState(state) {
    state.currentBet = 0;
    for (const seat of orderedSeats(state)) {
      const userId = seat.userId;
      state.betThisRoundByUserId[userId] = 0;
      state.toCallByUserId[userId] = 0;
      state.actedThisRoundByUserId[userId] = false;
      state.lastBettingRoundActionByUserId[userId] = null;
    }
  }
  function resolveLastBettingRoundAction({ action, stackAfterAction }) {
    if (action === "FOLD") {
      return "fold";
    }
    if (action === "CHECK") {
      return "check";
    }
    if (stackAfterAction <= 0) {
      return "all_in";
    }
    if (action === "CALL") {
      return "call";
    }
    if (action === "BET" || action === "RAISE") {
      return "raise";
    }
    return null;
  }
  function resolveStreetTurnUserId(state) {
    const seats = orderedSeats(state);
    if (seats.length === 0) {
      return null;
    }
    const dealerSeatNo = Number(state.dealerSeatNo ?? 0);
    const dealerIndex = seats.findIndex((seat) => seat.seatNo === dealerSeatNo);
    const startIndex = dealerIndex === -1 ? 0 : (dealerIndex + 1) % seats.length;
    for (let offset = 0; offset < seats.length; offset += 1) {
      const seat = seats[(startIndex + offset) % seats.length];
      if (isSelectableActor(state, seat.userId)) {
        return seat.userId;
      }
    }
    return null;
  }
  function advanceStreetIfClosed(state) {
    if (!isBettingClosed(state)) {
      return false;
    }
    const phase = nextPhase(state.phase);
    if (!phase) {
      state.turnUserId = null;
      return true;
    }
    state.phase = phase;
    if (phase === "FLOP") {
      revealCommunityCards(state, 3);
    } else {
      revealCommunityCards(state, 1);
    }
    resetRoundState(state);
    state.turnUserId = resolveStreetTurnUserId(state);
    return true;
  }
  function advanceClosedStreets(state, nowIso) {
    let advanced = false;
    while (isBettingClosed(state)) {
      if (state.phase === "RIVER") {
        return { advanced: true, settled: true, state: settleHandState(state, nowIso) };
      }
      if (!advanceStreetIfClosed(state)) {
        break;
      }
      advanced = true;
    }
    return { advanced, settled: false, state };
  }
  function applyAction({ pokerState, userId, action, amount, nowIso = "1970-01-01T00:00:00.000Z" }) {
    if (!pokerState || typeof pokerState !== "object" || Array.isArray(pokerState)) {
      return { ok: false, reason: "invalid_state" };
    }
    if (typeof pokerState.phase !== "string" || !["PREFLOP", "FLOP", "TURN", "RIVER"].includes(pokerState.phase)) {
      return { ok: false, reason: "unsupported_phase" };
    }
    if (typeof userId !== "string" || userId.trim() === "") {
      return { ok: false, reason: "invalid_actor" };
    }
    const normalizedAction = normalizeAction(action);
    if (!normalizedAction) {
      return { ok: false, reason: "unsupported_action" };
    }
    const legalInfo = computeSharedLegalActions({ statePublic: pokerState, userId });
    if (!legalInfo.actions.includes(normalizedAction)) {
      return { ok: false, reason: "illegal_action" };
    }
    const nextState = asStateCopy(pokerState);
    const wasOutOfTurnFold = normalizedAction === "FOLD" && nextState.turnUserId !== userId;
    const stack = Number(nextState.stacks?.[userId] ?? 0);
    const currentUserBet = Number(nextState.betThisRoundByUserId?.[userId] ?? 0);
    const toCall = Math.max(0, Number(legalInfo.toCall ?? 0));
    let contribution = 0;
    if (normalizedAction === "FOLD") {
      nextState.foldedByUserId[userId] = true;
      nextState.actedThisRoundByUserId[userId] = true;
    } else if (normalizedAction === "CHECK") {
      nextState.actedThisRoundByUserId[userId] = true;
    } else if (normalizedAction === "CALL") {
      contribution = Math.max(0, Math.min(stack, toCall));
      nextState.stacks[userId] = stack - contribution;
      nextState.betThisRoundByUserId[userId] = currentUserBet + contribution;
      nextState.contributionsByUserId[userId] = Number(nextState.contributionsByUserId[userId] ?? 0) + contribution;
      nextState.potTotal = Number(nextState.potTotal ?? 0) + contribution;
      nextState.actedThisRoundByUserId[userId] = true;
    } else if (normalizedAction === "BET") {
      const betAmount = toInt(amount);
      const minBetAmount = Number(legalInfo.minBetAmount ?? 1);
      if (!Number.isInteger(betAmount) || betAmount < minBetAmount || betAmount > stack) {
        return { ok: false, reason: "invalid_amount" };
      }
      contribution = betAmount;
      const nextBet = currentUserBet + contribution;
      nextState.stacks[userId] = stack - contribution;
      nextState.betThisRoundByUserId[userId] = nextBet;
      nextState.currentBet = Math.max(Number(nextState.currentBet ?? 0), nextBet);
      nextState.lastRaiseSize = Math.max(deriveBigBlind(nextState), contribution);
      nextState.contributionsByUserId[userId] = Number(nextState.contributionsByUserId[userId] ?? 0) + contribution;
      nextState.potTotal = Number(nextState.potTotal ?? 0) + contribution;
      nextState.actedThisRoundByUserId[userId] = true;
    } else if (normalizedAction === "RAISE") {
      const raiseTo = toInt(amount);
      const minRaiseTo = Number(legalInfo.minRaiseTo ?? 0);
      const maxRaiseTo = Number(legalInfo.maxRaiseTo ?? 0);
      if (!Number.isInteger(raiseTo) || raiseTo < minRaiseTo || raiseTo > maxRaiseTo || raiseTo <= currentUserBet) {
        return { ok: false, reason: "invalid_amount" };
      }
      contribution = raiseTo - currentUserBet;
      nextState.stacks[userId] = stack - contribution;
      nextState.betThisRoundByUserId[userId] = raiseTo;
      const previousCurrentBet = Number(nextState.currentBet ?? 0);
      nextState.currentBet = Math.max(previousCurrentBet, raiseTo);
      const raiseSize = raiseTo - previousCurrentBet;
      const previousLastRaiseSize = Number(nextState.lastRaiseSize ?? 0);
      if (raiseSize >= previousLastRaiseSize) {
        nextState.lastRaiseSize = raiseSize;
      }
      nextState.contributionsByUserId[userId] = Number(nextState.contributionsByUserId[userId] ?? 0) + contribution;
      nextState.potTotal = Number(nextState.potTotal ?? 0) + contribution;
      nextState.actedThisRoundByUserId[userId] = true;
    }
    nextState.lastBettingRoundActionByUserId[userId] = resolveLastBettingRoundAction({
      action: normalizedAction,
      stackAfterAction: Number(nextState.stacks?.[userId] ?? 0)
    });
    recomputeToCall(nextState);
    if (shouldSettleByFold(nextState)) {
      return {
        ok: true,
        action: normalizedAction,
        state: settleHandState(nextState, nowIso)
      };
    }
    if (wasOutOfTurnFold) {
      nextState.turnUserId = pokerState.turnUserId;
      return {
        ok: true,
        action: normalizedAction,
        state: nextState
      };
    }
    if (shouldSettleAtShowdown(nextState)) {
      return {
        ok: true,
        action: normalizedAction,
        state: settleHandState(nextState, nowIso)
      };
    }
    const progression = advanceClosedStreets(nextState, nowIso);
    if (progression.settled) {
      return {
        ok: true,
        action: normalizedAction,
        state: progression.state
      };
    }
    if (!progression.advanced) {
      nextState.turnUserId = resolveNextTurnUserId(nextState, userId);
    }
    return {
      ok: true,
      action: normalizedAction,
      state: nextState
    };
  }

  // ws-server/poker/shared/poker-turn-timeout.mjs
  var DEFAULT_TURN_MS = 2e4;
  var ACTION_PHASES3 = /* @__PURE__ */ new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);
  function resolveTurnMs(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_TURN_MS;
    }
    return Math.trunc(parsed);
  }
  var TURN_MS = resolveTurnMs(void 0);
  function isLiveHand(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return false;
    }
    if (typeof state.turnUserId !== "string" || !state.turnUserId.trim()) {
      return false;
    }
    return ACTION_PHASES3.has(state.phase);
  }
  function defaultTimeoutActionFor(state, userId) {
    const leftTableByUserId = state?.leftTableByUserId && typeof state.leftTableByUserId === "object" && !Array.isArray(state.leftTableByUserId) ? state.leftTableByUserId : null;
    const statePublic = leftTableByUserId?.[userId] === true ? {
      ...state,
      leftTableByUserId: {
        ...leftTableByUserId,
        [userId]: false
      }
    } : state;
    const legalInfo = computeSharedLegalActions({ statePublic, userId });
    const actions = Array.isArray(legalInfo.actions) ? legalInfo.actions : [];
    if (actions.includes("CHECK")) {
      return { type: "CHECK", userId };
    }
    if (actions.includes("FOLD")) {
      return { type: "FOLD", userId };
    }
    return null;
  }
  function decideTurnTimeout({ pokerState, nowMs, turnMs = TURN_MS }) {
    if (!isLiveHand(pokerState)) {
      return { due: false, reason: "hand_not_live" };
    }
    const deadline = Number(pokerState.turnDeadlineAt);
    const now = Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
    if (typeof pokerState.turnDeadlineAt !== "number" || !Number.isFinite(deadline)) {
      return { due: false, reason: "deadline_missing" };
    }
    if (now < deadline) {
      return { due: false, reason: "deadline_unexpired" };
    }
    const userId = pokerState.turnUserId.trim();
    const action = defaultTimeoutActionFor(pokerState, userId);
    if (!action) {
      return { due: false, reason: "no_default_action" };
    }
    return {
      due: true,
      actorUserId: userId,
      action,
      nowMs: now,
      deadline,
      turnMs
    };
  }
  function stampTurnDeadline(state, nowMs, turnMs = TURN_MS) {
    if (!isLiveHand(state)) {
      return {
        ...state,
        turnStartedAt: null,
        turnDeadlineAt: null
      };
    }
    const startedAt = Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
    const ttl = Number.isFinite(turnMs) && turnMs > 0 ? Math.trunc(turnMs) : TURN_MS;
    return {
      ...state,
      turnStartedAt: startedAt,
      turnDeadlineAt: startedAt + ttl
    };
  }

  // shared/poker-domain/table-economy.mjs
  var DEFAULT_CASH_TABLE_BUY_IN_CHIPS = 100;
  var HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY = "POKER_BOT_BANKROLL";
  var CANONICAL_POKER_BUY_IN_TIERS = Object.freeze([
    DEFAULT_CASH_TABLE_BUY_IN_CHIPS,
    500,
    1e3,
    5e3,
    1e4,
    5e4,
    1e5,
    5e5,
    1e6,
    5e6,
    1e7
  ]);
  function getBotFundingSystemKeyForBuyIn(buyIn, options = {}) {
    const normalizedBuyIn = Number(buyIn);
    const hasExplicitPoolClass = Object.prototype.hasOwnProperty.call(options, "poolClass");
    const poolClass = typeof options.poolClass === "string" ? options.poolClass.trim().toUpperCase() : "";
    if (hasExplicitPoolClass) {
      if (poolClass !== "NORMAL" && poolClass !== "SLOW") return null;
      if (!CANONICAL_POKER_BUY_IN_TIERS.includes(normalizedBuyIn)) return null;
      if (poolClass === "SLOW") {
        return `POKER_BOT_SLOW_BANKROLL_${normalizedBuyIn}`;
      }
      if (normalizedBuyIn === 500) {
        return HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY;
      }
      return `POKER_BOT_BANKROLL_${normalizedBuyIn}`;
    }
    const { legacySystemKey = "TREASURY" } = options;
    if (normalizedBuyIn === DEFAULT_CASH_TABLE_BUY_IN_CHIPS) {
      const configuredKey = typeof legacySystemKey === "string" ? legacySystemKey.trim() : "";
      return configuredKey || "TREASURY";
    }
    if (normalizedBuyIn === 500) return HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY;
    return null;
  }
  var CANONICAL_POKER_BOT_POOL_KEYS = Object.freeze((() => {
    const keys = [];
    for (const buyIn of CANONICAL_POKER_BUY_IN_TIERS) {
      const normal = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "NORMAL" });
      const slow = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "SLOW" });
      if (normal) keys.push(normal);
      if (slow) keys.push(slow);
    }
    return [...new Set(keys)];
  })());

  // ws-server/poker/engine/poker-engine.mjs
  var MIN_PLAYERS_TO_BOOTSTRAP = 2;
  var MIN_STACK_TO_JOIN_HAND = 2;
  function nextHandId(tableId, version, seatCount) {
    return `ws_hand_${tableId}_${version}_${seatCount}`;
  }
  function nextHandSeed(tableId, version, seatCount) {
    return `ws_seed_${tableId}_${version}_${seatCount}`;
  }
  function orderedSeatMembers(coreState) {
    const members = Array.isArray(coreState?.members) ? coreState.members : [];
    return members.filter((member) => typeof member?.userId === "string" && Number.isInteger(member?.seat)).slice().sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));
  }
  function isContinuationEligibleByStack(userId, stacksByUserId, { isBot = false } = {}) {
    const stack = Number(stacksByUserId?.[userId] ?? 0);
    const minimumStack = isBot ? MIN_STACK_TO_JOIN_HAND : 1;
    return Number.isFinite(stack) && stack >= minimumStack;
  }
  function orderedEligibleSeatMembers(coreState, stacksByUserId = null) {
    const members = orderedSeatMembers(coreState).filter((member) => !coreState?.pokerState?.inactivityEjectionByUserId?.[member.userId] && !coreState?.pokerState?.sitOutByUserId?.[member.userId] && !coreState?.pokerState?.leftTableByUserId?.[member.userId]);
    if (!stacksByUserId || typeof stacksByUserId !== "object" || Array.isArray(stacksByUserId)) {
      return members;
    }
    return members.filter((member) => isContinuationEligibleByStack(member.userId, stacksByUserId, {
      isBot: coreState?.seatDetailsByUserId?.[member.userId]?.isBot === true
    }));
  }
  function normalizeHandStakes(stakes) {
    const smallBlind = Number(stakes?.sb);
    const bigBlind = Number(stakes?.bb);
    if (Number.isInteger(smallBlind) && smallBlind > 0 && Number.isInteger(bigBlind) && bigBlind > smallBlind) {
      return { smallBlind, bigBlind };
    }
    return { smallBlind: 1, bigBlind: 2 };
  }
  function buildBootstrappedPokerState({
    tableId,
    coreState,
    dealerSeatNo = null,
    startingStacks = null,
    handVersion = null,
    stakes = null
  }) {
    const members = orderedEligibleSeatMembers(coreState, startingStacks);
    if (members.length < MIN_PLAYERS_TO_BOOTSTRAP) {
      return null;
    }
    const inactivity = { inactivityEjectionByUserId: { ...coreState.pokerState?.inactivityEjectionByUserId || {} }, missedTurnsByUserId: {}, pendingAutoSitOutByUserId: {}, sitOutByUserId: {} };
    for (const userId of Object.keys(coreState.seats || {})) {
      if (!Number.isInteger(coreState.seats[userId]) || coreState.seats[userId] < 1 || coreState.pokerState?.leftTableByUserId?.[userId]) continue;
      const missed = coreState.pokerState?.missedTurnsByUserId?.[userId];
      if (Number.isInteger(missed) && missed >= 0) inactivity.missedTurnsByUserId[userId] = missed;
      for (const key of ["pendingAutoSitOutByUserId", "sitOutByUserId"]) {
        if (coreState.pokerState?.[key]?.[userId] === true) inactivity[key][userId] = true;
      }
    }
    const userIds = members.map((member) => member.userId);
    const dealerIndex = Number.isInteger(dealerSeatNo) ? Math.max(0, members.findIndex((member) => member.seat === dealerSeatNo)) : 0;
    const isHeadsUp = members.length === 2;
    const sbIndex = isHeadsUp ? dealerIndex : (dealerIndex + 1) % members.length;
    const bbIndex = (sbIndex + 1) % members.length;
    const utgIndex = isHeadsUp ? dealerIndex : (bbIndex + 1) % members.length;
    const sbUserId = members[sbIndex]?.userId ?? null;
    const bbUserId = members[bbIndex]?.userId ?? null;
    const turnUserId = members[utgIndex]?.userId ?? members[dealerIndex]?.userId ?? null;
    const versionForHand = Number.isInteger(handVersion) ? handVersion : coreState.version;
    const handSeed = nextHandSeed(tableId, versionForHand, members.length);
    const initialDeck = deriveDeck(handSeed);
    const dealt = dealHoleCards(initialDeck, userIds);
    const stacks = Object.fromEntries(userIds.map((userId) => {
      const stack = Number(startingStacks?.[userId]);
      return [userId, Number.isSafeInteger(stack) && stack >= 0 ? stack : null];
    }));
    if (Object.values(stacks).some((stack) => stack === null)) return null;
    const handStartStacksByUserId = { ...stacks };
    const betThisRoundByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));
    const toCallByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));
    const actedThisRoundByUserId = Object.fromEntries(userIds.map((userId) => [userId, false]));
    const lastBettingRoundActionByUserId = Object.fromEntries(userIds.map((userId) => [userId, null]));
    const foldedByUserId = Object.fromEntries(userIds.map((userId) => [userId, false]));
    const contributionsByUserId = Object.fromEntries(userIds.map((userId) => [userId, 0]));
    const postBlind = (userId, amount) => {
      if (!userId || !Number.isFinite(amount) || amount <= 0) {
        return 0;
      }
      const currentStack = Number(stacks[userId] ?? 0);
      const posted = Math.max(0, Math.min(currentStack, Math.trunc(amount)));
      stacks[userId] = currentStack - posted;
      betThisRoundByUserId[userId] = posted;
      contributionsByUserId[userId] = posted;
      return posted;
    };
    const { smallBlind, bigBlind } = normalizeHandStakes(stakes);
    const sbPosted = postBlind(sbUserId, smallBlind);
    const bbPosted = postBlind(bbUserId, bigBlind);
    const currentBet = Math.max(sbPosted, bbPosted);
    for (const userId of userIds) {
      toCallByUserId[userId] = Math.max(0, currentBet - Number(betThisRoundByUserId[userId] ?? 0));
    }
    const handSeats = members.map((member) => ({ userId: member.userId, seatNo: member.seat }));
    return {
      ...inactivity,
      roomId: coreState.roomId || tableId,
      handId: nextHandId(tableId, versionForHand, members.length),
      handSeed,
      phase: "PREFLOP",
      dealerSeatNo: members[dealerIndex]?.seat ?? null,
      turnUserId,
      seats: handSeats.map((seat) => ({ ...seat })),
      handSeats,
      community: [],
      communityDealt: 0,
      potTotal: sbPosted + bbPosted,
      sidePots: [],
      currentBet,
      bigBlind,
      lastRaiseSize: bigBlind,
      stacks,
      handStartStacksByUserId,
      toCallByUserId,
      betThisRoundByUserId,
      actedThisRoundByUserId,
      lastBettingRoundActionByUserId,
      foldedByUserId,
      contributionsByUserId,
      holeCardsByUserId: toHoleCardCodeMap(dealt.holeCardsByUserId),
      deck: toCardCodes(dealt.deck),
      turnStartedAt: null,
      turnDeadlineAt: null
    };
  }
  function resolveNextDealerSeatNo({ members, settledState, coreState = null }) {
    if (!Array.isArray(members) || members.length === 0) {
      return null;
    }
    const eligibleMembers = members.filter((member) => isContinuationEligibleByStack(member.userId, settledState?.stacks, {
      isBot: coreState?.seatDetailsByUserId?.[member.userId]?.isBot === true
    }));
    if (eligibleMembers.length === 0) {
      return null;
    }
    const currentDealerSeatNo = Number(settledState?.dealerSeatNo);
    const currentDealerIndex = eligibleMembers.findIndex((member) => member.seat === currentDealerSeatNo);
    if (currentDealerIndex === -1) {
      return eligibleMembers[0].seat;
    }
    const nextIndex = (currentDealerIndex + 1) % eligibleMembers.length;
    return eligibleMembers[nextIndex]?.seat ?? eligibleMembers[0].seat;
  }
  function buildNextHandStateFromSettled({ tableId, coreState, settledState, nextVersion, stakes = null }) {
    const sitOutByUserId = { ...settledState?.sitOutByUserId || {} };
    for (const [userId, pending] of Object.entries(settledState?.pendingAutoSitOutByUserId || {})) {
      if (pending === true) sitOutByUserId[userId] = true;
    }
    coreState = { ...coreState, pokerState: { ...settledState, sitOutByUserId, pendingAutoSitOutByUserId: {} } };
    const members = orderedEligibleSeatMembers(coreState, settledState?.stacks);
    const nextDealerSeatNo = resolveNextDealerSeatNo({ members, settledState, coreState });
    const nextHandState = buildBootstrappedPokerState({
      tableId,
      coreState,
      dealerSeatNo: nextDealerSeatNo,
      startingStacks: settledState?.stacks,
      handVersion: nextVersion,
      stakes
    });
    if (!nextHandState) return null;
    const durableStacks = { ...nextHandState.stacks };
    const settledStacks = settledState?.stacks && typeof settledState.stacks === "object" && !Array.isArray(settledState.stacks) ? settledState.stacks : {};
    for (const [userId, rawStack] of Object.entries(settledStacks)) {
      if (Object.prototype.hasOwnProperty.call(durableStacks, userId)) continue;
      const stack = Number(rawStack);
      if (Number.isInteger(stack) && stack >= 0) durableStacks[userId] = stack;
    }
    const waitingForNextHandByUserId = settledState?.waitingForNextHandByUserId && typeof settledState.waitingForNextHandByUserId === "object" && !Array.isArray(settledState.waitingForNextHandByUserId) ? { ...settledState.waitingForNextHandByUserId } : {};
    for (const seat of nextHandState.handSeats) delete waitingForNextHandByUserId[seat.userId];
    return { ...nextHandState, stacks: durableStacks, waitingForNextHandByUserId };
  }

  // ws-server/poker/shared/poker-bot-strategy.mjs
  function normalizeString2(value) {
    return String(value == null ? "" : value).trim();
  }
  function clampRandom(random = Math.random) {
    const sampled = typeof random === "function" ? Number(random()) : Number(random);
    if (!Number.isFinite(sampled)) return 0;
    return Math.max(0, Math.min(0.999999, sampled));
  }
  function readAmount(entry) {
    if (!entry || typeof entry !== "object") return null;
    for (const key of ["min", "minimum", "minAmount", "amountMin", "amount"]) {
      const value = Number(entry[key]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }
  function findAction(legalActions, actionType) {
    const target = normalizeString2(actionType).toUpperCase();
    for (const entry of Array.isArray(legalActions) ? legalActions : []) {
      if (typeof entry === "string" && entry.toUpperCase() === target) return { type: target };
      const entryType = normalizeString2(entry?.type || entry?.action).toUpperCase();
      if (entryType === target) return entry;
    }
    return null;
  }
  function botCardsFromContext(context = {}) {
    const userId = typeof context?.userId === "string" ? context.userId : "";
    const privateCards = context?.privateState?.holeCardsByUserId?.[userId];
    const publicCards = context?.state?.holeCardsByUserId?.[userId];
    return Array.isArray(privateCards) ? privateCards : Array.isArray(publicCards) ? publicCards : [];
  }
  function cardRank(card) {
    const raw = typeof card === "string" ? card.trim().slice(0, -1).toUpperCase() : card?.r;
    if (typeof raw === "number" && Number.isInteger(raw)) return raw;
    if (raw === "A") return 14;
    if (raw === "K") return 13;
    if (raw === "Q") return 12;
    if (raw === "J") return 11;
    if (raw === "T" || raw === "10") return 10;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 2 && parsed <= 14 ? parsed : 0;
  }
  function cardSuit(card) {
    return typeof card === "string" ? card.trim().slice(-1).toUpperCase() : normalizeString2(card?.s).toUpperCase();
  }
  function scorePreflop(cards) {
    if (!Array.isArray(cards) || cards.length < 2) return 0.45;
    const ranks = cards.map(cardRank).sort((a, b) => b - a);
    const suited = cardSuit(cards[0]) && cardSuit(cards[0]) === cardSuit(cards[1]);
    const pair = ranks[0] === ranks[1];
    const high = ranks[0] || 0;
    const low = ranks[1] || 0;
    if (pair) return high >= 11 ? 0.95 : high >= 8 ? 0.78 : 0.62;
    let score = (high + low) / 28;
    if (suited) score += 0.1;
    if (high >= 14 && low >= 10) score += 0.2;
    else if (high >= 13 && low >= 10) score += 0.12;
    if (Math.abs(high - low) <= 2) score += 0.05;
    return Math.max(0.05, Math.min(0.98, score));
  }
  function scorePostflop(cards, community) {
    const allCards = [...Array.isArray(cards) ? cards : [], ...Array.isArray(community) ? community : []];
    if (allCards.length < 3) return scorePreflop(cards);
    const rankCounts = /* @__PURE__ */ new Map();
    const suitCounts = /* @__PURE__ */ new Map();
    for (const card of allCards) {
      const rank = cardRank(card);
      const suit = cardSuit(card);
      if (rank) rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
      if (suit) suitCounts.set(suit, (suitCounts.get(suit) || 0) + 1);
    }
    const counts = [...rankCounts.values()].sort((a, b) => b - a);
    const maxSuit = Math.max(0, ...suitCounts.values());
    if (counts[0] >= 4) return 0.98;
    if (counts[0] >= 3 && counts[1] >= 2) return 0.94;
    if (maxSuit >= 5) return 0.9;
    if (counts[0] >= 3) return 0.82;
    if (counts[0] >= 2 && counts[1] >= 2) return 0.72;
    if (counts[0] >= 2) return 0.58;
    return Math.max(0.1, Math.min(0.55, scorePreflop(cards) - 0.12 + (maxSuit === 4 ? 0.12 : 0)));
  }
  function strengthThresholds(profile) {
    if (profile === "TIGHT") return { bet: 0.78, call: 0.55, bluff: 0.06, aggression: 0.28 };
    if (profile === "LOOSE") return { bet: 0.62, call: 0.32, bluff: 0.18, aggression: 0.55 };
    return { bet: 0.7, call: 0.43, bluff: 0.11, aggression: 0.38 };
  }
  function enrichBotLegalActions(legalInfo = {}) {
    const actions = Array.isArray(legalInfo?.actions) ? legalInfo.actions : [];
    const minRaiseTo = Number(legalInfo?.minRaiseTo);
    const maxRaiseTo = Number(legalInfo?.maxRaiseTo);
    const maxBetAmount = Number(legalInfo?.maxBetAmount);
    const minBetAmount = Number(legalInfo?.minBetAmount);
    const normalizedMinRaiseTo = Number.isFinite(minRaiseTo) ? Math.trunc(minRaiseTo) : null;
    const normalizedMaxRaiseTo = Number.isFinite(maxRaiseTo) ? Math.trunc(maxRaiseTo) : null;
    const normalizedMaxBetAmount = Number.isFinite(maxBetAmount) ? Math.trunc(maxBetAmount) : null;
    const normalizedMinBetAmount = Number.isFinite(minBetAmount) ? Math.trunc(minBetAmount) : null;
    const botMinBet = normalizedMinBetAmount > 0 ? normalizedMinBetAmount : 1;
    return actions.map((action) => {
      const type = typeof action === "string" ? action.toUpperCase() : normalizeString2(action?.type || action?.action).toUpperCase();
      if (type === "BET" && normalizedMaxBetAmount > 0) {
        return {
          type: "BET",
          min: botMinBet,
          minAmount: botMinBet,
          amount: botMinBet,
          max: normalizedMaxBetAmount,
          maxAmount: normalizedMaxBetAmount
        };
      }
      if (type === "RAISE" && normalizedMinRaiseTo > 0) {
        return {
          type: "RAISE",
          min: normalizedMinRaiseTo,
          minAmount: normalizedMinRaiseTo,
          amount: normalizedMinRaiseTo,
          max: normalizedMaxRaiseTo,
          maxAmount: normalizedMaxRaiseTo
        };
      }
      return action;
    });
  }
  function pickLegalAction(legalActions, preferredTypes) {
    for (const type of preferredTypes) {
      const action = findAction(legalActions, type);
      if (!action) continue;
      const amount = readAmount(action);
      if (type === "BET" || type === "RAISE") {
        if (amount == null) continue;
        const normalizedAmount = Math.trunc(amount);
        if (normalizedAmount <= 0) continue;
        return { type, amount: normalizedAmount };
      }
      return { type };
    }
    return null;
  }
  function hasAggressedThisRound(context = {}) {
    const userId = typeof context?.userId === "string" ? context.userId : "";
    const lastAction = normalizeString2(context?.state?.lastBettingRoundActionByUserId?.[userId]).toUpperCase();
    return lastAction === "BET" || lastAction === "RAISE";
  }
  function chooseBotActionProfiled(legalActions, context = {}) {
    const seatProfile = Array.isArray(context?.state?.seats) ? context.state.seats.find((seat) => seat?.userId === context?.userId)?.botProfile : null;
    const profile = normalizeString2(context?.profile ?? context?.botProfile ?? seatProfile).toUpperCase() || "NORMAL";
    const cards = botCardsFromContext(context);
    const phase = normalizeString2(context?.state?.phase).toUpperCase();
    const strength = phase === "PREFLOP" ? scorePreflop(cards) : scorePostflop(cards, context?.state?.community);
    const thresholds = strengthThresholds(profile);
    const roll = clampRandom(context?.random);
    const toCall = Number(context?.state?.toCallByUserId?.[context?.userId] ?? 0);
    const aggressiveTypes = hasAggressedThisRound(context) ? ["BET", "CALL", "CHECK", "FOLD"] : ["BET", "RAISE", "CALL", "CHECK", "FOLD"];
    if (strength >= thresholds.bet && roll < thresholds.aggression || roll < thresholds.bluff) return pickLegalAction(legalActions, aggressiveTypes);
    if (toCall <= 0 && strength >= thresholds.call - 0.15) return pickLegalAction(legalActions, ["CHECK", "BET", "CALL", "FOLD"]);
    if (strength >= thresholds.call || roll < thresholds.call * 0.35) return pickLegalAction(legalActions, ["CALL", "CHECK", "FOLD"]);
    return pickLegalAction(legalActions, ["CHECK", "FOLD", "CALL"]);
  }

  // shared/profile-avatar-projection.mjs
  var PUBLIC_AVATAR_VARIANTS = Object.freeze([
    "comet-blue",
    "falcon-orange",
    "fox-blue",
    "nova-purple",
    "orbit-green",
    "panda-pink"
  ]);
  var PUBLIC_AVATAR_VARIANT_SET = new Set(PUBLIC_AVATAR_VARIANTS);

  // ws-server/poker/read-model/public-poker-identity.mjs
  var HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
  var DISPLAY_NAME_CONTROL_RE = /[\u0000-\u001f\u007f]/;
  var SUPABASE_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i;
  var UPLOADED_AVATAR_PATH_RE = /^\/storage\/v1\/object\/public\/profile-avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
  var PUBLIC_AVATAR_VARIANT_SET2 = /* @__PURE__ */ new Set([...PUBLIC_AVATAR_VARIANTS, "default"]);
  function normalizeHandle(value) {
    const handle = typeof value === "string" ? value.trim().toLowerCase() : "";
    return HANDLE_RE.test(handle) ? handle : "";
  }
  function normalizeDisplayName(value) {
    const displayName = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (displayName.length < 2 || displayName.length > 40 || DISPLAY_NAME_CONTROL_RE.test(displayName)) {
      return "";
    }
    return displayName;
  }
  function normalizeTrustedStorageOrigin(storageBaseUrl) {
    const rawValue = typeof storageBaseUrl === "string" ? storageBaseUrl.trim() : "";
    try {
      const parsed = new URL(rawValue);
      if (!SUPABASE_ORIGIN_RE.test(parsed.origin) || parsed.href !== `${parsed.origin}/`) {
        return "";
      }
      return parsed.origin;
    } catch {
      return "";
    }
  }
  function normalizePublicAvatar(value, { storageBaseUrl = "" } = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    if (value.type === "uploaded" && typeof value.url === "string") {
      const trustedOrigin = normalizeTrustedStorageOrigin(storageBaseUrl);
      try {
        const parsed = new URL(value.url);
        if (trustedOrigin && parsed.origin === trustedOrigin && UPLOADED_AVATAR_PATH_RE.test(parsed.pathname) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && !parsed.port) {
          return { type: "uploaded", url: parsed.href };
        }
      } catch {
        return null;
      }
    }
    if (value.type === "default" && PUBLIC_AVATAR_VARIANT_SET2.has(value.variant)) {
      return { type: "default", variant: value.variant };
    }
    return null;
  }
  function normalizePublicPokerIdentity(value, { storageBaseUrl = "" } = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const handle = normalizeHandle(value.handle);
    const displayName = normalizeDisplayName(value.displayName);
    const avatar = normalizePublicAvatar(value.avatar, { storageBaseUrl });
    if (!handle || !displayName || !avatar) {
      return null;
    }
    return { handle, displayName, avatar };
  }

  // ws-server/poker/read-model/room-core-snapshot.mjs
  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function withoutPrivateState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return state;
    }
    const { holeCardsByUserId, deck, handSeed, handStartStacksByUserId, ...rest } = state;
    return rest;
  }
  function normalizeCards(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((card) => typeof card === "string");
  }
  function normalizeActions(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((action) => typeof action === "string");
  }
  function normalizeSeatRows(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((seat) => seat && typeof seat.userId === "string" && Number.isInteger(seat.seatNo)).map((seat) => {
      const normalized = {
        userId: seat.userId,
        seatNo: seat.seatNo,
        status: typeof seat.status === "string" ? seat.status : "ACTIVE"
      };
      if (seat.isBot === true) normalized.isBot = true;
      if (typeof seat.botProfile === "string" && seat.botProfile) normalized.botProfile = seat.botProfile;
      if (seat.leaveAfterHand === true) normalized.leaveAfterHand = true;
      return normalized;
    });
  }
  function normalizeSeatDetails(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const entries = Object.entries(value).filter(([userId]) => typeof userId === "string" && userId).map(([userId, details]) => [userId, {
      isBot: details?.isBot === true,
      botProfile: typeof details?.botProfile === "string" ? details.botProfile : null,
      leaveAfterHand: details?.leaveAfterHand === true
    }]);
    return Object.fromEntries(entries);
  }
  function normalizeStacks(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const entries = Object.entries(value).filter(([userId, amount]) => typeof userId === "string" && userId && Number.isFinite(Number(amount)));
    return Object.fromEntries(entries.map(([userId, amount]) => [userId, Number(amount)]));
  }
  function normalizeNumericUserMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const entries = Object.entries(value).filter(([userId, amount]) => typeof userId === "string" && userId && Number.isFinite(Number(amount)));
    return Object.fromEntries(entries.map(([userId, amount]) => [userId, Number(amount)]));
  }
  function normalizeLastBettingRoundActionByUserId(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const allowed = /* @__PURE__ */ new Set(["fold", "check", "call", "raise", "all_in"]);
    return Object.fromEntries(
      Object.entries(value).filter(([userId, action]) => typeof userId === "string" && userId && typeof action === "string" && allowed.has(action))
    );
  }
  function normalizeMemberSeatRows(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((member) => member && typeof member.userId === "string" && Number.isInteger(member.seat)).map((member) => ({ userId: member.userId, seatNo: member.seat, status: "ACTIVE" }));
  }
  function resolvePublicSeats({ statePublic, members, coreState, publicProfilesByUserId, publicProfileStorageBaseUrl, tableStatus }) {
    const stateSeats = normalizeSeatRows(statePublic?.seats);
    const memberSeats = normalizeMemberSeatRows(members);
    const seatDetailsByUserId = normalizeSeatDetails(coreState?.seatDetailsByUserId);
    const foldedByUserId = asObject(statePublic?.foldedByUserId) || {};
    const leftTableByUserId = asObject(statePublic?.leftTableByUserId) || {};
    const byUserId = new Map(memberSeats.map((seat) => [seat.userId, seat]));
    for (const seat of stateSeats) byUserId.set(seat.userId, { ...byUserId.get(seat.userId) || {}, ...seat });
    const baseSeats = [...byUserId.values()].sort((left, right) => left.seatNo - right.seatNo || left.userId.localeCompare(right.userId));
    return baseSeats.filter((seat) => leftTableByUserId[seat.userId] !== true || tableStatus !== "CLOSED" && statePublic?.inactivityEjectionByUserId?.[seat.userId] && stateSeats.some((owned) => owned.userId === seat.userId)).map((seat) => {
      const details = seatDetailsByUserId[seat.userId] || null;
      const merged = { ...seat };
      if (foldedByUserId[seat.userId] === true) {
        merged.status = "FOLDED";
      }
      if (details?.isBot) merged.isBot = true;
      if (details?.botProfile) merged.botProfile = details.botProfile;
      if (details?.leaveAfterHand) merged.leaveAfterHand = true;
      if (!merged.isBot) {
        const profile = normalizePublicPokerIdentity(publicProfilesByUserId?.[seat.userId], { storageBaseUrl: publicProfileStorageBaseUrl });
        if (profile) merged.profile = profile;
      }
      return merged;
    });
  }
  function resolvePublicStacks({ statePublic, coreState, seats }) {
    const stateStacks = normalizeStacks(statePublic?.stacks);
    const fallbackStacks = { ...normalizeStacks(coreState?.publicStacks), ...stateStacks };
    if (Object.keys(fallbackStacks).length <= 0) {
      return {};
    }
    if (!Array.isArray(seats) || seats.length <= 0) {
      return fallbackStacks;
    }
    const allowedUserIds = new Set(seats.map((seat) => seat.userId));
    return Object.fromEntries(Object.entries(fallbackStacks).filter(([userId]) => allowedUserIds.has(userId)));
  }
  function resolvePotTotal(statePublic) {
    if (Number.isFinite(statePublic?.potTotal)) {
      return statePublic.potTotal;
    }
    if (Number.isFinite(statePublic?.pot)) {
      return statePublic.pot;
    }
    return 0;
  }
  function resolveSidePots(statePublic) {
    return Array.isArray(statePublic?.sidePots) ? statePublic.sidePots : [];
  }
  function resolveRoundFromPhase(phase) {
    if (typeof phase !== "string") {
      return null;
    }
    if (phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER") {
      return phase;
    }
    return null;
  }
  function resolveTurnTimerField(value) {
    return Number.isFinite(value) ? value : null;
  }
  function resolveTurnTimer({ statePublic, turnUserId }) {
    const liveRound = resolveRoundFromPhase(statePublic?.phase);
    const hasTurnUser = typeof turnUserId === "string" && turnUserId.trim().length > 0;
    if (!liveRound || !hasTurnUser) {
      return { startedAt: null, deadlineAt: null };
    }
    return {
      startedAt: resolveTurnTimerField(statePublic?.turnStartedAt),
      deadlineAt: resolveTurnTimerField(statePublic?.turnDeadlineAt)
    };
  }
  function resolveTurnIdentity({ statePublic, turnUserId, turnSeat }) {
    const liveRound = resolveRoundFromPhase(statePublic?.phase);
    const hasTurnUser = typeof turnUserId === "string" && turnUserId.trim().length > 0;
    if (!liveRound || !hasTurnUser) {
      return { userId: null, seat: null };
    }
    return { userId: turnUserId, seat: turnSeat };
  }
  function normalizeAwardedPots(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((pot) => pot && typeof pot === "object" && !Array.isArray(pot)).map((pot) => ({
      amount: Number.isFinite(Number(pot.amount)) ? Number(pot.amount) : 0,
      winners: Array.isArray(pot.winners) ? pot.winners.filter((userId) => typeof userId === "string") : [],
      eligibleUserIds: Array.isArray(pot.eligibleUserIds) ? pot.eligibleUserIds.filter((userId) => typeof userId === "string") : []
    }));
  }
  function normalizeShowdown(showdown) {
    if (!showdown || typeof showdown !== "object" || Array.isArray(showdown)) {
      return null;
    }
    const normalized = {
      winners: Array.isArray(showdown.winners) ? showdown.winners.filter((userId) => typeof userId === "string") : [],
      potsAwarded: normalizeAwardedPots(showdown.potsAwarded),
      potAwardedTotal: Number.isFinite(showdown.potAwardedTotal) ? showdown.potAwardedTotal : Number.isFinite(showdown.potAwarded) ? showdown.potAwarded : 0,
      reason: typeof showdown.reason === "string" ? showdown.reason : null,
      handId: typeof showdown.handId === "string" ? showdown.handId : null
    };
    if (Array.isArray(showdown.revealedShowdownParticipants)) {
      normalized.revealedShowdownParticipants = showdown.revealedShowdownParticipants.filter((entry) => entry && typeof entry.userId === "string").map((entry) => ({
        userId: entry.userId,
        holeCards: normalizeCards(entry.holeCards)
      })).filter((entry) => entry.holeCards.length === 2);
    }
    return normalized;
  }
  function normalizeHandSettlement(handSettlement) {
    if (!handSettlement || typeof handSettlement !== "object" || Array.isArray(handSettlement)) {
      return null;
    }
    return {
      handId: typeof handSettlement.handId === "string" ? handSettlement.handId : null,
      settledAt: typeof handSettlement.settledAt === "string" ? handSettlement.settledAt : null,
      payouts: handSettlement.payouts && typeof handSettlement.payouts === "object" && !Array.isArray(handSettlement.payouts) ? handSettlement.payouts : {}
    };
  }
  function resolvePrivateBranch({ state, statePublic, userId, youSeat, stack, isBot, tableStatus }) {
    const intent = state?.inactivityEjectionByUserId?.[userId];
    if (intent) {
      const retained = state?.seats?.some((seat) => seat?.userId === userId) || Object.prototype.hasOwnProperty.call(state?.stacks || {}, userId);
      const pending = tableStatus !== "CLOSED" && retained;
      return {
        userId,
        seat: youSeat,
        holeCards: [],
        inactivity: { status: pending ? "pending" : "removed", isSinglePlayer: intent.isSinglePlayer === true },
        playerState: { status: pending ? "EJECTION_PENDING" : "REMOVED", stack: Number.isInteger(stack) ? stack : 0, canRebuy: false }
      };
    }
    if (!Number.isInteger(youSeat)) {
      return null;
    }
    const holeCards = normalizeCards(state?.holeCardsByUserId?.[userId]);
    const handSeats = Array.isArray(statePublic?.handSeats) ? statePublic.handSeats : Array.isArray(statePublic?.seats) ? statePublic.seats : [];
    const phase = typeof state?.phase === "string" ? state.phase.trim().toUpperCase() : "";
    const inCurrentHand = phase !== "SETTLED" && handSeats.some((seat) => seat?.userId === userId);
    const waiting = statePublic?.waitingForNextHandByUserId?.[userId] === true;
    const status = waiting ? "WAITING_NEXT_HAND" : stack === 0 && !inCurrentHand ? "OUT_OF_CHIPS" : "ACTIVE";
    const branch = {
      userId,
      seat: youSeat,
      holeCards
    };
    if (Number.isInteger(stack) && stack >= 0) {
      branch.playerState = {
        status,
        stack,
        canRebuy: isBot !== true && tableStatus === "OPEN" && stack === 0 && !inCurrentHand && !waiting
      };
    }
    return branch;
  }
  function hasLeftTable(statePublic, userId) {
    if (typeof userId !== "string" || !userId) {
      return false;
    }
    const leftTableByUserId = asObject(statePublic?.leftTableByUserId) || {};
    return leftTableByUserId[userId] === true;
  }
  function resolveRevealedShowdownParticipants({ statePublic, state }) {
    if (statePublic?.phase !== "SETTLED") {
      return [];
    }
    if (statePublic?.showdown?.reason !== "computed") {
      return [];
    }
    const potsAwarded = Array.isArray(statePublic?.showdown?.potsAwarded) ? statePublic.showdown.potsAwarded : [];
    const comparedUserIds = [];
    const comparedUserIdSet = /* @__PURE__ */ new Set();
    potsAwarded.forEach((pot) => {
      if (!pot || typeof pot !== "object" || !Array.isArray(pot.eligibleUserIds) || pot.eligibleUserIds.length < 2) return;
      pot.eligibleUserIds.forEach((userId) => {
        if (typeof userId !== "string" || !userId || comparedUserIdSet.has(userId)) return;
        comparedUserIdSet.add(userId);
        comparedUserIds.push(userId);
      });
    });
    if (comparedUserIds.length === 0) {
      const winners = Array.isArray(statePublic?.showdown?.winners) ? statePublic.showdown.winners.filter((value) => typeof value === "string" && value) : [];
      winners.forEach((userId) => {
        if (comparedUserIdSet.has(userId)) return;
        comparedUserIdSet.add(userId);
        comparedUserIds.push(userId);
      });
    }
    if (comparedUserIds.length === 0) {
      return [];
    }
    const holeCardsByUserId = asObject(state?.holeCardsByUserId) || {};
    return comparedUserIds.map((userId) => ({
      userId,
      holeCards: normalizeCards(holeCardsByUserId[userId])
    })).filter((entry) => entry.holeCards.length === 2);
  }
  function projectRoomCoreSnapshot({ tableId, roomId, coreState, members, userId, youSeat, tableStatus = "OPEN", publicProfilesByUserId = {}, publicProfileStorageBaseUrl = "" }) {
    const state = asObject(coreState?.pokerState) || asObject(coreState?.state);
    const statePublic = state ? withoutPrivateState(state) : null;
    let publicSeats = resolvePublicSeats({ statePublic, members, coreState, publicProfilesByUserId, publicProfileStorageBaseUrl, tableStatus });
    const publicStacks = resolvePublicStacks({ statePublic, coreState, seats: publicSeats });
    const handSeats = Array.isArray(statePublic?.handSeats) ? statePublic.handSeats : Array.isArray(statePublic?.seats) ? statePublic.seats : [];
    const publicPhase = typeof state?.phase === "string" ? state.phase.trim().toUpperCase() : "";
    const currentHandUserIds = new Set(handSeats.map((seat) => seat?.userId).filter((seatUserId) => typeof seatUserId === "string" && seatUserId));
    publicSeats = publicSeats.map((seat) => {
      if (statePublic?.inactivityEjectionByUserId?.[seat.userId]) return { ...seat, status: "EJECTION_PENDING" };
      if (seat.isBot === true) return seat;
      const stack = Number(publicStacks[seat.userId]);
      if (statePublic?.waitingForNextHandByUserId?.[seat.userId] === true) return { ...seat, status: "WAITING_NEXT_HAND" };
      const inCurrentHand = publicPhase !== "SETTLED" && currentHandUserIds.has(seat.userId);
      if (Number.isInteger(stack) && stack === 0 && !inCurrentHand) return { ...seat, status: "OUT_OF_CHIPS" };
      return seat;
    });
    const effectiveYouSeat = hasLeftTable(statePublic, userId) || state?.inactivityEjectionByUserId?.[userId] ? null : youSeat;
    if (!statePublic) {
      return {
        roomId,
        seats: publicSeats,
        stacks: publicStacks,
        bigBlind: null,
        hand: {
          handId: null,
          status: members.length > 0 ? "LOBBY" : "EMPTY",
          round: null,
          dealerSeatNo: null
        },
        board: {
          cards: []
        },
        pot: {
          total: 0,
          sidePots: []
        },
        turn: {
          userId: members[0]?.userId ?? null,
          seat: Number.isInteger(members[0]?.seat) ? members[0].seat : null,
          startedAt: null,
          deadlineAt: null
        },
        legalActions: {
          seat: null,
          actions: []
        },
        projectedLegalActions: {
          seat: null,
          actions: []
        },
        betThisRoundByUserId: {},
        committedByUserId: {},
        private: Number.isInteger(effectiveYouSeat) ? {
          userId,
          seat: effectiveYouSeat,
          holeCards: []
        } : null
      };
    }
    const turnUserId = typeof statePublic.turnUserId === "string" ? statePublic.turnUserId : null;
    const seatByUserId = asObject(coreState?.seats) || {};
    const turnSeat = Number.isInteger(seatByUserId[turnUserId]) ? seatByUserId[turnUserId] : null;
    const turnIdentity = resolveTurnIdentity({ statePublic, turnUserId, turnSeat });
    const turnTimer = resolveTurnTimer({ statePublic, turnUserId: turnIdentity.userId });
    const isTurnPlayer = Number.isInteger(effectiveYouSeat) && turnUserId === userId;
    const legalInfo = Number.isInteger(effectiveYouSeat) ? computeSharedLegalActions({ statePublic, userId }) : { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    const constraintsInfo = Number.isInteger(effectiveYouSeat) && !isTurnPlayer ? computeProjectedLegalActions({ statePublic, userId }) : legalInfo;
    const snapshot = {
      roomId: typeof statePublic.roomId === "string" ? statePublic.roomId : roomId || tableId,
      seats: publicSeats,
      stacks: publicStacks,
      bigBlind: Number.isInteger(statePublic?.bigBlind) && statePublic.bigBlind > 0 ? statePublic.bigBlind : null,
      hand: {
        handId: typeof statePublic.handId === "string" && statePublic.handId.trim() ? statePublic.handId : null,
        status: typeof statePublic.phase === "string" ? statePublic.phase : null,
        round: resolveRoundFromPhase(statePublic.phase),
        dealerSeatNo: Number.isInteger(statePublic.dealerSeatNo) ? statePublic.dealerSeatNo : null
      },
      board: {
        cards: normalizeCards(statePublic.community)
      },
      pot: {
        total: resolvePotTotal(statePublic),
        sidePots: resolveSidePots(statePublic)
      },
      turn: {
        userId: turnIdentity.userId,
        seat: turnIdentity.seat,
        startedAt: turnTimer.startedAt,
        deadlineAt: turnTimer.deadlineAt
      },
      legalActions: {
        seat: Number.isInteger(effectiveYouSeat) ? effectiveYouSeat : null,
        actions: Number.isInteger(effectiveYouSeat) ? normalizeActions(legalInfo.actions) : []
      },
      // Authoritative pre-action action list for a seated viewer who is not
      // acting (e.g. RAISE presence honors reopening rights); empty for the
      // current actor and observers. The browser uses this instead of inferring
      // raising rights from numeric constraints.
      projectedLegalActions: Number.isInteger(effectiveYouSeat) && !isTurnPlayer ? { seat: effectiveYouSeat, actions: normalizeActions(constraintsInfo.actions) } : { seat: null, actions: [] },
      actionConstraints: {
        toCall: Number.isFinite(constraintsInfo.toCall) ? constraintsInfo.toCall : null,
        minRaiseTo: Number.isFinite(constraintsInfo.minRaiseTo) ? constraintsInfo.minRaiseTo : null,
        maxRaiseTo: Number.isFinite(constraintsInfo.maxRaiseTo) ? constraintsInfo.maxRaiseTo : null,
        maxBetAmount: Number.isFinite(constraintsInfo.maxBetAmount) ? constraintsInfo.maxBetAmount : null,
        minBetAmount: Number.isFinite(constraintsInfo.minBetAmount) ? constraintsInfo.minBetAmount : null
      },
      betThisRoundByUserId: normalizeNumericUserMap(statePublic.betThisRoundByUserId),
      committedByUserId: normalizeNumericUserMap(statePublic.committedByUserId),
      lastBettingRoundActionByUserId: normalizeLastBettingRoundActionByUserId(statePublic.lastBettingRoundActionByUserId),
      private: resolvePrivateBranch({
        state,
        statePublic,
        userId,
        youSeat: effectiveYouSeat,
        stack: Number.isInteger(Number(publicStacks[userId])) ? Number(publicStacks[userId]) : null,
        isBot: coreState?.seatDetailsByUserId?.[userId]?.isBot === true,
        tableStatus
      })
    };
    const showdown = normalizeShowdown(statePublic.showdown);
    if (showdown) {
      const revealedShowdownParticipants = resolveRevealedShowdownParticipants({ statePublic, state });
      if (revealedShowdownParticipants.length > 0) {
        showdown.revealedShowdownParticipants = revealedShowdownParticipants;
      }
      snapshot.showdown = showdown;
    }
    const handSettlement = normalizeHandSettlement(statePublic.handSettlement);
    if (handSettlement) {
      snapshot.handSettlement = handSettlement;
    }
    return snapshot;
  }

  // shared/poker-domain/bots.mjs
  function clampRandom2(random = Math.random) {
    const sampled = typeof random === "function" ? Number(random()) : Number(random);
    if (!Number.isFinite(sampled)) return 0;
    return Math.max(0, Math.min(0.999999, sampled));
  }
  function randomIntInclusive(min, max, random = Math.random) {
    const low = Math.ceil(Number(min));
    const high = Math.floor(Number(max));
    if (!Number.isInteger(low) || !Number.isInteger(high) || high < low) return low;
    return low + Math.floor((high - low + 1) * clampRandom2(random));
  }
  function computeTargetBotCount({ maxPlayers, humanCount, maxBots, minBots = 2, random = Math.random } = {}) {
    const totalSeats = Number.isFinite(Number(maxPlayers)) ? Math.trunc(Number(maxPlayers)) : 0;
    const humans = Number.isFinite(Number(humanCount)) ? Math.trunc(Number(humanCount)) : 0;
    const limit = Number.isFinite(Number(maxBots)) ? Math.trunc(Number(maxBots)) : 0;
    const minimum = Number.isFinite(Number(minBots)) ? Math.trunc(Number(minBots)) : 0;
    if (humans <= 0 || humans >= totalSeats) return 0;
    const upper = Math.max(0, Math.min(Math.max(0, limit), Math.max(0, totalSeats - humans)));
    if (upper <= 0) return 0;
    const lower = Math.min(upper, Math.max(1, Math.max(0, minimum)));
    return randomIntInclusive(lower, upper, random);
  }

  // poker/offline/offline-game.mjs
  var STORAGE_KEY = "arcade.poker.offline.v1";
  var HUMAN = "offline-human";
  var legacyMembers = [HUMAN, "bot-offline-1", "bot-offline-2"].map((userId, i) => ({ userId, seat: i + 1 }));
  var clone = (value) => JSON.parse(JSON.stringify(value));
  var integer = (value) => Number.isSafeInteger(value) && value >= 0;
  function core(session) {
    const members = session.members, ids = members.map((m) => m.userId);
    return {
      version: session.hand,
      roomId: session.tableId,
      members,
      seats: Object.fromEntries(members.map((m) => [m.userId, m.seat])),
      seatDetailsByUserId: Object.fromEntries(ids.map((id) => [id, { isBot: id !== HUMAN, botProfile: "NORMAL" }])),
      pokerState: session.state
    };
  }
  function createOfflineGame({ storage, prepare = prepareSeed, random = Math.random, uuid = () => crypto.randomUUID(), now = Date.now } = {}) {
    function read() {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return { schema: 1, revision: 0, wallet: 5e3, session: null };
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("Offline storage is corrupt; reset local practice data to continue");
      }
      if (data?.schema !== 1 || !integer(data.wallet) || !integer(data.revision)) throw new Error("Unsupported offline storage");
      if (data.session) {
        const s = data.session;
        if (!s.members) s.members = legacyMembers.map((m) => ({ ...m }));
        if (!Array.isArray(s.members) || s.members.length < 3 || s.members.length > 6 || !s.members.every((m, i) => m?.seat === i + 1 && m.userId === (i === 0 ? HUMAN : "bot-offline-" + i))) throw new Error("Invalid offline storage roster");
        const ids = s.members.map((m) => m.userId);
        if (typeof s.tableId !== "string" || !s.tableId.startsWith("offline-") || !integer(s.hand) || s.hand < 1 || ![100, 500, 1e3].includes(s.buyIn) || !s.state || s.state.roomId !== s.tableId || typeof s.state.handId !== "string" || !integer(s.state.potTotal) || !ids.every((id) => integer(s.state.stacks?.[id])) || Object.keys(s.state.stacks).length !== ids.length) throw new Error("Invalid offline storage session");
        if (s.clock && (typeof s.clock.paused !== "boolean" || !integer(s.clock.durationMs) || s.clock.durationMs < 1 || s.clock.durationMs > 2e4 || !integer(s.clock.remainingMs) || s.clock.remainingMs > s.clock.durationMs || !integer(s.clock.dueAt))) throw new Error("Invalid offline storage clock");
        if (s.clock && (s.clock.botDueAt != null && !integer(s.clock.botDueAt) || s.clock.botRemainingMs != null && (!integer(s.clock.botRemainingMs) || s.clock.botRemainingMs > 2e3))) throw new Error("Invalid offline storage bot timer");
      }
      return data;
    }
    function save(data, revision) {
      if (read().revision !== revision) throw new Error("Offline session changed in another tab; resume it");
      data.revision = revision + 1;
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
      return clone(data);
    }
    function mutate(fn) {
      const data = read(), revision = data.revision;
      const result = fn(data);
      save(data, revision);
      return result;
    }
    function session(data) {
      if (!data.session) throw new Error("No offline session");
      return data.session;
    }
    function legalFor(s, id) {
      return computeSharedLegalActions({ statePublic: s.state, userId: id });
    }
    function token(data) {
      const s = data.session;
      return s ? { tableId: s.tableId, handId: s.state.handId, userId: s.state.turnUserId, revision: data.revision } : null;
    }
    function matches(expected, data) {
      const current = token(data);
      return !expected || !!current && ["tableId", "handId", "userId", "revision"].every((key) => expected[key] === current[key]);
    }
    function stampClock(s) {
      const durationMs = s.state.phase === "SETTLED" ? 3e3 : 2e4;
      const botDelay = s.state.phase !== "SETTLED" && s.state.turnUserId !== HUMAN ? 1e3 + Math.floor(clampRandom(random) * 1001) : null;
      s.state = stampTurnDeadline(s.state, now(), durationMs);
      s.clock = { paused: false, durationMs, remainingMs: durationMs, dueAt: now() + durationMs, botDueAt: botDelay === null ? null : now() + botDelay, botRemainingMs: botDelay };
    }
    function apply(s, id, action, source = id === HUMAN ? "human" : "bot") {
      if (s.state.turnUserId !== id) throw new Error("Not your turn");
      const result = applyAction({ pokerState: s.state, userId: id, action: action.type, amount: action.amount, nowIso: new Date(now()).toISOString() });
      if (!result.ok) throw new Error(result.reason);
      s.state = result.state;
      s.lastAction = { userId: id, type: action.type, source, at: now() };
      stampClock(s);
    }
    function bot(s) {
      const id = s.state.turnUserId;
      if (!id || id === HUMAN) return false;
      const action = chooseBotActionProfiled(enrichBotLegalActions(legalFor(s, id)), { userId: id, profile: "NORMAL", state: s.state, random });
      if (!action) throw new Error("No legal bot decision");
      apply(s, id, action);
      return true;
    }
    const api = {
      read,
      timerToken() {
        return token(read());
      },
      pendingTimer() {
        const data = read(), s = data.session;
        if (!s || !s.clock || s.clock.paused || s.state.phase === "SETTLED" && s.state.stacks[HUMAN] < 2) return null;
        const dueAt = s.clock.botDueAt == null ? s.clock.dueAt : Math.min(s.clock.dueAt, s.clock.botDueAt);
        return { token: token(data), delayMs: Math.max(0, dueAt - now()) };
      },
      pause() {
        const data = read(), s = data.session;
        if (!s || s.clock?.paused) return false;
        const revision = data.revision;
        if (!s.clock) stampClock(s);
        s.clock.remainingMs = Math.max(1e3, Math.min(s.clock.durationMs, s.clock.dueAt - now()));
        if (s.clock.botDueAt != null) s.clock.botRemainingMs = Math.max(0, s.clock.botDueAt - now());
        s.clock.paused = true;
        s.state = { ...s.state, turnStartedAt: null, turnDeadlineAt: null };
        save(data, revision);
        return true;
      },
      resume(restart = false) {
        const data = read(), s = data.session;
        if (!s || s.clock && !s.clock.paused && !restart) return false;
        const revision = data.revision;
        if (!s.clock || s.state.phase !== "SETTLED" && s.clock.durationMs !== 2e4) stampClock(s);
        const duration = s.clock.durationMs, remaining = Math.max(1e3, Math.min(duration, s.clock.remainingMs));
        s.state = stampTurnDeadline(s.state, now() - (duration - remaining), duration);
        const botRemaining = s.clock.botRemainingMs ?? null;
        s.clock = { paused: false, durationMs: duration, remainingMs: remaining, dueAt: now() + remaining, botDueAt: botRemaining === null ? null : now() + botRemaining, botRemainingMs: botRemaining };
        save(data, revision);
        return true;
      },
      async tick(expected) {
        const data = read(), s = data.session;
        if (!s || !expected || !matches(expected, data) || !s.clock || s.clock.paused) return false;
        if (s.state.phase === "SETTLED") {
          if (now() < s.clock.dueAt || s.state.stacks[HUMAN] < 2) return false;
          return api.nextHand(expected);
        }
        const decision = decideTurnTimeout({ pokerState: s.state, nowMs: now(), turnMs: 2e4 });
        if (decision.due) apply(s, decision.actorUserId, decision.action, "timeout");
        else if (s.state.turnUserId !== HUMAN && s.clock.botDueAt != null && now() >= s.clock.botDueAt) {
          if (!bot(s)) return false;
        } else return false;
        save(data, data.revision);
        return true;
      },
      async newGame(buyIn) {
        if (![100, 500, 1e3].includes(buyIn)) throw new Error("Invalid Practice Chips buy-in");
        const data = read(), revision = data.revision;
        if (data.session) throw new Error("Leave the current session before New Game");
        if (data.wallet < buyIn) throw new Error("Not enough Practice Chips; use free refill");
        const count = computeTargetBotCount({ maxPlayers: 6, humanCount: 1, minBots: 2, maxBots: 5, random });
        const members = Array.from({ length: count + 1 }, (_, i) => ({ userId: i === 0 ? HUMAN : "bot-offline-" + i, seat: i + 1 }));
        const ids = members.map((m) => m.userId);
        const s = { tableId: "offline-" + uuid(), buyIn, hand: 1, members, state: null };
        await prepare(`ws_seed_${s.tableId}_1_${members.length}`);
        s.state = buildBootstrappedPokerState({ tableId: s.tableId, coreState: core(s), startingStacks: Object.fromEntries(ids.map((id) => [id, buyIn])) });
        if (!s.state) throw new Error("Offline deal failed");
        stampClock(s);
        data.wallet -= buyIn;
        data.session = s;
        save(data, revision);
      },
      async nextHand(expected) {
        const data = read(), revision = data.revision;
        if (!matches(expected, data)) return false;
        const s = session(data);
        if (s.state.phase !== "SETTLED") throw new Error("Hand is not settled");
        if (s.state.stacks[HUMAN] < 2) throw new Error("Rebuy or Leave to continue");
        for (const { userId: id } of s.members.slice(1)) if (s.state.stacks[id] < 2) s.state.stacks[id] = s.buyIn;
        s.hand++;
        await prepare(`ws_seed_${s.tableId}_${s.hand}_${s.members.length}`);
        if (expected && !matches(expected, read())) return false;
        const next = buildNextHandStateFromSettled({ tableId: s.tableId, coreState: core(s), settledState: s.state, nextVersion: s.hand });
        if (!next) throw new Error("Offline rollover failed");
        s.state = next;
        stampClock(s);
        save(data, revision);
        return true;
      },
      legal() {
        return legalFor(session(read()), HUMAN);
      },
      act(action, expected) {
        const data = read();
        if (!matches(expected, data)) return false;
        const s = session(data);
        if (action.handId && action.handId !== s.state.handId) return false;
        apply(s, HUMAN, action);
        save(data, data.revision);
        return true;
      },
      botStep() {
        return mutate((data) => bot(session(data)));
      },
      leave() {
        const data = read();
        if (!data.session) return { wallet: data.wallet, cashout: 0 };
        const revision = data.revision, s = data.session;
        for (let n = 0; s.state.phase !== "SETTLED" && n < 300; n++) {
          if (s.state.turnUserId === HUMAN) apply(s, HUMAN, { type: "FOLD" });
          else if (!bot(s)) throw new Error("Offline hand cannot finish");
        }
        if (s.state.phase !== "SETTLED") throw new Error("Offline hand did not settle");
        const cashout = s.state.stacks[HUMAN];
        data.wallet += cashout;
        data.session = null;
        save(data, revision);
        return { wallet: data.wallet, cashout };
      },
      rebuy() {
        return mutate((data) => {
          const s = session(data);
          if (s.state.phase !== "SETTLED") throw new Error("Rebuy requires settled hand");
          const amount = Math.max(0, s.buyIn - s.state.stacks[HUMAN]);
          if (data.wallet < amount) throw new Error("Not enough Practice Chips; use free refill");
          data.wallet -= amount;
          s.state.stacks[HUMAN] += amount;
          stampClock(s);
        });
      },
      refill() {
        return mutate((data) => {
          data.wallet = Math.max(5e3, data.wallet);
        });
      },
      snapshot() {
        const data = read(), s = session(data), members = s.members;
        return {
          ...projectRoomCoreSnapshot({ tableId: s.tableId, roomId: s.tableId, coreState: core(s), members, userId: HUMAN, youSeat: 1 }),
          tableId: s.tableId,
          stateVersion: data.revision,
          youSeat: 1,
          table: { status: "OPEN", maxSeats: members.length, buyIn: s.buyIn }
        };
      }
    };
    return api;
  }

  // poker/offline/browser-entry.mjs
  var game = createOfflineGame({ storage: window.localStorage });
  var listener;
  var timer;
  var active = false;
  var epoch = 0;
  var reactionListener;
  var lastBotReaction = 0;
  var renderedToken;
  function botReaction(before) {
    if (!reactionListener || Date.now() - lastBotReaction < 4e3) return;
    const session = game.read().session, s = session?.state;
    if (!s) return;
    const botSeats = session.members.filter((m) => m.userId !== HUMAN).map((m) => ({ userId: m.userId, seatNo: m.seat }));
    const candidate = s.phase === "SETTLED" && before.phase !== "SETTLED" ? classifySettlementReaction({ state: s, botSeats }) : s.currentBet > before.currentBet ? classifyRaiseReaction({ actorUserId: before.turnUserId, actorSeatNo: session.members.find((m) => m.userId === before.turnUserId)?.seat, street: s.phase, botSeats }) : classifyAmbientReaction({ botSeats });
    if (candidate) {
      lastBotReaction = Date.now();
      reactionListener({ payload: { ...candidate, seatNo: candidate.botSeatNo } });
    }
  }
  function publish() {
    if (listener && game.read().session) {
      const token = game.timerToken(), snapshot = game.snapshot();
      renderedToken = token.revision === snapshot.stateVersion ? token : null;
      listener(snapshot);
    }
    updateWallet();
  }
  function fail(error) {
    const node = document.getElementById("offlineError") || document.getElementById("pokerV2ErrorText");
    if (node) {
      node.textContent = error.message;
      node.hidden = false;
    }
  }
  function updateWallet() {
    const data = game.read(), settled = data.session?.state.phase === "SETTLED";
    document.querySelectorAll("[data-practice-balance]").forEach((el) => {
      el.textContent = data.wallet.toLocaleString() + " Practice Chips";
    });
    const resume = document.getElementById("offlineResume");
    if (resume) resume.hidden = !data.session;
    const rebuy = document.getElementById("offlineRebuy");
    if (rebuy) rebuy.disabled = !settled;
  }
  function schedule() {
    clearTimeout(timer);
    if (!active || document.hidden || !listener) return;
    const pending = game.pendingTimer();
    if (!pending) return;
    timer = setTimeout(() => run(() => active && !document.hidden ? game.tick(pending.token) : false).catch(fail), pending.delayMs);
  }
  async function run(fn) {
    if (!navigator.locks) throw new Error("This browser cannot safely save Offline play");
    return navigator.locks.request(STORAGE_KEY, async () => {
      const before = game.read().session?.state, lastAction = game.read().session?.lastAction;
      const result = await fn();
      publish();
      if (before && JSON.stringify(lastAction) !== JSON.stringify(game.read().session?.lastAction)) botReaction(before);
      schedule();
      return result;
    });
  }
  async function activate() {
    if (active || !listener || document.hidden) return;
    const generation = ++epoch;
    await run(() => {
      if (generation !== epoch || document.hidden) return;
      game.resume(true);
      active = true;
    });
  }
  async function park() {
    epoch++;
    active = false;
    clearTimeout(timer);
    if (listener) {
      try {
        await run(() => game.pause());
      } catch (error) {
        if (!document.hidden) {
          active = true;
          schedule();
        }
        throw error;
      }
    }
  }
  var resolveConfirmation;
  function cancelDialog() {
    const dialog = document.getElementById("offlineConfirm");
    if (dialog?.open) {
      dialog.close("cancel");
      return true;
    }
    const leave = document.getElementById("pokerV2LeaveConfirmModal");
    if (leave && !leave.hidden) {
      document.getElementById("pokerV2LeaveConfirmCancel").click();
      return true;
    }
    return false;
  }
  function ask(title, message) {
    const dialog = document.getElementById("offlineConfirm");
    if (!dialog) return Promise.reject(new Error("Practice confirmation unavailable"));
    document.getElementById("offlineConfirmTitle").textContent = title;
    document.getElementById("offlineConfirmCopy").textContent = message;
    return new Promise((resolve) => {
      resolveConfirmation = resolve;
      dialog.showModal();
      document.getElementById("offlineConfirmCancel").focus();
    });
  }
  async function backToLobby() {
    if (cancelDialog()) return;
    await park();
    window.location.assign("/poker/");
  }
  window.PokerOffline = {
    human: HUMAN,
    read: game.read,
    backToLobby,
    cancelDialog,
    start(fn, reactions) {
      listener = fn;
      reactionListener = reactions;
      activate().catch(fail);
    },
    act(action) {
      const expected = renderedToken;
      return run(() => active && expected ? game.act(action, expected) : false);
    },
    leave() {
      clearTimeout(timer);
      return run(() => {
        const result = game.leave();
        active = false;
        epoch++;
        return result;
      }).catch((error) => {
        schedule();
        throw error;
      });
    },
    rebuy() {
      return run(() => game.rebuy());
    },
    reaction(key, targetSeatNo) {
      if (reactionListener) reactionListener({ payload: { seatNo: 1, reactionKey: key, ...targetSeatNo ? { targetSeatNo } : {} } });
    },
    inspect() {
      return game.read();
    }
  };
  function init() {
    const dialog = document.getElementById("offlineConfirm");
    if (dialog) {
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.close("cancel");
      });
      dialog.addEventListener("close", () => {
        const resolve = resolveConfirmation;
        resolveConfirmation = null;
        if (resolve) resolve(dialog.returnValue === "confirm");
      });
      document.getElementById("offlineConfirmYes").addEventListener("click", () => dialog.close("confirm"));
      document.getElementById("offlineConfirmCancel").addEventListener("click", () => dialog.close("cancel"));
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && cancelDialog()) event.preventDefault();
    });
    const plugins = window.Capacitor?.Plugins;
    if (window.location.pathname === "/poker/offline/play.html") {
      if (plugins?.App) {
        plugins.App.addListener("backButton", () => backToLobby().catch(fail));
        plugins.App.addListener("appStateChange", (event) => (event.isActive ? activate() : park()).catch(fail));
      }
      if (plugins?.SystemBars) Promise.resolve(plugins.SystemBars.hide()).catch(() => {
      });
    }
    try {
      updateWallet();
    } catch (error) {
      fail(error);
    }
    const action = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", () => run(fn).catch(fail));
    };
    action("offlinePlay", async () => {
      const buyIn = Number(document.querySelector('[name="offlineBuyIn"]:checked')?.value || 100);
      if (game.read().session) {
        if (!await ask("New Offline game", "Settle and leave the current practice session before starting a new game?")) return;
        game.leave();
      }
      await game.newGame(buyIn);
      window.location.assign("/poker/offline/play.html");
    });
    const resume = document.getElementById("offlineResume");
    if (resume) resume.addEventListener("click", () => window.location.assign("/poker/offline/play.html"));
    document.querySelectorAll("[data-offline-refill]").forEach((el) => el.addEventListener("click", () => run(() => game.refill()).catch(fail)));
    action("offlineRefill", () => game.refill());
    action("offlineRebuy", () => game.rebuy());
    action("offlineReset", async () => {
      if (await ask("Reset Practice Chips", "Discard only this device\u2019s Practice Chips and Offline session? Online CH is unaffected.")) {
        clearTimeout(timer);
        window.localStorage.removeItem(STORAGE_KEY);
        window.location.assign("/poker/");
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelDialog();
      (document.hidden ? park() : activate()).catch(fail);
    });
    window.addEventListener("pagehide", () => {
      park().catch(fail);
    });
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) {
        clearTimeout(timer);
        try {
          publish();
          schedule();
        } catch (error) {
          fail(error);
        }
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
