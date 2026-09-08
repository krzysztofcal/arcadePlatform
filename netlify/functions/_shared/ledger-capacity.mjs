const DEFAULT_LEDGER_DB_WARNING_MB = 800;

export function resolveLedgerDbWarningMb(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") return DEFAULT_LEDGER_DB_WARNING_MB;
  const num = Number(rawValue);
  // The env value is documented as a finite non-negative integer; a
  // non-integer value is treated as invalid rather than silently truncated.
  if (!Number.isInteger(num) || num < 0) return DEFAULT_LEDGER_DB_WARNING_MB;
  return num;
}

export async function loadLedgerCapacity(
  env,
  runSql,
  klog = () => {},
  { includeRowCounts = true } = {},
) {
  const warningMb = resolveLedgerDbWarningMb(env.ADMIN_LEDGER_DB_WARNING_MB);
  const warningThresholdBytes = warningMb * 1024 * 1024;
  const measuredAt = new Date().toISOString();
  try {
    const rowCountColumns = includeRowCounts
      ? `
  (select count(*) from public.chips_transactions) as tx_rows,
  (select count(*) from public.chips_entries)      as entry_rows,`
      : "";
    const rows = await runSql(
      `select
${rowCountColumns}
  (select pg_table_size('public.chips_transactions'))        as tx_table_bytes,
  (select pg_indexes_size('public.chips_transactions'))      as tx_index_bytes,
  (select pg_total_relation_size('public.chips_transactions')) as tx_total_bytes,
  (select pg_table_size('public.chips_entries'))             as entry_table_bytes,
  (select pg_indexes_size('public.chips_entries'))           as entry_index_bytes,
  (select pg_total_relation_size('public.chips_entries'))    as entry_total_bytes,
  (select pg_database_size(current_database()))              as db_total_bytes;`,
    );
    const row = rows?.[0] || {};
    const transactionTotalBytes = Number(row.tx_total_bytes);
    const entryTotalBytes = Number(row.entry_total_bytes);
    const dbTotalBytes = Number(row.db_total_bytes);
    const ledgerTotalBytes = Number.isSafeInteger(transactionTotalBytes) && Number.isSafeInteger(entryTotalBytes)
      ? transactionTotalBytes + entryTotalBytes
      : null;
    const ledgerSharePercent = Number.isSafeInteger(dbTotalBytes) && dbTotalBytes > 0 && Number.isSafeInteger(ledgerTotalBytes)
      ? Number(((ledgerTotalBytes / dbTotalBytes) * 100).toFixed(1))
      : null;
    const capacityStatus = warningThresholdBytes > 0 && Number.isSafeInteger(dbTotalBytes) && dbTotalBytes >= warningThresholdBytes
      ? "warning"
      : "OK";
    const result = {
      available: true,
      transactionRowCount: includeRowCounts ? Number(row.tx_rows) || 0 : null,
      entryRowCount: includeRowCounts ? Number(row.entry_rows) || 0 : null,
      transactionTableBytes: Number(row.tx_table_bytes) || 0,
      transactionIndexBytes: Number(row.tx_index_bytes) || 0,
      transactionTotalBytes: transactionTotalBytes || 0,
      entryTableBytes: Number(row.entry_table_bytes) || 0,
      entryIndexBytes: Number(row.entry_index_bytes) || 0,
      entryTotalBytes: entryTotalBytes || 0,
      ledgerTotalBytes: ledgerTotalBytes || 0,
      ledgerSharePercent,
      dbTotalBytes: dbTotalBytes || 0,
      capacityStatus,
      warningThresholdBytes,
      measuredAt,
    };
    klog("admin_ops_ledger_capacity", {
      databaseBytes: result.dbTotalBytes,
      ledgerBytes: result.ledgerTotalBytes,
      transactionRows: result.transactionRowCount,
      entryRows: result.entryRowCount,
      capacityStatus,
      warningThresholdBytes,
      measuredAt,
    });
    return result;
  } catch (error) {
    klog("admin_ops_ledger_capacity_failed", { reason: error?.code || "query_failed" });
    return {
      available: false,
      transactionRowCount: null,
      entryRowCount: null,
      transactionTableBytes: null,
      transactionIndexBytes: null,
      transactionTotalBytes: null,
      entryTableBytes: null,
      entryIndexBytes: null,
      entryTotalBytes: null,
      ledgerTotalBytes: null,
      ledgerSharePercent: null,
      dbTotalBytes: null,
      capacityStatus: null,
      warningThresholdBytes,
      measuredAt,
    };
  }
}
