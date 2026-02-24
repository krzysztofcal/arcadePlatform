import crypto from "node:crypto";
import { areCardsUnique, isValidTwoCards } from "./poker-cards-utils.mjs";
import { dealHoleCards } from "./poker-engine.mjs";
import { deriveDeck } from "./poker-deal-deterministic.mjs";
import { TURN_MS, computeNextDealerSeatNo } from "./poker-reducer.mjs";
import { getRng, isPlainObject, isStateStorageValid } from "./poker-state-utils.mjs";
import { updatePokerStateOptimistic } from "./poker-state-write.mjs";
import { parseStakes } from "./poker-stakes.mjs";
import { isHoleCardsTableMissing } from "./poker-hole-cards-store.mjs";

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const buildStacksFromSeats = (seats) => {
  const rows = Array.isArray(seats) ? seats : [];
  return rows.reduce((acc, seat) => {
    const userId = typeof seat?.user_id === "string" ? seat.user_id : "";
    if (!userId) return acc;
    const parsed = Number(seat?.stack);
    acc[userId] = Math.max(0, Number.isFinite(parsed) ? parsed : 0);
    return acc;
  }, {});
};

export const startHandCore = async ({
  tx,
  tableId,
  table,
  currentState,
  expectedVersion,
  validSeats,
  userId,
  requestId,
  previousDealerSeatNo,
  makeError,
  onAlreadyInHandConflict,
  deps,
}) => {
  const resolvedDeps = deps && typeof deps === "object" ? deps : {};
  const klogFn = typeof resolvedDeps.klog === "function" ? resolvedDeps.klog : () => {};
  const dealHoleCardsFn = resolvedDeps.dealHoleCards || dealHoleCards;
  const deriveDeckFn = resolvedDeps.deriveDeck || deriveDeck;
  const getRngFn = resolvedDeps.getRng || getRng;
  const computeNextDealerSeatNoFn = resolvedDeps.computeNextDealerSeatNo || computeNextDealerSeatNo;
  const parseStakesFn = resolvedDeps.parseStakes || parseStakes;
  const updatePokerStateOptimisticFn = resolvedDeps.updatePokerStateOptimistic || updatePokerStateOptimistic;

  const orderedSeats = validSeats.slice().sort((a, b) => Number(a.seat_no) - Number(b.seat_no));
  const orderedSeatList = orderedSeats.map((seat) => ({ userId: seat.user_id, seatNo: seat.seat_no }));
  let dealerSeatNo = computeNextDealerSeatNoFn(orderedSeatList, previousDealerSeatNo);
  if (!orderedSeats.some((seat) => seat.seat_no === dealerSeatNo)) dealerSeatNo = orderedSeats[0].seat_no;
  const dealerIndex = Math.max(orderedSeats.findIndex((seat) => seat.seat_no === dealerSeatNo), 0);
  const seatCount = orderedSeats.length;
  const isHeadsUp = seatCount === 2;
  const sbIndex = isHeadsUp ? dealerIndex : (dealerIndex + 1) % seatCount;
  const bbIndex = (sbIndex + 1) % seatCount;
  const utgIndex = isHeadsUp ? dealerIndex : (bbIndex + 1) % seatCount;
  const sbUserId = orderedSeats[sbIndex]?.user_id || null;
  const bbUserId = orderedSeats[bbIndex]?.user_id || null;
  const turnUserId = orderedSeats[utgIndex]?.user_id || orderedSeats[dealerIndex]?.user_id || orderedSeats[0].user_id;

  const rng = getRngFn();
  const handId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `hand_${Date.now()}_${Math.floor(rng() * 1e6)}`;
  const handSeed = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `seed_${Date.now()}_${Math.floor(rng() * 1e6)}`;
  const derivedSeats = orderedSeatList.slice();
  const activeUserIds = new Set(orderedSeats.map((seat) => seat.user_id));
  const activeUserIdList = orderedSeats.map((seat) => seat.user_id);
  if (activeUserIds.size < 2 || activeUserIdList.length < 2) {
    klogFn("poker_start_hand_invalid_active_players", {
      tableId,
      reason: "insufficient_active_players",
      activeUserCount: activeUserIds.size,
      activeSeatCount: activeUserIdList.length,
    });
    throw makeError(409, "state_invalid");
  }

  const currentStacks = parseStacks(currentState.stacks);
  const stacksFromSeats = buildStacksFromSeats(orderedSeats);
  const hasStoredStacks = Object.keys(currentStacks).length > 0;
  const missingStoredStackUserId = activeUserIdList.find((id) => !Object.prototype.hasOwnProperty.call(currentStacks, id));
  const useStoredStacks = hasStoredStacks && !missingStoredStackUserId;
  const nextStacks = activeUserIdList.reduce((acc, activeId) => {
    const raw = useStoredStacks ? currentStacks[activeId] : stacksFromSeats[activeId];
    const n = Number(raw);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) acc[activeId] = n;
    return acc;
  }, {});
  const invalidActiveStackUserIds = activeUserIdList.filter((activeId) => !Object.prototype.hasOwnProperty.call(nextStacks, activeId));
  if (invalidActiveStackUserIds.length > 0) {
    klogFn("poker_start_hand_invalid_active_stacks", {
      tableId,
      userId,
      invalidActiveStackUserIds,
      activeUserIdList,
      currentStacks,
      stacksFromSeats,
      useStoredStacks,
    });
    throw makeError(409, "state_invalid");
  }

  const toCallByUserId = Object.fromEntries(activeUserIdList.map((activeId) => [activeId, 0]));
  const betThisRoundByUserId = Object.fromEntries(activeUserIdList.map((activeId) => [activeId, 0]));
  const actedThisRoundByUserId = Object.fromEntries(activeUserIdList.map((activeId) => [activeId, false]));
  const foldedByUserId = Object.fromEntries(activeUserIdList.map((activeId) => [activeId, false]));
  const contributionsByUserId = Object.fromEntries(activeUserIdList.map((activeId) => [activeId, 0]));

  const stakesParsed = parseStakesFn(table?.stakes);
  if (!stakesParsed.ok) throw makeError(409, "invalid_stakes");
  const { sb: sbAmount, bb: bbAmount } = stakesParsed.value;
  const postBlind = (activeId, blindAmount) => {
    if (!activeId) return 0;
    const stack = nextStacks[activeId] ?? 0;
    const posted = Math.min(stack, blindAmount);
    nextStacks[activeId] = Math.max(0, stack - posted);
    betThisRoundByUserId[activeId] = posted;
    contributionsByUserId[activeId] = posted;
    return posted;
  };
  const sbPosted = postBlind(sbUserId, sbAmount);
  const bbPosted = postBlind(bbUserId, bbAmount);
  const currentBet = bbPosted;
  const blindRaiseSize = bbPosted - sbPosted;
  const lastRaiseSize = bbPosted > 0 ? (blindRaiseSize > 0 ? blindRaiseSize : bbPosted) : 0;
  activeUserIdList.forEach((activeId) => {
    const bet = betThisRoundByUserId[activeId] || 0;
    toCallByUserId[activeId] = Math.max(0, currentBet - bet);
  });

  let deck;
  try {
    deck = deriveDeckFn(handSeed);
  } catch (error) {
    if (error?.message === "deal_secret_missing") throw makeError(409, "state_invalid");
    throw error;
  }
  const dealResult = dealHoleCardsFn(deck, activeUserIdList);
  const dealtHoleCards = isPlainObject(dealResult?.holeCardsByUserId) ? dealResult.holeCardsByUserId : {};
  if (!activeUserIdList.every((activeId) => isValidTwoCards(dealtHoleCards[activeId]))) throw makeError(409, "state_invalid");
  const flatHoleCards = activeUserIdList.flatMap((activeId) => dealtHoleCards[activeId] || []);
  if (flatHoleCards.length !== activeUserIdList.length * 2 || !areCardsUnique(flatHoleCards)) throw makeError(409, "state_invalid");
  if (!isStateStorageValid({ seats: derivedSeats, holeCardsByUserId: dealtHoleCards }, { requireHoleCards: true })) {
    throw makeError(409, "state_invalid");
  }

  const holeCardValues = activeUserIdList.map((activeId) => ({ userId: activeId, cards: dealtHoleCards[activeId] }));
  const holeCardPlaceholders = holeCardValues.map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}::jsonb)`).join(", ");
  const holeCardParams = holeCardValues.flatMap((entry) => [tableId, handId, entry.userId, JSON.stringify(entry.cards)]);

  let holeCardInsertRows;
  try {
    holeCardInsertRows = await tx.unsafe(
      `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ${holeCardPlaceholders} on conflict (table_id, hand_id, user_id) do update set cards = excluded.cards returning user_id;`,
      holeCardParams
    );
  } catch (error) {
    if (isHoleCardsTableMissing(error)) throw makeError(409, "state_invalid");
    if (error?.code === "23503") throw makeError(500, "hole_cards_write_failed");
    throw error;
  }
  const insertedUserIds = Array.isArray(holeCardInsertRows) ? holeCardInsertRows.map((row) => row?.user_id).filter(Boolean) : [];
  if (insertedUserIds.length !== activeUserIdList.length) throw makeError(500, "hole_cards_write_failed");

  const { holeCardsByUserId: _ignoredHoleCards, handSettlement: _ignoredHandSettlement, ...stateBase } = currentState;
  const updatedState = {
    ...stateBase,
    tableId: currentState.tableId || tableId,
    handId,
    handSeed,
    phase: "PREFLOP",
    pot: sbPosted + bbPosted,
    community: [],
    communityDealt: 0,
    seats: derivedSeats,
    handSeats: derivedSeats.slice(),
    stacks: nextStacks,
    dealerSeatNo,
    turnUserId,
    toCallByUserId,
    betThisRoundByUserId,
    actedThisRoundByUserId,
    foldedByUserId,
    contributionsByUserId,
    currentBet,
    lastRaiseSize,
    lastActionRequestIdByUserId: {},
    lastStartHandRequestId: requestId || null,
    lastStartHandUserId: userId,
    startedAt: new Date().toISOString(),
    turnNo: 1,
    turnStartedAt: Date.now(),
    turnDeadlineAt: Date.now() + TURN_MS,
  };
  if (!isStateStorageValid(updatedState, { requireHandSeed: true, requireCommunityDealt: true, requireNoDeck: true })) {
    throw makeError(409, "state_invalid");
  }

  const updateResult = await updatePokerStateOptimisticFn(tx, { tableId, expectedVersion, nextState: updatedState });
  if (!updateResult.ok) {
    if (updateResult.reason === "not_found") throw makeError(404, "state_missing");
    if (updateResult.reason === "conflict") {
      if (typeof onAlreadyInHandConflict === "function") await onAlreadyInHandConflict();
      throw makeError(409, "state_conflict");
    }
    throw makeError(409, "state_invalid");
  }
  const newVersion = updateResult.newVersion;

  const actionMeta = { determinism: { handSeed, dealContext: "poker-deal:v1" } };
  await tx.unsafe(
    "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
    [tableId, newVersion, userId, "START_HAND", null, handId, requestId, currentState.phase || null, updatedState.phase || null, JSON.stringify(actionMeta)]
  );
  for (const blindAction of [{ type: "POST_SB", userId: sbUserId, amount: sbPosted }, { type: "POST_BB", userId: bbUserId, amount: bbPosted }]) {
    if (!blindAction.userId) continue;
    await tx.unsafe(
      "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
      [tableId, newVersion, blindAction.userId, blindAction.type, blindAction.amount, handId, requestId, currentState.phase || null, updatedState.phase || null, JSON.stringify({})]
    );
  }

  return {
    updatedState,
    newVersion,
    dealtHoleCards,
    privateState: { ...updatedState, deck: Array.isArray(dealResult?.deck) ? dealResult.deck.slice() : [] },
  };
};
