import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import {
  evaluatePersistedTableSnapshot,
  fetchWsHealth,
  loadPersistedTableSnapshots,
  resolveEnvVisibility,
  resolveJanitorConfig,
} from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";

async function loadPokerEscrowResidualSummary(runSql = executeSql) {
  try {
    const rows = await runSql(
      `
with poker_escrow as (
  select
    a.system_key,
    a.balance,
    a.updated_at as escrow_updated_at,
    substring(a.system_key from char_length('POKER_TABLE:') + 1) as table_id_text
  from public.chips_accounts a
  where a.account_type = 'ESCROW'
    and a.system_key like 'POKER_TABLE:%'
), problem_residuals as (
  select
    e.table_id_text as table_id,
    e.balance,
    case when t.id is null then 'ORPHANED' else t.status end as status,
    t.created_at as table_created_at,
    t.updated_at as table_updated_at,
    t.last_activity_at,
    e.escrow_updated_at
  from poker_escrow e
  left join public.poker_tables t on t.id::text = e.table_id_text
  where e.balance > 0
    and (t.status = 'CLOSED' or t.id is null)
), orphan_zero_balance_accounts as (
  select e.table_id_text, e.balance, e.escrow_updated_at
  from poker_escrow e
  left join public.poker_tables t on t.id::text = e.table_id_text
  where e.balance = 0
    and t.id is null
), completed_account_batches as (
  select
    batches.batch_id,
    batches.account_retirement_at,
    case
      when batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
        then array[batches.bot_only_table_id]::uuid[]
      else proofs.batch_table_ids
    end as table_ids
  from public.chips_ledger_archive_batches batches
  left join public.chips_legacy_stage_allowlist_proofs proofs
    on proofs.batch_id = batches.batch_id
   and batches.source_policy_id = 'legacy_stage_allowlist_v1'
  where batches.project_ref = 'krydukthwdvccggbyjfw'
    and batches.status = 'committed'
    and batches.format_version = 2
    and batches.source_policy_id in ('stage-ledger-bot-only-retention-7d-v1', 'legacy_stage_allowlist_v1')
    and batches.archive_proof_verified_at is not null
    and batches.pruned_at is not null
    and batches.registry_cleaned_at is not null
    and batches.destructive_go_at is not null
    and batches.destructive_go_batch_id = batches.batch_id
    and (batches.source_policy_id <> 'legacy_stage_allowlist_v1' or proofs.batch_id is not null)
), account_retirement_backlog as (
  select distinct orphan.table_id_text
  from orphan_zero_balance_accounts orphan
  join completed_account_batches batches on true
  cross join lateral unnest(batches.table_ids) as batch_table(table_id)
  where orphan.table_id_text = batch_table.table_id::text
    and batches.account_retirement_at is null
), limited_items as (
  select *
  from problem_residuals
  order by balance desc, escrow_updated_at desc, table_id asc
  limit 10
)
select
  (select count(*)::bigint from poker_escrow) as total_account_count,
  (select count(*)::bigint from problem_residuals where status = 'CLOSED') as closed_residual_table_count,
  coalesce((select sum(balance)::bigint from problem_residuals where status = 'CLOSED'), 0) as closed_residual_chips,
  (select count(*)::bigint from problem_residuals where status = 'ORPHANED') as orphan_residual_account_count,
  coalesce((select sum(balance)::bigint from problem_residuals where status = 'ORPHANED'), 0) as orphan_residual_chips,
  (select count(*)::bigint from problem_residuals) as problem_account_count,
  coalesce((select sum(balance)::bigint from problem_residuals), 0) as problem_chips,
  (select count(*)::bigint from orphan_zero_balance_accounts) as orphan_zero_balance_escrow_account_count,
  (select count(*)::bigint from account_retirement_backlog) as account_retirement_backlog_count,
  coalesce((select max(balance)::bigint from problem_residuals), 0) as largest_residual_chips,
  (select max(escrow_updated_at) from problem_residuals) as latest_escrow_update_at,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
      'tableId', table_id,
      'balance', balance,
      'status', status,
      'tableCreatedAt', table_created_at,
      'tableUpdatedAt', table_updated_at,
      'lastActivityAt', last_activity_at,
      'escrowUpdatedAt', escrow_updated_at
    ) order by balance desc, escrow_updated_at desc, table_id asc) from limited_items),
    '[]'::jsonb
  ) as items;
      `,
    );
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) {
      throw new Error("poker escrow summary returned no authoritative row");
    }
    const row = rows[0];
    return {
      available: true,
      totalAccountCount: Number(row.total_account_count || 0),
      closedResidualTableCount: Number(row.closed_residual_table_count || 0),
      closedResidualChips: Number(row.closed_residual_chips || 0),
      orphanResidualAccountCount: Number(row.orphan_residual_account_count || 0),
      orphanResidualChips: Number(row.orphan_residual_chips || 0),
      problemAccountCount: Number(row.problem_account_count || 0),
      problemChips: Number(row.problem_chips || 0),
      orphanZeroBalanceEscrowAccountCount: Number(row.orphan_zero_balance_escrow_account_count || 0),
      accountRetirementBacklogCount: Number(row.account_retirement_backlog_count || 0),
      largestResidualChips: Number(row.largest_residual_chips || 0),
      latestEscrowUpdateAt: row.latest_escrow_update_at || null,
      items: Array.isArray(row.items) ? row.items : [],
    };
  } catch (error) {
    klog("admin_ops_poker_escrow_residuals_failed", { reason: error?.code || "query_failed" });
    return {
      available: false,
      totalAccountCount: null,
      closedResidualTableCount: null,
      closedResidualChips: null,
      orphanResidualAccountCount: null,
      orphanResidualChips: null,
      problemAccountCount: null,
      problemChips: null,
      orphanZeroBalanceEscrowAccountCount: null,
      accountRetirementBacklogCount: null,
      largestResidualChips: null,
      latestEscrowUpdateAt: null,
      items: [],
    };
  }
}

