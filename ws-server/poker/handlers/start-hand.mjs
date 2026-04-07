export async function handleStartHandCommand({ frame, ws, connState, tableManager, ensureTableLoadedErrorMapper, sendError, sendCommandResult, persistMutatedState, restoreTableFromPersisted, broadcastResyncRequired, broadcastStateSnapshots, runAcceptedBotAutoplay = async () => ({ ok: true, changed: false }), klog = () => {} }) {
  const tableId = frame.__resolvedTableId;
  const ensured = await tableManager.ensureTableLoaded(tableId);
  if (!ensured.ok) {
    const loadError = ensureTableLoadedErrorMapper(ensured);
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: loadError.code || "table_load_failed"
    });
    return;
  }


  const callerSnapshot = typeof tableManager.tableSnapshot === "function"
    ? tableManager.tableSnapshot(tableId, connState.session.userId)
    : null;
  const callerSeat = Number.isInteger(callerSnapshot?.youSeat) ? callerSnapshot.youSeat : null;
  if (!Number.isInteger(callerSeat)) {
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: "not_seated"
    });
    return;
  }

  const expectedVersion = tableManager.persistedStateVersion(tableId);
  const started = tableManager.bootstrapHand(tableId, { nowMs: Date.now() });
  if (!started?.ok) {
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: started?.code || "state_invalid"
    });
    return;
  }

  if (!started.changed) {
    const reason = started.bootstrap === "already_live" ? "already_live" : "not_enough_players";
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason
    });
    return;
  }

  const persisted = await persistMutatedState({
    tableId,
    expectedVersion,
    mutationKind: "start_hand"
  });
  if (!persisted?.ok) {
    await restoreTableFromPersisted(tableId);
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: persisted?.reason || "persist_failed"
    });
    broadcastResyncRequired(tableId, "persistence_conflict");
    return;
  }

  sendCommandResult(ws, connState, {
    requestId: frame.requestId ?? null,
    tableId,
    status: "accepted",
    reason: null
  });

  let autoplayResult = { ok: true };
  try {
    autoplayResult = await runAcceptedBotAutoplay({
      tableId,
      trigger: "start_hand",
      requestId: frame.requestId ?? null,
      frameTs: frame.ts
    });
  } catch (error) {
    autoplayResult = { ok: false, reason: error?.message || "autoplay_failed" };
    klog("ws_start_hand_bot_autoplay_failed", {
      tableId,
      requestId: frame.requestId ?? null,
      message: error?.message || "unknown"
    });
  }

  if (autoplayResult?.ok === false) {
    broadcastStateSnapshots(tableId);
    return;
  }

  broadcastStateSnapshots(tableId);
}
