import { normalizeJsonState } from "./poker-state-utils.mjs";

const updatePokerStateLocked = async (tx, { tableId, nextState }) => {
  if (!tableId) return { ok: false, reason: "invalid" };
  if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
    return { ok: false, reason: "invalid" };
  }
  let payload;
  try {
    payload = JSON.stringify(nextState);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const rows = await tx.unsafe(
    "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1 returning version;",
    [tableId, payload]
  );
  const newVersion = Number(rows?.[0]?.version);
  if (!Number.isFinite(newVersion)) return { ok: false, reason: "not_found" };
  return { ok: true, newVersion };
};

const loadPokerStateForUpdate = async (tx, tableId) => {
  if (!tableId) return { ok: false, reason: "invalid" };
  const rows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 for update;", [tableId]);
  const row = rows?.[0] || null;
  if (!row) return { ok: false, reason: "not_found" };
  const version = Number(row.version);
  if (!Number.isInteger(version) || version < 0) return { ok: false, reason: "invalid" };
  return { ok: true, version, state: normalizeJsonState(row.state) };
};

export { loadPokerStateForUpdate, updatePokerStateLocked };
