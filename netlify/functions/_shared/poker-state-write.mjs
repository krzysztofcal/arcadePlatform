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
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, newVersion };
};
