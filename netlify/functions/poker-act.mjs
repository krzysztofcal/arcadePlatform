import crypto from "node:crypto";
import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "./_shared/poker-hole-cards-store.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "./_shared/poker-deal-deterministic.mjs";
import { TURN_MS, advanceIfNeeded, applyAction, applyLeaveTable } from "./_shared/poker-reducer.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { awardPotsAtShowdown } from "./_shared/poker-payout.mjs";
import { materializeShowdownAndPayout } from "./_shared/poker-materialize-showdown.mjs";
import { computeShowdown } from "./_shared/poker-showdown.mjs";
import { buildActionConstraints, computeLegalActions } from "./_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./_shared/poker-idempotency.mjs";
import { updatePokerStateOptimistic } from "./_shared/poker-state-write.mjs";
import { parseStakes } from "./_shared/poker-stakes.mjs";
import { resetTurnTimer } from "./_shared/poker-turn-timer.mjs";
import { maybeApplyTurnTimeout } from "./_shared/poker-turn-timeout.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { clearMissedTurns } from "./_shared/poker-missed-turns.mjs";
import { buildSeatBotMap, chooseBotActionTrivial, getBotAutoplayConfig, isBotTurn } from "./_shared/poker-bots.mjs";
import { cashoutBotSeatIfNeeded, ensureBotSeatInactiveForCashout } from "./_shared/poker-bot-cashout.mjs";
import { startHandCore } from "./_shared/poker-start-hand-core.mjs";

const ACTION_TYPES = new Set(["CHECK", "BET", "CALL", "RAISE", "FOLD", "LEAVE_TABLE"]);
const ADVANCE_LIMIT = 4;
const REQUEST_PENDING_STALE_SEC = 30;

const LEAVE_AFTER_HAND_SUFFIX = "leave_after_hand:v1";

const isPlainObjectValue = (value) => value && typeof value === "object" && !Array.isArray(value);
const isPlainObject = isPlainObjectValue;

const BOT_EVICT_PERSISTED_USER_MAP_KEYS = [
  "toCallByUserId",
  "betThisRoundByUserId",
  "actedThisRoundByUserId",
  "foldedByUserId",
  "leftTableByUserId",
  "sitOutByUserId",
  "lastActionRequestIdByUserId",
  "missedTurnsByUserId",
];

const removeUserIdFromStateMaps = (state, userId) => {
  if (!isPlainObjectValue(state) || typeof userId !== "string" || !userId) return state;
  const nextState = { ...state };
  for (const key of BOT_EVICT_PERSISTED_USER_MAP_KEYS) {
    if (!isPlainObjectValue(nextState[key]) || !Object.prototype.hasOwnProperty.call(nextState[key], userId)) continue;
    const nextMap = { ...nextState[key] };
    delete nextMap[userId];
    nextState[key] = nextMap;
  }
  return nextState;
};

const clearMismatchedShowdown = (stateInput) => {
  if (!isPlainObjectValue(stateInput) || !stateInput.showdown) return stateInput;
  const handId = typeof stateInput.handId === "string" ? stateInput.handId.trim() : "";
  const showdownHandId =
    typeof stateInput.showdown?.handId === "string" && stateInput.showdown.handId.trim()
      ? stateInput.showdown.handId.trim()
      : "";
  if (!handId || !showdownHandId || showdownHandId === handId) return stateInput;
  const { showdown: _ignoredShowdown, ...sanitizedState } = stateInput;
  return sanitizedState;
};

const clearMismatchedHandSettlement = (stateInput) => {
  if (!isPlainObjectValue(stateInput) || !stateInput.handSettlement) return stateInput;
  const handId = typeof stateInput.handId === "string" ? stateInput.handId.trim() : "";
  const handSettlementHandId =
    typeof stateInput.handSettlement?.handId === "string" && stateInput.handSettlement.handId.trim()
      ? stateInput.handSettlement.handId.trim()
      : "";
  if (!handId || !handSettlementHandId || handSettlementHandId === handId) return stateInput;
  const { handSettlement: _ignoredHandSettlement, ...sanitizedState } = stateInput;
  return sanitizedState;
};

const sanitizePerHandArtifacts = (stateInput) => clearMismatchedHandSettlement(clearMismatchedShowdown(stateInput));

const maybeEvictMarkedBotAfterSettlement = async (tx, { tableId, state, actorUserId }) => {
  if (state?.phase !== "SETTLED") return { state, evicted: false };
  try {
    const actor = String(actorUserId || "").trim();
    if (!isValidUuid(actor)) {
      klog("poker_bot_leave_after_hand_skip", { tableId, reason: "missing_actor" });
      return { state, evicted: false };
    }
    const markedRows = await tx.unsafe(
      "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' and coalesce(is_bot, false) = true and coalesce(leave_after_hand, false) = true order by seat_no asc limit 1 for update;",
      [tableId]
    );
    const marked = markedRows?.[0] || null;
    if (!marked?.user_id) return { state, evicted: false };

    const botUserId = marked.user_id;
    const inactiveResult = await ensureBotSeatInactiveForCashout(tx, { tableId, botUserId });
    if (!inactiveResult?.ok) {
      klog("poker_bot_leave_after_hand_skip", { tableId, botUserId, seatNo: marked.seat_no ?? null, reason: inactiveResult?.reason || "inactivate_failed" });
      return { state, evicted: false };
    }

    await cashoutBotSeatIfNeeded(tx, {
      tableId,
      botUserId,
      seatNo: marked.seat_no,
      reason: "LEAVE_AFTER_HAND",
      actorUserId: actor,
      idempotencyKeySuffix: LEAVE_AFTER_HAND_SUFFIX,
      expectedAmount: Number(state?.stacks?.[botUserId] ?? 0),
    });

    await tx.unsafe(
      "update public.poker_seats set stack = 0, leave_after_hand = false where table_id = $1 and user_id = $2 and coalesce(is_bot, false) = true;",
      [tableId, botUserId]
    );

    const nextStacks = isPlainObjectValue(state?.stacks) ? { ...state.stacks } : {};
    delete nextStacks[botUserId];
    const nextSeats = Array.isArray(state?.seats) ? state.seats.filter((seat) => seat?.userId !== botUserId) : [];
    const cleanedState = removeUserIdFromStateMaps(state, botUserId);
    const nextState = {
      ...cleanedState,
      seats: nextSeats,
      stacks: nextStacks,
    };
    klog("poker_bot_leave_after_hand_evicted", { tableId, botUserId, seatNo: marked.seat_no ?? null });
    return { state: nextState, evicted: true, botUserId };
  } catch (error) {
    klog("poker_bot_leave_after_hand_error", { tableId, reason: error?.code || error?.message || "unknown_error" });
    return { state, evicted: false };
  }
};

const runAdvanceLoop = (stateToAdvance, eventsList, advanceEventsList, advanceLimit = ADVANCE_LIMIT) => {
  let next = stateToAdvance;
  let loopCount = 0;
  while (loopCount < advanceLimit) {
    if (next.phase === "HAND_DONE") break;
    const prevPhase = next.phase;
    const advanced = advanceIfNeeded(next);
    next = advanced.state;

    if (Array.isArray(advanced.events) && advanced.events.length > 0) {
      if (Array.isArray(eventsList)) eventsList.push(...advanced.events);
      if (Array.isArray(advanceEventsList)) advanceEventsList.push(...advanced.events);
    }

    if (!Array.isArray(advanced.events) || advanced.events.length === 0) break;
    if (next.phase === prevPhase) break;
    loopCount += 1;
  }
  return { nextState: next, loops: loopCount };
};
const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const maxFromMap = (value) => {
  if (!value || typeof value !== "object") return 0;
  const nums = Object.values(value)
    .map((entry) => toSafeInt(entry, 0))
    .filter((entry) => entry > 0);
  if (nums.length === 0) return 0;
  return Math.max(...nums);
};

const deriveCurrentBet = (state) => {
  const currentBet = toSafeInt(state.currentBet, null);
  if (currentBet == null || currentBet < 0) {
    return maxFromMap(state.betThisRoundByUserId);
  }
  return currentBet;
};

