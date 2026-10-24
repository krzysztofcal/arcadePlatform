// GENERATED from shared accepted WS rules and strategy. Do not edit.
(() => {
  // poker/offline/browser-crypto.mjs
  var digests = /* @__PURE__ */ new Map();
  async function prepareSeed(seed) {
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
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
    let state2 = digest.readUInt32BE(0) ^ digest.readUInt32BE(4) ^ digest.readUInt32BE(8) ^ digest.readUInt32BE(12);
    if (state2 === 0) {
      state2 = 2654435769;
    }
    const next = () => {
      state2 ^= state2 << 13;
      state2 ^= state2 >>> 17;
      state2 ^= state2 << 5;
      return (state2 >>> 0) / 4294967296;
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
  function deriveCurrentBet(state2) {
    const currentBet = toSafeInt(state2.currentBet, null);
    if (currentBet == null || currentBet < 0) return maxFromMap(state2.betThisRoundByUserId);
    return currentBet;
  }
  function deriveLastRaiseSize(state2, currentBet) {
    const lastRaiseSize = toSafeInt(state2.lastRaiseSize, null);
    if (lastRaiseSize == null || lastRaiseSize <= 0) return currentBet > 0 ? currentBet : 0;
    return lastRaiseSize;
  }
  function deriveBigBlind(state2) {
    const bigBlind = toSafeInt(state2?.bigBlind, 0);
    return bigBlind > 0 ? bigBlind : 1;
  }
  function canRaise(state2, userId, toCall, lastRaiseSize) {
    return !state2?.actedThisRoundByUserId?.[userId] || toCall >= lastRaiseSize;
  }
  function isActivePlayer(state2, userId) {
    if (!state2 || !userId) return false;
    if (state2.leftTableByUserId && state2.leftTableByUserId[userId]) return false;
    if (state2.sitOutByUserId && state2.sitOutByUserId[userId]) return false;
    const folded = !!(state2.foldedByUserId && state2.foldedByUserId[userId]);
    const allIn = !!(state2.allInByUserId && state2.allInByUserId[userId]);
    return !folded && !allIn;
  }
  function isSeatedPlayer(state2, userId) {
    if (!state2 || !userId) {
      return false;
    }
    const phase = typeof state2?.phase === "string" ? state2.phase : "";
    const seats = ACTION_PHASES.has(phase) && Array.isArray(state2?.handSeats) && state2.handSeats.length > 0 ? state2.handSeats : state2?.seats;
    if (Array.isArray(seats)) {
      return seats.some((seat) => seat && seat.userId === userId);
    }
    return !!(state2.stacks && typeof state2.stacks === "object" && Object.prototype.hasOwnProperty.call(state2.stacks, userId));
  }
  function computeLegalActionsForSeatedPlayer(state2, userId) {
    const stack = toSafeInt(state2.stacks?.[userId], 0);
    const currentUserBet = toSafeInt(state2.betThisRoundByUserId?.[userId], 0);
    const currentBet = deriveCurrentBet(state2);
    const lastRaiseSize = deriveLastRaiseSize(state2, currentBet);
    const toCall = Math.max(0, currentBet - currentUserBet);
    if (stack <= 0) {
      return { actions: [], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (toCall > 0) {
      const actions2 = ["FOLD", "CALL"];
      const maxRaiseTo = stack + currentUserBet;
      const rawMinRaiseTo = currentBet + lastRaiseSize;
      const minRaiseTo = maxRaiseTo > 0 ? Math.min(rawMinRaiseTo, maxRaiseTo) : rawMinRaiseTo;
      const mayRaise = canRaise(state2, userId, toCall, lastRaiseSize) && maxRaiseTo > currentBet;
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
    const minBetAmount = Math.min(deriveBigBlind(state2), stack);
    return { actions, toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: stack, minBetAmount };
  }
  function computeSharedLegalActions({ statePublic, userId } = {}) {
    const state2 = statePublic || {};
    if (!state2 || typeof state2 !== "object" || Array.isArray(state2)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    const phase = typeof state2.phase === "string" ? state2.phase : "";
    if (!ACTION_PHASES.has(phase)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (!userId || typeof userId !== "string") {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (!isSeatedPlayer(state2, userId) || !isActivePlayer(state2, userId)) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    const turnUserId = typeof state2.turnUserId === "string" ? state2.turnUserId : "";
    if (!turnUserId) {
      return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    if (turnUserId !== userId) {
      const toCall = Math.max(0, deriveCurrentBet(state2) - toSafeInt(state2.betThisRoundByUserId?.[userId], 0));
      return { actions: ["FOLD"], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
    }
    return computeLegalActionsForSeatedPlayer(state2, userId);
  }

  // ws-server/poker/shared/settlement/poker-materialize-showdown.mjs
  var getHandId = (state2) => typeof state2?.handId === "string" && state2.handId.trim() ? state2.handId.trim() : "";
  var normalizeChipAmount = (name, value) => {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || Math.floor(amount) !== amount) {
      throw new Error(`showdown_invalid_${name}`);
    }
    return amount;
  };
  var normalizeSeatOrder = (seatUserIdsInOrder2, state2) => {
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
    if (!Array.isArray(state2?.seats)) return [];
    const ordered = state2.seats.slice().sort((a, b) => Number(a?.seatNo ?? 0) - Number(b?.seatNo ?? 0));
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
  var listEligibleUserIds = ({ state: state2, seatUserIdsInOrder: seatUserIdsInOrder2 }) => {
    const seatOrder = normalizeSeatOrder(seatUserIdsInOrder2, state2);
    if (seatOrder.length === 0) throw new Error("showdown_invalid_seats");
    const stacks = state2.stacks || {};
    const eligible = [];
    for (const userId of seatOrder) {
      if (state2.foldedByUserId?.[userId]) continue;
      if (state2.leftTableByUserId?.[userId]) continue;
      if (state2.sitOutByUserId?.[userId]) continue;
      if (!Object.prototype.hasOwnProperty.call(stacks, userId)) continue;
      normalizeChipAmount("stack", stacks[userId]);
      eligible.push(userId);
    }
    return { eligibleUserIds: eligible, seatOrder };
  };
  var ensureCommunityComplete = (state2) => {
    if (!Array.isArray(state2.community)) throw new Error("showdown_incomplete_community");
    if (state2.community.length > 5) throw new Error("showdown_invalid_community");
    if (state2.community.length !== 5) throw new Error("showdown_incomplete_community");
    return state2.community.slice();
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
  var ensureExistingSettlementMatches = ({ state: state2, handId }) => {
    const settlementHandId = typeof state2?.handSettlement?.handId === "string" && state2.handSettlement.handId.trim() ? state2.handSettlement.handId.trim() : "";
    if (!settlementHandId || settlementHandId !== handId) {
      throw new Error("showdown_settlement_hand_mismatch");
    }
  };
  var finalizeSettlement = ({ state: state2, handId, payouts, nowIso, klog }) => {
    if (state2?.handSettlement) {
      ensureExistingSettlementMatches({ state: state2, handId });
      return state2;
    }
    const settledAt = typeof nowIso === "string" ? nowIso : (/* @__PURE__ */ new Date()).toISOString();
    const nextState = {
      ...state2,
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
        tableId: state2?.tableId ?? null,
        handId,
        payouts
      });
    }
    return nextState;
  };
  var materializeShowdownAndPayout = ({
    state: state2,
    seatUserIdsInOrder: seatUserIdsInOrder2,
    holeCardsByUserId,
    computeShowdown: computeShowdown2,
    awardPotsAtShowdown: awardPotsAtShowdown2,
    klog,
    nowIso
  }) => {
    if (!state2 || typeof state2 !== "object" || Array.isArray(state2)) return { nextState: state2 };
    const handId = getHandId(state2);
    const showdownHandId = typeof state2.showdown?.handId === "string" && state2.showdown.handId.trim() ? state2.showdown.handId.trim() : "";
    if (state2.showdown) {
      if (!handId) return { nextState: state2 };
      if (!showdownHandId || showdownHandId !== handId) throw new Error("showdown_hand_mismatch");
      if (normalizeChipAmount("pot", state2.pot) > 0) throw new Error("showdown_pot_not_zero");
      if (state2.handSettlement) {
        ensureExistingSettlementMatches({ state: state2, handId });
        return { nextState: state2 };
      }
      const payouts2 = buildPayoutsFromPotsAwarded(state2.showdown?.potsAwarded);
      const payoutTotal = Object.values(payouts2).reduce((sum, value) => sum + normalizeChipAmount("pot", value), 0);
      const expectedTotal = normalizeChipAmount(
        "pot",
        state2.showdown?.potAwardedTotal ?? state2.showdown?.potAwarded ?? 0
      );
      if (payoutTotal !== expectedTotal) throw new Error("showdown_invalid_settlement_total");
      if (typeof klog === "function") {
        klog("poker_settlement_backfilled", {
          tableId: state2?.tableId ?? null,
          handId,
          reason: "missing_handSettlement"
        });
      }
      return {
        nextState: finalizeSettlement({
          state: state2,
          handId,
          payouts: payouts2,
          nowIso,
          klog
        })
      };
    }
    if (!handId) throw new Error("showdown_missing_hand_id");
    const { eligibleUserIds, seatOrder } = listEligibleUserIds({ state: state2, seatUserIdsInOrder: seatUserIdsInOrder2 });
    if (eligibleUserIds.length === 0) {
      if (typeof klog === "function") klog("poker_showdown_no_eligible", { handId: state2.handId ?? null });
      return { nextState: state2 };
    }
    if (eligibleUserIds.length === 1) {
      const winnerUserId = eligibleUserIds[0];
      const potAmount = normalizeChipAmount("pot", state2.pot);
      const nextStacks2 = { ...copyStacks(state2.stacks) };
      nextStacks2[winnerUserId] = normalizeChipAmount("stack", nextStacks2[winnerUserId] ?? 0) + potAmount;
      const awardedAt = typeof nowIso === "string" ? nowIso : (/* @__PURE__ */ new Date()).toISOString();
      const withShowdown = {
        ...state2,
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
    const community = ensureCommunityComplete(state2);
    const prevStacks = copyStacks(state2.stacks);
    const awardResult = awardPotsAtShowdown2({
      state: {
        ...state2,
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
  var listShowdownUserIds = (state2, seatUserIdsInOrder2) => {
    return seatUserIdsInOrder2.filter((userId) => typeof userId === "string" && !state2.foldedByUserId?.[userId] && !state2.leftTableByUserId?.[userId] && !state2.sitOutByUserId?.[userId] && !state2.pendingAutoSitOutByUserId?.[userId]);
  };
  var ensureHoleCardsPresent = ({ holeCardsByUserId, userId }) => {
    const holeCards = holeCardsByUserId?.[userId];
    if (!Array.isArray(holeCards) || holeCards.length !== 2) {
      throw new Error("showdown_missing_hole_cards");
    }
    return holeCards;
  };
  var awardPotsAtShowdown = ({ state: state2, seatUserIdsInOrder: seatUserIdsInOrder2, computeShowdown: computeShowdown2, nowIso }) => {
    if (!state2 || typeof state2 !== "object" || Array.isArray(state2)) {
      throw new Error("showdown_invalid_state");
    }
    if (!Array.isArray(seatUserIdsInOrder2) || seatUserIdsInOrder2.length === 0) {
      throw new Error("showdown_no_players");
    }
    if (typeof computeShowdown2 !== "function") {
      throw new Error("showdown_invalid_compute");
    }
    const showdownUserIds = listShowdownUserIds(state2, seatUserIdsInOrder2);
    if (showdownUserIds.length === 0) {
      throw new Error("showdown_no_players");
    }
    const community = Array.isArray(state2.community) ? state2.community.slice() : [];
    if (community.length !== 5) {
      throw new Error("showdown_invalid_community");
    }
    const holeCardsByUserId = state2.holeCardsByUserId || {};
    const showdownUserIdSet = new Set(showdownUserIds);
    for (const userId of showdownUserIds) {
      ensureHoleCardsPresent({ holeCardsByUserId, userId });
    }
    let pots = normalizeSidePots(state2.sidePots);
    if (!pots && isPlainObject(state2.contributionsByUserId)) {
      pots = buildSidePots({
        contributionsByUserId: state2.contributionsByUserId,
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
      pots = [{ amount: normalizePotAmount(state2.pot ?? 0), eligibleUserIds: showdownUserIds.slice() }];
    }
    const nextStacks = { ...state2.stacks };
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
        ...state2,
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
  function asStateCopy(state2) {
    return {
      ...state2,
      stacks: { ...state2.stacks || {} },
      toCallByUserId: { ...state2.toCallByUserId || {} },
      betThisRoundByUserId: { ...state2.betThisRoundByUserId || {} },
      actedThisRoundByUserId: { ...state2.actedThisRoundByUserId || {} },
      lastBettingRoundActionByUserId: { ...state2.lastBettingRoundActionByUserId || {} },
      foldedByUserId: { ...state2.foldedByUserId || {} },
      contributionsByUserId: { ...state2.contributionsByUserId || {} },
      sidePots: Array.isArray(state2.sidePots) ? state2.sidePots.slice() : [],
      community: Array.isArray(state2.community) ? state2.community.slice() : [],
      deck: Array.isArray(state2.deck) ? state2.deck.slice() : []
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
  function seatUserIdsInOrder(state2) {
    return orderedSeats(state2).map((seat) => seat.userId);
  }
  function deriveBoardStateFromHandSeed(state2, communityCount) {
    const handSeed = typeof state2?.handSeed === "string" ? state2.handSeed.trim() : "";
    const seatOrder = seatUserIdsInOrder(state2);
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
  function resolveSettlementCommunity(state2) {
    const community = Array.isArray(state2?.community) ? state2.community.slice() : [];
    if (community.length === 5) {
      return community;
    }
    const derivedBoardState = deriveBoardStateFromHandSeed(state2, 5);
    return Array.isArray(derivedBoardState?.community) && derivedBoardState.community.length === 5 ? derivedBoardState.community : community;
  }
  function eligibleUserIdsForSettlement(state2) {
    return seatUserIdsInOrder(state2).filter((userId) => !state2.foldedByUserId?.[userId] && !state2.leftTableByUserId?.[userId] && !state2.sitOutByUserId?.[userId]);
  }
  function settleHandState(state2, nowIso) {
    const handId = typeof state2.handId === "string" ? state2.handId : "";
    if (!handId) {
      return state2;
    }
    const settlementCommunity = resolveSettlementCommunity(state2);
    const materialized = materializeShowdownAndPayout({
      state: {
        ...state2,
        pot: Number(state2.potTotal ?? state2.pot ?? 0),
        community: settlementCommunity.map(cardCodeToCard).filter(Boolean)
      },
      seatUserIdsInOrder: seatUserIdsInOrder(state2),
      holeCardsByUserId: toShowdownHoleCardsByUserId(state2.holeCardsByUserId),
      computeShowdown,
      awardPotsAtShowdown,
      nowIso
    });
    if (!materialized?.nextState || materialized.nextState === state2) {
      return state2;
    }
    return {
      ...state2,
      ...materialized.nextState,
      phase: "SETTLED",
      turnUserId: null,
      turnStartedAt: null,
      turnDeadlineAt: null,
      community: settlementCommunity,
      communityDealt: settlementCommunity.length,
      holeCardsByUserId: { ...state2.holeCardsByUserId || {} },
      deck: Array.isArray(state2.deck) ? state2.deck.slice() : [],
      potTotal: Number(materialized.nextState.pot ?? state2.potTotal ?? 0),
      sidePots: []
    };
  }
  function shouldSettleByFold(state2) {
    return eligibleUserIdsForSettlement(state2).length <= 1;
  }
  function shouldSettleAtShowdown(state2) {
    return state2.phase === "RIVER" && isBettingClosed(state2);
  }
  function orderedSeats(state2) {
    const phase = typeof state2?.phase === "string" ? state2.phase : "";
    const seats = ACTION_PHASES2.has(phase) && Array.isArray(state2?.handSeats) && state2.handSeats.length > 0 ? state2.handSeats : state2?.seats;
    return (Array.isArray(seats) ? seats : []).filter((seat) => typeof seat?.userId === "string" && Number.isInteger(seat?.seatNo)).slice().sort((a, b) => a.seatNo - b.seatNo || a.userId.localeCompare(b.userId));
  }
  function isSelectableActor(state2, userId) {
    if (state2.foldedByUserId?.[userId] || state2.leftTableByUserId?.[userId] || state2.sitOutByUserId?.[userId]) {
      return false;
    }
    const stack = Number(state2.stacks?.[userId] ?? 0);
    return stack > 0;
  }
  function resolveNextTurnUserId(state2, currentUserId) {
    const seats = orderedSeats(state2);
    if (seats.length === 0) {
      return null;
    }
    const activeUserIds = seats.map((seat) => seat.userId).filter((userId) => isSelectableActor(state2, userId));
    if (activeUserIds.length === 0) {
      return null;
    }
    if (activeUserIds.length === 1) {
      const onlyUserId = activeUserIds[0];
      return Number(state2.toCallByUserId?.[onlyUserId] ?? 0) > 0 ? onlyUserId : null;
    }
    const currentIndex = seats.findIndex((seat) => seat.userId === currentUserId);
    if (currentIndex === -1) {
      return activeUserIds[0];
    }
    for (let offset = 1; offset <= seats.length; offset += 1) {
      const nextSeat = seats[(currentIndex + offset) % seats.length];
      if (isSelectableActor(state2, nextSeat.userId)) {
        return nextSeat.userId;
      }
    }
    return null;
  }
  function recomputeToCall(state2) {
    const currentBet = Number(state2.currentBet ?? 0);
    for (const seat of orderedSeats(state2)) {
      const userId = seat.userId;
      const userBet = Number(state2.betThisRoundByUserId?.[userId] ?? 0);
      state2.toCallByUserId[userId] = Math.max(0, currentBet - userBet);
    }
  }
  function isBettingClosed(state2) {
    const seats = orderedSeats(state2);
    const active = seats.filter((seat) => isSelectableActor(state2, seat.userId));
    if (active.length === 0) {
      return true;
    }
    if (active.length === 1) {
      return Number(state2.toCallByUserId?.[active[0].userId] ?? 0) === 0;
    }
    const allMatched = active.every((seat) => Number(state2.toCallByUserId?.[seat.userId] ?? 0) === 0);
    if (!allMatched) {
      return false;
    }
    if (Number(state2.currentBet ?? 0) > 0) {
      return true;
    }
    return active.every((seat) => state2.actedThisRoundByUserId?.[seat.userId] === true);
  }
  function nextPhase(phase) {
    return typeof phase === "string" ? NEXT_PHASE[phase] ?? null : null;
  }
  function revealCommunityCards(state2, count) {
    const normalized = Number.isInteger(count) && count > 0 ? count : 0;
    if (normalized === 0) {
      return;
    }
    const deck = Array.isArray(state2.deck) ? state2.deck : [];
    const community = Array.isArray(state2.community) ? state2.community : [];
    const revealedCount = Number.isInteger(state2.communityDealt) ? Math.max(community.length, Math.min(5, state2.communityDealt)) : community.length;
    const targetCommunityCount = Math.min(5, revealedCount + normalized);
    const missingCount = Math.max(0, targetCommunityCount - community.length);
    const dealt = deck.slice(0, missingCount);
    if (dealt.length === missingCount) {
      state2.community = community.concat(dealt);
      state2.deck = deck.slice(dealt.length);
      state2.communityDealt = targetCommunityCount;
      return;
    }
    const derivedBoardState = deriveBoardStateFromHandSeed(state2, targetCommunityCount);
    if (Array.isArray(derivedBoardState?.community) && derivedBoardState.community.length === targetCommunityCount) {
      state2.community = derivedBoardState.community;
      state2.deck = Array.isArray(derivedBoardState.deck) ? derivedBoardState.deck : [];
      state2.communityDealt = targetCommunityCount;
      return;
    }
    state2.community = community.concat(dealt);
    state2.deck = deck.slice(dealt.length);
    state2.communityDealt = Math.max(revealedCount, state2.community.length);
  }
  function resetRoundState(state2) {
    state2.currentBet = 0;
    for (const seat of orderedSeats(state2)) {
      const userId = seat.userId;
      state2.betThisRoundByUserId[userId] = 0;
      state2.toCallByUserId[userId] = 0;
      state2.actedThisRoundByUserId[userId] = false;
      state2.lastBettingRoundActionByUserId[userId] = null;
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
  function resolveStreetTurnUserId(state2) {
    const seats = orderedSeats(state2);
    if (seats.length === 0) {
      return null;
    }
    const dealerSeatNo = Number(state2.dealerSeatNo ?? 0);
    const dealerIndex = seats.findIndex((seat) => seat.seatNo === dealerSeatNo);
    const startIndex = dealerIndex === -1 ? 0 : (dealerIndex + 1) % seats.length;
    for (let offset = 0; offset < seats.length; offset += 1) {
      const seat = seats[(startIndex + offset) % seats.length];
      if (isSelectableActor(state2, seat.userId)) {
        return seat.userId;
      }
    }
    return null;
  }
  function advanceStreetIfClosed(state2) {
    if (!isBettingClosed(state2)) {
      return false;
    }
    const phase = nextPhase(state2.phase);
    if (!phase) {
      state2.turnUserId = null;
      return true;
    }
    state2.phase = phase;
    if (phase === "FLOP") {
      revealCommunityCards(state2, 3);
    } else {
      revealCommunityCards(state2, 1);
    }
    resetRoundState(state2);
    state2.turnUserId = resolveStreetTurnUserId(state2);
    return true;
  }
  function advanceClosedStreets(state2, nowIso) {
    let advanced = false;
    while (isBettingClosed(state2)) {
      if (state2.phase === "RIVER") {
        return { advanced: true, settled: true, state: settleHandState(state2, nowIso) };
      }
      if (!advanceStreetIfClosed(state2)) {
        break;
      }
      advanced = true;
    }
    return { advanced, settled: false, state: state2 };
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
  function resolveTurnMs(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_TURN_MS;
    }
    return Math.trunc(parsed);
  }
  var TURN_MS = resolveTurnMs(void 0);

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
  function nextHandId(tableId2, version2, seatCount) {
    return `ws_hand_${tableId2}_${version2}_${seatCount}`;
  }
  function nextHandSeed(tableId2, version2, seatCount) {
    return `ws_seed_${tableId2}_${version2}_${seatCount}`;
  }
  function orderedSeatMembers(coreState) {
    const members2 = Array.isArray(coreState?.members) ? coreState.members : [];
    return members2.filter((member) => typeof member?.userId === "string" && Number.isInteger(member?.seat)).slice().sort((a, b) => a.seat - b.seat || a.userId.localeCompare(b.userId));
  }
  function isContinuationEligibleByStack(userId, stacksByUserId, { isBot = false } = {}) {
    const stack = Number(stacksByUserId?.[userId] ?? 0);
    const minimumStack = isBot ? MIN_STACK_TO_JOIN_HAND : 1;
    return Number.isFinite(stack) && stack >= minimumStack;
  }
  function orderedEligibleSeatMembers(coreState, stacksByUserId = null) {
    const members2 = orderedSeatMembers(coreState).filter((member) => !coreState?.pokerState?.inactivityEjectionByUserId?.[member.userId] && !coreState?.pokerState?.sitOutByUserId?.[member.userId] && !coreState?.pokerState?.leftTableByUserId?.[member.userId]);
    if (!stacksByUserId || typeof stacksByUserId !== "object" || Array.isArray(stacksByUserId)) {
      return members2;
    }
    return members2.filter((member) => isContinuationEligibleByStack(member.userId, stacksByUserId, {
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
    tableId: tableId2,
    coreState,
    dealerSeatNo = null,
    startingStacks = null,
    handVersion = null,
    stakes = null
  }) {
    const members2 = orderedEligibleSeatMembers(coreState, startingStacks);
    if (members2.length < MIN_PLAYERS_TO_BOOTSTRAP) {
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
    const userIds = members2.map((member) => member.userId);
    const dealerIndex = Number.isInteger(dealerSeatNo) ? Math.max(0, members2.findIndex((member) => member.seat === dealerSeatNo)) : 0;
    const isHeadsUp = members2.length === 2;
    const sbIndex = isHeadsUp ? dealerIndex : (dealerIndex + 1) % members2.length;
    const bbIndex = (sbIndex + 1) % members2.length;
    const utgIndex = isHeadsUp ? dealerIndex : (bbIndex + 1) % members2.length;
    const sbUserId = members2[sbIndex]?.userId ?? null;
    const bbUserId = members2[bbIndex]?.userId ?? null;
    const turnUserId = members2[utgIndex]?.userId ?? members2[dealerIndex]?.userId ?? null;
    const versionForHand = Number.isInteger(handVersion) ? handVersion : coreState.version;
    const handSeed = nextHandSeed(tableId2, versionForHand, members2.length);
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
    const handSeats = members2.map((member) => ({ userId: member.userId, seatNo: member.seat }));
    return {
      ...inactivity,
      roomId: coreState.roomId || tableId2,
      handId: nextHandId(tableId2, versionForHand, members2.length),
      handSeed,
      phase: "PREFLOP",
      dealerSeatNo: members2[dealerIndex]?.seat ?? null,
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

  // ws-server/poker/shared/poker-bot-strategy.mjs
  function normalizeString(value) {
    return String(value == null ? "" : value).trim();
  }
  function clampRandom(random2 = Math.random) {
    const sampled = typeof random2 === "function" ? Number(random2()) : Number(random2);
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
    const target = normalizeString(actionType).toUpperCase();
    for (const entry of Array.isArray(legalActions) ? legalActions : []) {
      if (typeof entry === "string" && entry.toUpperCase() === target) return { type: target };
      const entryType = normalizeString(entry?.type || entry?.action).toUpperCase();
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
    return typeof card === "string" ? card.trim().slice(-1).toUpperCase() : normalizeString(card?.s).toUpperCase();
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
      const type = typeof action === "string" ? action.toUpperCase() : normalizeString(action?.type || action?.action).toUpperCase();
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
    const lastAction = normalizeString(context?.state?.lastBettingRoundActionByUserId?.[userId]).toUpperCase();
    return lastAction === "BET" || lastAction === "RAISE";
  }
  function chooseBotActionProfiled(legalActions, context = {}) {
    const seatProfile = Array.isArray(context?.state?.seats) ? context.state.seats.find((seat) => seat?.userId === context?.userId)?.botProfile : null;
    const profile = normalizeString(context?.profile ?? context?.botProfile ?? seatProfile).toUpperCase() || "NORMAL";
    const cards = botCardsFromContext(context);
    const phase = normalizeString(context?.state?.phase).toUpperCase();
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

  // poker/offline/offline-game.mjs
  var human = "offline-human";
  var botIds = ["bot-offline-1", "bot-offline-2"];
  var members = [human, ...botIds].map((userId, i) => ({ userId, seat: i + 1 }));
  var tableId = "offline-" + crypto.randomUUID();
  var state;
  var version = 0;
  var listener;
  var started = false;
  var random = Math.random;
  var history = [];
  function legal(userId) {
    return computeSharedLegalActions({ statePublic: state, userId });
  }
  function snapshot() {
    const info = legal(human);
    return {
      tableId,
      stateVersion: version,
      table: { status: "PLAYING", maxSeats: 3, buyIn: 100 },
      seats: members.map((m) => ({ userId: m.userId, seatNo: m.seat, isBot: m.userId !== human, displayName: "You", status: "ACTIVE" })),
      stacks: state.stacks,
      youSeat: 1,
      hand: { handId: state.handId, status: state.phase, dealerSeatNo: state.dealerSeatNo },
      turn: { userId: state.turnUserId },
      pot: { total: state.potTotal },
      board: state.community,
      myHoleCards: state.holeCardsByUserId[human],
      bigBlind: state.bigBlind,
      legalActions: info.actions,
      actionConstraints: info,
      foldedByUserId: state.foldedByUserId,
      betThisRoundByUserId: state.betThisRoundByUserId,
      showdown: state.showdown || null,
      handSettlement: state.handSettlement || null
    };
  }
  function publish() {
    version++;
    if (listener) listener(snapshot());
  }
  function apply(userId, action) {
    if (state.turnUserId !== userId) throw new Error("Not your turn");
    const result = applyAction({ pokerState: state, userId, action: action.type, amount: action.amount, nowIso: (/* @__PURE__ */ new Date()).toISOString() });
    if (!result.ok) throw new Error(result.reason);
    history.push({ userId, ...action, phase: state.phase });
    state = result.state;
    publish();
  }
  async function advanceBots() {
    for (let n = 0; state.turnUserId && state.turnUserId !== human && n < 100; n++) {
      await new Promise((resolve) => setTimeout(resolve, 180));
      const userId = state.turnUserId;
      const action = chooseBotActionProfiled(enrichBotLegalActions(legal(userId)), { userId, profile: "NORMAL", state, random });
      if (!action) throw new Error("No legal bot decision");
      apply(userId, action);
    }
  }
  window.PokerOfflinePoc = {
    tableId,
    human,
    async start(onSnapshot, options = {}) {
      if (started) throw new Error("One hand only: reload for a new game");
      started = true;
      listener = onSnapshot;
      if (typeof options.random === "function") random = options.random;
      await prepareSeed(`ws_seed_${tableId}_1_3`);
      state = buildBootstrappedPokerState({ tableId, coreState: { version: 1, members }, startingStacks: Object.fromEntries(members.map((m) => [m.userId, 100])) });
      publish();
      await advanceBots();
    },
    async act(action) {
      apply(human, action);
      await advanceBots();
    },
    inspect() {
      return { tableId, state, history: history.slice(), total: state && Object.values(state.stacks).reduce((a, b) => a + b, 0) + state.potTotal };
    }
  };
})();
