import crypto from "node:crypto";
import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { areCardsUnique, isValidTwoCards } from "./_shared/poker-cards-utils.mjs";
import { dealHoleCards } from "./_shared/poker-engine.mjs";
import { deriveDeck } from "./_shared/poker-deal-deterministic.mjs";
import { TURN_MS, advanceIfNeeded, applyAction, computeNextDealerSeatNo } from "./_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "./_shared/poker-legal-actions.mjs";
import {
  getRng,
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  upgradeLegacyInitStateWithSeats,
  withoutPrivateState,
} from "./_shared/poker-state-utils.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./_shared/poker-idempotency.mjs";
import { updatePokerStateOptimistic } from "./_shared/poker-state-write.mjs";
import { parseStakes } from "./_shared/poker-stakes.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { resetTurnTimer } from "./_shared/poker-turn-timer.mjs";
import { clearMissedTurns } from "./_shared/poker-missed-turns.mjs";
import { buildSeatBotMap, chooseBotActionTrivial, getBotAutoplayConfig, isBotTurn } from "./_shared/poker-bots.mjs";

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

const KNOWN_ERROR_CODES = new Set([
  "table_not_found",
  "table_not_open",
  "not_allowed",
  "not_enough_players",
  "state_invalid",
  "state_conflict",
  "already_in_hand",
  "invalid_stakes",
  "hole_cards_write_failed",
]);

const toErrorPayload = (err) => {
  if (typeof err?.code === "string") return { code: err.code };
  if (typeof err?.message === "string" && KNOWN_ERROR_CODES.has(err.message)) return { code: err.message };
  return { code: "server_error" };
};

const makeAlreadyInHandError = (tableId, userId, context) => {
  klog("poker_start_hand_already_in_hand", { tableId, userId, context: context || "unknown" });
  return makeError(409, "already_in_hand");
};

const REQUEST_PENDING_STALE_SEC = 30;
const ADVANCE_LIMIT = 4;

const parseRequestId = (value) => {
  const parsed = normalizeRequestId(value, { maxLen: 200 });
  if (!parsed.ok || !parsed.value) return { ok: false, value: null };
  return { ok: true, value: parsed.value };
};

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

