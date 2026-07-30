export async function handleContinuousBotRotationAtSettled({
  tableId,
  tableMeta,
  phase,
  tableManager,
  continuousBotTableRepository,
  applyInactiveCleanupAndBroadcast,
  scheduleSettledRolloverRetry,
  generationKey,
  attempt = 0,
  nowMs = Date.now(),
  klog = () => {}
} = {}) {
  const managedContinuousTable = tableMeta?.lifecycleKind === "CONTINUOUS_BOT"
    && tableMeta?.managedProfileKey === "CONTINUOUS_BOT_DEFAULT";
  if (phase !== "SETTLED") {
    return { handled: false, managedContinuousTable, rotationDue: false };
  }
  const rotationDue = managedContinuousTable
    && Number.isFinite(tableMeta?.rotationDueAtMs)
    && tableMeta.rotationDueAtMs <= nowMs;
  if (managedContinuousTable) {
    klog("ws_continuous_bot_table_rotation_evaluated", {
      tableId,
      nowMs,
      lifecycleKind: tableMeta?.lifecycleKind,
      managedProfileKey: tableMeta?.managedProfileKey,
      rotationDueAtMs: tableMeta?.rotationDueAtMs,
      typeofRotationDueAtMs: typeof tableMeta?.rotationDueAtMs,
      isFiniteRotationDueAtMs: Number.isFinite(tableMeta?.rotationDueAtMs),
      managedContinuousTable,
      rotationDue,
      hasActiveHumanMember: tableManager.hasActiveHumanMember(tableId),
      hasConnectedHumanPresence: tableManager.hasConnectedHumanPresence(tableId)
    });
  }
  if (!rotationDue) {
    return { handled: false, managedContinuousTable, rotationDue: false };
  }

  const hasHuman = tableManager.hasActiveHumanMember(tableId)
    || tableManager.hasConnectedHumanPresence(tableId);
  if (hasHuman) {
    const profile = continuousBotTableRepository?.currentProfile?.();
    const postponeIntervalSeconds = Number(profile?.postponeIntervalSeconds);
    if (!Number.isInteger(postponeIntervalSeconds) || postponeIntervalSeconds < 30) {
      scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 });
      return {
        handled: true,
        result: { ok: false, changed: false, reason: "managed_profile_unavailable", retryable: true }
      };
    }
    const postponedDueAtMs = nowMs + postponeIntervalSeconds * 1_000;
    const postponed = await continuousBotTableRepository?.postponeRotation?.(
      tableId,
      new Date(postponedDueAtMs).toISOString()
    );
    if (postponed?.ok !== true) {
      scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 });
      return {
        handled: true,
        result: {
          ok: false,
          changed: false,
          reason: postponed?.reason || "rotation_postpone_failed",
          retryable: true
        }
      };
    }
    const runtimePostponed = tableManager.setTableRotationDueAt(
      tableId,
      postponed.rotationDueAt || postponedDueAtMs
    );
    if (runtimePostponed?.ok !== true) {
      scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 });
      return {
        handled: true,
        result: { ok: false, changed: false, reason: "rotation_runtime_sync_failed", retryable: true }
      };
    }
    klog("ws_continuous_bot_table_rotation_postponed", {
      tableId,
      postponeIntervalSeconds
    });
    return {
      handled: false,
      managedContinuousTable: true,
      rotationDue: false,
      postponed: true,
      rotationDueAtMs: runtimePostponed.rotationDueAtMs
    };
  }

  klog("ws_continuous_bot_table_rotation_started", { tableId, reason: "deadline" });
  const retired = await applyInactiveCleanupAndBroadcast({
    tableId,
    requestId: `continuous-bot-table-close:${tableId}`,
    logPrefix: "ws_continuous_bot_table_retirement"
  });
  if (retired?.closed === true) {
    klog("ws_continuous_bot_table_rotation_completed", { tableId });
  }
  return { handled: true, result: retired };
}
