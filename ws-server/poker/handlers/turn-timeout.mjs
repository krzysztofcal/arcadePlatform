export async function handleTurnTimeoutCommand({
  tableId,
  nowMs = Date.now(),
  tableManager,
  persistMutatedState,
  restoreTableFromPersisted,
  broadcastResyncRequired,
  broadcastStateSnapshots,
  scheduleBotStep = () => {},
  klog = () => {}
}) {
  const result = tableManager.maybeApplyTurnTimeout({ tableId, nowMs });
  if (!result?.ok || !result.changed) {
    return result;
  }

  const persisted = await persistMutatedState({
    tableId,
    expectedVersion: Number(result.stateVersion) - 1,
    mutationKind: "timeout"
  });
  if (!persisted?.ok) {
    await restoreTableFromPersisted(tableId);
    broadcastResyncRequired(tableId, "persistence_conflict");
    return {
      ok: false,
      changed: false,
      reason: persisted?.reason || "persist_failed",
      stateVersion: result.stateVersion
    };
  }

  broadcastStateSnapshots(tableId);
  try {
    scheduleBotStep({
      tableId,
      trigger: "timeout",
      requestId: result.requestId ?? null,
      frameTs: null
    });
  } catch (error) {
    klog("ws_timeout_bot_autoplay_failed", {
      tableId,
      requestId: result.requestId ?? null,
      message: error?.message || "unknown"
    });
  }
  return result;
}