const normalizeVersion = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeStateRow = (raw) => {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return normalizeJsonState(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  return null;
};

const isHoleCardsTableMissing = (error) => {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || "").toLowerCase();
  return message.includes("poker_hole_cards") && message.includes("does not exist");
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  const headersWithCors = () => ({ ...baseHeaders(), ...(cors || {}) });
  const respondError = (statusCode, code, extra) => ({
    statusCode,
    headers: headersWithCors(),
    body: JSON.stringify({ error: code, ...(extra || {}) }),
  });
  if (!cors) {
    const headers = {
      ...baseHeaders(),
      "access-control-allow-origin": "null",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: headersWithCors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: headersWithCors(), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: headersWithCors(), body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: headersWithCors(), body: JSON.stringify({ error: "invalid_payload" }) };
  }

  const tableIdValue = payload?.tableId;
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: headersWithCors(), body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const requestIdParsed = parseRequestId(payload?.requestId);
  if (!requestIdParsed.ok) {
    return { statusCode: 400, headers: headersWithCors(), body: JSON.stringify({ error: "invalid_request_id" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return {
      statusCode: 401,
      headers: headersWithCors(),
      body: JSON.stringify({ error: "unauthorized", reason: auth.reason }),
    };
  }

  try {
    const result = await beginSql(async (tx) => {
      let mutated = false;
      const requestInfo = await ensurePokerRequest(tx, {
        tableId,
        userId: auth.userId,
        requestId: requestIdParsed.value,
        kind: "START_HAND",
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
            requestId: requestIdParsed.value,
            kind: "START_HAND",
            result: replayed,
          });
          return replayed;
        }
        return stored;
      }
      if (requestInfo.status === "pending") return { pending: true, requestId: requestIdParsed.value };

      try {
        const tableRows = await tx.unsafe("select id, status, stakes from public.poker_tables where id = $1 limit 1;", [tableId]);
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }
        if (table.status !== "OPEN") {
          throw makeError(409, "table_not_open");
        }

        const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [
          tableId,
        ]);
        const stateRow = stateRows?.[0] || null;
        if (!stateRow) {
          throw makeError(409, "state_invalid");
        }
        let expectedVersion = normalizeVersion(stateRow.version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
          throw makeError(409, "state_invalid");
        }

        let currentState = normalizeJsonState(stateRow.state);
        const previousDealerSeatNo = Number.isInteger(currentState?.dealerSeatNo) ? currentState.dealerSeatNo : null;

        const seatRows = await tx.unsafe(
          "select user_id, seat_no, stack, is_bot from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
          [tableId]
        );
        const seats = Array.isArray(seatRows) ? seatRows : [];
        const seatBotMap = buildSeatBotMap(seats);
        const activeHumanCount = seats.reduce(
          (count, seat) => (seat?.is_bot ? count : count + 1),
          0
        );
        const validSeats = seats.filter((seat) => Number.isInteger(seat?.seat_no) && seat?.user_id);
        if (validSeats.length < 2) {
          throw makeError(400, "not_enough_players");
        }
        if (!validSeats.some((seat) => seat.user_id === auth.userId)) {
          throw makeError(403, "not_allowed");
        }
        if (currentState?.phase === "INIT") {
          const seatsSorted = validSeats.map((seat) => ({ userId: seat.user_id, seatNo: seat.seat_no }));
          const hasAllUserKeys = (obj) =>
            isPlainObject(obj) && seatsSorted.every((seat) => Object.prototype.hasOwnProperty.call(obj, seat.userId));
          const upgradedState = upgradeLegacyInitStateWithSeats(currentState, seatsSorted);
          const isLegacy =
            upgradedState?.phase === "INIT" &&
            (!Number.isInteger(currentState.communityDealt) ||
              !Number.isInteger(currentState.dealerSeatNo) ||
              typeof currentState.turnUserId !== "string" ||
              !currentState.turnUserId.trim() ||
              !hasAllUserKeys(currentState.toCallByUserId) ||
              !hasAllUserKeys(currentState.betThisRoundByUserId) ||
              !hasAllUserKeys(currentState.actedThisRoundByUserId) ||
              !hasAllUserKeys(currentState.foldedByUserId));
          if (isLegacy) {
            const upgradeResult = await updatePokerStateOptimistic(tx, {
              tableId,
              expectedVersion,
              nextState: upgradedState,
            });
            if (!upgradeResult.ok) {
              if (upgradeResult.reason === "conflict") {
                klog("poker_start_hand_conflict", { tableId, userId: auth.userId, expectedVersion });
                throw makeError(409, "state_conflict");
              }
              klog("poker_start_hand_upgrade_failed", { tableId, reason: "legacy_init_upgrade_failed" });
              throw makeError(409, "state_invalid");
            }
            expectedVersion = upgradeResult.newVersion;
            mutated = true;
          }
          currentState = upgradedState;
        }

        const sameRequest =
          currentState.lastStartHandRequestId === requestIdParsed.value && currentState.lastStartHandUserId === auth.userId;
        if (sameRequest) {
          const isActionPhase =
            currentState.phase === "PREFLOP" ||
            currentState.phase === "FLOP" ||
            currentState.phase === "TURN" ||
            currentState.phase === "RIVER";
          if (isActionPhase && typeof currentState.handId === "string" && currentState.handId.trim()) {
            let holeCardRows;
            try {
              holeCardRows = await tx.unsafe(
                "select cards from public.poker_hole_cards where table_id = $1 and hand_id = $2 and user_id = $3 limit 1;",
                [tableId, currentState.handId, auth.userId]
              );
            } catch (error) {
              if (isHoleCardsTableMissing(error)) {
                throw makeError(409, "state_invalid");
              }
              throw error;
            }
            const myHoleCards = holeCardRows?.[0]?.cards || null;
            if (!isValidTwoCards(myHoleCards)) {
              throw makeError(409, "state_invalid");
            }
            const replayPublicState = withoutPrivateState(currentState);
            const replayLegalInfo = computeLegalActions({ statePublic: replayPublicState, userId: auth.userId });
            const resultPayload = {
              ok: true,
              tableId,
              state: {
                version: normalizeVersion(stateRow.version),
                state: replayPublicState,
              },
              myHoleCards,
              replayed: true,
              legalActions: replayLegalInfo.actions,
              actionConstraints: buildActionConstraints(replayLegalInfo),
            };
            await storePokerRequestResult(tx, {
              tableId,
              userId: auth.userId,
              requestId: requestIdParsed.value,
              kind: "START_HAND",
              result: resultPayload,
            });
            return resultPayload;
          }
          throw makeError(409, "state_invalid");
        }

      if (currentState.phase && currentState.phase !== "INIT" && currentState.phase !== "HAND_DONE") {
        throw makeAlreadyInHandError(tableId, auth.userId, "phase_gate");
      }

      const orderedSeats = validSeats.slice().sort((a, b) => Number(a.seat_no) - Number(b.seat_no));
      const orderedSeatList = orderedSeats.map((seat) => ({ userId: seat.user_id, seatNo: seat.seat_no }));
      let dealerSeatNo = computeNextDealerSeatNo(orderedSeatList, previousDealerSeatNo);
      if (!orderedSeats.some((seat) => seat.seat_no === dealerSeatNo)) {
        dealerSeatNo = orderedSeats[0].seat_no;
      }
      const dealerIndex = Math.max(
        orderedSeats.findIndex((seat) => seat.seat_no === dealerSeatNo),
        0
      );
      const seatCount = orderedSeats.length;
      const isHeadsUp = seatCount === 2;
      const sbIndex = isHeadsUp ? dealerIndex : (dealerIndex + 1) % seatCount;
      const bbIndex = (sbIndex + 1) % seatCount;
      const utgIndex = isHeadsUp ? dealerIndex : (bbIndex + 1) % seatCount;
      const sbUserId = orderedSeats[sbIndex]?.user_id || null;
      const bbUserId = orderedSeats[bbIndex]?.user_id || null;
      const turnUserId =
        orderedSeats[utgIndex]?.user_id || orderedSeats[dealerIndex]?.user_id || orderedSeats[0].user_id;

      const rng = getRng();
      const handId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `hand_${Date.now()}_${Math.floor(rng() * 1e6)}`;
      const handSeed =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `seed_${Date.now()}_${Math.floor(rng() * 1e6)}`;
      const derivedSeats = orderedSeatList.slice();
      const activeUserIds = new Set(orderedSeats.map((seat) => seat.user_id));
      const activeUserIdList = orderedSeats.map((seat) => seat.user_id);
      if (activeUserIds.size < 2 || activeUserIdList.length < 2) {
        klog("poker_start_hand_invalid_active_players", {
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
      const missingStoredStackUserId = activeUserIdList.find((userId) => !Object.prototype.hasOwnProperty.call(currentStacks, userId));
      const useStoredStacks = hasStoredStacks && !missingStoredStackUserId;
      const nextStacks = activeUserIdList.reduce((acc, userId) => {
        const rawStack = useStoredStacks ? currentStacks[userId] : stacksFromSeats[userId];
        const n = Number(rawStack);
        if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) acc[userId] = n;
        return acc;
      }, {});
      const invalidActiveStackUserIds = activeUserIdList.filter((userId) => !Object.prototype.hasOwnProperty.call(nextStacks, userId));
      if (invalidActiveStackUserIds.length > 0) {
        klog("poker_start_hand_invalid_active_stacks", {
          tableId,
          userId: auth.userId,
          invalidActiveStackUserIds,
          activeUserIdList,
          currentStacks,
          stacksFromSeats,
          useStoredStacks,
        });
        throw makeError(409, "state_invalid");
      }
      const toCallByUserId = Object.fromEntries(activeUserIdList.map((userId) => [userId, 0]));
      const betThisRoundByUserId = Object.fromEntries(activeUserIdList.map((userId) => [userId, 0]));
      const actedThisRoundByUserId = Object.fromEntries(activeUserIdList.map((userId) => [userId, false]));
      const foldedByUserId = Object.fromEntries(activeUserIdList.map((userId) => [userId, false]));
      const contributionsByUserId = Object.fromEntries(activeUserIdList.map((userId) => [userId, 0]));
      const stakesParsed = parseStakes(table?.stakes);
      if (!stakesParsed.ok) {
        klog("poker_start_hand_invalid_stakes", { tableId, reason: stakesParsed.details?.reason || "stakes_invalid" });
        throw makeError(409, "invalid_stakes");
      }
      const sbAmount = stakesParsed.value.sb;
      const bbAmount = stakesParsed.value.bb;
      const postBlind = (userId, blindAmount) => {
        if (!userId) return 0;
        const stack = nextStacks[userId] ?? 0;
        const posted = Math.min(stack, blindAmount);
        nextStacks[userId] = Math.max(0, stack - posted);
        betThisRoundByUserId[userId] = posted;
        contributionsByUserId[userId] = posted;
        return posted;
      };
      const sbPosted = postBlind(sbUserId, sbAmount);
      const bbPosted = postBlind(bbUserId, bbAmount);
      const currentBet = bbPosted;
      const blindRaiseSize = bbPosted - sbPosted;
      const lastRaiseSize = bbPosted > 0 ? (blindRaiseSize > 0 ? blindRaiseSize : bbPosted) : 0;
      activeUserIdList.forEach((userId) => {
        const bet = betThisRoundByUserId[userId] || 0;
        toCallByUserId[userId] = Math.max(0, currentBet - bet);
      });

      let deck;
      try {
        deck = deriveDeck(handSeed);
      } catch (error) {
        if (error?.message === "deal_secret_missing") {
          throw makeError(409, "state_invalid");
        }
        throw error;
      }
      const dealResult = dealHoleCards(deck, activeUserIdList);
      const dealtHoleCards = isPlainObject(dealResult?.holeCardsByUserId) ? dealResult.holeCardsByUserId : {};

      if (!activeUserIdList.every((userId) => isValidTwoCards(dealtHoleCards[userId]))) {
        klog("poker_state_corrupt", { tableId, phase: "PREFLOP" });
        throw makeError(409, "state_invalid");
      }
      const flatHoleCards = activeUserIdList.flatMap((seatUserId) => dealtHoleCards[seatUserId] || []);
      const expectedHoleCardCount = activeUserIdList.length * 2;
      if (flatHoleCards.length !== expectedHoleCardCount) {
        klog("poker_state_corrupt", {
          tableId,
          phase: "PREFLOP",
          reason: "hole_cards_wrong_count",
          expectedHoleCardCount,
          actual: flatHoleCards.length,
        });
        throw makeError(409, "state_invalid");
      }
      if (!areCardsUnique(flatHoleCards)) {
        klog("poker_state_corrupt", { tableId, phase: "PREFLOP", reason: "hole_cards_not_unique" });
        throw makeError(409, "state_invalid");
      }

      if (!isStateStorageValid({ seats: derivedSeats, holeCardsByUserId: dealtHoleCards }, { requireHoleCards: true })) {
        klog("poker_state_corrupt", { tableId, phase: "PREFLOP" });
        throw makeError(409, "state_invalid");
      }

      const holeCardValues = activeUserIdList.map((userId) => ({ userId, cards: dealtHoleCards[userId] }));
      const holeCardPlaceholders = holeCardValues
        .map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}::jsonb)`)
        .join(", ");
      const holeCardParams = holeCardValues.flatMap((entry) => [
        tableId,
        handId,
        entry.userId,
        JSON.stringify(entry.cards),
      ]);

      let holeCardInsertRows;
      try {
        holeCardInsertRows = await tx.unsafe(
          `insert into public.poker_hole_cards (table_id, hand_id, user_id, cards) values ${holeCardPlaceholders} on conflict (table_id, hand_id, user_id) do update set cards = excluded.cards returning user_id;`,
          holeCardParams
        );
      } catch (error) {
        if (isHoleCardsTableMissing(error)) {
          throw makeError(409, "state_invalid");
        }
        if (error?.code === "23503") {
          throw makeError(500, "hole_cards_write_failed");
        }
        throw error;
      }
      const insertedUserIds = Array.isArray(holeCardInsertRows)
        ? holeCardInsertRows.map((row) => row?.user_id).filter(Boolean)
        : [];
      const expectedSeatCount = activeUserIdList.length;
      const insertedCount = insertedUserIds.length;
      const insertedSet = new Set(insertedUserIds);
      const missingUserIds = activeUserIdList.filter((userId) => !insertedSet.has(userId));
      if (insertedCount !== expectedSeatCount || missingUserIds.length > 0) {
        klog("poker_start_hand_hole_cards_write_failed", {
          tableId,
          handId,
          expectedSeatCount,
          insertedCount,
          missingUserIds,
          userIds: activeUserIdList,
        });
        throw makeError(500, "hole_cards_write_failed");
      }
      klog("poker_start_hand_hole_cards_written", {
        tableId,
        handId,
        expectedSeatCount,
        insertedCount,
        userIds: activeUserIdList,
      });

      const { holeCardsByUserId: _ignoredHoleCards, ...stateBase } = currentState;
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
        lastStartHandRequestId: requestIdParsed.value || null,
        lastStartHandUserId: auth.userId,
        startedAt: new Date().toISOString(),
      };
      const nowMs = Date.now();
      updatedState.turnNo = 1;
      updatedState.turnStartedAt = nowMs;
      updatedState.turnDeadlineAt = nowMs + TURN_MS;

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
          klog("poker_start_hand_conflict", { tableId, userId: auth.userId, expectedVersion });
          const freshStateRows = await tx.unsafe("select state from public.poker_state where table_id = $1 limit 1;", [tableId]);
          const rawFreshState = freshStateRows?.[0]?.state ?? null;
          const freshState = normalizeStateRow(rawFreshState);
          const freshPhase = typeof freshState?.phase === "string" ? freshState.phase : null;
          if (freshPhase && freshPhase !== "INIT" && freshPhase !== "HAND_DONE") {
            throw makeAlreadyInHandError(tableId, auth.userId, "optimistic_conflict");
          }
          throw makeError(409, "state_conflict");
        }
        throw makeError(409, "state_invalid");
      }
      let newVersion = updateResult.newVersion;
      mutated = true;

      const actionMeta = {
        determinism: {
          handSeed,
          dealContext: "poker-deal:v1",
        },
      };
      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
        [
          tableId,
          newVersion,
          auth.userId,
          "START_HAND",
          null,
          handId,
          requestIdParsed.value,
          currentState.phase || null,
          updatedState.phase || null,
          JSON.stringify(actionMeta),
        ]
      );
      const blindActions = [
        { type: "POST_SB", userId: sbUserId, amount: sbPosted },
        { type: "POST_BB", userId: bbUserId, amount: bbPosted },
      ];
      for (const blindAction of blindActions) {
        if (!blindAction.userId) continue;
        await tx.unsafe(
          "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
          [
            tableId,
            newVersion,
            blindAction.userId,
            blindAction.type,
            blindAction.amount,
            handId,
            requestIdParsed.value,
            currentState.phase || null,
            updatedState.phase || null,
            JSON.stringify({}),
          ]
        );
      }

      const botAutoplayConfig = getBotAutoplayConfig(process.env);
      let finalState = updatedState;
      let loopPrivateState = { ...updatedState, deck: Array.isArray(dealResult?.deck) ? dealResult.deck.slice() : [] };
      let botActionIndex = 0;
      let stopReason = "not_attempted";
      let lastBotActionSummary = null;
      const handIdForLog = typeof handId === "string" && handId.trim() ? handId.trim() : null;
      const runAdvanceLoop = (stateToAdvance, eventsList) => {
        let next = stateToAdvance;
        let loopCount = 0;
        while (loopCount < ADVANCE_LIMIT) {
          if (next.phase === "HAND_DONE") break;
          const prevPhase = next.phase;
          const advanced = advanceIfNeeded(next);
          next = advanced.state;
          if (Array.isArray(advanced.events) && advanced.events.length > 0) {
            eventsList.push(...advanced.events);
          }
          if (!Array.isArray(advanced.events) || advanced.events.length === 0) break;
          loopCount += 1;
        }
        return next;
      };
      const toPersistedState = (privateStateInput, actorUserId, actorRequestId) => {
        const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...stateBase } = privateStateInput || {};
        const baseLastActionRequestIdByUserId =
          stateBase?.lastActionRequestIdByUserId && typeof stateBase.lastActionRequestIdByUserId === "object" && !Array.isArray(stateBase.lastActionRequestIdByUserId)
            ? stateBase.lastActionRequestIdByUserId
            : {};
        const withCommunity = {
          ...stateBase,
          communityDealt: Array.isArray(privateStateInput?.community) ? privateStateInput.community.length : 0,
          lastActionRequestIdByUserId: {
            ...baseLastActionRequestIdByUserId,
            [actorUserId]: actorRequestId,
          },
        };
        const nowMs = Date.now();
        const hasTurnUserId = typeof withCommunity.turnUserId === "string" && withCommunity.turnUserId.trim();
        const withTimer =
          (withCommunity.phase === "PREFLOP" || withCommunity.phase === "FLOP" || withCommunity.phase === "TURN" || withCommunity.phase === "RIVER") && hasTurnUserId
            ? resetTurnTimer(withCommunity, nowMs, TURN_MS)
            : { ...withCommunity, turnStartedAt: null, turnDeadlineAt: null };
        const cleared = clearMissedTurns(withTimer, actorUserId);
        return cleared.changed ? cleared.nextState : withTimer;
      };

      klog("poker_start_hand_bot_autoplay_attempt", {
        tableId,
        handId: handIdForLog,
        turnUserId: finalState.turnUserId || null,
        policyVersion: botAutoplayConfig.policyVersion,
        maxActionsPerRequest: botAutoplayConfig.maxActionsPerRequest,
      });

      while (botActionIndex < botAutoplayConfig.maxActionsPerRequest) {
        if (activeHumanCount === 0) {
          stopReason = "no_active_humans";
          break;
        }
        const turnUserId = finalState.turnUserId;
        if (!(finalState.phase === "PREFLOP" || finalState.phase === "FLOP" || finalState.phase === "TURN" || finalState.phase === "RIVER")) {
          stopReason = "non_action_phase";
          break;
        }
        if (!isBotTurn(turnUserId, seatBotMap)) {
          stopReason = "turn_not_bot";
          break;
        }
        const legalInfoBot = computeLegalActions({ statePublic: withoutPrivateState(finalState), userId: turnUserId });
        const selected = chooseBotActionTrivial(legalInfoBot.actions);
        if (!selected || !selected.type) {
          stopReason = "no_legal_action";
          break;
        }

        const botRequestId = `bot:${requestIdParsed.value}:${botActionIndex + 1}`;
        const botAction = { ...selected, userId: turnUserId, requestId: botRequestId };
        let appliedBot;
        try {
          appliedBot = applyAction(loopPrivateState, botAction);
        } catch (error) {
          stopReason = "apply_action_failed";
          klog("poker_start_hand_bot_autoplay_stop", {
            tableId,
            handId: handIdForLog,
            turnUserId: turnUserId || null,
            policyVersion: botAutoplayConfig.policyVersion,
            botActionCount: botActionIndex,
            reason: stopReason,
            actionType: botAction.type || null,
            actionAmount: botAction.amount ?? null,
            error: error?.message || "apply_action_failed",
          });
          break;
        }
        const botEvents = Array.isArray(appliedBot.events) ? appliedBot.events.slice() : [];
        const botAdvancedState = runAdvanceLoop(appliedBot.state, botEvents);
        const persistedBotState = toPersistedState(botAdvancedState, botAction.userId, botRequestId);
        if (!isStateStorageValid(persistedBotState, { requireHandSeed: true, requireCommunityDealt: true, requireNoDeck: true })) {
          stopReason = "invalid_persist_state";
          break;
        }
        const botUpdate = await updatePokerStateOptimistic(tx, {
          tableId,
          expectedVersion: newVersion,
          nextState: persistedBotState,
        });
        if (!botUpdate.ok) {
          if (botUpdate.reason === "conflict") {
            stopReason = "optimistic_conflict";
            break;
          }
          if (botUpdate.reason === "not_found") {
            stopReason = "state_missing";
            throw makeError(404, "state_missing");
          }
          stopReason = "update_failed";
          throw makeError(409, "state_invalid");
        }
        newVersion = botUpdate.newVersion;
        mutated = true;
        await tx.unsafe(
          "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
          [
            tableId,
            newVersion,
            botAction.userId,
            botAction.type,
            botAction.amount ?? null,
            handId,
            botRequestId,
            finalState.phase || null,
            persistedBotState.phase || null,
            JSON.stringify({ actor: "BOT", botUserId: botAction.userId, policyVersion: botAutoplayConfig.policyVersion, reason: "AUTO_TURN" }),
          ]
        );
        lastBotActionSummary = { type: botAction.type, amount: botAction.amount ?? null, userId: botAction.userId };
        finalState = persistedBotState;
        loopPrivateState = botAdvancedState;
        botActionIndex += 1;
      }
      if (stopReason === "not_attempted") {
        stopReason = botActionIndex >= botAutoplayConfig.maxActionsPerRequest ? "action_cap_reached" : "completed";
      } else if (botActionIndex >= botAutoplayConfig.maxActionsPerRequest) {
        stopReason = "action_cap_reached";
      }
      klog("poker_start_hand_bot_autoplay_stop", {
        tableId,
        handId: handIdForLog,
        turnUserId: finalState.turnUserId || null,
        policyVersion: botAutoplayConfig.policyVersion,
        botActionCount: botActionIndex,
        reason: stopReason,
        lastActionType: lastBotActionSummary?.type || null,
        lastActionAmount: lastBotActionSummary?.amount ?? null,
        optimisticConflict: stopReason === "optimistic_conflict",
      });

      await tx.unsafe(
        "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
        [tableId]
      );

      const responseState = withoutPrivateState(finalState);
      const legalInfo = computeLegalActions({ statePublic: responseState, userId: auth.userId });
      const resultPayload = {
        ok: true,
        tableId,
        state: {
          version: newVersion,
          state: responseState,
        },
        myHoleCards: dealtHoleCards[auth.userId] || [],
        replayed: false,
        legalActions: legalInfo.actions,
        actionConstraints: buildActionConstraints(legalInfo),
      };
      await storePokerRequestResult(tx, {
        tableId,
        userId: auth.userId,
        requestId: requestIdParsed.value,
        kind: "START_HAND",
        result: resultPayload,
      });
      return resultPayload;
      } catch (error) {
        if (requestIdParsed.value && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: auth.userId, requestId: requestIdParsed.value, kind: "START_HAND" });
        } else if (requestIdParsed.value && mutated) {
          klog("poker_start_hand_request_retained", { tableId, userId: auth.userId, requestId: requestIdParsed.value });
        }
        throw error;
      }
    });

    if (result?.pending) {
      return {
        statusCode: 202,
        headers: headersWithCors(),
        body: JSON.stringify({ error: "request_pending", requestId: result.requestId || requestIdParsed.value }),
      };
    }
    return { statusCode: 200, headers: headersWithCors(), body: JSON.stringify(result) };
  } catch (error) {
    const isAppError = Number.isInteger(error?.status) && typeof error?.code === "string";
    const status = isAppError ? error.status : 500;
    const code = isAppError ? error.code : toErrorPayload(error).code;
    klog("poker_start_hand_error", {
      tableId,
      userId: auth?.userId ?? null,
      status,
      code,
      constraint: typeof error?.constraint === "string" ? error.constraint : null,
      message: typeof error?.message === "string" ? error.message : null,
      dbCode: typeof error?.code === "string" ? error.code : null,
    });
    return respondError(status, code);
  }
}
