import crypto from "node:crypto";

export const LEGACY_STAGE_ALLOWLIST_REGISTRY_TYPES = Object.freeze([
  "TABLE_BUY_IN",
  "TABLE_CASH_OUT",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function reject(code, fail) {
  if (typeof fail === "function") fail(code);
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function hashLegacyStageAllowlistRegistryKeys(keys) {
  if (!Array.isArray(keys)) throw new TypeError("registry keys must be an array");
  return crypto.createHash("sha256").update(`${keys.join("\n")}\n`).digest("hex");
}

export function legacyStageAllowlistRegistryPredicate(tableIdsParameter = "$1") {
  return `(registry.table_id = any(${tableIdsParameter}::uuid[])
         and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT'))`;
}

export function assertLegacyStageAllowlistRegistryRows(rows, {
  tableIds,
  expectedCount,
  expectedKeysSha256,
  fail,
} = {}) {
  if (!Array.isArray(rows)) reject("registry_rows_type", fail);
  if (!Array.isArray(tableIds)) reject("registry_table_ids_type", fail);

  const allowedTableIds = tableIds.map((id) => text(id).toLowerCase());
  if (allowedTableIds.length === 0
    || allowedTableIds.some((id) => !UUID_RE.test(id))
    || new Set(allowedTableIds).size !== allowedTableIds.length) {
    reject("registry_table_id_set", fail);
  }
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
    reject("registry_expected_count", fail);
  }
  if (!/^[0-9a-f]{64}$/.test(text(expectedKeysSha256))) {
    reject("registry_expected_hash", fail);
  }
  if (rows.length !== expectedCount) reject("registry_rows_count", fail);

  const allowed = new Set(allowedTableIds);
  const keys = rows.map((row) => text(row?.idempotency_key));
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
    reject("registry_key_set", fail);
  }
  if (hashLegacyStageAllowlistRegistryKeys([...keys].sort()) !== expectedKeysSha256) {
    reject("registry_keys_hash", fail);
  }

  const observedTableIds = new Set();
  for (const row of rows) {
    const tableId = text(row?.table_id).toLowerCase();
    observedTableIds.add(tableId);
    if (!UUID_RE.test(tableId) || !allowed.has(tableId)) reject("registry_table_id_set", fail);
    if (!UUID_RE.test(text(row?.transaction_id).toLowerCase())) reject("registry_transaction_id", fail);
    if (!LEGACY_STAGE_ALLOWLIST_REGISTRY_TYPES.includes(text(row?.tx_type))) {
      reject("registry_tx_type", fail);
    }
    if (row?.user_id !== null) reject("registry_user_id", fail);
    if (row?.archive_batch_id !== null) reject("registry_archive_batch_id", fail);
  }
  if (observedTableIds.size !== allowed.size
    || [...allowed].some((tableId) => !observedTableIds.has(tableId))) {
    reject("registry_table_id_set", fail);
  }

  return {
    keys: [...keys].sort(),
    keysSha256: hashLegacyStageAllowlistRegistryKeys([...keys].sort()),
    tableIds: [...observedTableIds].sort(),
  };
}
