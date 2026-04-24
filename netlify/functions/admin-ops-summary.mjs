import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import {
  evaluatePersistedTableSnapshot,
  fetchWsHealth,
  loadPersistedTableSnapshots,
  resolveEnvVisibility,
  resolveJanitorConfig,
} from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";

async function loadOpsSummary(env = process.env) {
  const janitorConfig = resolveJanitorConfig(env);
  const staleSeatCutoffIso = new Date(
    Date.now() - Math.max(janitorConfig.activeSeatFreshMs, janitorConfig.seatedReconnectGraceMs),
  ).toISOString();
  const idleThresholdMinutes = 15;
  const idleCutoffIso = new Date(Date.now() - idleThresholdMinutes * 60 * 1000).toISOString();
  const [openTableRows, statsRows, recentActions, recentCleanupTransactions, wsHealth] = await Promise.all([
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
  };
}

function createAdminOpsSummaryHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadSummary = deps.loadOpsSummary || (() => loadOpsSummary(env));
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    }
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
  loadOpsSummary,
};
