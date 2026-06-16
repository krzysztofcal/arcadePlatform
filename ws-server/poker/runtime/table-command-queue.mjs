function noop() {}

export function createTableCommandQueue({ onError = noop } = {}) {
  const queueStateByTableId = new Map();

  function ensureQueueState(tableId) {
    if (!queueStateByTableId.has(tableId)) {
      queueStateByTableId.set(tableId, {
        tail: Promise.resolve(),
        pendingByKey: new Map(),
        activeCount: 0
      });
    }
    return queueStateByTableId.get(tableId);
  }

  function cleanupQueueState(tableId, state) {
    if (!state) return;
    if (state.activeCount !== 0) return;
    if (state.pendingByKey.size !== 0) return;
    queueStateByTableId.delete(tableId);
  }

  function enqueue({ tableId, run, dedupeKey = null }) {
    if (typeof tableId !== "string" || tableId.trim() === "") {
      throw new Error("table_command_queue_requires_table_id");
    }
    if (typeof run !== "function") {
      throw new Error("table_command_queue_requires_run");
    }

    const normalizedTableId = tableId.trim();
    const normalizedDedupeKey = typeof dedupeKey === "string" && dedupeKey.trim() ? dedupeKey.trim() : null;
    const state = ensureQueueState(normalizedTableId);

    if (normalizedDedupeKey && state.pendingByKey.has(normalizedDedupeKey)) {
      return state.pendingByKey.get(normalizedDedupeKey);
    }

    const execute = async () => {
      state.activeCount += 1;
      try {
        return await run();
      } finally {
        state.activeCount = Math.max(0, state.activeCount - 1);
        if (normalizedDedupeKey) {
          state.pendingByKey.delete(normalizedDedupeKey);
        }
        cleanupQueueState(normalizedTableId, state);
      }
    };

    const queuedPromise = state.tail.then(execute, execute);
    state.tail = queuedPromise.catch((error) => {
      onError(error, { tableId: normalizedTableId, dedupeKey: normalizedDedupeKey });
    });

    if (normalizedDedupeKey) {
      state.pendingByKey.set(normalizedDedupeKey, queuedPromise);
    }

    return queuedPromise;
  }

  return {
    enqueue
  };
}
