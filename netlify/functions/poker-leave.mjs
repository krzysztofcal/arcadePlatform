import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";
import { postTransaction } from "./_shared/chips-ledger.mjs";
import { normalizeRequestId } from "./_shared/poker-request-id.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "./_shared/poker-idempotency.mjs";
import { updatePokerStateOptimistic } from "./_shared/poker-state-write.mjs";
import { advanceIfNeeded, applyLeaveTable } from "./_shared/poker-reducer.mjs";
import { isStateStorageValid, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { buildSeatBotMap, isBotTurn } from "./_shared/poker-bots.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "./_shared/poker-deal-deterministic.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "./_shared/poker-hole-cards-store.mjs";
import { hasParticipatingHumanInHand, runAdvanceLoop, runBotAutoplayLoop } from "./_shared/poker-autoplay.mjs";

const REQUEST_PENDING_STALE_SEC = 30;
const BOT_AUTOPLAY_MAX_ACTIONS = 8;
const BOT_AUTOPLAY_BOTS_ONLY_HARD_CAP = 30;


const isPlainObjectValue = (value) => value && typeof value === "object" && !Array.isArray(value);

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

const sanitizePersistedState = (stateInput) => {
  if (!isPlainObjectValue(stateInput)) return stateInput;
  const { deck: _ignoredDeck, holeCardsByUserId: _ignoredHoleCards, ...rest } = stateInput;
  return sanitizePerHandArtifacts(rest);
};

const isHandScopedForStorageValidation = (state) => {
  const handId = typeof state?.handId === "string" ? state.handId.trim() : "";
  if (handId) return true;
  return false;
};

const validatePersistedStateOrThrow = (state, makeErrorFn) => {
  const requireHandScopedData = isHandScopedForStorageValidation(state);
  if (!isStateStorageValid(state, {
    requireNoDeck: true,
    requireHandSeed: requireHandScopedData,
    requireCommunityDealt: requireHandScopedData,
  })) {
    throw makeErrorFn(409, "state_invalid");
  }
};

const parseBody = (body) => {
  if (!body) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false, value: null };
  }
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const makeError = (status, code) => {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
};

const normalizeState = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
};

const parseSeats = (value) => (Array.isArray(value) ? value : []);

const parseStacks = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const normalizeSeatStack = (value) => {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) return null;
  return num;
};

const normalizeNonNegativeInt = (n) =>
  Number.isInteger(n) && n >= 0 && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;

const isInvalidPlayerLeaveNoop = (error) => {
  const code = typeof error?.code === "string" ? error.code.trim().toLowerCase() : "";
  if (code === "invalid_player") return true;
  const message = typeof error?.message === "string" ? error.message.trim().toLowerCase() : "";
  return message === "invalid_player";
};

const sanitizeNoopResponseState = (state, userId) => {
  const base = normalizeState(state);
  const seats = parseSeats(base.seats).filter((seat) => seat?.userId !== userId);
  const stacks = { ...parseStacks(base.stacks) };
  delete stacks[userId];
  return { ...base, seats, stacks };
};

const isActionPhase = (phase) => ["PREFLOP", "FLOP", "TURN", "RIVER"].includes(phase);

const normalizeSeatOrderFromActiveSeatRows = (activeSeatRows) => {
  if (!Array.isArray(activeSeatRows)) return [];
  const orderedUserIds = activeSeatRows
    .filter((row) => Number.isInteger(Number(row?.seat_no)) && typeof row?.user_id === "string" && row.user_id.trim())
    .sort((a, b) => Number(a.seat_no) - Number(b.seat_no))
    .map((row) => row.user_id);
  return [...new Set(orderedUserIds)];
};

