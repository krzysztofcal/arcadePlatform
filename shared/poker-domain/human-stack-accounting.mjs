function asState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function normalizeNonNegativeStack(value) {
  const stack = Number(value);
  return Number.isSafeInteger(stack) && stack >= 0 ? stack : null;
}

export function resolveAuthoritativeHumanStack({ state, userId } = {}) {
  const normalizedState = asState(state);
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  const stacks = asState(normalizedState?.stacks);
  if (!normalizedUserId || !stacks || !Object.prototype.hasOwnProperty.call(stacks, normalizedUserId)) {
    return { ok: false, reason: "stack_ambiguous", source: "ambiguous", amount: null };
  }
  const amount = normalizeNonNegativeStack(stacks[normalizedUserId]);
  if (amount === null) {
    return { ok: false, reason: "stack_ambiguous", source: "ambiguous", amount: null };
  }
  return { ok: true, reason: null, source: "authoritative_state", amount };
}

export function requireAuthoritativeHumanStack(args = {}) {
  const result = resolveAuthoritativeHumanStack(args);
  if (result.ok) return result;
  const error = new Error(result.reason);
  error.code = result.reason;
  error.status = 409;
  throw error;
}
