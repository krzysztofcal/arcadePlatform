const MAX_STAKES = 1_000_000;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const normalizeInt = (value) => {
  if (value == null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return num;
};

const invalid = (reason, details = {}) => ({
  ok: false,
  error: "stakes_invalid",
  details: { reason, ...details },
});

const validateStakes = (stakes) => {
  if (!isPlainObject(stakes)) return invalid("stakes_not_object");
  const sb = normalizeInt(stakes.sb);
  const bb = normalizeInt(stakes.bb);
  if (sb == null || bb == null) return invalid("stakes_not_integer");
  if (sb < 0) return invalid("sb_negative");
  if (bb <= 0) return invalid("bb_non_positive");
  if (sb >= bb) return invalid("sb_not_less_than_bb");
  if (sb > MAX_STAKES || bb > MAX_STAKES) return invalid("stakes_too_large", { max: MAX_STAKES });
  return { ok: true, value: { sb, bb } };
};

const parseSlashStakes = (value) => {
  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const sb = normalizeInt(match[1]);
  const bb = normalizeInt(match[2]);
  return { sb, bb };
};

export const parseStakes = (raw) => {
  if (raw == null) return invalid("stakes_missing");
  if (isPlainObject(raw)) {
    return validateStakes(raw);
  }
  if (typeof raw !== "string") return invalid("stakes_not_object");
  const trimmed = raw.trim();
  if (!trimmed) return invalid("stakes_missing");

  const slashParsed = parseSlashStakes(trimmed);
  if (slashParsed) {
    return validateStakes(slashParsed);
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (isPlainObject(parsed)) return validateStakes(parsed);
    if (typeof parsed === "string") {
      const nested = parseSlashStakes(parsed.trim());
      if (nested) return validateStakes(nested);
    }
    return invalid("stakes_not_object");
  } catch (error) {
    return invalid("stakes_parse_failed");
  }
};

export const formatStakes = (stakes) => JSON.stringify({ sb: stakes.sb, bb: stakes.bb });
