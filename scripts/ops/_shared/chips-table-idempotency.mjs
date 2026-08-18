// Versioned, server-verifiable TABLE_* idempotency-key bindings.
//
// The PostgreSQL implementation in the bot-only retention migration is the
// authoritative write fence.  This small mirror is deliberately strict and
// is used by exporter/operator code to reject an artifact before it reaches
// Storage or the proof path.

export const TABLE_TRANSACTION_TYPES = Object.freeze([
  "TABLE_BUY_IN",
  "TABLE_CASH_OUT",
]);

export const TABLE_IDEMPOTENCY_KEY_FORMAT_VERSION = 1;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORMATS = Object.freeze([
  ["join-buyin", 1, "join-buyin"],
  ["bot-seed-buyin", 1, "bot-seed-buyin"],
  ["managed-bot-seed-buyin", 1, "managed-bot-seed-buyin"],
  ["poker:leave", 2, "poker:leave"],
  ["poker:inactive_cleanup", 2, "poker:inactive_cleanup"],
  ["poker:rebuy:v1", 3, "poker:rebuy:v1"],
  ["poker:deferred-leave:v1", 3, "poker:deferred-leave:v1"],
  ["poker:bot-terminal-cashout:v1", 3, "poker:bot-terminal-cashout:v1"],
  ["poker:human-terminal-cashout:v1", 3, "poker:human-terminal-cashout:v1"],
  ["poker:bot-replacement-buyin:v1", 3, "poker:bot-replacement-buyin:v1"],
  ["poker:managed-bot-top-up:v1", 3, "poker:managed-bot-top-up:v1"],
]);

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid_table_idempotency_key";
  return error;
}

function nonEmptySegments(parts, start) {
  return parts.length > start && parts.slice(start).every((part) => part.length > 0);
}

export function parseTableIdempotencyKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 240) throw invalid("TABLE idempotency key is empty or too long");
  const parts = key.split(":");
  for (const [format, tableIndex, prefix] of FORMATS) {
    if (!key.startsWith(`${prefix}:`)) continue;
    if (!nonEmptySegments(parts, tableIndex + 1)) throw invalid(`TABLE idempotency key has an incomplete ${format} suffix`);
    const tableId = parts[tableIndex]?.toLowerCase();
    if (!UUID_RE.test(tableId)) throw invalid(`TABLE idempotency key has an invalid table id for ${format}`);
    return Object.freeze({
      version: TABLE_IDEMPOTENCY_KEY_FORMAT_VERSION,
      format,
      tableId,
      key,
    });
  }
  throw invalid("TABLE idempotency key format is not supported");
}

export function tryParseTableIdempotencyKey(value) {
  try {
    return parseTableIdempotencyKey(value);
  } catch {
    return null;
  }
}

export function parseTableReference(value) {
  const reference = typeof value === "string" ? value.trim() : "";
  if (!reference) return null;
  const match = /^(?:table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):([^:]+)(?::|$)/i.exec(reference);
  if (!match) return null;
  const tableId = match[1].toLowerCase();
  if (!UUID_RE.test(tableId)) throw invalid("TABLE reference has an invalid table id");
  return tableId;
}

export function tableBindingFromMetadata(metadata) {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata.tableId;
  if (value == null || String(value).trim() === "") return null;
  const tableId = String(value).trim().toLowerCase();
  if (!UUID_RE.test(tableId)) throw invalid("TABLE metadata.tableId is invalid");
  return tableId;
}

export function assertTableBinding({ idempotencyKey, metadata = null, reference = null } = {}) {
  const parsed = parseTableIdempotencyKey(idempotencyKey);
  const bindings = new Set([parsed.tableId]);
  const metadataTableId = tableBindingFromMetadata(metadata);
  if (metadataTableId) bindings.add(metadataTableId);
  const referenceTableId = parseTableReference(reference);
  if (referenceTableId) bindings.add(referenceTableId);
  if (bindings.size !== 1) throw invalid("TABLE metadata/reference binding does not match idempotency key");
  return parsed;
}

export function isTableTransactionType(value) {
  return TABLE_TRANSACTION_TYPES.includes(String(value || "").trim().toUpperCase());
}
