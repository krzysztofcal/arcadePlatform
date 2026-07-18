import { createHash } from "node:crypto";

const HUMAN_ACTIONS = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE"]);
const AMOUNT_ACTIONS = new Set(["BET", "RAISE"]);

function normalizeRequiredString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeActionCommand({ tableId, userId, handId, action, amount } = {}) {
  const normalizedTableId = normalizeRequiredString(tableId);
  const normalizedUserId = normalizeRequiredString(userId);
  const normalizedHandId = normalizeRequiredString(handId);
  const normalizedAction = typeof action === "string" ? action.trim().toUpperCase() : "";
  if (!normalizedTableId || !normalizedUserId || !normalizedHandId || !HUMAN_ACTIONS.has(normalizedAction)) {
    return null;
  }
  let normalizedAmount = null;
  if (AMOUNT_ACTIONS.has(normalizedAction)) {
    if (!Number.isInteger(amount)) return null;
    normalizedAmount = amount;
  }
  return {
    kind: "ACT",
    tableId: normalizedTableId,
    userId: normalizedUserId,
    handId: normalizedHandId,
    action: normalizedAction,
    amount: normalizedAmount
  };
}

export function hashActionCommand(command) {
  const normalized = normalizeActionCommand(command);
  if (!normalized) return null;
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function projectDurableActionResult({ status, reason = null, handId, stateVersion } = {}) {
  const normalizedHandId = normalizeRequiredString(handId);
  const normalizedReason = reason === null || reason === undefined
    ? null
    : normalizeRequiredString(reason);
  if (status !== "accepted" || !normalizedHandId || !Number.isInteger(stateVersion) || stateVersion < 0) {
    return null;
  }
  if (reason !== null && reason !== undefined && !normalizedReason) return null;
  return { status: "accepted", reason: normalizedReason, handId: normalizedHandId, stateVersion };
}
