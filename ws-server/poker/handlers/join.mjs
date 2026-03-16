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

export async function handleJoinCommand({ frame, ws, connState, sessionStore, tableManager, ensureTableLoadedErrorMapper, restoreTableFromPersisted, persistMutatedState, broadcastResyncRequired, broadcastStateSnapshots, broadcastTableState, sendError, sendCommandResult, sendTableState, authoritativeJoinEnabled, observeOnlyJoinEnabled, persistedBootstrapEnabled, loadAuthoritativeJoinExecutor }) {
  const tableId = frame.__resolvedTableId;
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

  if (authoritativeJoinEnabled && !observeOnlyJoinEnabled && persistedBootstrapEnabled) {
    const authoritativeJoinExecutor = await loadAuthoritativeJoinExecutor();
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
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason
      });
      return;
    }
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

  if (authoritativeJoinEnabled && !observeOnlyJoinEnabled && persistedBootstrapEnabled) {
    const restored = await restoreTableFromPersisted(tableId);
    if (!restored.ok) {
      sendError(ws, connState, {
        code: "TABLE_BOOTSTRAP_FAILED",
        message: "authoritative_join_rehydrate_failed",
        requestId: frame.requestId ?? null,
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
    buyIn: joinIntent.buyIn,
    authoritativeSeatNo: authoritativeJoinResult?.seatNo ?? null
  });
  if (!joined.ok) {
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: joined.code || "join_failed"
    });
    return;
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
      await restoreTableFromPersisted(tableId);
      broadcastResyncRequired(tableId, "persistence_conflict");
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: persisted?.reason || "persist_failed"
      });
      return;
    }
  }

  const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
  sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: joined.tableState, tableSnapshot });

  sendCommandResult(ws, connState, {
    requestId: frame.requestId ?? null,
    tableId,
    status: "accepted",
    reason: joined.changed ? null : "already_joined"
  });

  if (joined.changed) {
    broadcastTableState(tableId, { excludeWs: ws });
  }
  if (bootstrapped?.changed) {
    broadcastStateSnapshots(tableId);
  }
}
