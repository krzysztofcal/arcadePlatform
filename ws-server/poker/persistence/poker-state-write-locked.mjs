import { normalizeJsonState } from "../snapshot-runtime/poker-state-utils.mjs";

export async function updatePokerStateLocked(tx, { tableId, nextState }) {
  const klog = typeof tx?.klog === "function" ? tx.klog : () => {};
  if (!tableId) return { ok: false, reason: "invalid" };
  if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
    klog("ws_state_update_invalid", { reason: "invalid_state_payload" });
    return { ok: false, reason: "invalid" };
  }
  klog("ws_state_update_start", { tableId });
  let payload;
  try {
    payload = JSON.stringify(nextState);
  } catch {
    klog("ws_state_update_invalid", { reason: "state_not_serializable" });
    return { ok: false, reason: "invalid" };
  }
  const rows = await tx.unsafe(
    "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1 returning version;",
    [tableId, payload]
  );
  const newVersion = Number(rows?.[0]?.version);
  if (!Number.isInteger(newVersion) || newVersion <= 0) {
    klog("ws_state_update_invalid", { reason: rows?.length ? "invalid_version" : "not_found" });
    return { ok: false, reason: rows?.length ? "invalid" : "not_found" };
  }
  klog("ws_state_update_result", { newVersion });
  return { ok: true, newVersion };
}

export async function loadPokerStateForUpdate(tx, tableId) {
  if (!tableId) return { ok: false, reason: "invalid" };
  const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
  const row = rows?.[0] || null;
  if (!row) return { ok: false, reason: "not_found" };
  const version = Number(row.version);
  if (!Number.isInteger(version) || version < 0) return { ok: false, reason: "invalid" };
  return { ok: true, version, state: normalizeJsonState(row.state) };
}
