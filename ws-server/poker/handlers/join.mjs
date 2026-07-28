function parseJoinIntent(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const autoSeat = body.autoSeat === true || body.autoSeat === "true" || body.autoSeat === 1 || body.autoSeat === "1";

  const seatNoRaw = body.seatNo;
  const seatNoNum = Number(seatNoRaw);
  const seatNo = seatNoRaw === undefined || seatNoRaw === null ? null : (Number.isInteger(seatNoNum) && seatNoNum >= 1 ? seatNoNum : null);

  const preferredSeatRaw = body.preferredSeatNo;
  const preferredSeatNum = Number(preferredSeatRaw);
  const preferredSeatNo = preferredSeatRaw === undefined || preferredSeatRaw === null
    ? null
    : (Number.isInteger(preferredSeatNum) && preferredSeatNum >= 1 ? preferredSeatNum : null);

  const buyInRaw = body.buyIn;
  const buyInNum = Number(buyInRaw);
  const buyIn = buyInRaw === undefined || buyInRaw === null
    ? null
    : (Number.isInteger(buyInNum) && buyInNum > 0 ? buyInNum : null);

  if ((seatNoRaw !== undefined && seatNoRaw !== null && seatNo === null) || (preferredSeatRaw !== undefined && preferredSeatRaw !== null && preferredSeatNo === null)) {
    return { ok: false, code: "invalid_seat_no" };
  }
  if (buyInRaw !== undefined && buyInRaw !== null && buyIn === null) {
    return { ok: false, code: "invalid_buy_in" };
  }

  return {
    ok: true,
    intent: {
      seatNo,
      autoSeat,
      preferredSeatNo,
      buyIn
    }
  };
}


function normalizeAuthoritativeJoinReason(code) {
  if (code === "poker_state_missing" || code === "state_missing") return "state_missing";
  if (code === "duplicate_seat" || code === "seat_taken") return "seat_taken";
  return code || "authoritative_join_failed";
}

function classifyRestoreFailureAsMissingState(reason) {
  return ["state_missing", "poker_state_missing", "invalid_persisted_state"].includes(String(reason || ""));
}

function evaluateRestoredAuthoritativeState({ restoredTable, userId, seatNo, seededBots = [], expectedStateVersion = null }) {
  const coreState = restoredTable?.coreState && typeof restoredTable.coreState === "object" ? restoredTable.coreState : null;
  const seats = coreState?.seats && typeof coreState.seats === "object" && !Array.isArray(coreState.seats) ? coreState.seats : {};
  const stacks = coreState?.publicStacks && typeof coreState.publicStacks === "object" && !Array.isArray(coreState.publicStacks) ? coreState.publicStacks : {};
  const restoredVersion = Number(coreState?.version);
  const expectedVersionValid = Number.isInteger(restoredVersion)
    && restoredVersion > 0
    && (expectedStateVersion === null || restoredVersion === Number(expectedStateVersion));
  const humanSeatValid = Number(seats[userId]) === Number(seatNo);
  const humanStackValid = Number(stacks[userId]) > 0;
  const seededBotProjectionValid = seededBots.every((bot) => {
    const botUserId = typeof bot?.userId === "string" ? bot.userId : "";
    const botSeatNo = Number(bot?.seatNo);
    return Boolean(
      botUserId
      && Number.isInteger(botSeatNo)
      && botSeatNo >= 1
      && Number(seats[botUserId]) === botSeatNo
      && Number(stacks[botUserId]) > 0
    );
  });
  return {
    ok: expectedVersionValid && humanSeatValid && humanStackValid && seededBotProjectionValid,
    expectedVersionValid,
    humanSeatValid,
    humanStackValid,
    seededBotProjectionValid
  };
}

function restoredAuthoritativeValidationReason(validation) {
  if (validation?.expectedVersionValid !== true) return "restore_expected_version_invalid";
  if (validation?.humanSeatValid !== true) return "restore_human_seat_missing";
  if (validation?.humanStackValid !== true) return "restore_human_stack_missing";
  if (validation?.seededBotProjectionValid !== true) return "restore_seeded_bot_projection_invalid";
  return "restore_validation_failed";
}

