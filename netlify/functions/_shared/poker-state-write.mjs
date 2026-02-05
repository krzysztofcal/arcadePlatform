import { normalizeJsonState } from "./poker-state-utils.mjs";

const stableStringify = (value) =>
  JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object" || Array.isArray(val)) return val;
    return Object.keys(val)
      .sort()
      .reduce((acc, key) => {
        acc[key] = val[key];
        return acc;
      }, {});
  });

export const updatePokerStateOptimistic = async (tx, { tableId, expectedVersion, nextState }) => {
  if (!tableId || !Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return { ok: false, reason: "invalid" };
  }
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
    "update public.poker_state set version = version + 1, state = $3::jsonb, updated_at = now() where table_id = $1 and version = $2 returning version;",
    [tableId, expectedVersion, payload]
  );
  const newVersion = Number(rows?.[0]?.version);
  if (!Number.isFinite(newVersion)) {
    const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [
      tableId,
    ]);
    const currentRow = stateRows?.[0];
    const currentVersion = Number(currentRow?.version);
    if (!currentRow) return { ok: false, reason: "not_found" };
    let currentState = normalizeJsonState(currentRow?.state);
    let matches = false;
    try {
      matches = stableStringify(currentState) === stableStringify(nextState);
    } catch {
      matches = false;
    }
    if (matches) {
      return { ok: true, newVersion: Number.isFinite(currentVersion) ? currentVersion : expectedVersion, alreadyApplied: true };
    }
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, newVersion };
};