const selectFallbackBotTurnUserId = (state, seatUserIdsInOrder, seatBotMap) => {
  for (const userId of seatUserIdsInOrder) {
    if (!isBotTurn(userId, seatBotMap)) continue;
    if (state?.foldedByUserId?.[userId]) continue;
    if (state?.leftTableByUserId?.[userId]) continue;
    if (state?.sitOutByUserId?.[userId]) continue;
    if (state?.pendingAutoSitOutByUserId?.[userId]) continue;
    return userId;
  }
  return null;
};

const buildPersistedFromPrivateState = (privateStateInput, actorUserId, actionRequestId) => {
  const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...stateBase } = privateStateInput;
  const baseLastActionRequestIdByUserId = isPlainObjectValue(stateBase?.lastActionRequestIdByUserId)
    ? stateBase.lastActionRequestIdByUserId
    : {};
  return sanitizePersistedState({
    ...stateBase,
    communityDealt: Array.isArray(privateStateInput.community) ? privateStateInput.community.length : 0,
    lastActionRequestIdByUserId: {
      ...baseLastActionRequestIdByUserId,
      [actorUserId]: actionRequestId,
    },
  });
};

const maybeBuildPrivateStateForBotAutoplay = async ({ tx, tableId, state, seatUserIdsInOrder }) => {
  const handId = typeof state?.handId === "string" ? state.handId.trim() : "";
  const handSeed = typeof state?.handSeed === "string" ? state.handSeed.trim() : "";
  if (!handId || !handSeed) return { ok: false, reason: "missing_hand_context" };
  if (!Number.isInteger(state?.communityDealt) || state.communityDealt < 0 || state.communityDealt > 5) {
    return { ok: false, reason: "invalid_community_dealt" };
  }

  let holeCardsByUserId;
  try {
    const holeCards = await loadHoleCardsByUserId(tx, {
      tableId,
      handId,
      activeUserIds: seatUserIdsInOrder,
      requiredUserIds: seatUserIdsInOrder,
      mode: "strict",
    });
    holeCardsByUserId = holeCards.holeCardsByUserId;
  } catch (error) {
    if (error?.message === "state_invalid") return { ok: false, reason: "hole_cards_state_invalid" };
    if (isHoleCardsTableMissing(error)) return { ok: false, reason: "hole_cards_table_missing" };
    throw error;
  }

  let derivedCommunity;
  let derivedDeck;
  try {
    derivedCommunity = deriveCommunityCards({
      handSeed,
      seatUserIdsInOrder,
      communityDealt: state.communityDealt,
    });
    derivedDeck = deriveRemainingDeck({
      handSeed,
      seatUserIdsInOrder,
      communityDealt: state.communityDealt,
    });
  } catch {
    return { ok: false, reason: "derive_failed" };
  }

  return {
    ok: true,
    privateState: {
      ...state,
      community: derivedCommunity,
      deck: derivedDeck,
      holeCardsByUserId,
    },
  };
};