const deriveLastRaiseSize = (state, currentBet) => {
  const lastRaiseSize = toSafeInt(state.lastRaiseSize, null);
  if (lastRaiseSize == null || lastRaiseSize <= 0) {
    return currentBet > 0 ? currentBet : 0;
  }
  return lastRaiseSize;
};

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const makeError = (status, code) => {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
};

const normalizeAction = (action) => {
  if (!action || typeof action !== "object" || Array.isArray(action)) return { ok: false, value: null };
  const type = typeof action.type === "string" ? action.type.trim().toUpperCase() : "";
  if (!ACTION_TYPES.has(type)) return { ok: false, value: null };
  if (type === "BET" || type === "RAISE") {
    const amount = Number(action.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) return { ok: false, value: null };
    return { ok: true, value: { type, amount } };
  }
  if (type === "LEAVE_TABLE") return { ok: true, value: { type } };
  return { ok: true, value: { type } };
};

const normalizeRequest = (value) => {
  const parsed = normalizeRequestId(value, { maxLen: 200 });
  if (!parsed.ok || !parsed.value) return { ok: false, value: null };
  return { ok: true, value: parsed.value };
};

const hasRequiredState = (state) =>
  isPlainObjectValue(state) &&
  typeof state.phase === "string" &&
  (typeof state.turnUserId === "string" || state.phase === "HAND_DONE") &&
  Array.isArray(state.seats) &&
  isPlainObjectValue(state.stacks) &&
  isPlainObjectValue(state.toCallByUserId) &&
  isPlainObjectValue(state.betThisRoundByUserId) &&
  isPlainObjectValue(state.actedThisRoundByUserId) &&
  isPlainObjectValue(state.foldedByUserId);

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";

const isTurnUserEligible = (state, userId) => {
  if (!isActionPhase(state?.phase)) return false;
  if (typeof userId !== "string" || !userId.trim()) return false;
  if (state?.foldedByUserId?.[userId]) return false;
  if (state?.leftTableByUserId?.[userId]) return false;
  if (state?.sitOutByUserId?.[userId]) return false;
  if ((state?.stacks?.[userId] ?? 0) <= 0) return false;
  return true;
};


const computeLegalActionsWithGuard = ({ statePublic, userId, tableId, source }) => {
  const legalInfo = computeLegalActions({ statePublic, userId });
  const actionCount = Array.isArray(legalInfo?.actions) ? legalInfo.actions.length : 0;
  if (!isActionPhase(statePublic?.phase)) return { legalInfo, statePublic, healed: false };
  const shouldCheck = userId && statePublic?.turnUserId === userId;
  if (!shouldCheck || actionCount > 0) return { legalInfo, statePublic, healed: false };

  klog("poker_contract_empty_legal_actions", {
    tableId,
    source,
    phase: statePublic?.phase || null,
    turnUserId: statePublic?.turnUserId || null,
    folded: !!statePublic?.foldedByUserId?.[statePublic?.turnUserId],
    leftTable: !!statePublic?.leftTableByUserId?.[statePublic?.turnUserId],
    sitOut: !!statePublic?.sitOutByUserId?.[statePublic?.turnUserId],
    stack: statePublic?.turnUserId ? Number(statePublic?.stacks?.[statePublic.turnUserId] ?? 0) : null,
  });

  throw makeError(409, "contract_mismatch_empty_legal_actions");
};

const getSeatForUser = (state, userId) => (Array.isArray(state.seats) ? state.seats.find((seat) => seat?.userId === userId) : null);

const buildMeStatus = (state, userId) => {
  const seat = getSeatForUser(state, userId);
  const isLeft = !!state?.leftTableByUserId?.[userId];
  const isSitOut = !!state?.sitOutByUserId?.[userId];
  return {
    userId,
    isSeated: !!seat,
    isLeft,
    isSitOut,
  };
};

const normalizeRank = (value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  if (upper === "T") return 10;
  if (upper === "J") return 11;
  if (upper === "Q") return 12;
  if (upper === "K") return 13;
  if (upper === "A") return 14;
  const num = Number(upper);
  return Number.isInteger(num) ? num : null;
};

const cardKey = (card) => {
  const rank = normalizeRank(card?.r);
  const suit = typeof card?.s === "string" ? card.s.toUpperCase() : "";
  if (!rank || !suit) return "";
  return `${rank}-${suit}`;
};

const safeHash = (value) => {
  const input = String(value ?? "").slice(0, 200);
  try {
    if (crypto?.createHash) {
      return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12);
    }
  } catch {
    // fall through
  }
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).slice(0, 12);
};

const hashUserId = (userId) => safeHash(`uid:${String(userId ?? "").slice(0, 200)}`);

const hashCardKey = (card) => {
  const key = cardKey(card);
  if (!key) return "invalid";
  return safeHash(`card:${key}`);
};

const takeList = (values, maxLen = 12) => (Array.isArray(values) ? values.slice(0, maxLen) : []);

const cardsSameSet = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const leftKeys = left.map(cardKey);
  if (leftKeys.some((key) => !key)) return false;
  leftKeys.sort();
  const rightKeys = right.map(cardKey);
  if (rightKeys.some((key) => !key)) return false;
  rightKeys.sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i]) return false;
  }
  return true;
};

const arraysEqual = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const toSeatNo = (value) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

const normalizeSeatOrderFromState = (seats) => {
  if (!Array.isArray(seats)) return [];
  const ordered = seats.slice().sort((a, b) => toSeatNo(a?.seatNo) - toSeatNo(b?.seatNo));
  const out = [];
  const seen = new Set();
  for (const seat of ordered) {
    if (typeof seat?.userId !== "string") continue;
    const userId = seat.userId.trim();
    if (!userId) continue;
    if (seen.has(userId)) return [];
    seen.add(userId);
    out.push(userId);
  }
  return out;
};

const repairDealerSeatNo = (state) => {
  const ordered = Array.isArray(state?.seats)
    ? state.seats.slice().sort((a, b) => toSeatNo(a?.seatNo) - toSeatNo(b?.seatNo))
    : [];
  const occupiedSeats = ordered
    .filter((seat) => typeof seat?.userId === "string" && seat.userId.trim())
    .map((seat) => {
      const seatNo = toSeatNo(seat?.seatNo);
      if (!Number.isFinite(seatNo)) return null;
      return { seatNo: Math.trunc(seatNo) };
    })
    .filter(Boolean);
  const dealerSeatNo = Number.isInteger(state?.dealerSeatNo) ? state.dealerSeatNo : null;
  if (occupiedSeats.length === 0) return dealerSeatNo ?? null;
  if (dealerSeatNo != null && occupiedSeats.some((seat) => seat.seatNo === dealerSeatNo)) return dealerSeatNo;
  return occupiedSeats[0].seatNo;
};

