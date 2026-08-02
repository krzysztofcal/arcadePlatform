const DEFAULT_SWEEP_MS = 10_000;

export function createContinuousBotTableSupervisor({
  repository,
  onCreatedTable = async () => {},
  onRetirementRequested = async () => {},
  onRotationScheduled = async () => {},
  klog = () => {},
  sweepMs = DEFAULT_SWEEP_MS
} = {}) {
  let timer = null;
  let running = false;
  let stopped = false;
  let lastSweepStartedAt = null;
  let lastSweepFinishedAt = null;
  let lastSweepResult = null;
  let lastError = null;
  const activatedTableIds = new Set();

  async function sweep() {
    if (running) return { ok: true, skipped: true, reason: "sweep_in_progress" };
    if (stopped) return { ok: true, skipped: true, reason: "supervisor_stopped" };
    running = true;
    lastSweepStartedAt = new Date().toISOString();
    try {
      const result = await repository.reconcile();
      if (!result?.ok) {
        lastError = { code: result?.reason || "reconcile_failed" };
        lastSweepResult = { ok: false, reason: result?.reason || "reconcile_failed" };
        return result;
      }
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
      for (const tableId of result.rotationScheduledTableIds || []) {
        await onRotationScheduled({
          tableId,
          profile: result.profile,
          rotationDueAt: result.rotationDueAtByTableId?.[tableId] || null
        });
      }
      for (const tableId of [...activatedTableIds]) {
        if (!active.has(tableId)) activatedTableIds.delete(tableId);
      }
      lastError = null;
      lastSweepResult = {
        ok: true,
        createdCount: Array.isArray(result.createdTableIds) ? result.createdTableIds.length : 0,
        retirementCount: Array.isArray(result.retirementTableIds) ? result.retirementTableIds.length : 0,
        rotationScheduledCount: Array.isArray(result.rotationScheduledTableIds)
          ? result.rotationScheduledTableIds.length
          : 0
      };
      return result;
    } catch (error) {
      const reason = error?.code || error?.message || "unknown";
      lastError = { code: String(reason).slice(0, 120) };
      lastSweepResult = { ok: false, reason: lastError.code };
      klog("ws_continuous_bot_table_supervisor_failed", { reason: lastError.code });
      return { ok: false, reason: lastError.code };
    } finally {
      running = false;
      lastSweepFinishedAt = new Date().toISOString();
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

  function status() {
    return {
      started: timer !== null && !stopped,
      sweepInProgress: running,
      lastSweepStartedAt,
      lastSweepFinishedAt,
      lastSweepResult,
      lastError
    };
  }

  return { start, stop, sweep, status };
}
