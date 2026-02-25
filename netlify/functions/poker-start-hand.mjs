import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { dealHoleCards } from "./_shared/poker-engine.mjs";
import { deriveDeck } from "./_shared/poker-deal-deterministic.mjs";
import { TURN_MS, advanceIfNeeded, applyAction, computeNextDealerSeatNo } from "./_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "./_shared/poker-legal-actions.mjs";
import { materializeShowdownAndPayout } from "./_shared/poker-materialize-showdown.mjs";
import { computeShowdown } from "./_shared/poker-showdown.mjs";
import { awardPotsAtShowdown } from "./_shared/poker-payout.mjs";
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
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "./_shared/poker-hole-cards-store.mjs";
import { buildSeatBotMap, chooseBotActionTrivial, getBotAutoplayConfig, isBotTurn } from "./_shared/poker-bots.mjs";
import { startHandCore } from "./_shared/poker-start-hand-core.mjs";
import { normalizeSeatOrderFromState } from "./_shared/poker-turn-timeout.mjs";

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

const TERMINAL_OR_RECOVERABLE_PHASES = new Set(["SHOWDOWN", "HAND_DONE", "SETTLED"]);

const recoverTerminalStateIfNeeded = async ({ tx, tableId, state, expectedVersion, activeSeatRows }) => {
  const phase = typeof state?.phase === "string" ? state.phase : "";
  const stuckShowdown = phase === "SHOWDOWN" && !state?.showdown;
  const terminalPhase = TERMINAL_OR_RECOVERABLE_PHASES.has(phase);
  if (!stuckShowdown && !terminalPhase) {
    return { state, expectedVersion, recovered: false };
  }
  if (phase === "HAND_DONE") {
    return { state, expectedVersion, recovered: false };
  }

  let nextState = state;
  let nextVersion = expectedVersion;
  let didMutate = false;

  if (stuckShowdown) {
    try {
      const normalizedHandSeats = Array.isArray(nextState?.handSeats) ? nextState.handSeats : [];
      let seatUserIdsInOrder = normalizeSeatOrderFromState(normalizedHandSeats);
      if (seatUserIdsInOrder.length === 0) {
        const fallbackSeats = Array.isArray(activeSeatRows) ? activeSeatRows : [];
        const sorted = fallbackSeats.slice().sort((a, b) => Number(a?.seat_no ?? 0) - Number(b?.seat_no ?? 0));
        seatUserIdsInOrder = sorted
          .map((seat) => (typeof seat?.user_id === "string" ? seat.user_id.trim() : ""))
          .filter((userId) => !!userId);
      }
      if (seatUserIdsInOrder.length === 0) {
        throw makeError(409, "state_conflict");
      }

      const eligibleUserIds = seatUserIdsInOrder.filter(
        (userId) =>
          typeof userId === "string" &&
          !nextState?.foldedByUserId?.[userId] &&
          !nextState?.leftTableByUserId?.[userId] &&
          !nextState?.sitOutByUserId?.[userId]
      );

      let holeCardsByUserId = null;
      if (eligibleUserIds.length > 1) {
        let loaded;
        try {
          loaded = await loadHoleCardsByUserId(tx, {
            tableId,
            handId: nextState.handId,
            activeUserIds: seatUserIdsInOrder,
            requiredUserIds: eligibleUserIds,
            mode: "strict",
          });
        } catch (error) {
          if (isHoleCardsTableMissing(error)) {
            throw makeError(409, "state_conflict");
          }
          throw error;
        }
        holeCardsByUserId = loaded?.holeCardsByUserId || null;
      }

      const materialized = materializeShowdownAndPayout({
        state: nextState,
        seatUserIdsInOrder,
        holeCardsByUserId,
        computeShowdown,
        awardPotsAtShowdown,
        klog,
      });
      nextState = materialized.nextState;
      didMutate = true;
    } catch (error) {
      if (Number.isInteger(error?.status) && typeof error?.code === "string") throw error;
      throw makeError(409, "state_conflict");
    }
  }

  let loopCount = 0;
  while (loopCount < ADVANCE_LIMIT) {
    const before = nextState;
    const advanced = advanceIfNeeded(nextState);
    nextState = advanced.state;
    const hasEvents = Array.isArray(advanced.events) && advanced.events.length > 0;
    const phaseChanged = before?.phase !== nextState?.phase;
    if (!hasEvents && !phaseChanged) break;
    didMutate = true;
    if (nextState?.phase === "INIT") break;
    loopCount += 1;
  }

  if (!didMutate) return { state, expectedVersion, recovered: false };
  if (!isStateStorageValid(nextState, { requireNoDeck: true, requireHandSeed: false, requireCommunityDealt: false })) {
    throw makeError(409, "state_invalid");
  }

  const recovered = await updatePokerStateOptimistic(tx, {
    tableId,
    expectedVersion: nextVersion,
    nextState,
  });
  if (!recovered.ok) {
    if (recovered.reason === "conflict") throw makeError(409, "state_conflict");
    throw makeError(409, "state_invalid");
  }
  nextVersion = recovered.newVersion;
  return { state: nextState, expectedVersion: nextVersion, recovered: true };
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
        const leftTableByUserId =
          currentState?.leftTableByUserId && typeof currentState.leftTableByUserId === "object"
            ? currentState.leftTableByUserId
            : {};
        const sitOutByUserId =
          currentState?.sitOutByUserId && typeof currentState.sitOutByUserId === "object"
            ? currentState.sitOutByUserId
            : {};
        const validSeats = seats.filter(
          (seat) =>
            Number.isInteger(seat?.seat_no) &&
            seat?.user_id &&
            !leftTableByUserId[seat.user_id] &&
            !sitOutByUserId[seat.user_id]
        );
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

        const recovered = await recoverTerminalStateIfNeeded({
          tx,
          tableId,
          state: currentState,
          expectedVersion,
          activeSeatRows: validSeats,
        });
        if (recovered.recovered) {
          currentState = recovered.state;
          expectedVersion = recovered.expectedVersion;
          mutated = true;
          klog("poker_start_hand_recovered_terminal_state", {
            tableId,
            userId: auth.userId,
            phase: currentState?.phase || null,
          });
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

      const startResult = await startHandCore({
        tx,
        tableId,
        table,
        currentState,
        expectedVersion,
        validSeats,
        userId: auth.userId,
        requestId: requestIdParsed.value,
        previousDealerSeatNo,
        makeError,
        onAlreadyInHandConflict: async () => {
          klog("poker_start_hand_conflict", { tableId, userId: auth.userId, expectedVersion });
          const freshStateRows = await tx.unsafe("select state from public.poker_state where table_id = $1 limit 1;", [tableId]);
          const rawFreshState = freshStateRows?.[0]?.state ?? null;
          const freshState = normalizeStateRow(rawFreshState);
          const freshPhase = typeof freshState?.phase === "string" ? freshState.phase : null;
          if (freshPhase && freshPhase !== "INIT" && freshPhase !== "HAND_DONE") {
            throw makeAlreadyInHandError(tableId, auth.userId, "optimistic_conflict");
          }
        },
        deps: {
          dealHoleCards,
          deriveDeck,
          getRng,
          computeNextDealerSeatNo,
          parseStakes,
          updatePokerStateOptimistic,
          klog,
        },
      });
      let newVersion = startResult.newVersion;
      mutated = true;
      const updatedState = startResult.updatedState;
      const dealtHoleCards = startResult.dealtHoleCards;
      const handId = updatedState.handId;
      const botAutoplayConfig = getBotAutoplayConfig(process.env);
      let finalState = updatedState;
      let loopPrivateState = startResult.privateState;
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
