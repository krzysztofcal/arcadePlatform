import { recoverFromPersistConflict } from "../runtime/persist-conflict-recovery.mjs";

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
  let result;
  try {
    result = tableManager.maybeApplyTurnTimeout({ tableId, nowMs });
  } catch {
    result = { ok: false, changed: false, reason: "timeout_apply_failed", stateVersion: 0 };
  }
  if (!result?.ok) {
    await recoverFromPersistConflict({
      tableId,
      restoreTableFromPersisted,
      broadcastStateSnapshots,
      broadcastResyncRequired
    });
    return {
      ok: false,
      changed: false,
      reason: result?.reason || "timeout_apply_failed",
      stateVersion: result?.stateVersion ?? 0
    };
  }
  if (!result.changed) {
    return result;
  }

  const persisted = await persistMutatedState({
    tableId,
    expectedVersion: Number(result.stateVersion) - 1,
    mutationKind: "timeout"
  });
  if (!persisted?.ok) {
    await recoverFromPersistConflict({
      tableId,
      restoreTableFromPersisted,
      broadcastStateSnapshots,
      broadcastResyncRequired
    });
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
