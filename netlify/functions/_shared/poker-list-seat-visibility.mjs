import { normalizeJsonState } from "./poker-state-utils.mjs";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function shouldHideSeatRowFromReadModel(row) {
  const userId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
  if (!userId) return false;
  const state = normalizeJsonState(row?.state);
  const leftTableByUserId = state?.leftTableByUserId;
  return isPlainObject(leftTableByUserId) && leftTableByUserId[userId] === true;
}
