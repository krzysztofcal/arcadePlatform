export function createReactionTimers({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pendingByTableBot = new Map();
  const turnByTableId = new Map();

  function clearEntry(map, tableId) {
    const entry = map.get(tableId);
    if (entry?.timer) clearTimer(entry.timer);
    map.delete(tableId);
  }

  function pendingKey(tableId, botUserId) {
    return `${tableId}:${botUserId}`;
  }

  function scheduleReaction({ tableId, botUserId, delayMs, validate, emit }) {
    const key = pendingKey(tableId, botUserId);
    if (pendingByTableBot.has(key)) return false;
    const timer = setTimer(() => {
      const pending = pendingByTableBot.get(key);
      if (!pending || pending.timer !== timer) return;
      pendingByTableBot.delete(key);
      if (validate() !== true) return;
      emit();
    }, delayMs);
    timer?.unref?.();
    pendingByTableBot.set(key, { tableId, timer });
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
    hasPendingReaction: (tableId, botUserId) => pendingByTableBot.has(pendingKey(tableId, botUserId)),
    scheduleReaction,
    scheduleTurnObserver,
    clearTurnObserver: (tableId) => clearEntry(turnByTableId, tableId),
    clearTable(tableId) {
      for (const [key, entry] of pendingByTableBot) {
        if (entry.tableId === tableId) clearEntry(pendingByTableBot, key);
      }
      clearEntry(turnByTableId, tableId);
    }
  });
}

export function shouldObservePersistedReactionMutation(persisted) {
  return persisted?.ok === true && persisted.outcome !== "durable_replay";
}