const executePostLeaveBotAutoplayLoop = async ({
  tx,
  tableId,
  userId,
  requestId,
  state,
  version,
  seatBotMap,
  seatUserIdsInOrder,
  mutate,
  validatePersistedState,
  botsOnlyInHand,
}) => {
  if (!isActionPhase(state?.phase)) {
    return { state, version, attempted: false, reason: "not_applicable" };
  }
  const hasBotTurn = isBotTurn(state?.turnUserId, seatBotMap);
  if (!hasBotTurn && !botsOnlyInHand) {
    return { state, version, attempted: false, reason: "not_applicable" };
  }

  const fallbackBotTurnUserId = !hasBotTurn && botsOnlyInHand
    ? selectFallbackBotTurnUserId(state, seatUserIdsInOrder, seatBotMap)
    : null;
  if (!hasBotTurn && botsOnlyInHand && !fallbackBotTurnUserId) {
    klog("poker_leave_autoplay_skipped", {
      tableId,
      userId,
      reason: "no_eligible_bot_turn",
      hasDeck: false,
      hasHoleCards: false,
      seats: Array.isArray(state?.seats) ? state.seats.length : null,
    });
    return { state, version, attempted: true, reason: "no_eligible_bot_turn" };
  }
  const autoplayStartState = fallbackBotTurnUserId ? { ...state, turnUserId: fallbackBotTurnUserId } : state;

  const privateStateResult = await maybeBuildPrivateStateForBotAutoplay({ tx, tableId, state: autoplayStartState, seatUserIdsInOrder });
  if (!privateStateResult.ok) {
    klog("poker_leave_autoplay_skipped", {
      tableId,
      userId,
      reason: privateStateResult.reason,
      hasDeck: false,
      hasHoleCards: false,
      seats: Array.isArray(state?.seats) ? state.seats.length : null,
    });
    return { state, version, attempted: true, reason: privateStateResult.reason };
  }

  const botLoop = await runBotAutoplayLoop({
    tableId,
    requestId: `bot-auto:post-leave:${requestId || "no-request-id"}`,
    initialState: autoplayStartState,
    initialPrivateState: privateStateResult.privateState,
    initialVersion: version,
    seatBotMap,
    seatUserIdsInOrder,
    maxActions: BOT_AUTOPLAY_MAX_ACTIONS,
    botsOnlyHandCompletionHardCap: BOT_AUTOPLAY_BOTS_ONLY_HARD_CAP,
    policyVersion: "leave-v1",
    klog,
    isActionPhase,
    advanceIfNeeded,
    buildPersistedFromPrivateState,
    persistStep: async ({ botTurnUserId, botAction, botRequestId, fromState, persistedState, privateState, loopVersion }) => {
      validatePersistedState(persistedState);
      const updateResult = await updatePokerStateOptimistic(tx, {
        tableId,
        expectedVersion: loopVersion,
        nextState: persistedState,
      });
      if (!updateResult.ok) {
        return { ok: false, reason: updateResult.reason === "conflict" ? "optimistic_conflict" : "update_failed" };
      }

      mutate();
      const botActionHandId = typeof persistedState.handId === "string" && persistedState.handId.trim() ? persistedState.handId.trim() : null;
      await tx.unsafe(
        "insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);",
        [
          tableId,
          updateResult.newVersion,
          botTurnUserId,
          botAction.type,
          botAction.amount ?? null,
          botActionHandId,
          botRequestId,
          fromState.phase || null,
          persistedState.phase || null,
          JSON.stringify({ actor: "BOT", botUserId: botTurnUserId, policyVersion: "leave-v1", reason: "AUTO_TURN" }),
        ]
      );
      return {
        ok: true,
        loopVersion: updateResult.newVersion,
        responseFinalState: persistedState,
        loopPrivateState: privateState,
      };
    },
  });

  klog("poker_leave_bot_autoplay_stop", {
    tableId,
    userId,
    requestId: requestId || null,
    botActionCount: botLoop.botActionCount,
    botStopReason: botLoop.botStopReason,
  });

  return {
    state: sanitizePersistedState(botLoop.responseFinalState),
    version: botLoop.loopVersion,
    attempted: true,
    reason: botLoop.botStopReason,
  };
};

