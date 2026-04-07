export async function handleLeaveCommand({
  frame,
  ws,
  connState,
  tableId,
  tableManager,
  loadAuthoritativeLeaveExecutor,
  sendCommandResult,
  broadcastStateSnapshots,
  broadcastTableState
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

    const leaveState = left?.state?.state && typeof left.state.state === "object" ? left.state.state : null;
    const synced = tableManager.syncAuthoritativeLeave({
      ws,
      userId: connState.session.userId,
      tableId,
      stateVersion: left?.state?.version ?? null,
      pokerState: leaveState
    });

    if (!synced || synced.ok !== true) {
      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "rejected",
        reason: synced?.code || "authoritative_state_invalid"
      });
      return;
    }

    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "accepted",
      reason: left?.status === "already_left" ? "already_left" : null
    });

    if (synced.changed) {
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
