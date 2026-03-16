function mapActReason(reason) {
  if (reason === "illegal_action") return "action_not_allowed";
  if (reason === "hand_mismatch") return "state_invalid";
  if (reason === "not_seated") return "state_invalid";
  return reason;
}

export async function handleActCommand({ frame, ws, connState, tableManager, ensureTableLoadedErrorMapper, sendError, sendCommandResult, persistMutatedState, restoreTableFromPersisted, broadcastResyncRequired, broadcastStateSnapshots }) {
  const tableId = frame.__resolvedTableId;
  const handId = typeof frame.payload?.handId === "string" ? frame.payload.handId.trim() : "";
  const action = typeof frame.payload?.action === "string" ? frame.payload.action.trim().toUpperCase() : "";
  const amount = frame.payload?.amount;

  if (!handId) {
    sendError(ws, connState, {
      code: "INVALID_COMMAND",
      message: "act requires payload.handId",
      requestId: frame.requestId ?? null
    });
    return;
  }

  if (!["FOLD", "CHECK", "CALL", "BET", "RAISE"].includes(action)) {
    sendError(ws, connState, {
      code: "INVALID_COMMAND",
      message: "act requires payload.action of fold/check/call/bet/raise",
      requestId: frame.requestId ?? null
    });
    return;
  }

  if ((action === "BET" || action === "RAISE") && !Number.isFinite(amount)) {
    sendError(ws, connState, {
      code: "INVALID_COMMAND",
      message: "act requires numeric payload.amount for bet/raise",
      requestId: frame.requestId ?? null
    });
    return;
  }

  const ensured = await tableManager.ensureTableLoaded(tableId);
  if (!ensured.ok) {
    const loadError = ensureTableLoadedErrorMapper(ensured);
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: loadError.message
    });
    return;
  }

  const result = tableManager.applyAction({
    tableId,
    handId,
    userId: connState.session.userId,
    requestId: frame.requestId,
    action,
    amount,
    nowIso: frame.ts
  });

  if (result.accepted && !result.replayed && result.changed) {
    const persisted = await persistMutatedState({
      tableId,
      expectedVersion: Number(result.stateVersion) - 1,
      mutationKind: "act"
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
  }

  sendCommandResult(ws, connState, {
    requestId: frame.requestId ?? null,
    tableId,
    status: result.accepted ? "accepted" : "rejected",
    reason: mapActReason(result.reason)
  });

  if (result.accepted && !result.replayed && result.changed) {
    broadcastStateSnapshots(tableId);
  }
}