const buildAlreadyLeftResultPayload = ({ tableId, seatNo, includeState, state, userId }) => {
  const viewState = withoutPrivateState(sanitizeNoopResponseState(state, userId));
  return {
    ok: true,
    tableId,
    cashedOut: 0,
    seatNo: Number.isInteger(seatNo) ? seatNo : null,
    status: "already_left",
    ...(includeState
      ? {
          state: {
            version: null,
            viewOnly: true,
            state: viewState,
          },
          viewState,
        }
      : {}),
  };
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);

  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const parsed = parseBody(event.body);
  if (!parsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_json" }) };
  }

  const payload = parsed.value ?? {};
  if (payload && !isPlainObject(payload)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_payload" }) };
  }
  const includeState = payload?.includeState === true;

  const tableIdValue = payload?.tableId;
  const tableIdRaw = typeof tableIdValue === "string" ? tableIdValue : "";
  const tableId = typeof tableIdValue === "string" ? tableIdValue.trim() : "";
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const requestIdValue = payload?.requestId;
  const requestIdTrimmed = typeof requestIdValue === "string" ? requestIdValue.trim() : "";
  const requestIdPresent = requestIdTrimmed !== "";
  const requestIdParsed = normalizeRequestId(payload?.requestId, { maxLen: 200 });
  if (!requestIdParsed.ok) {
    const requestIdType = typeof requestIdValue;
    const requestIdPreview = requestIdTrimmed ? requestIdTrimmed.slice(0, 50) : null;
    klog("poker_request_id_invalid", {
      fn: "leave",
      tableId,
      requestIdType,
      requestIdPreview,
      requestIdPresent,
      reason: "normalize_failed",
    });
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_request_id" }) };
  }
  const parsedRequestId = requestIdParsed.value;
  const normalizedRequestId =
    typeof parsedRequestId === "string" && parsedRequestId.trim() ? parsedRequestId.trim() : null;

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  const userId = auth.userId || null;
  klog("poker_leave_start", {
    tableId,
    tableIdRaw: tableIdRaw || null,
    userId,
    hasAuth: !!(auth.valid && auth.userId),
    requestIdPresent,
  });

  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    let txId = null;
    const result = await beginSql(async (tx) => {
      let mutated = false;
      let requestInfo = { status: "none" };
      if (normalizedRequestId) {
        requestInfo = await ensurePokerRequest(tx, {
          tableId,
          userId: auth.userId,
          requestId: normalizedRequestId,
          kind: "LEAVE",
          pendingStaleSec: REQUEST_PENDING_STALE_SEC,
        });
        if (requestInfo.status === "stored") return requestInfo.result;
        if (requestInfo.status === "pending") return { ok: false, pending: true, requestId: normalizedRequestId };
      }

      try {
        const tableRows = await tx.unsafe("select id, status from public.poker_tables where id = $1 for update;", [tableId]);
        const table = tableRows?.[0] || null;
        if (!table) {
          throw makeError(404, "table_not_found");
        }

        const stateRows = await tx.unsafe(
          "select version, state from public.poker_state where table_id = $1 for update;",
          [tableId]
        );
        const stateRow = stateRows?.[0] || null;
        if (!stateRow) {
          throw new Error("poker_state_missing");
        }
        const expectedVersion = Number(stateRow.version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
          throw makeError(409, "state_invalid");
        }

        const currentState = normalizeState(stateRow.state);
        const stacks = parseStacks(currentState.stacks);
        const seatsBefore = parseSeats(currentState.seats);
        const alreadyLeft =
          !seatsBefore.some((seat) => seat?.userId === auth.userId) &&
          !Object.prototype.hasOwnProperty.call(stacks, auth.userId);

        const seatRows = await tx.unsafe(
          "select seat_no, status, stack from public.poker_seats where table_id = $1 and user_id = $2 for update;",
          [tableId, auth.userId]
        );
        const seatRow = seatRows?.[0] || null;
        const seatNo = seatRow?.seat_no;
        if (alreadyLeft) {
          if (seatRow) {
            await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
              tableId,
              auth.userId,
            ]);
            mutated = true;
            await tx.unsafe(
              "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
              [tableId]
            );
          }
          const resultPayload = buildAlreadyLeftResultPayload({
            tableId,
            seatNo,
            includeState,
            state: currentState,
            userId: auth.userId,
          });
          if (normalizedRequestId) {
            await storePokerRequestResult(tx, {
              tableId,
              userId: auth.userId,
              requestId: normalizedRequestId,
              kind: "LEAVE",
              result: resultPayload,
            });
          }
          return resultPayload;
        }
        const rawSeatStack = seatRow ? seatRow.stack : null;
        const stackValue = normalizeSeatStack(rawSeatStack);
        const stateStackRaw = currentState?.stacks?.[auth.userId];
        const stateStack = normalizeNonNegativeInt(Number(stateStackRaw));
        const seatStack = normalizeNonNegativeInt(Number(rawSeatStack));
        const cashOutAmount = stateStack ?? seatStack ?? 0;
        const isStackMissing = rawSeatStack == null;
        if (isStackMissing) {
          klog("poker_leave_stack_missing", { tableId, userId: auth.userId, seatNo });
        }
        if (stackValue != null && stackValue < 0) {
          klog("poker_leave_stack_negative", { tableId, userId: auth.userId, seatNo, stack: stackValue });
        }

        const reducerRequestId = normalizedRequestId || undefined;
        let leaveApplied = null;
        try {
          leaveApplied = applyLeaveTable(currentState, { userId: auth.userId, requestId: reducerRequestId });
        } catch (error) {
          const isInvalidPlayer = isInvalidPlayerLeaveNoop(error);
          klog("poker_leave_reducer_throw", {
            tableId,
            userId: auth.userId,
            requestId: reducerRequestId || null,
            message: error?.message || "unknown_error",
            code: error?.code || null,
            noop: isInvalidPlayer,
          });
          if (isInvalidPlayer && alreadyLeft) {
            if (seatRow) {
              await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
                tableId,
                auth.userId,
              ]);
            }
            const resultPayload = buildAlreadyLeftResultPayload({
              tableId,
              seatNo,
              includeState,
              state: currentState,
              userId: auth.userId,
            });
            if (normalizedRequestId) {
              await storePokerRequestResult(tx, {
                tableId,
                userId: auth.userId,
                requestId: normalizedRequestId,
                kind: "LEAVE",
                result: resultPayload,
              });
            }
            klog("poker_leave_already_left_noop", {
              tableId,
              userId: auth.userId,
              requestId: normalizedRequestId || null,
              reason: "invalid_player",
            });
            return resultPayload;
          }
          throw makeError(409, "state_invalid");
        }

        if (!isPlainObject(leaveApplied?.state)) {
          klog("poker_leave_invalid_reducer_state", { tableId, userId: auth.userId, hasState: leaveApplied?.state != null });
          throw makeError(409, "state_invalid");
        }

        const leaveState = normalizeState(leaveApplied.state);
        const leavePhase = typeof leaveState.phase === "string" ? leaveState.phase : "";
        const hasActiveHandId = typeof leaveState.handId === "string" && leaveState.handId.trim() !== "";
        const isActiveHandPhase = ["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"].includes(leavePhase);
        const hasAnyActiveHandSignal = hasActiveHandId || isActiveHandPhase;
        const shouldDetachSeatAndStack = true;

        if (cashOutAmount > 0) {
          const escrowSystemKey = `POKER_TABLE:${tableId}`;
          const idempotencyKey = normalizedRequestId
            ? `poker:leave:${tableId}:${auth.userId}:${normalizedRequestId}`
            : `poker:leave:${tableId}:${auth.userId}:${cashOutAmount}`;

          const txResult = await postTransaction({
            userId: auth.userId,
            txType: "TABLE_CASH_OUT",
            idempotencyKey,
            entries: [
              { accountType: "ESCROW", systemKey: escrowSystemKey, amount: -cashOutAmount },
              { accountType: "USER", amount: cashOutAmount },
            ],
            createdBy: auth.userId,
            tx,
          });
          txId = txResult?.transaction?.id || null;
          mutated = true;
        }
        klog("poker_leave_cashout", {
          tableId,
          userId: auth.userId,
          amount: shouldDetachSeatAndStack ? cashOutAmount : 0,
          seatNo,
          stackSource: stateStack != null ? "state" : seatStack != null ? "seat" : "none",
          hadStack: stackValue != null,
          deferred: !shouldDetachSeatAndStack,
        });

        const baseSeats = Array.isArray(leaveState.seats) ? leaveState.seats : parseSeats(currentState.seats);
        const baseStacks = isPlainObject(leaveState.stacks) ? leaveState.stacks : parseStacks(currentState.stacks);
        const seats = shouldDetachSeatAndStack
          ? parseSeats(baseSeats).filter((seatItem) => seatItem?.userId !== auth.userId)
          : parseSeats(baseSeats);
        const updatedStacks = parseStacks(baseStacks);
        const seatRetained = seats.some((seatItem) => seatItem?.userId === auth.userId);
        if (shouldDetachSeatAndStack) {
          delete updatedStacks[auth.userId];
        } else if (seatRetained) {
          const restoredStack = stateStack ?? seatStack;
          if (normalizeNonNegativeInt(restoredStack) != null && normalizeNonNegativeInt(updatedStacks[auth.userId]) == null) {
            updatedStacks[auth.userId] = restoredStack;
          }
        }

        const nextLeftTableByUserId = isPlainObject(leaveState.leftTableByUserId) ? { ...leaveState.leftTableByUserId } : {};
        nextLeftTableByUserId[auth.userId] = true;

        const updatedStateRaw = {
          ...leaveState,
          tableId: leaveState.tableId || tableId,
          seats,
          stacks: updatedStacks,
          leftTableByUserId: nextLeftTableByUserId,
          pot: Number.isFinite(leaveState.pot) ? leaveState.pot : 0,
          phase: leaveState.phase || "INIT",
        };
        const updatedState = sanitizePersistedState(updatedStateRaw);
        validatePersistedStateOrThrow(updatedState, makeError);

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
            klog("poker_leave_conflict", { tableId, userId: auth.userId, expectedVersion });
            throw makeError(409, "state_conflict");
          }
          throw makeError(409, "state_invalid");
        }
        mutated = true;

        let latestState = updatedState;
        let latestVersion = updateResult.newVersion;
        if (hasAnyActiveHandSignal) {
          const actionHandId = typeof leaveState.handId === "string" && leaveState.handId.trim() ? leaveState.handId.trim() : null;
          let leaveActionRows = [];
          if (normalizedRequestId) {
            leaveActionRows = await tx.unsafe(
              `insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta)
               select $1, $2, $3, $4, null, $5, $6, $7, $8, $9::jsonb
               where not exists (
                 select 1 from public.poker_actions
                 where table_id = $1 and user_id = $3 and action_type = $4 and request_id is not distinct from $6
               )
               returning id;`,
              [
                tableId,
                latestVersion,
                auth.userId,
                "LEAVE_TABLE",
                actionHandId,
                normalizedRequestId,
                currentState.phase || null,
                leaveState.phase || null,
                JSON.stringify({ source: "poker-leave" }),
              ]
            );
          } else {
            leaveActionRows = await tx.unsafe(
              `insert into public.poker_actions (table_id, version, user_id, action_type, amount, hand_id, request_id, phase_from, phase_to, meta)
               select $1, $2, $3, $4, null, $5, $6, $7, $8, $9::jsonb
               where not exists (
                 select 1 from public.poker_actions
                 where table_id = $1 and user_id = $3 and action_type = $4 and hand_id is not distinct from $5
               )
               returning id;`,
              [
                tableId,
                latestVersion,
                auth.userId,
                "LEAVE_TABLE",
                actionHandId,
                null,
                currentState.phase || null,
                leaveState.phase || null,
                JSON.stringify({ source: "poker-leave" }),
              ]
            );
          }
          if (Array.isArray(leaveActionRows) && leaveActionRows.length > 0) {
            mutated = true;
          }

          const leaveAdvanceEvents = [];
          const leaveAdvanced = runAdvanceLoop(latestState, null, leaveAdvanceEvents, advanceIfNeeded);
          latestState = sanitizePersistedState(leaveAdvanced.nextState);
          if (leaveAdvanceEvents.length > 0) {
            validatePersistedStateOrThrow(latestState, makeError);
            const advanceUpdateResult = await updatePokerStateOptimistic(tx, {
              tableId,
              expectedVersion: latestVersion,
              nextState: latestState,
            });
            if (!advanceUpdateResult.ok) {
              throw makeError(409, advanceUpdateResult.reason === "conflict" ? "state_conflict" : "state_invalid");
            }
            latestVersion = advanceUpdateResult.newVersion;
          }

          if (leaveAdvanceEvents.length > 0) {
            mutated = true;
            klog("poker_leave_advanced", {
              tableId,
              userId: auth.userId,
              advanceEvents: leaveAdvanceEvents.length,
            });
          }

          const activeSeatRows = await tx.unsafe(
            "select user_id, seat_no, is_bot from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
            [tableId]
          );
          const seatBotMap = buildSeatBotMap(activeSeatRows);
          const seatUserIdsInOrder = normalizeSeatOrderFromActiveSeatRows(activeSeatRows);
          const botsOnlyInHand = !hasParticipatingHumanInHand(latestState, seatBotMap);
          if (isBotTurn(latestState.turnUserId, seatBotMap) || botsOnlyInHand) {
            const autoplayResult = await executePostLeaveBotAutoplayLoop({
              tx,
              tableId,
              userId: auth.userId,
              requestId: normalizedRequestId,
              state: latestState,
              version: latestVersion,
              seatBotMap,
              seatUserIdsInOrder,
              mutate: () => {
                mutated = true;
              },
              validatePersistedState: (stateToValidate) => validatePersistedStateOrThrow(stateToValidate, makeError),
              botsOnlyInHand,
            });
            latestState = autoplayResult.state;
            latestVersion = autoplayResult.version;
          }
        }

        if (shouldDetachSeatAndStack) {
          await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
            tableId,
            auth.userId,
          ]);
        }

        if (mutated) {
          await tx.unsafe(
            "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
            [tableId]
          );
        }

        const publicState = withoutPrivateState(latestState);
        const responseState = sanitizeNoopResponseState(publicState, auth.userId);
        const resultPayload = {
          ok: true,
          tableId,
          cashedOut: shouldDetachSeatAndStack ? cashOutAmount : 0,
          seatNo: seatNo ?? null,
          ...(includeState
            ? {
                state: {
                  version: latestVersion,
                  state: responseState,
                },
              }
            : {}),
        };
        if (normalizedRequestId) {
          await storePokerRequestResult(tx, {
            tableId,
            userId: auth.userId,
            requestId: normalizedRequestId,
            kind: "LEAVE",
            result: resultPayload,
          });
        }
        klog("poker_leave_ok", {
          tableId,
          userId: auth.userId,
          requestId: normalizedRequestId || null,
          cashedOut: shouldDetachSeatAndStack && cashOutAmount > 0,
          txId,
        });
        return resultPayload;
      } catch (error) {
        if (normalizedRequestId && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: auth.userId, requestId: normalizedRequestId, kind: "LEAVE" });
        } else if (normalizedRequestId && mutated) {
          klog("poker_leave_request_retained", { tableId, userId: auth.userId, requestId: normalizedRequestId });
        }
        throw error;
      }
    });

    if (result?.pending) {
      return {
        statusCode: 202,
        headers: cors,
        body: JSON.stringify({ error: "request_pending", requestId: result.requestId || normalizedRequestId }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(result),
    };
  } catch (error) {
    if (error?.status && error?.code) {
      klog("poker_leave_error", {
        tableId,
        userId: auth.userId || null,
        code: error.code,
        message: error.message || null,
      });
      return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_leave_error", {
      tableId,
      userId: auth?.userId || null,
      code: error?.code || "server_error",
      message: error?.message || "unknown_error",
    });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