const DEFAULT_LEDGER_DB_WARNING_MB = 800;

function resolveLedgerDbWarningMb(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") return DEFAULT_LEDGER_DB_WARNING_MB;
  const num = Number(rawValue);
  // The env value is documented as a finite non-negative integer; a
  // non-integer value is treated as invalid rather than silently truncated.
  if (!Number.isInteger(num) || num < 0) return DEFAULT_LEDGER_DB_WARNING_MB;
  return num;
}

async function loadLedgerCapacity(env = process.env, runSql = executeSql) {
  const warningMb = resolveLedgerDbWarningMb(env.ADMIN_LEDGER_DB_WARNING_MB);
  const warningThresholdBytes = warningMb * 1024 * 1024;
  const measuredAt = new Date().toISOString();
  try {
    const rows = await runSql(
      `select
  (select count(*) from public.chips_transactions) as tx_rows,
  (select count(*) from public.chips_entries)      as entry_rows,
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
      transactionRowCount: Number(row.tx_rows) || 0,
      entryRowCount: Number(row.entry_rows) || 0,
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

async function loadOpsSummary(env = process.env) {
  const janitorConfig = resolveJanitorConfig(env);
  const staleSeatCutoffIso = new Date(
    Date.now() - Math.max(janitorConfig.activeSeatFreshMs, janitorConfig.seatedReconnectGraceMs),
  ).toISOString();
  const idleThresholdMinutes = 15;
  const idleCutoffIso = new Date(Date.now() - idleThresholdMinutes * 60 * 1000).toISOString();
  const [openTableRows, statsRows, recentActions, recentCleanupTransactions, wsHealth, pokerEscrowResiduals, ledgerCapacity] = await Promise.all([
    executeSql("select id from public.poker_tables where status = 'OPEN' order by updated_at asc, id asc;"),
    executeSql(
      `
select
  count(*) filter (where status = 'OPEN') as open_table_count,
  count(*) filter (
    where status = 'OPEN'
      and coalesce(last_activity_at, updated_at, created_at) <= $1::timestamptz
  ) as stale_table_count
from public.poker_tables;
      `,
      [idleCutoffIso],
    ),
    executeSql(
      `
select id, table_id, user_id, action_type, request_id, created_at, meta
from public.poker_actions
where action_type like 'ADMIN_%'
order by created_at desc, id desc
limit 16;
      `,
    ),
    executeSql(
      `
select
  id as transaction_id,
  user_id::text as user_id,
  tx_type,
  idempotency_key,
  reference,
  description,
  metadata,
  created_at
from public.chips_transactions
where tx_type = 'TABLE_CASH_OUT'
  and (
    coalesce(metadata->>'reason', '') like 'ws_%'
    or coalesce(metadata->>'reason', '') = 'ADMIN_FORCE_CLOSE'
  )
order by created_at desc, id desc
limit 16;
      `,
    ),
    fetchWsHealth(env),
    loadPokerEscrowResidualSummary(),
    loadLedgerCapacity(env),
  ]);
  const openTableIds = (Array.isArray(openTableRows) ? openTableRows : []).map((row) => row.id).filter(Boolean);
  const snapshots = await loadPersistedTableSnapshots(openTableIds);
  let flaggedTableCount = 0;
  let staleHumanSeatCount = 0;
  for (const tableId of openTableIds) {
    const snapshot = snapshots.get(tableId);
    if (!snapshot?.table) continue;
    const classification = evaluatePersistedTableSnapshot(snapshot, env);
    if (classification?.healthy === false || (Array.isArray(classification?.concerns) && classification.concerns.length > 0)) {
      flaggedTableCount += 1;
    }
    staleHumanSeatCount += (snapshot.seats || []).filter((seat) => (
      String(seat?.status || "").toUpperCase() === "ACTIVE"
      && seat?.is_bot !== true
      && (!seat.last_seen_at || seat.last_seen_at <= staleSeatCutoffIso)
    )).length;
  }
  const envVisibility = resolveEnvVisibility(env);
  return {
    janitor: {
      openTableCount: Number(statsRows?.[0]?.open_table_count || 0),
      staleHumanSeatCount,
      staleOpenTableCount: Number(statsRows?.[0]?.stale_table_count || 0),
      flaggedTableCount,
      idleThresholdMinutes,
    },
    recentJanitorActivity: {
      adminActions: (Array.isArray(recentActions) ? recentActions : []).map((row) => ({
        id: row.id || null,
        tableId: row.table_id || null,
        userId: row.user_id || null,
        actionType: row.action_type || null,
        requestId: row.request_id || null,
        createdAt: row.created_at || null,
        meta: row.meta || null,
      })),
      cleanupTransactions: (Array.isArray(recentCleanupTransactions) ? recentCleanupTransactions : []).map((row) => ({
        transactionId: row.transaction_id || null,
        userId: row.user_id || null,
        txType: row.tx_type || null,
        idempotencyKey: row.idempotency_key || null,
        reference: row.reference || null,
        description: row.description || null,
        metadata: row.metadata || null,
        createdAt: row.created_at || null,
      })),
    },
    runtime: {
      buildId: envVisibility.buildId,
      chipsEnabled: envVisibility.chipsEnabled,
      adminUserIdsConfigured: envVisibility.adminUserIdsConfigured,
      janitorConfig: envVisibility.janitorConfig,
      wsHealth,
      healthy: envVisibility.chipsEnabled && envVisibility.adminUserIdsConfigured && wsHealth.ok !== false,
    },
    pokerEscrowResiduals,
    ledgerCapacity,
  };
}

function createAdminOpsSummaryHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadSummary = deps.loadOpsSummary || (() => loadOpsSummary(env));
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
    }
    try {
      await requireAdmin(event, env);
      return { statusCode: 200, headers: cors, body: JSON.stringify(await loadSummary()) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminOpsSummaryHandler();

export {
  createAdminOpsSummaryHandler,
  handler,
  loadLedgerCapacity,
  loadPokerEscrowResidualSummary,
  loadOpsSummary,
  resolveLedgerDbWarningMb,
};