import { recoverFromPersistConflict } from "../runtime/persist-conflict-recovery.mjs";

export async function handleJoinCommand({ frame, ws, connState, sessionStore, tableManager, ensureTableLoadedErrorMapper, restoreTableFromPersisted, persistMutatedState, broadcastResyncRequired, broadcastStateSnapshots, broadcastTableState, sendError, sendCommandResult, sendTableState, authoritativeJoinEnabled, observeOnlyJoinEnabled, persistedBootstrapEnabled, loadAuthoritativeJoinExecutor, scheduleBotStep = () => {}, klog = () => {}, klogVerbose = () => {}, verboseLogsEnabled = false }) {
  const tableId = frame.__resolvedTableId;
  const authoritativeJoinRequired = authoritativeJoinEnabled && !observeOnlyJoinEnabled;
  const parsedJoinIntent = parseJoinIntent(frame.payload);
  if (!parsedJoinIntent.ok) {
    sendError(ws, connState, {
      code: "INVALID_COMMAND",
      message: parsedJoinIntent.code,
      requestId: frame.requestId ?? null
    });
    return;
  }
  const joinIntent = parsedJoinIntent.intent;
  let authoritativeJoinResult = null;

  if (authoritativeJoinRequired && !persistedBootstrapEnabled) {
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: "temporarily_unavailable"
    });
    return;
  }

  if (authoritativeJoinRequired && persistedBootstrapEnabled) {
    const authoritativeJoinExecutor = await loadAuthoritativeJoinExecutor();
    const authoritativeJoinStartedAtMs = verboseLogsEnabled ? Date.now() : null;
    klogVerbose("ws_join_authoritative_start", () => ({
      tableId,
      requestId: frame.requestId ?? null
    }), { tableId });
    const authoritativeJoin = await authoritativeJoinExecutor({
      tableId,
      userId: connState.session.userId,
      requestId: frame.requestId ?? null,
      seatNo: joinIntent.seatNo,
      autoSeat: joinIntent.autoSeat,
      preferredSeatNo: joinIntent.preferredSeatNo,
      buyIn: joinIntent.buyIn
    });
    if (!authoritativeJoin?.ok) {
      let reason = normalizeAuthoritativeJoinReason(authoritativeJoin?.code);
      if (reason === "authoritative_join_failed") {
        const restored = await restoreTableFromPersisted(tableId);
        if (!restored?.ok && classifyRestoreFailureAsMissingState(restored?.reason || restored?.code)) {
          reason = "state_missing";
        }
      }
      klogVerbose("ws_join_authoritative_result", () => ({
        tableId,
        requestId: frame.requestId ?? null,
        ok: false,
        reason,
        durationMs: Math.max(0, Date.now() - authoritativeJoinStartedAtMs)
      }), { tableId });
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason
      });
      return;
    }
    klogVerbose("ws_join_authoritative_result", () => ({
      tableId,
      requestId: frame.requestId ?? null,
      ok: true,
      rejoin: authoritativeJoin?.rejoin === true,
      stateVersion: Number(authoritativeJoin?.snapshot?.stateVersion) || null,
      durationMs: Math.max(0, Date.now() - authoritativeJoinStartedAtMs)
    }), { tableId });
    authoritativeJoinResult = authoritativeJoin;
  }

  const ensured = await tableManager.ensureTableLoaded(tableId, { allowCreate: true });
  if (!ensured.ok) {
    const loadError = ensureTableLoadedErrorMapper(ensured);
    sendError(ws, connState, {
      code: loadError.code || "TABLE_BOOTSTRAP_FAILED",
      message: loadError.message || "table_load_failed",
      requestId: frame.requestId ?? null,
    });
    return;
  }

  if (authoritativeJoinRequired && persistedBootstrapEnabled) {
    const restored = await restoreTableFromPersisted(tableId);
    if (!restored.ok) {
      sendError(ws, connState, {
        code: "TABLE_BOOTSTRAP_FAILED",
        message: "authoritative_join_rehydrate_failed",
        requestId: frame.requestId ?? null,
      });
      return;
    }
    const restoredVersion = Number(restored?.restoredTable?.coreState?.version);
    const expectedVersionRaw = authoritativeJoinResult?.snapshot?.stateVersion ?? null;
    const expectedVersion = expectedVersionRaw === null || expectedVersionRaw === undefined ? null : Number(expectedVersionRaw);
    const seededBots = Array.isArray(authoritativeJoinResult?.seededBots) ? authoritativeJoinResult.seededBots : [];
    const restoreValidation = evaluateRestoredAuthoritativeState({
      restoredTable: restored?.restoredTable,
      userId: connState.session.userId,
      seatNo: authoritativeJoinResult?.seatNo,
      seededBots,
      expectedStateVersion: expectedVersionRaw
    });
    if (!restoreValidation.ok) {
      const validationReason = restoredAuthoritativeValidationReason(restoreValidation);
      klog("ws_join_restore_invalid", {
        tableId,
        requestId: frame.requestId ?? null,
        reason: "validation_failed",
        validationReason,
        restoredVersion: Number.isInteger(restoredVersion) ? restoredVersion : null,
        expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null,
        expectedVersionValid: restoreValidation.expectedVersionValid,
        humanSeatValid: restoreValidation.humanSeatValid,
        humanStackValid: restoreValidation.humanStackValid,
        seededBotProjectionValid: restoreValidation.seededBotProjectionValid
      });
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: "authoritative_state_invalid"
      });
      return;
    }
  }

  sessionStore.trackConnection({ ws, userId: connState.session.userId, sessionId: connState.session.sessionId });
  const joined = tableManager.join({
    ws,
    userId: connState.session.userId,
    tableId,
    requestId: frame.requestId,
    nowTs: Date.now(),
    seatNo: joinIntent.seatNo,
    autoSeat: joinIntent.autoSeat,
    preferredSeatNo: joinIntent.preferredSeatNo,
    buyIn: authoritativeJoinResult?.rejoin === true
      ? null
      : (authoritativeJoinResult?.stack ?? joinIntent.buyIn),
    authoritativeSeatNo: authoritativeJoinResult?.seatNo ?? null
  });
  if (!joined.ok) {
    klog("ws_join_attach_failed", {
      tableId,
      requestId: frame.requestId ?? null,
      code: joined?.code || "join_failed"
    });
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: joined.code || "join_failed"
    });
    return;
  }

  if (typeof tableManager.refreshPublicProfiles === "function") {
    await tableManager.refreshPublicProfiles(tableId);
  }

  const bootstrapExpectedVersion = tableManager.persistedStateVersion(tableId);
  const bootstrapped = tableManager.bootstrapHand(tableId, { nowMs: Date.now() });
  if (bootstrapped?.changed) {
    const persisted = await persistMutatedState({
      tableId,
      expectedVersion: bootstrapExpectedVersion,
      mutationKind: "bootstrap"
    });
    if (!persisted?.ok) {
      await recoverFromPersistConflict({
        tableId,
        restoreTableFromPersisted,
        broadcastStateSnapshots,
        broadcastResyncRequired
      });
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: persisted?.reason || "persist_failed"
      });
      return;
    }
  }

  sendCommandResult(ws, connState, {
    requestId: frame.requestId ?? null,
    tableId,
    status: "accepted",
    reason: joined.changed ? null : "already_joined"
  });

  const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
  sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: joined.tableState, tableSnapshot });

  if (joined.changed) {
    broadcastTableState(tableId, { excludeWs: ws });
  }
  if (bootstrapped?.changed) {
    broadcastStateSnapshots(tableId);
    try {
      scheduleBotStep({
        tableId,
        trigger: "join_bootstrap",
        requestId: frame.requestId ?? null,
        frameTs: frame.ts
      });
    } catch (error) {
      klog("ws_join_bootstrap_bot_autoplay_failed", {
        tableId,
        requestId: frame.requestId ?? null,
        message: error?.message || "unknown"
      });
    }
  }
}
