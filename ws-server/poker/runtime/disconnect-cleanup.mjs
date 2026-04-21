export function createDisconnectCleanupRuntime({
  executeCleanup,
  listActiveSocketsForUser,
  socketMatchesTable,
  seatedReconnectGraceMs = 0,
  onChanged = () => {},
  klog = () => {},
  nowMs = () => Date.now()
} = {}) {
  const candidates = new Map();

  function key(tableId, userId) {
    return `${tableId}:${userId}`;
  }

  function enqueue({ tableId, userId }) {
    if (typeof tableId !== 'string' || !tableId) return false;
    if (typeof userId !== 'string' || !userId) return false;
    const existing = candidates.get(key(tableId, userId));
    const graceDelayMs = Number.isFinite(seatedReconnectGraceMs) && seatedReconnectGraceMs > 0
      ? Math.trunc(seatedReconnectGraceMs)
      : 0;
    const enqueuedAt = Number.isFinite(existing?.enqueuedAt) ? existing.enqueuedAt : nowMs();
    const retryNotBeforeMs = Number.isFinite(existing?.retryNotBeforeMs)
      ? existing.retryNotBeforeMs
      : (graceDelayMs > 0 ? enqueuedAt + graceDelayMs : null);
    candidates.set(key(tableId, userId), {
      tableId,
      userId,
      enqueuedAt,
      retryNotBeforeMs
    });
    return true;
  }

  async function sweep() {
    for (const candidate of [...candidates.values()]) {
      const currentNowMs = nowMs();
      const activeSockets = typeof listActiveSocketsForUser === 'function' ? (listActiveSocketsForUser(candidate.userId) || []) : [];
      const hasLiveSocket = activeSockets.some((socket) => {
        if (typeof socketMatchesTable !== 'function') return false;
        return socketMatchesTable(socket, candidate.tableId);
      });
      if (hasLiveSocket) {
        candidates.delete(key(candidate.tableId, candidate.userId));
        continue;
      }
      if (Number.isFinite(candidate.retryNotBeforeMs) && candidate.retryNotBeforeMs > currentNowMs) {
        continue;
      }

      const result = await executeCleanup({
        tableId: candidate.tableId,
        userId: candidate.userId,
        requestId: `ws-disconnect-cleanup:${candidate.tableId}:${candidate.userId}`
      });

      if (result?.ok && result?.protected) {
        if (Number.isFinite(seatedReconnectGraceMs) && seatedReconnectGraceMs > 0) {
          candidate.retryNotBeforeMs = currentNowMs + seatedReconnectGraceMs;
          candidates.set(key(candidate.tableId, candidate.userId), candidate);
        }
        klog('ws_disconnect_cleanup_protected', {
          tableId: candidate.tableId,
          userId: candidate.userId,
          status: result?.status || 'turn_protected'
        });
        continue;
      }
      if (result?.ok && result?.deferred) {
        if (Number.isFinite(seatedReconnectGraceMs) && seatedReconnectGraceMs > 0) {
          candidate.retryNotBeforeMs = currentNowMs + seatedReconnectGraceMs;
          candidates.set(key(candidate.tableId, candidate.userId), candidate);
        }
        klog('ws_disconnect_cleanup_deferred', {
          tableId: candidate.tableId,
          userId: candidate.userId,
          status: result?.status || 'deferred'
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
