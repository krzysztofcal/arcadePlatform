export const normalizeRequestId = (value, options = {}) => {
  const maxLen = Number.isFinite(options.maxLen) ? options.maxLen : 200;
  if (value == null || value === "") return { ok: true, value: null };
  let normalized = value;
  if (typeof normalized === "number" && Number.isFinite(normalized)) {
    normalized = String(normalized);
  }
  if (typeof normalized !== "string") return { ok: false, value: null };
  const trimmed = normalized.trim();
  if (!trimmed) return { ok: false, value: null };
  if (trimmed.length > maxLen) return { ok: false, value: null };
  if (trimmed === "[object PointerEvent]") return { ok: false, value: null };
  return { ok: true, value: trimmed };
};
