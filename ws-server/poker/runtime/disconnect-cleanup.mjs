export function createDisconnectCleanupRuntime({
  executeCleanup,
  listActiveSocketsForUser,
  socketMatchesTable,
  onChanged = () => {},
  klog = () => {}
} = {}) {
  const candidates = new Map();

  function key(tableId, userId) {
    return `${tableId}:${userId}`;
  }

  function enqueue({ tableId, userId }) {
    if (typeof tableId !== 'string' || !tableId) return false;
    if (typeof userId !== 'string' || !userId) return false;
    candidates.set(key(tableId, userId), { tableId, userId, enqueuedAt: Date.now() });
    return true;
  }

  async function sweep() {
    for (const candidate of [...candidates.values()]) {
      const activeSockets = typeof listActiveSocketsForUser === 'function' ? (listActiveSocketsForUser(candidate.userId) || []) : [];
      const hasLiveSocket = activeSockets.some((socket) => {
        if (typeof socketMatchesTable !== 'function') return false;
        return socketMatchesTable(socket, candidate.tableId);
      });
      if (hasLiveSocket) {
        candidates.delete(key(candidate.tableId, candidate.userId));
        continue;
      }

      const result = await executeCleanup({
        tableId: candidate.tableId,
        userId: candidate.userId,
        requestId: `ws-disconnect-cleanup:${candidate.tableId}:${candidate.userId}`
      });

      if (result?.ok && result?.protected) {
        klog('ws_disconnect_cleanup_protected', {
          tableId: candidate.tableId,
          userId: candidate.userId,
          status: result?.status || 'turn_protected'
        });
        continue;
      }
      if (result?.ok) {
        candidates.delete(key(candidate.tableId, candidate.userId));
        await onChanged(candidate.tableId, result);
        continue;
      }
      if (result?.retryable === false) {
        candidates.delete(key(candidate.tableId, candidate.userId));
        continue;
      }
      klog('ws_disconnect_cleanup_retry', {
        tableId: candidate.tableId,
        userId: candidate.userId,
        code: result?.code || 'unknown'
      });
    }
  }

  function size() {
    return candidates.size;
  }

  return { enqueue, sweep, size };
}
