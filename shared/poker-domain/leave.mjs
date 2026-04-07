import { postTransaction } from "../../netlify/functions/_shared/chips-ledger.mjs";
import { deletePokerRequest, ensurePokerRequest, storePokerRequestResult } from "../../netlify/functions/_shared/poker-idempotency.mjs";
import { updatePokerStateOptimistic } from "../../netlify/functions/_shared/poker-state-write.mjs";
import { advanceIfNeeded, applyLeaveTable } from "../../netlify/functions/_shared/poker-reducer.mjs";
import { isStateStorageValid, withoutPrivateState } from "../../netlify/functions/_shared/poker-state-utils.mjs";
import { buildSeatBotMap, isBotTurn } from "../../netlify/functions/_shared/poker-bots.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "../../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { hasParticipatingHumanInHand, runAdvanceLoop, runBotAutoplayLoop } from "../../netlify/functions/_shared/poker-autoplay.mjs";

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

const normalizeCardCodeForValidation = (cardCode) => {
  if (typeof cardCode !== "string") return null;
  const code = cardCode.trim().toUpperCase();
  if (!/^(10|[2-9TJQKA])[CDHS]$/.test(code)) return null;
  const suit = code.slice(-1);
  const rankCode = code.slice(0, -1);
  const rank = rankCode === "A"
    ? 14
    : rankCode === "K"
      ? 13
      : rankCode === "Q"
        ? 12
        : rankCode === "J"
          ? 11
          : rankCode === "T"
            ? 10
            : Number(rankCode);
  if (!Number.isInteger(rank) || rank < 2 || rank > 14) return null;
  return { r: rank, s: suit };
};

const normalizeStateForStorageValidation = (stateInput) => {
  if (!isPlainObjectValue(stateInput)) return stateInput;
  if (!Array.isArray(stateInput.community)) return stateInput;
  const normalizedCommunity = stateInput.community.map((card) =>
    typeof card === "string" ? normalizeCardCodeForValidation(card) : card
  );
  if (normalizedCommunity.some((card) => !card)) return stateInput;
  return { ...stateInput, community: normalizedCommunity };
};

const isHandScopedForStorageValidation = (state) => {
  const handId = typeof state?.handId === "string" ? state.handId.trim() : "";
  if (handId) return true;
  return false;
};

