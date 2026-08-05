export function createReactionTimers({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pendingByTableId = new Map();
  const turnByTableId = new Map();

  function clearEntry(map, tableId) {
    const entry = map.get(tableId);
    if (entry?.timer) clearTimer(entry.timer);
    map.delete(tableId);
  }

  function scheduleReaction({ tableId, delayMs, validate, emit }) {
    if (pendingByTableId.has(tableId)) return false;
    const timer = setTimer(() => {
      const pending = pendingByTableId.get(tableId);
      if (!pending || pending.timer !== timer) return;
      pendingByTableId.delete(tableId);
      if (validate() !== true) return;
      emit();
    }, delayMs);
    timer?.unref?.();
    pendingByTableId.set(tableId, { timer });
    return true;
  }

  function scheduleTurnObserver({ tableId, delayMs, validate, onDue }) {
    clearEntry(turnByTableId, tableId);
    if (!(delayMs > 0)) return false;
    const timer = setTimer(() => {
      const pending = turnByTableId.get(tableId);
      if (!pending || pending.timer !== timer) return;
      turnByTableId.delete(tableId);
      if (validate() !== true) return;
      onDue();
    }, delayMs);
    timer?.unref?.();
    turnByTableId.set(tableId, { timer });
    return true;
  }

  return Object.freeze({
    hasPendingReaction: (tableId) => pendingByTableId.has(tableId),
    scheduleReaction,
    scheduleTurnObserver,
    clearTurnObserver: (tableId) => clearEntry(turnByTableId, tableId),
    clearTable(tableId) {
      clearEntry(pendingByTableId, tableId);
      clearEntry(turnByTableId, tableId);
    }
  });
}

export function shouldObservePersistedReactionMutation(persisted) {
  return persisted?.ok === true && persisted.outcome !== "durable_replay";
}
