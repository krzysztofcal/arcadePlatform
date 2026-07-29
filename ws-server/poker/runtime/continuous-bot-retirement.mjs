export function isManagedReplacementSeatProjectionConflict({
  managedContinuousTable,
  replacementFundingCount,
  persisted
} = {}) {
  return managedContinuousTable === true
    && Number(replacementFundingCount) > 0
    && persisted?.reason === "replacement_seat_projection_conflict";
}

export async function retireManagedTableAfterReplacementConflict({
  tableId,
  generationKey,
  attempt,
  requestRetirement,
  markRetirementRequested = () => {},
  restoreTableFromPersisted,
  markTableRotationDue = () => {},
  scheduleSettledRolloverRetry,
  broadcastStateSnapshots,
  hasActiveHumanMember,
  hasConnectedHumanPresence,
  applyInactiveCleanupAndBroadcast
} = {}) {
  const persisted = await requestRetirement(tableId);
  if (!persisted?.ok) {
    return persisted || { ok: false, reason: "retirement_request_unavailable" };
  }

  markRetirementRequested(tableId);
  const restored = await restoreTableFromPersisted(tableId);
  if (!restored?.ok) {
    markTableRotationDue(tableId, Date.now());
    scheduleSettledRolloverRetry(tableId, generationKey, attempt + 1);
    return {
      ok: true,
      changed: false,
      deferred: true,
      reason: "managed_retirement_restore_pending",
      retryable: true
    };
  }
  broadcastStateSnapshots(tableId);

  if (hasActiveHumanMember(tableId) || hasConnectedHumanPresence(tableId)) {
    scheduleSettledRolloverRetry(tableId, generationKey, attempt + 1);
    return {
      ok: true,
      changed: false,
      deferred: true,
      reason: "managed_retirement_human_present",
      retryable: true
    };
  }

  return applyInactiveCleanupAndBroadcast({
    tableId,
    requestId: `continuous-bot-table-close:${tableId}`,
    logPrefix: "ws_continuous_bot_table_retirement"
  });
}
