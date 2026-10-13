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
  scheduleBotStep = () => {},
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
          pokerState: left?.state?.state ?? null,
          tableStatus: left?.tableStatus ?? null
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
      try {
        scheduleBotStep({
          tableId,
          trigger: "leave",
          requestId: frame.requestId ?? null,
          frameTs: frame.ts ?? null
        });
      } catch (error) {
        klog("ws_leave_schedule_bot_step_failed", {
          tableId,
          requestId: frame.requestId ?? null,
          message: error?.message || "unknown_error"
        });
      }
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

// Called only under existing per-table command ownership. The persisted tombstone
// survives process failure; the existing timeout sweep retries failed Leave/restore.
export async function reconcileInactivityEjectionsCommand({ tableId, tableManager,
  loadAuthoritativeLeaveExecutor, restoreTableFromPersisted, broadcastStateSnapshots,
  broadcastTableState, klog = () => {} }) {
  if (tableManager.isTableClosed(tableId)) return { ok: true };
  let state = tableManager.persistedPokerState(tableId);
  for (const [userId, intent] of Object.entries(state?.inactivityEjectionByUserId || {})) {
    if (state?.leftTableByUserId?.[userId] === true) continue;
    if (!state?.seats?.some(seat => seat?.userId === userId)
      && !Object.prototype.hasOwnProperty.call(state?.stacks || {}, userId)) continue;
    const executeLeave = await loadAuthoritativeLeaveExecutor();
    const result = await executeLeave({ tableId, userId,
      requestId: `inactivity:${tableId}:${intent.handId}:${userId}`, inactivityEjection: true });
    // Even after a lost response/retry, reload current persistence rather than
    // restoring an old idempotent result over a newer hand.
    const restored = await restoreTableFromPersisted(tableId);
    if (!restored?.ok || !result?.ok) {
      klog("ws_inactivity_ejection_pending", { tableId, userId, reason: result?.code || restored?.reason });
      broadcastStateSnapshots(tableId);
      return { ok: false, reason: result?.code || restored?.reason || "inactivity_pending" };
    }
    broadcastStateSnapshots(tableId);
    broadcastTableState(tableId);
    state = tableManager.persistedPokerState(tableId);
  }
  return { ok: true };
}