const validatePersistedStateOrThrow = (state, makeErrorFn) => {
  const normalizedState = normalizeStateForStorageValidation(state);
  const requireHandScopedData = isHandScopedForStorageValidation(state);
  if (!isStateStorageValid(normalizedState, {
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
  klog,
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


export async function executePokerLeave({ beginSql, tableId, userId, requestId = null, nowMs = Date.now(), klog, includeState = false }) {
  void nowMs;
  let txId = null;
  const result = await beginSql(async (tx) => {
      let mutated = false;
      let requestInfo = { status: "none" };
      if (requestId) {
        requestInfo = await ensurePokerRequest(tx, {
          tableId,
          userId: userId,
          requestId: requestId,
          kind: "LEAVE",
          pendingStaleSec: REQUEST_PENDING_STALE_SEC,
        });
        if (requestInfo.status === "stored") return requestInfo.result;
        if (requestInfo.status === "pending") return { ok: false, pending: true, requestId: requestId };
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
          !seatsBefore.some((seat) => seat?.userId === userId) &&
          !Object.prototype.hasOwnProperty.call(stacks, userId);

        const seatRows = await tx.unsafe(
          "select seat_no, status, stack from public.poker_seats where table_id = $1 and user_id = $2 for update;",
          [tableId, userId]
        );
        const seatRow = seatRows?.[0] || null;
        const seatNo = seatRow?.seat_no;
        if (alreadyLeft) {
          if (seatRow) {
            await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
              tableId,
              userId,
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
            userId: userId,
          });
          if (requestId) {
            await storePokerRequestResult(tx, {
              tableId,
              userId: userId,
              requestId: requestId,
              kind: "LEAVE",
              result: resultPayload,
            });
          }
          return resultPayload;
        }
        const rawSeatStack = seatRow ? seatRow.stack : null;
        const stackValue = normalizeSeatStack(rawSeatStack);
        const stateStackRaw = currentState?.stacks?.[userId];
        const stateStack = normalizeNonNegativeInt(Number(stateStackRaw));
        const seatStack = normalizeNonNegativeInt(Number(rawSeatStack));
        const cashOutAmount = stateStack ?? seatStack ?? 0;
        const isStackMissing = rawSeatStack == null;
        if (isStackMissing) {
          klog("poker_leave_stack_missing", { tableId, userId: userId, seatNo });
        }
        if (stackValue != null && stackValue < 0) {
          klog("poker_leave_stack_negative", { tableId, userId: userId, seatNo, stack: stackValue });
        }

        const reducerRequestId = requestId || undefined;
        let leaveApplied = null;
        try {
          leaveApplied = applyLeaveTable(currentState, { userId: userId, requestId: reducerRequestId });
        } catch (error) {
          const isInvalidPlayer = isInvalidPlayerLeaveNoop(error);
          klog("poker_leave_reducer_throw", {
            tableId,
            userId: userId,
            requestId: reducerRequestId || null,
            message: error?.message || "unknown_error",
            code: error?.code || null,
            noop: isInvalidPlayer,
          });
          if (isInvalidPlayer && alreadyLeft) {
            if (seatRow) {
              await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
                tableId,
                userId,
              ]);
            }
            const resultPayload = buildAlreadyLeftResultPayload({
              tableId,
              seatNo,
              includeState,
              state: currentState,
              userId: userId,
            });
            if (requestId) {
              await storePokerRequestResult(tx, {
                tableId,
                userId: userId,
                requestId: requestId,
                kind: "LEAVE",
                result: resultPayload,
              });
            }
            klog("poker_leave_already_left_noop", {
              tableId,
              userId: userId,
              requestId: requestId || null,
              reason: "invalid_player",
            });
            return resultPayload;
          }
          throw makeError(409, "state_invalid");
        }

        if (!isPlainObject(leaveApplied?.state)) {
          klog("poker_leave_invalid_reducer_state", { tableId, userId: userId, hasState: leaveApplied?.state != null });
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
          const idempotencyKey = requestId
            ? `poker:leave:${tableId}:${userId}:${requestId}`
            : `poker:leave:${tableId}:${userId}:${cashOutAmount}`;

          const txResult = await postTransaction({
            userId: userId,
            txType: "TABLE_CASH_OUT",
            idempotencyKey,
            entries: [
              { accountType: "ESCROW", systemKey: escrowSystemKey, amount: -cashOutAmount },
              { accountType: "USER", amount: cashOutAmount },
            ],
            createdBy: userId,
            tx,
          });
          txId = txResult?.transaction?.id || null;
          mutated = true;
        }
        klog("poker_leave_cashout", {
          tableId,
          userId: userId,
          amount: shouldDetachSeatAndStack ? cashOutAmount : 0,
          seatNo,
          stackSource: stateStack != null ? "state" : seatStack != null ? "seat" : "none",
          hadStack: stackValue != null,
          deferred: !shouldDetachSeatAndStack,
        });

        const baseSeats = Array.isArray(leaveState.seats) ? leaveState.seats : parseSeats(currentState.seats);
        const baseStacks = isPlainObject(leaveState.stacks) ? leaveState.stacks : parseStacks(currentState.stacks);
        const seats = shouldDetachSeatAndStack
          ? parseSeats(baseSeats).filter((seatItem) => seatItem?.userId !== userId)
          : parseSeats(baseSeats);
        const updatedStacks = parseStacks(baseStacks);
        const seatRetained = seats.some((seatItem) => seatItem?.userId === userId);
        if (shouldDetachSeatAndStack) {
          delete updatedStacks[userId];
        } else if (seatRetained) {
          const restoredStack = stateStack ?? seatStack;
          if (normalizeNonNegativeInt(restoredStack) != null && normalizeNonNegativeInt(updatedStacks[userId]) == null) {
            updatedStacks[userId] = restoredStack;
          }
        }

        const nextLeftTableByUserId = isPlainObject(leaveState.leftTableByUserId) ? { ...leaveState.leftTableByUserId } : {};
        nextLeftTableByUserId[userId] = true;

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
            klog("poker_leave_conflict", { tableId, userId: userId, expectedVersion });
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
          if (requestId) {
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
                userId,
                "LEAVE_TABLE",
                actionHandId,
                requestId,
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
                userId,
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
              userId: userId,
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
              userId: userId,
              requestId: requestId,
              state: latestState,
              version: latestVersion,
              seatBotMap,
              seatUserIdsInOrder,
              mutate: () => {
                mutated = true;
              },
              validatePersistedState: (stateToValidate) => validatePersistedStateOrThrow(stateToValidate, makeError),
              botsOnlyInHand,
              klog,
            });
            latestState = autoplayResult.state;
            latestVersion = autoplayResult.version;
          }
        }

        if (shouldDetachSeatAndStack) {
          await tx.unsafe("delete from public.poker_seats where table_id = $1 and user_id = $2;", [
            tableId,
            userId,
          ]);
        }

        if (mutated) {
          await tx.unsafe(
            "update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1;",
            [tableId]
          );
        }

        const publicState = withoutPrivateState(latestState);
        const responseState = sanitizeNoopResponseState(publicState, userId);
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
        if (requestId) {
          await storePokerRequestResult(tx, {
            tableId,
            userId: userId,
            requestId: requestId,
            kind: "LEAVE",
            result: resultPayload,
          });
        }
        klog("poker_leave_ok", {
          tableId,
          userId: userId,
          requestId: requestId || null,
          cashedOut: shouldDetachSeatAndStack && cashOutAmount > 0,
          txId,
        });
        return resultPayload;
      } catch (error) {
        if (requestId && !mutated) {
          await deletePokerRequest(tx, { tableId, userId: userId, requestId: requestId, kind: "LEAVE" });
        } else if (requestId && mutated) {
          klog("poker_leave_request_retained", { tableId, userId: userId, requestId: requestId });
        }
        throw error;
      }
    });
  return result;
}
