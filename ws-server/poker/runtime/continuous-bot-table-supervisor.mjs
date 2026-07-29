const DEFAULT_SWEEP_MS = 10_000;

export function createContinuousBotTableSupervisor({
  repository,
  onCreatedTable = async () => {},
  onRetirementRequested = async () => {},
  klog = () => {},
  sweepMs = DEFAULT_SWEEP_MS
} = {}) {
  let timer = null;
  let running = false;
  let stopped = false;
  const activatedTableIds = new Set();

  async function sweep() {
    if (running || stopped) return { ok: true, skipped: true };
    running = true;
    try {
      const result = await repository.reconcile();
      if (!result?.ok) return result;
      const created = new Set(result.createdTableIds || []);
      const active = new Set(result.activeTableIds || []);
      for (const tableId of active) {
        if (activatedTableIds.has(tableId)) continue;
        const activated = await onCreatedTable({ tableId, profile: result.profile, created: created.has(tableId) });
        if (activated?.ok === true) activatedTableIds.add(tableId);
      }
      for (const tableId of result.retirementTableIds || []) {
        await onRetirementRequested({ tableId, profile: result.profile });
        activatedTableIds.delete(tableId);
      }
      for (const tableId of [...activatedTableIds]) {
        if (!active.has(tableId)) activatedTableIds.delete(tableId);
      }
      return result;
    } catch (error) {
      klog("ws_continuous_bot_table_supervisor_failed", { reason: error?.message || "unknown" });
      return { ok: false, reason: error?.message || "unknown" };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || stopped) return;
    void sweep();
    timer = setInterval(() => void sweep(), sweepMs);
    if (typeof timer?.unref === "function") timer.unref();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, sweep };
}
