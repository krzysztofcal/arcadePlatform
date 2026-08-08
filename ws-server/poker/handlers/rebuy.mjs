export async function handleRebuyCommand({
  frame,
  ws,
  connState,
  tableId,
  loadAuthoritativeRebuyExecutor,
  restoreTableFromPersisted,
  broadcastStateSnapshots,
  broadcastTableState,
  broadcastResyncRequired,
  sendCommandResult,
  scheduleBotStep = () => {},
  scheduleSettledRolloverIfSettled = () => {},
  klog = () => {}
}) {
  const amount = frame?.payload?.amount === undefined ? 100 : Number(frame.payload.amount);
  const executeAuthoritativeRebuy = await loadAuthoritativeRebuyExecutor();
  const rebuy = await executeAuthoritativeRebuy({
    tableId,
    userId: connState.session.userId,
    requestId: frame.requestId ?? null,
    amount
  });
  if (!rebuy?.ok) {
    sendCommandResult(ws, connState, {
      requestId: frame.requestId ?? null,
      tableId,
      status: "rejected",
      reason: rebuy?.code || "authoritative_rebuy_failed"
    });
    return;
  }

  const restored = await restoreTableFromPersisted(tableId);
  sendCommandResult(ws, connState, {
    requestId: frame.requestId ?? null,
    tableId,
    status: "accepted",
    reason: rebuy.replayed === true ? "already_applied" : null
  });
  if (!restored?.ok) {
    klog("ws_rebuy_runtime_restore_failed", {
      tableId,
      requestId: frame.requestId ?? null,
      stateVersion: rebuy.stateVersion ?? null,
      reason: restored?.reason || restored?.code || "restore_failed"
    });
    broadcastResyncRequired(tableId, "authoritative_rebuy_restore_failed");
    return;
  }

  // A rebuy during SETTLED changes the persisted state version, which is part
  // of the settled-rollover generation key. Re-arm the rollover timer for the
  // new generation while preserving the original reveal deadline, so the next
  // hand still starts on time and includes the re-funded player.
  try {
    scheduleSettledRolloverIfSettled(tableId);
  } catch (error) {
    klog("ws_rebuy_schedule_settled_rollover_failed", { tableId, requestId: frame.requestId ?? null, message: error?.message || "unknown" });
  }

  broadcastStateSnapshots(tableId);
  broadcastTableState(tableId);
  try {
    scheduleBotStep({
      tableId,
      trigger: "rebuy",
      requestId: frame.requestId ?? null,
      frameTs: frame.ts ?? null
    });
  } catch (error) {
    klog("ws_rebuy_schedule_bot_step_failed", { tableId, requestId: frame.requestId ?? null, message: error?.message || "unknown" });
  }
}
