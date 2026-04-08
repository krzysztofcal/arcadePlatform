export async function handleLeaveCommand({
  frame,
  ws,
  connState,
  tableId,
  tableManager,
  loadAuthoritativeLeaveExecutor,
  sendCommandResult,
  broadcastStateSnapshots,
  broadcastTableState,
  klog = () => {}
}) {
  try {
    const executeAuthoritativeLeave = await loadAuthoritativeLeaveExecutor();
    const left = await executeAuthoritativeLeave({
      tableId,
      userId: connState.session.userId,
      requestId: frame.requestId
    });

    if (!left?.ok) {
      if (left?.pending) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason: "request_pending"
        });
        return;
      }

      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: left?.code || left?.reason || "state_invalid"
      });
      return;
    }

    const restored = typeof tableManager?.buildAuthoritativeLeaveRestore === "function"
      ? tableManager.buildAuthoritativeLeaveRestore({
          tableId,
          userId: connState.session.userId,
          stateVersion: left?.state?.version ?? null,
          pokerState: left?.state?.state ?? null
        })
      : { ok: false, code: "authoritative_state_invalid" };
    if (!restored?.ok || !restored?.restoredTable) {
      klog("ws_leave_restore_rejected", {
        tableId,
        requestId: frame.requestId ?? null,
        reason: restored?.code || restored?.reason || "authoritative_state_invalid"
      });
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: restored?.code || restored?.reason || "authoritative_state_invalid"
      });
      return;
    }

    const applied = typeof tableManager?.restoreTableFromPersisted === "function"
      ? tableManager.restoreTableFromPersisted(tableId, restored.restoredTable)
      : { ok: false, reason: "authoritative_state_invalid" };
    if (!applied?.ok) {
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: applied?.code || applied?.reason || "authoritative_state_invalid"
      });
      return;
    }

    const detached = typeof tableManager?.leave === "function"
      ? tableManager.leave({
          ws,
          userId: connState.session.userId,
          tableId,
          requestId: frame.requestId
        })
      : { ok: true, changed: false };
    if (!detached?.ok) {
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: detached?.code || "state_invalid"
      });
      return;
    }

    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "accepted",
      reason: left?.status === "already_left" ? "already_left" : null
    });

    if (left?.status !== "already_left" || detached?.changed) {
      broadcastStateSnapshots(tableId);
      broadcastTableState(tableId);
    }
  } catch (error) {
    const reason = typeof error?.code === "string" ? error.code : "state_invalid";
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason
    });
  }
}