const validateActionAmount = (state, action, userId, legalInfo) => {
  const stack = Number(state.stacks?.[userId] ?? 0);
  const currentUserBet = Number(state.betThisRoundByUserId?.[userId] || 0);
  const currentBet = deriveCurrentBet(state);
  const lastRaiseSize = deriveLastRaiseSize(state, currentBet);
  const toCall = Math.max(0, currentBet - currentUserBet);
  if (!Number.isFinite(stack) || !Number.isFinite(currentUserBet) || !Number.isFinite(currentBet)) return false;
  if (action.type === "CHECK" || action.type === "CALL" || action.type === "FOLD") return true;
  if (action.type === "BET") {
    return toCall === 0 && action.amount <= stack;
  }
  if (action.type === "RAISE") {
    if (!(toCall > 0)) return false;
    const raiseTo = action.amount;
    const maxRaiseTo = Number.isFinite(legalInfo?.maxRaiseTo) ? legalInfo.maxRaiseTo : stack + currentUserBet;
    const rawMinRaiseTo = currentBet + lastRaiseSize;
    if (raiseTo > maxRaiseTo || raiseTo <= currentBet) return false;
    if (raiseTo >= rawMinRaiseTo) return true;
    return raiseTo === maxRaiseTo;
  }
  return true;
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });
  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: mergeHeaders(cors), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: mergeHeaders(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObjectValue(payload)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_json" }) };
  }

  const tableIdValue = payload?.tableId;
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const requestIdParsed = normalizeRequest(payload?.requestId);
  if (!requestIdParsed.ok) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const requestId = requestIdParsed.value;

  const actionParsed = normalizeAction(payload?.action);
  if (!actionParsed.ok) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_action" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return {
      statusCode: 401,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ error: "unauthorized", reason: auth.reason }),
    };
  }

  try {
    const result = await beginSql(async (tx) => {
      let mutated = false;
      const requestInfo = await ensurePokerRequest(tx, {
        tableId,
        userId: auth.userId,
        requestId,
        kind: "ACT",
        pendingStaleSec: REQUEST_PENDING_STALE_SEC,
      });
      if (requestInfo.status === "stored") {
        const stored = requestInfo.result;
        if (stored?.replayed) return stored;
        if (stored?.ok) {
          const replayed = { ...stored, replayed: true };
          await storePokerRequestResult(tx, {
            tableId,
            userId: auth.userId,
            requestId,
            kind: "ACT",
            result: replayed,
          });
          return replayed;
        }
        return stored;
      }
      if (requestInfo.status === "pending") {
        const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [
          tableId,
        ]);
        const stateRow = stateRows?.[0] || null;
        if (!stateRow) {
          throw makeError(409, "state_invalid");
        }
        const expectedVersion = Number(stateRow.version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
          throw makeError(409, "state_invalid");
        }
        let currentState = normalizeJsonState(stateRow.state);
        currentState = sanitizePerHandArtifacts(currentState);
        if (!hasRequiredState(currentState)) {
          throw makeError(409, "state_invalid");
        }
        if (currentState?.phase === "INIT") {
          throw makeError(409, "hand_not_started");
        }
        if (actionParsed.value.type !== "LEAVE_TABLE" && (!isActionPhase(currentState.phase) || !currentState.turnUserId)) {
          throw makeError(409, "state_invalid");
        }
        return { pending: true, requestId };
      }

      try {
        const tableRows = await tx.unsafe("select id, status, stakes from public.poker_tables where id = $1 limit 1;", [
          tableId,
        ]);
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }
        if (table.status !== "OPEN") {
          throw makeError(409, "table_not_open");
        }
        const stakesParsed = parseStakes(table?.stakes);
        if (!stakesParsed.ok) {
          klog("poker_act_invalid_stakes", { tableId, reason: stakesParsed.details?.reason || "invalid_stakes" });
          throw makeError(409, "invalid_stakes");
        }

        const seatRows = await tx.unsafe(
          "select user_id from public.poker_seats where table_id = $1 and status = 'ACTIVE' and user_id = $2 limit 1;",
          [tableId, auth.userId]
        );
        if (!seatRows?.[0]?.user_id) {
          throw makeError(403, "not_allowed");
        }

        const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [
          tableId,
        ]);
        const stateRow = stateRows?.[0] || null;
        if (!stateRow) {
          throw makeError(409, "state_invalid");
        }
        const expectedVersion = Number(stateRow.version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
          throw makeError(409, "state_invalid");
        }

        let currentState = normalizeJsonState(stateRow.state);
        if (!hasRequiredState(currentState)) {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "state_invalid",
            phase: currentState?.phase || null,
          });
          throw makeError(409, "state_invalid");
        }
      const repairedDealerSeatNo = repairDealerSeatNo(currentState);
      if (repairedDealerSeatNo != null && repairedDealerSeatNo !== currentState.dealerSeatNo) {
        currentState = { ...currentState, dealerSeatNo: repairedDealerSeatNo };
      }
      currentState = sanitizePerHandArtifacts(currentState);

      if (currentState?.phase === "INIT") {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "hand_not_started",
          phase: currentState.phase,
          actionType: actionParsed?.value?.type ?? null,
        });
        throw makeError(409, "hand_not_started");
      }

      const rejectStateInvalid = (code, extra) => {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_invalid",
          code,
          phase: currentState?.phase ?? null,
          ...(extra || {}),
        });
        throw makeError(409, "state_invalid");
      };
      const materializeShowdownState = (stateToMaterialize, seatOrder, holeCards) => {
        let materialized;
        try {
          materialized = materializeShowdownAndPayout({
            state: stateToMaterialize,
            seatUserIdsInOrder: seatOrder,
            holeCardsByUserId: holeCards,
            computeShowdown,
            awardPotsAtShowdown,
            klog,
          });
        } catch (error) {
          const reason = error?.message || null;
          if (reason === "showdown_missing_hole_cards") {
            rejectStateInvalid("showdown_missing_hole_cards");
          }
          if (reason === "showdown_invalid_pot") {
            rejectStateInvalid("showdown_invalid_pot", { pot: stateToMaterialize.pot ?? null });
          }
          if (reason === "showdown_invalid_community") {
            rejectStateInvalid("showdown_invalid_community", { communityLen: stateToMaterialize.community?.length ?? null });
          }
          if (reason === "showdown_incomplete_community") {
            rejectStateInvalid("showdown_incomplete_community", { communityLen: stateToMaterialize.community?.length ?? null });
          }
          if (reason === "showdown_hand_mismatch") {
            rejectStateInvalid("showdown_hand_mismatch");
          }
          if (reason === "showdown_pot_not_zero") {
            rejectStateInvalid("showdown_pot_not_zero", { pot: stateToMaterialize.pot ?? null });
          }
          if (reason === "showdown_missing_hand_id") {
            rejectStateInvalid("showdown_missing_hand_id");
          }
          if (reason === "showdown_invalid_seats") {
            rejectStateInvalid("showdown_invalid_seats");
          }
          if (reason === "showdown_invalid_stack") {
            rejectStateInvalid("showdown_invalid_stack");
          }
          rejectStateInvalid("showdown_failed", { reason });
        }
        return materialized.nextState;
      };
      if (typeof currentState.handId !== "string" || !currentState.handId.trim()) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_invalid",
          phase: currentState?.phase || null,
        });
        throw makeError(409, "state_invalid");
      }
      if (typeof currentState.handSeed !== "string" || !currentState.handSeed.trim()) {
        rejectStateInvalid("missing_hand_seed");
      }
      if (!Number.isInteger(currentState.communityDealt) || currentState.communityDealt < 0 || currentState.communityDealt > 5) {
        rejectStateInvalid("invalid_community_dealt", { communityDealt: currentState.communityDealt });
      }
      if (!Array.isArray(currentState.community) || currentState.community.length !== currentState.communityDealt) {
        rejectStateInvalid("community_len_mismatch", {
          communityDealt: currentState.communityDealt,
          communityLen: Array.isArray(currentState.community) ? currentState.community.length : null,
        });
      }

      const lastByUserId = isPlainObjectValue(currentState.lastActionRequestIdByUserId)
        ? currentState.lastActionRequestIdByUserId
        : {};

      const seat = getSeatForUser(currentState, auth.userId);
      if (!seat) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_drift",
          phase: currentState.phase,
        });
        throw makeError(409, "state_invalid");
      }
      const activeSeatRows = await tx.unsafe(
        "select user_id, seat_no, is_bot from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
        [tableId]
      );
      const seatBotMap = buildSeatBotMap(activeSeatRows);
      const seatUserIdsInOrder = normalizeSeatOrderFromState(currentState.seats);
      const dbActiveUserIds = Array.isArray(activeSeatRows)
        ? activeSeatRows.map((row) => row?.user_id).filter(Boolean)
        : [];
      const dbActiveHumanUserIds = Array.isArray(activeSeatRows)
        ? activeSeatRows.filter((row) => !row?.is_bot).map((row) => row?.user_id).filter(Boolean)
        : [];
      const activeUserIdsForHoleCards = seatUserIdsInOrder.slice();
      const requiredHoleCardUserIds = dbActiveHumanUserIds.length ? dbActiveHumanUserIds.slice() : [auth.userId];

      let holeCardsByUserId;
      try {
        const holeCards = await loadHoleCardsByUserId(tx, {
          tableId,
          handId: currentState.handId,
          activeUserIds: activeUserIdsForHoleCards,
          requiredUserIds: requiredHoleCardUserIds,
          mode: "strict",
        });
        holeCardsByUserId = holeCards.holeCardsByUserId;
      } catch (error) {
        if (error?.message === "state_invalid") {
          throw makeError(409, "state_invalid");
        }
        if (isHoleCardsTableMissing(error)) {
          throw makeError(409, "state_invalid");
        }
        throw error;
      }

      const currentHandId = typeof currentState.handId === "string" ? currentState.handId.trim() : "";
      const currentShowdownHandId =
        typeof currentState.showdown?.handId === "string" && currentState.showdown.handId.trim()
          ? currentState.showdown.handId.trim()
          : "";
      if (currentState.showdown && currentHandId) {
        if (!currentShowdownHandId || currentShowdownHandId !== currentHandId) {
          rejectStateInvalid("showdown_hand_mismatch");
        }
        const potValue = Number(currentState.pot ?? 0);
        if (!Number.isFinite(potValue) || potValue < 0 || Math.floor(potValue) !== potValue) {
          rejectStateInvalid("showdown_invalid_pot", { pot: currentState.pot ?? null });
        }
        if (potValue > 0) {
          rejectStateInvalid("showdown_pot_not_zero", { pot: currentState.pot ?? null });
        }
      }

      const lastRequestId = Object.prototype.hasOwnProperty.call(lastByUserId, auth.userId)
        ? lastByUserId[auth.userId]
        : null;
      if (lastRequestId != null && requestId != null && String(lastRequestId) === String(requestId)) {
        const version = Number(stateRow.version);
        if (!Number.isFinite(version)) {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "state_invalid",
            phase: currentState.phase,
          });
          throw makeError(409, "state_invalid");
        }
        let replayPublicState = withoutPrivateState(currentState);
        const replayGuard = computeLegalActionsWithGuard({ statePublic: replayPublicState, userId: auth.userId, tableId, source: "poker_act_replay" });
        replayPublicState = replayGuard.statePublic;
        const replayLegalInfo = replayGuard.legalInfo;
        const resultPayload = {
          ok: true,
          tableId,
          state: {
            version,
            state: replayPublicState,
          },
          myHoleCards: holeCardsByUserId[auth.userId] || [],
          events: [],
          replayed: true,
          legalActions: replayLegalInfo.actions,
          actionConstraints: buildActionConstraints(replayLegalInfo),
        };
        await storePokerRequestResult(tx, {
          tableId,
          userId: auth.userId,
          requestId,
          kind: "ACT",
          result: resultPayload,
        });
        return resultPayload;
      }

      if (!isActionPhase(currentState.phase) || !currentState.turnUserId) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_invalid",
          phase: currentState?.phase || null,
        });
        throw makeError(409, "state_invalid");
      }
      if (currentState.foldedByUserId?.[auth.userId]) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "folded_player",
          phase: currentState.phase,
        });
        throw makeError(403, "not_allowed");
      }

      if (seatUserIdsInOrder.length <= 0) {
        rejectStateInvalid("no_active_seats");
      }
      if (!arraysEqual(dbActiveUserIds, seatUserIdsInOrder)) {
        klog("poker_act_active_mismatch", {
          tableId,
          dbSeatCount: dbActiveUserIds.length,
          stateSeatCount: seatUserIdsInOrder.length,
          dbSeatIds: takeList(dbActiveUserIds.map(hashUserId)),
          stateSeatIds: takeList(seatUserIdsInOrder.map(hashUserId)),
        });
      }
      let derivedCommunity;
      let derivedDeck;
      try {
        derivedCommunity = deriveCommunityCards({
          handSeed: currentState.handSeed,
          seatUserIdsInOrder,
          communityDealt: currentState.communityDealt,
        });
        derivedDeck = deriveRemainingDeck({
          handSeed: currentState.handSeed,
          seatUserIdsInOrder,
          communityDealt: currentState.communityDealt,
        });
      } catch {
        rejectStateInvalid("derive_failed");
      }
      if (!cardsSameSet(currentState.community, derivedCommunity)) {
        const stateKeys = Array.isArray(currentState.community) ? currentState.community.map(hashCardKey) : [];
        const derivedKeys = Array.isArray(derivedCommunity) ? derivedCommunity.map(hashCardKey) : [];
        rejectStateInvalid("community_mismatch", {
          communityDealt: currentState.communityDealt,
          stateCommunityLen: Array.isArray(currentState.community) ? currentState.community.length : null,
          derivedCommunityLen: Array.isArray(derivedCommunity) ? derivedCommunity.length : null,
          stateCommunityKeys: takeList(stateKeys, 5),
          derivedCommunityKeys: takeList(derivedKeys, 5),
          invalidKeyFound: stateKeys.includes("invalid") || derivedKeys.includes("invalid"),
        });
      }

      const privateState = {
        ...currentState,
        community: derivedCommunity,
        deck: derivedDeck,
        holeCardsByUserId,
      };

      const timeoutResult = maybeApplyTurnTimeout({ tableId, state: currentState, privateState, nowMs: Date.now() });
      if (timeoutResult.applied) {
        const updatedState = timeoutResult.state;
        if (!isStateStorageValid(updatedState, { requireHandSeed: true, requireCommunityDealt: true, requireNoDeck: true })) {
          klog("poker_state_corrupt", { tableId, phase: updatedState.phase });
          throw makeError(409, "state_invalid");
        }

        const updateResult = await updatePokerStateOptimistic(tx, {
          tableId,
          expectedVersion,
          nextState: updatedState,
        });
        if (!updateResult.ok) {
          if (updateResult.reason === "not_found") {
            throw makeError(404, "state_missing");
          }
          if (updateResult.reason === "conflict") {
            klog("poker_act_conflict", { tableId, userId: auth.userId, expectedVersion, requestId });
            throw makeError(409, "state_conflict");
          }
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "state_invalid",
            phase: updatedState.phase,
          });
          throw makeError(409, "state_invalid");
        }
        let newVersion = updateResult.newVersion;
        mutated = true;

        const timeoutHandId =
          typeof updatedState.handId === "string" && updatedState.handId.trim() ? updatedState.handId.trim() : null;
        const timeoutRequestId = `timeout-${newVersion}`;
        await tx.unsafe(
          "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
          [
            tableId,
            newVersion,
            timeoutResult.action.userId,
            timeoutResult.action.type,
            timeoutResult.action.amount ?? null,
            timeoutHandId,
            timeoutRequestId,
            currentState.phase || null,
            updatedState.phase || null,
            null,
          ]
        );
        mutated = true;
        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );

        klog("poker_turn_timeout", {
          tableId,
          turnUserId: timeoutResult.action.userId,
          actionType: timeoutResult.action.type,
          newVersion,
        });

        const botAutoplayConfig = getBotAutoplayConfig(process.env);
        let timeoutFinalState = updatedState;
        let timeoutEvents = Array.isArray(timeoutResult.events) ? timeoutResult.events.slice() : [];
        let timeoutLoopPrivateState = {
          ...updatedState,
          community: Array.isArray(updatedState.community) ? updatedState.community.slice() : [],
          deck: deriveRemainingDeck({
            handSeed: updatedState.handSeed,
            seatUserIdsInOrder,
            communityDealt: updatedState.communityDealt,
          }),
          holeCardsByUserId,
        };
        let timeoutLoopVersion = newVersion;
        let timeoutBotActionCount = 0;
        let timeoutBotStopReason = "not_attempted";
        let timeoutLastBotActionSummary = null;
        const timeoutHandIdForLog =
          typeof timeoutFinalState.handId === "string" && timeoutFinalState.handId.trim() ? timeoutFinalState.handId.trim() : null;
        klog("poker_act_bot_autoplay_attempt", {
          tableId,
          handId: timeoutHandIdForLog,
          turnUserId: timeoutFinalState.turnUserId || null,
          policyVersion: botAutoplayConfig.policyVersion,
          maxActionsPerRequest: botAutoplayConfig.maxActionsPerRequest,
        });

        while (timeoutBotActionCount < botAutoplayConfig.maxActionsPerRequest) {
          if (!isActionPhase(timeoutFinalState.phase)) {
            timeoutBotStopReason = "non_action_phase";
            break;
          }
          const botTurnUserId = timeoutFinalState.turnUserId;
          if (!isBotTurn(botTurnUserId, seatBotMap)) {
            timeoutBotStopReason = "turn_not_bot";
            break;
          }

          const botLegalInfo = computeLegalActions({ statePublic: withoutPrivateState(timeoutFinalState), userId: botTurnUserId });
          const botChoice = chooseBotActionTrivial(botLegalInfo.actions);
          if (!botChoice) {
            timeoutBotStopReason = "no_legal_action";
            break;
          }
          const botAction = botChoice.amount != null ? { type: botChoice.type, amount: botChoice.amount } : { type: botChoice.type };
          const botRequestId = `bot:${requestId}:${timeoutBotActionCount + 1}`;

          let botApplied;
          try {
            botApplied = applyAction(timeoutLoopPrivateState, { ...botAction, userId: botTurnUserId, requestId: botRequestId });
          } catch (error) {
            timeoutBotStopReason = "apply_action_failed";
            const timeoutCurrentHandIdForLog =
              typeof timeoutFinalState?.handId === "string" && timeoutFinalState.handId.trim() ? timeoutFinalState.handId.trim() : null;
            klog("poker_act_bot_autoplay_step_error", {
              tableId,
              handId: timeoutCurrentHandIdForLog,
              turnUserId: botTurnUserId || null,
              policyVersion: botAutoplayConfig.policyVersion,
              botActionCount: timeoutBotActionCount,
              reason: timeoutBotStopReason,
              actionType: botAction.type || null,
              actionAmount: botAction.amount ?? null,
              error: error?.message || "apply_action_failed",
            });
            break;
          }

          let botNextState = botApplied.state;
          const botAdvanceEvents = [];
          const botEvents = Array.isArray(botApplied.events) ? botApplied.events.slice() : [];
          const botAdvanced = runAdvanceLoop(botNextState, botEvents, botAdvanceEvents);
          botNextState = botAdvanced.nextState;
          const botEligibleUserIds = seatUserIdsInOrder.filter(
            (userId) =>
              typeof userId === "string" &&
              !botNextState.foldedByUserId?.[userId] &&
              !botNextState.leftTableByUserId?.[userId] &&
              !botNextState.sitOutByUserId?.[userId]
          );
          const botHandId = typeof botNextState.handId === "string" ? botNextState.handId.trim() : "";
          const botShowdownHandId =
            typeof botNextState.showdown?.handId === "string" && botNextState.showdown.handId.trim()
              ? botNextState.showdown.handId.trim()
              : "";
          const botShowdownMaterialized = !!botHandId && !!botShowdownHandId && botShowdownHandId === botHandId;
          const botNeedsShowdown = !botShowdownMaterialized && (botEligibleUserIds.length <= 1 || botNextState.phase === "SHOWDOWN");
          if (botNeedsShowdown) {
            botNextState = materializeShowdownState(botNextState, seatUserIdsInOrder, holeCardsByUserId);
          }

          const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...timeoutBotStateBase } = botNextState;
          const timeoutBotUpdatedState = {
            ...timeoutBotStateBase,
            communityDealt: Array.isArray(botNextState.community) ? botNextState.community.length : 0,
            lastActionRequestIdByUserId: {
              ...(isPlainObjectValue(timeoutBotStateBase.lastActionRequestIdByUserId)
                ? timeoutBotStateBase.lastActionRequestIdByUserId
                : {}),
              [botTurnUserId]: botRequestId,
            },
          };
          const timeoutBotNowMs = Date.now();
          const timeoutBotHasTurn = typeof timeoutBotUpdatedState.turnUserId === "string" && timeoutBotUpdatedState.turnUserId.trim();
          const timeoutBotWithTimer = isActionPhase(timeoutBotUpdatedState.phase) && timeoutBotHasTurn
            ? resetTurnTimer(timeoutBotUpdatedState, timeoutBotNowMs, TURN_MS)
            : { ...timeoutBotUpdatedState, turnStartedAt: null, turnDeadlineAt: null };
          const timeoutBotClearedMissedTurns = clearMissedTurns(timeoutBotWithTimer, botTurnUserId);
          const timeoutBotPersistedStateRaw = timeoutBotClearedMissedTurns.changed
            ? timeoutBotClearedMissedTurns.nextState
            : timeoutBotWithTimer;
          const timeoutBotPersistedState = sanitizePerHandArtifacts(timeoutBotPersistedStateRaw);

          if (!isStateStorageValid(timeoutBotPersistedState, { requireHandSeed: true, requireCommunityDealt: true, requireNoDeck: true })) {
            timeoutBotStopReason = "invalid_persist_state";
            break;
          }

          const botUpdateResult = await updatePokerStateOptimistic(tx, {
            tableId,
            expectedVersion: timeoutLoopVersion,
            nextState: timeoutBotPersistedState,
          });
          if (!botUpdateResult.ok) {
            timeoutBotStopReason = botUpdateResult.reason === "conflict" ? "optimistic_conflict" : "update_failed";
            break;
          }

          timeoutLoopVersion = botUpdateResult.newVersion;
          mutated = true;
          const botActionHandId =
            typeof timeoutBotPersistedState.handId === "string" && timeoutBotPersistedState.handId.trim()
              ? timeoutBotPersistedState.handId.trim()
              : null;
          await tx.unsafe(
            "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
            [
              tableId,
              timeoutLoopVersion,
              botTurnUserId,
              botAction.type,
              botAction.amount ?? null,
              botActionHandId,
              botRequestId,
              timeoutFinalState.phase || null,
              timeoutBotPersistedState.phase || null,
              JSON.stringify({ actor: "BOT", botUserId: botTurnUserId, policyVersion: botAutoplayConfig.policyVersion, reason: "AUTO_TURN" }),
            ]
          );

          timeoutFinalState = timeoutBotPersistedState;
          timeoutEvents = timeoutEvents.concat(botEvents);
          timeoutLoopPrivateState = botNextState;
          newVersion = timeoutLoopVersion;
          timeoutLastBotActionSummary = { type: botAction.type, amount: botAction.amount ?? null, userId: botTurnUserId };
          timeoutBotActionCount += 1;
        }

        if (timeoutBotStopReason === "not_attempted") {
          timeoutBotStopReason = timeoutBotActionCount >= botAutoplayConfig.maxActionsPerRequest ? "action_cap_reached" : "completed";
        } else if (timeoutBotActionCount >= botAutoplayConfig.maxActionsPerRequest) {
          timeoutBotStopReason = "action_cap_reached";
        }
        const timeoutCurrentHandIdForLog =
          typeof timeoutFinalState?.handId === "string" && timeoutFinalState.handId.trim() ? timeoutFinalState.handId.trim() : null;
        klog("poker_act_bot_autoplay_stop", {
          tableId,
          handId: timeoutCurrentHandIdForLog,
          turnUserId: timeoutFinalState.turnUserId || null,
          policyVersion: botAutoplayConfig.policyVersion,
          botActionCount: timeoutBotActionCount,
          reason: timeoutBotStopReason,
          lastActionType: timeoutLastBotActionSummary?.type || null,
          lastActionAmount: timeoutLastBotActionSummary?.amount ?? null,
          optimisticConflict: timeoutBotStopReason === "optimistic_conflict",
        });

        let timeoutPublicState = withoutPrivateState(timeoutFinalState);
        const timeoutGuard = computeLegalActionsWithGuard({ statePublic: timeoutPublicState, userId: auth.userId, tableId, source: "poker_act_timeout" });
        timeoutPublicState = timeoutGuard.statePublic;
        const timeoutLegalInfo = timeoutGuard.legalInfo;
        const resultPayload = {
          ok: true,
          tableId,
          state: {
            version: newVersion,
            state: timeoutPublicState,
          },
          me: buildMeStatus(timeoutPublicState, auth.userId),
          myHoleCards: holeCardsByUserId[auth.userId] || [],
          events: timeoutEvents,
          replayed: false,
          legalActions: timeoutLegalInfo.actions,
          actionConstraints: buildActionConstraints(timeoutLegalInfo),
        };
        await storePokerRequestResult(tx, {
          tableId,
          userId: auth.userId,
          requestId,
          kind: "ACT",
          result: resultPayload,
        });
        return resultPayload;
      }

      if (currentState?.sitOutByUserId?.[auth.userId] && actionParsed.value.type !== "LEAVE_TABLE") {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "player_sitout",
          phase: currentState.phase,
          actionType: actionParsed.value.type,
        });
        throw makeError(409, "player_sitout");
      }

      if (actionParsed.value.type === "LEAVE_TABLE") {
        let applied;
        try {
          applied = applyLeaveTable(privateState, { userId: auth.userId, requestId });
        } catch (error) {
          const reason = error?.message || "invalid_action";
          if (reason === "invalid_player") {
            klog("poker_act_rejected", {
              tableId,
              userId: auth.userId,
              reason: "invalid_player",
              phase: currentState.phase,
              actionType: actionParsed.value.type,
            });
            throw makeError(403, "not_allowed");
          }
          if (reason === "invalid_action") {
            klog("poker_act_rejected", {
              tableId,
              userId: auth.userId,
              reason: "invalid_action",
              phase: currentState.phase,
              actionType: actionParsed.value.type,
            });
            throw makeError(400, "invalid_action");
          }
          throw error;
        }

        const nextState = applied.state;
        const events = Array.isArray(applied.events) ? applied.events.slice() : [];
        const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...stateBase } = nextState;
        const updatedState = {
          ...stateBase,
          communityDealt: Array.isArray(nextState.community) ? nextState.community.length : 0,
          lastActionRequestIdByUserId: {
            ...lastByUserId,
            [auth.userId]: requestId,
          },
        };
        const nowMs = Date.now();
        const hasTurnUserId = typeof updatedState.turnUserId === "string" && updatedState.turnUserId.trim();
        const shouldResetTimer = isActionPhase(updatedState.phase) && hasTurnUserId;
        const timerResetState = shouldResetTimer
          ? resetTurnTimer(updatedState, nowMs, TURN_MS)
          : { ...updatedState, turnStartedAt: null, turnDeadlineAt: null };

        if (!isStateStorageValid(timerResetState, { requireHandSeed: true, requireCommunityDealt: true, requireNoDeck: true })) {
          klog("poker_state_corrupt", { tableId, phase: timerResetState.phase });
          throw makeError(409, "state_invalid");
        }

        const updateResult = await updatePokerStateOptimistic(tx, {
          tableId,
          expectedVersion,
          nextState: timerResetState,
        });
        if (!updateResult.ok) {
          if (updateResult.reason === "not_found") {
            throw makeError(404, "state_missing");
          }
          if (updateResult.reason === "conflict") {
            klog("poker_act_conflict", { tableId, userId: auth.userId, expectedVersion, requestId });
            throw makeError(409, "state_conflict");
          }
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "state_invalid",
            phase: timerResetState.phase,
          });
          throw makeError(409, "state_invalid");
        }
        let newVersion = updateResult.newVersion;
        mutated = true;

        const actionHandId =
          typeof timerResetState.handId === "string" && timerResetState.handId.trim() ? timerResetState.handId.trim() : null;
        await tx.unsafe(
          "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
          [
            tableId,
            newVersion,
            auth.userId,
            actionParsed.value.type,
            null,
            actionHandId,
            requestId,
            currentState.phase || null,
            timerResetState.phase || null,
            null,
          ]
        );
        await tx.unsafe(
          "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
          [tableId]
        );

        const publicState = withoutPrivateState(timerResetState);
        const legalInfo = computeLegalActions({ statePublic: publicState, userId: auth.userId });
        const resultPayload = {
          ok: true,
          tableId,
          state: {
            version: newVersion,
            state: publicState,
          },
          me: buildMeStatus(publicState, auth.userId),
          myHoleCards: holeCardsByUserId[auth.userId] || [],
          events,
          replayed: false,
          legalActions: legalInfo.actions,
          actionConstraints: buildActionConstraints(legalInfo),
        };
        await storePokerRequestResult(tx, {
          tableId,
          userId: auth.userId,
          requestId,
          kind: "ACT",
          result: resultPayload,
        });
        return resultPayload;
      }

      if (currentState.turnUserId !== auth.userId) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "not_your_turn",
          phase: currentState.phase,
          actionType: actionParsed.value.type,
        });
        throw makeError(403, "not_your_turn");
      }

      const legalInfo = computeLegalActions({ statePublic: withoutPrivateState(currentState), userId: auth.userId });
      if (!legalInfo.actions.includes(actionParsed.value.type)) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "action_not_allowed",
          phase: currentState.phase,
          actionType: actionParsed.value.type,
        });
        throw makeError(403, "action_not_allowed");
      }
      if (!validateActionAmount(currentState, actionParsed.value, auth.userId, legalInfo)) {
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "invalid_amount",
          phase: currentState.phase,
          actionType: actionParsed.value.type,
          amount: actionParsed.value.amount ?? null,
        });
        throw makeError(400, "invalid_amount");
      }

      let applied;
      try {
        applied = applyAction(privateState, { ...actionParsed.value, userId: auth.userId, requestId });
      } catch (error) {
        const reason = error?.message || "invalid_action";
        if (reason === "not_your_turn") {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "not_your_turn",
            phase: currentState.phase,
            actionType: actionParsed.value.type,
          });
          throw makeError(403, "not_your_turn");
        }
        if (reason === "invalid_player") {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "invalid_player",
            phase: currentState.phase,
            actionType: actionParsed.value.type,
          });
          throw makeError(403, "not_allowed");
        }
        if (reason === "invalid_action") {
          klog("poker_act_rejected", {
            tableId,
            userId: auth.userId,
            reason: "invalid_action",
            phase: currentState.phase,
            actionType: actionParsed.value.type,
            amount: actionParsed.value.amount ?? null,
          });
          throw makeError(400, "invalid_action");
        }
        throw error;
      }

      let nextState = applied.state;
      let events = Array.isArray(applied.events) ? applied.events.slice() : [];
      const advanceEvents = [];
      const advanced = runAdvanceLoop(nextState, events, advanceEvents);
      nextState = advanced.nextState;
      const loops = advanced.loops;

      const handId = typeof nextState.handId === "string" ? nextState.handId.trim() : "";
      const showdownHandId =
        typeof nextState.showdown?.handId === "string" && nextState.showdown.handId.trim() ? nextState.showdown.handId.trim() : "";
      const showdownAlreadyMaterialized = !!handId && !!showdownHandId && showdownHandId === handId;
      if (nextState.showdown && handId && (!showdownHandId || showdownHandId !== handId)) {
        rejectStateInvalid("showdown_hand_mismatch");
      }
      if (nextState.showdown && showdownAlreadyMaterialized) {
        const potValue = Number(nextState.pot ?? 0);
        if (!Number.isFinite(potValue) || potValue < 0 || Math.floor(potValue) !== potValue) {
          rejectStateInvalid("showdown_invalid_pot", { pot: nextState.pot ?? null });
        }
        if (potValue > 0) {
          rejectStateInvalid("showdown_pot_not_zero", { pot: nextState.pot ?? null });
        }
      }
      const eligibleUserIds = seatUserIdsInOrder.filter(
        (userId) =>
          typeof userId === "string" &&
          !nextState.foldedByUserId?.[userId] &&
          !nextState.leftTableByUserId?.[userId] &&
          !nextState.sitOutByUserId?.[userId]
      );
      const shouldMaterializeShowdown =
        !showdownAlreadyMaterialized && (eligibleUserIds.length <= 1 || nextState.phase === "SHOWDOWN");

      if (shouldMaterializeShowdown) {
        nextState = materializeShowdownState(nextState, seatUserIdsInOrder, holeCardsByUserId);
      }
      if ((nextState.phase === "SHOWDOWN" || nextState.phase === "SETTLED") && Number(nextState.pot ?? 0) > 0) {
        rejectStateInvalid("showdown_pot_not_zero", { pot: nextState.pot ?? null });
      }

      const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...stateBase } = nextState;
      const updatedState = {
        ...stateBase,
        communityDealt: Array.isArray(nextState.community) ? nextState.community.length : 0,
        lastActionRequestIdByUserId: {
          ...lastByUserId,
          [auth.userId]: requestId,
        },
      };
      const nowMs = Date.now();
      const hasTurnUserId = typeof updatedState.turnUserId === "string" && updatedState.turnUserId.trim();
      const shouldResetTimer = isActionPhase(updatedState.phase) && hasTurnUserId;
      const timerResetState = shouldResetTimer
        ? resetTurnTimer(updatedState, nowMs, TURN_MS)
        : { ...updatedState, turnStartedAt: null, turnDeadlineAt: null };
      const clearedMissedTurns = clearMissedTurns(timerResetState, auth.userId);
      let finalState = clearedMissedTurns.changed ? clearedMissedTurns.nextState : timerResetState;
      const leaveAfterHand = await maybeEvictMarkedBotAfterSettlement(tx, {
        tableId,
        state: finalState,
        actorUserId: process.env.POKER_SYSTEM_ACTOR_USER_ID,
      });
      finalState = leaveAfterHand.state;

      if (shouldResetTimer) {
        klog("poker_turn_timer_reset", {
          tableId,
          fromUserId: auth.userId,
          toUserId: timerResetState.turnUserId ?? null,
          turnNo: timerResetState.turnNo ?? null,
          nowMs,
          deadlineMs: timerResetState.turnDeadlineAt ?? null,
        });
      } else {
        klog("poker_turn_timer_skipped", {
          tableId,
          phase: timerResetState.phase ?? null,
          reason: "non_action_phase",
        });
      }

      if (!isStateStorageValid(finalState, { requireHandSeed: true, requireCommunityDealt: true, requireNoDeck: true })) {
        klog("poker_state_corrupt", { tableId, phase: finalState.phase });
        throw makeError(409, "state_invalid");
      }

      const updateResult = await updatePokerStateOptimistic(tx, {
        tableId,
        expectedVersion,
        nextState: finalState,
      });
      if (!updateResult.ok) {
        if (updateResult.reason === "not_found") {
          throw makeError(404, "state_missing");
        }
        if (updateResult.reason === "conflict") {
          klog("poker_act_conflict", { tableId, userId: auth.userId, expectedVersion, requestId });
          throw makeError(409, "state_conflict");
        }
        klog("poker_act_rejected", {
          tableId,
          userId: auth.userId,
          reason: "state_invalid",
          phase: finalState.phase,
        });
        throw makeError(409, "state_invalid");
      }
        let newVersion = updateResult.newVersion;
        mutated = true;

      const actionHandId =
        typeof finalState.handId === "string" && finalState.handId.trim() ? finalState.handId.trim() : null;
      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
        [
          tableId,
          newVersion,
          auth.userId,
          actionParsed.value.type,
          actionParsed.value.amount ?? null,
          actionHandId,
          requestId,
          currentState.phase || null,
          finalState.phase || null,
          null,
        ]
      );
      const botAutoplayConfig = getBotAutoplayConfig(process.env);
      let responseFinalState = finalState;
      let responseEvents = Array.isArray(events) ? events.slice() : [];
      let loopPrivateState = {
        ...nextState,
        lastActionRequestIdByUserId: isPlainObjectValue(finalState?.lastActionRequestIdByUserId)
          ? { ...finalState.lastActionRequestIdByUserId }
          : {},
      };
      let loopVersion = newVersion;
      let botActionCount = 0;
      let botStopReason = "not_attempted";
      let lastBotActionSummary = null;
      const handIdForLog = typeof responseFinalState.handId === "string" && responseFinalState.handId.trim() ? responseFinalState.handId.trim() : null;
      klog("poker_act_bot_autoplay_attempt", {
        tableId,
        handId: handIdForLog,
        turnUserId: responseFinalState.turnUserId || null,
        policyVersion: botAutoplayConfig.policyVersion,
        maxActionsPerRequest: botAutoplayConfig.maxActionsPerRequest,
      });

      const buildPersistedFromPrivateState = (privateStateInput, actorUserId, actionRequestId) => {
        const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...stateBase } = privateStateInput;
        const baseLastActionRequestIdByUserId = isPlainObjectValue(stateBase?.lastActionRequestIdByUserId)
          ? stateBase.lastActionRequestIdByUserId
          : {};
        const updated = {
          ...stateBase,
          communityDealt: Array.isArray(privateStateInput.community) ? privateStateInput.community.length : 0,
          lastActionRequestIdByUserId: {
            ...baseLastActionRequestIdByUserId,
            [actorUserId]: actionRequestId,
          },
        };
        const nowMsValue = Date.now();
        const hasTurn = typeof updated.turnUserId === "string" && updated.turnUserId.trim();
        const withTimer = isActionPhase(updated.phase) && hasTurn
          ? resetTurnTimer(updated, nowMsValue, TURN_MS)
          : { ...updated, turnStartedAt: null, turnDeadlineAt: null };
        const cleared = clearMissedTurns(withTimer, actorUserId);
        const persistedState = cleared.changed ? cleared.nextState : withTimer;
        return sanitizePerHandArtifacts(persistedState);
      };

      const runBotAutoplayLoop = async () => {
        botStopReason = "not_attempted";
        while (botActionCount < botAutoplayConfig.maxActionsPerRequest) {
          if (!isActionPhase(responseFinalState.phase)) { botStopReason = "non_action_phase"; break; }
          const botTurnUserId = responseFinalState.turnUserId;
          if (!isBotTurn(botTurnUserId, seatBotMap)) { botStopReason = "turn_not_bot"; break; }

          const botLegalInfo = computeLegalActions({ statePublic: withoutPrivateState(responseFinalState), userId: botTurnUserId });
          const botChoice = chooseBotActionTrivial(botLegalInfo.actions);
          if (!botChoice || !botChoice.type) { botStopReason = "no_legal_action"; break; }

          const botRequestId = `bot:${requestId}:${botActionCount + 1}`;
          const botAction = { ...botChoice, userId: botTurnUserId, requestId: botRequestId };
          let botApplied;
          try {
            botApplied = applyAction(loopPrivateState, botAction);
          } catch (error) {
            botStopReason = "apply_action_failed";
            const currentHandIdForLog =
              typeof responseFinalState?.handId === "string" && responseFinalState.handId.trim() ? responseFinalState.handId.trim() : null;
            klog("poker_act_bot_autoplay_step_error", {
              tableId,
              handId: currentHandIdForLog,
              turnUserId: botTurnUserId || null,
              policyVersion: botAutoplayConfig.policyVersion,
              botActionCount,
              reason: botStopReason,
              actionType: botAction.type || null,
              actionAmount: botAction.amount ?? null,
              error: error?.message || "apply_action_failed",
            });
            break;
          }
          let botNextState = botApplied.state;
          const botAdvanceEvents = [];
          const botEvents = Array.isArray(botApplied.events) ? botApplied.events.slice() : [];
          const botAdvanced = runAdvanceLoop(botNextState, botEvents, botAdvanceEvents);
          botNextState = botAdvanced.nextState;
          const botEligibleUserIds = seatUserIdsInOrder.filter(
            (userId) =>
              typeof userId === "string" &&
              !botNextState.foldedByUserId?.[userId] &&
              !botNextState.leftTableByUserId?.[userId] &&
              !botNextState.sitOutByUserId?.[userId]
          );
          const botHandId = typeof botNextState.handId === "string" ? botNextState.handId.trim() : "";
          const botShowdownHandId =
            typeof botNextState.showdown?.handId === "string" && botNextState.showdown.handId.trim()
              ? botNextState.showdown.handId.trim()
              : "";
          const botShowdownMaterialized = !!botHandId && !!botShowdownHandId && botShowdownHandId === botHandId;
          const botNeedsShowdown = !botShowdownMaterialized && (botEligibleUserIds.length <= 1 || botNextState.phase === "SHOWDOWN");
          if (botNeedsShowdown) {
            botNextState = materializeShowdownState(botNextState, seatUserIdsInOrder, holeCardsByUserId);
          }

          const botPersistedState = buildPersistedFromPrivateState(botNextState, botTurnUserId, botRequestId);
          if (!isStateStorageValid(botPersistedState, { requireHandSeed: true, requireCommunityDealt: true, requireNoDeck: true })) {
            botStopReason = "invalid_persist_state";
            break;
          }

          const botUpdateResult = await updatePokerStateOptimistic(tx, {
            tableId,
            expectedVersion: loopVersion,
            nextState: botPersistedState,
          });
          if (!botUpdateResult.ok) {
            botStopReason = botUpdateResult.reason === "conflict" ? "optimistic_conflict" : "update_failed";
            break;
          }
          loopVersion = botUpdateResult.newVersion;
          mutated = true;
          const botActionHandId =
            typeof botPersistedState.handId === "string" && botPersistedState.handId.trim() ? botPersistedState.handId.trim() : null;
          await tx.unsafe(
            "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
            [
              tableId,
              loopVersion,
              botTurnUserId,
              botAction.type,
              botAction.amount ?? null,
              botActionHandId,
              botRequestId,
              responseFinalState.phase || null,
              botPersistedState.phase || null,
              JSON.stringify({ actor: "BOT", botUserId: botTurnUserId, policyVersion: botAutoplayConfig.policyVersion, reason: "AUTO_TURN" }),
            ]
          );

          responseFinalState = botPersistedState;
          responseEvents = responseEvents.concat(botEvents);
          loopPrivateState = botNextState;
          newVersion = loopVersion;
          lastBotActionSummary = { type: botAction.type, amount: botAction.amount ?? null, userId: botTurnUserId };
          botActionCount += 1;
        }

        if (botStopReason === "not_attempted") {
          botStopReason = botActionCount >= botAutoplayConfig.maxActionsPerRequest ? "action_cap_reached" : "completed";
        } else if (botActionCount >= botAutoplayConfig.maxActionsPerRequest) {
          botStopReason = "action_cap_reached";
        }
      };

      await runBotAutoplayLoop();

      if (responseFinalState.phase === "HAND_DONE" || responseFinalState.phase === "SETTLED") {
        const settledHandId = typeof responseFinalState?.handId === "string" ? responseFinalState.handId.trim() : "";
        if (!settledHandId) {
          klog("poker_act_auto_start_skipped", { tableId, reason: "missing_hand_id", phase: responseFinalState.phase || null });
        } else {
          const stackMap = isPlainObjectValue(responseFinalState?.stacks) ? responseFinalState.stacks : {};
          const eligibleSeats = (Array.isArray(responseFinalState?.seats) ? responseFinalState.seats : [])
            .filter((seat) => {
              const userId = typeof seat?.userId === "string" ? seat.userId : "";
              if (!userId) return false;
              if (seatBotMap?.[userId]) return false;
              return Number.isInteger(Number(stackMap[userId])) && Number(stackMap[userId]) > 0;
            })
            .map((seat) => ({ user_id: seat.userId, seat_no: Number(seat.seatNo), stack: Number(stackMap[seat.userId] ?? 0) }))
            .filter((seat) => Number.isInteger(seat.seat_no));
          if (eligibleSeats.length >= 2) {
            const autoStartRequestId = `auto-start:${tableId}:${settledHandId}:v${loopVersion}`;
            const autoStartRequest = await ensurePokerRequest(tx, {
              tableId,
              userId: auth.userId,
              requestId: autoStartRequestId,
              kind: "ACT_AUTO_START",
              pendingStaleSec: REQUEST_PENDING_STALE_SEC,
            });
            if (autoStartRequest.status === "created") {
              try {
                const autoStart = await startHandCore({
                  tx,
                  tableId,
                  table,
                  currentState: responseFinalState,
                  expectedVersion: loopVersion,
                  validSeats: eligibleSeats,
                  userId: auth.userId,
                  requestId: autoStartRequestId,
                  previousDealerSeatNo: Number.isInteger(responseFinalState?.dealerSeatNo) ? responseFinalState.dealerSeatNo : null,
                  makeError,
                });
                responseFinalState = sanitizePerHandArtifacts(autoStart.updatedState);
                loopPrivateState = sanitizePerHandArtifacts(autoStart.privateState || autoStart.updatedState);
                loopVersion = autoStart.newVersion;
                newVersion = autoStart.newVersion;
                holeCardsByUserId = autoStart.dealtHoleCards;
                mutated = true;
                await storePokerRequestResult(tx, {
                  tableId,
                  userId: auth.userId,
                  requestId: autoStartRequestId,
                  kind: "ACT_AUTO_START",
                  result: { ok: true, handId: responseFinalState.handId, version: newVersion },
                });
              } catch (error) {
                await deletePokerRequest(tx, {
                  tableId,
                  userId: auth.userId,
                  requestId: autoStartRequestId,
                  kind: "ACT_AUTO_START",
                });
                throw error;
              }
            }
          }
        }
      }

      if (isActionPhase(responseFinalState.phase) && isBotTurn(responseFinalState.turnUserId, seatBotMap) && botActionCount < botAutoplayConfig.maxActionsPerRequest) {
        await runBotAutoplayLoop();
      }

      const currentHandIdForLog =
        typeof responseFinalState?.handId === "string" && responseFinalState.handId.trim() ? responseFinalState.handId.trim() : null;
      klog("poker_act_bot_autoplay_stop", {
        tableId,
        handId: currentHandIdForLog,
        turnUserId: responseFinalState.turnUserId || null,
        policyVersion: botAutoplayConfig.policyVersion,
        botActionCount,
        reason: botStopReason,
        lastActionType: lastBotActionSummary?.type || null,
        lastActionAmount: lastBotActionSummary?.amount ?? null,
        optimisticConflict: botStopReason === "optimistic_conflict",
      });

      await tx.unsafe(
        "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
        [tableId]
      );

      if (advanceEvents.length > 0) {
        klog("poker_act_advanced", {
          tableId,
          fromPhase: currentState.phase,
          toPhase: responseFinalState.phase,
          loops,
          eventTypes: Array.from(new Set(advanceEvents.map((event) => event?.type).filter(Boolean))),
        });
      }

      klog("poker_act_applied", {
        tableId,
        userId: auth.userId,
        actionType: actionParsed.value.type,
        amount: actionParsed.value.amount ?? null,
        fromPhase: currentState.phase,
        toPhase: responseFinalState.phase,
        newVersion,
      });

      let responseState = withoutPrivateState(responseFinalState);
      const responseGuard = computeLegalActionsWithGuard({ statePublic: responseState, userId: auth.userId, tableId, source: "poker_act" });
      responseState = responseGuard.statePublic;
      const nextLegalInfo = responseGuard.legalInfo;
      const resultPayload = {
        ok: true,
        tableId,
        state: {
          version: newVersion,
          state: responseState,
        },
        me: buildMeStatus(responseState, auth.userId),
        myHoleCards: holeCardsByUserId[auth.userId] || [],
        events: responseEvents,
        replayed: false,
        legalActions: nextLegalInfo.actions,
        actionConstraints: buildActionConstraints(nextLegalInfo),
      };
      await storePokerRequestResult(tx, {
        tableId,
        userId: auth.userId,
        requestId,
        kind: "ACT",
        result: resultPayload,
      });
      return resultPayload;
      } catch (error) {
        if (requestId && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: auth.userId, requestId, kind: "ACT" });
        } else if (requestId && mutated) {
          klog("poker_act_request_retained", { tableId, userId: auth.userId, requestId });
        }
        throw error;
      }
    });

    if (result?.pending) {
      return {
        statusCode: 202,
        headers: mergeHeaders(cors),
        body: JSON.stringify({ error: "request_pending", requestId: result.requestId || requestId }),
      };
    }
    return { statusCode: 200, headers: mergeHeaders(cors), body: JSON.stringify(result) };
  } catch (error) {
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: mergeHeaders(cors), body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_act_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
