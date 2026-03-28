function rejectMalformed(sendError, ws, connState, requestId, message) {
  sendError(ws, connState, {
    code: "INVALID_COMMAND",
    message,
    requestId
  });
}

function normalizeAction(value) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

export async function handleAct({
  frame,
  ws,
  connState,
  tableId,
  tableManager,
  sendError,
  sendCommandResult,
  persistMutatedState,
  restoreTableFromPersisted,
  broadcastResyncRequired,
  broadcastStateSnapshots
}) {
  const requestId = frame.requestId ?? null;
  const handId = typeof frame.payload?.handId === "string" ? frame.payload.handId.trim() : "";
  const action = normalizeAction(frame.payload?.action);
  const amount = frame.payload?.amount;

  if (!handId) {
    rejectMalformed(sendError, ws, connState, requestId, "act requires payload.handId");
    return;
  }

  if (!["FOLD", "CHECK", "CALL", "BET", "RAISE"].includes(action)) {
    rejectMalformed(sendError, ws, connState, requestId, "act requires payload.action of fold/check/call/bet/raise");
    return;
  }

  if ((action === "BET" || action === "RAISE") && !Number.isFinite(amount)) {
    rejectMalformed(sendError, ws, connState, requestId, "act requires numeric payload.amount for bet/raise");
    return;
  }

  const activeTableId = typeof tableManager.resolveConnectionTableId === "function"
    ? tableManager.resolveConnectionTableId({ ws })
    : null;
  if (activeTableId && activeTableId !== tableId) {
    sendCommandResult(ws, connState, {
      requestId,
      tableId,
      status: "rejected",
      reason: "wrong_table"
    });
    return;
  }

  const ensured = await tableManager.ensureTableLoaded(tableId);
  if (!ensured.ok) {
    sendCommandResult(ws, connState, {
      requestId,
      tableId,
      status: "rejected",
      reason: ensured.code
    });
    return;
  }

  const result = tableManager.applyAction({
    tableId,
    handId,
    userId: connState.session.userId,
    requestId,
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
        requestId,
        tableId,
        status: "rejected",
        reason: persisted?.reason || "persist_failed"
      });
      broadcastResyncRequired(tableId, "persistence_conflict");
      return;
    }
  }

  sendCommandResult(ws, connState, {
    requestId,
    tableId,
    status: result.accepted ? "accepted" : "rejected",
    reason: result.reason
  });

  if (result.accepted && !result.replayed && result.changed) {
    broadcastStateSnapshots(tableId);
  }
}
