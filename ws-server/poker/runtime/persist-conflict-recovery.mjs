export async function recoverFromPersistConflict({
  tableId,
  restoreTableFromPersisted,
  broadcastStateSnapshots = null,
  broadcastResyncRequired = null,
  resyncReason = "persistence_conflict"
}) {
  const restored = await restoreTableFromPersisted(tableId);
  if (restored?.ok) {
    if (typeof broadcastStateSnapshots === "function") {
      broadcastStateSnapshots(tableId);
    }
    return {
      ok: true,
      restored: true,
      restoreReason: null
    };
  }

  if (typeof broadcastResyncRequired === "function") {
    broadcastResyncRequired(tableId, resyncReason);
  }

  return {
    ok: false,
    restored: false,
    restoreReason: restored?.reason || "restore_failed"
  };
}
