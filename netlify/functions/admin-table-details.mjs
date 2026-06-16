import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import {
  createTableMeta,
  evaluatePersistedTableSnapshot,
  fetchWsHealth,
  loadPersistedTableSnapshot,
  notFound,
  parseUuid,
  resolveEnvVisibility,
} from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";

function readTableId(event) {
  const qs = event.queryStringParameters || {};
  return parseUuid(qs.tableId, "invalid_table_id");
}

async function loadTableDetails(tableId, env = process.env) {
  const snapshot = await loadPersistedTableSnapshot(tableId);
  if (!snapshot?.table) {
    throw notFound("table_not_found", "table_not_found");
  }
  const [recentActions, recentCashouts, wsHealth] = await Promise.all([
    executeSql(
      `
select id, user_id, action_type, request_id, created_at, amount, hand_id, phase_from, phase_to, meta
from public.poker_actions
where table_id = $1::uuid
order by created_at desc, id desc
limit 12;
      `,
      [tableId],
    ),
    executeSql(
      `
select
  t.id as transaction_id,
  t.user_id::text as user_id,
  t.tx_type,
  t.reference,
  t.description,
  t.idempotency_key,
  t.metadata,
  t.created_at
from public.chips_transactions t
where t.tx_type = 'TABLE_CASH_OUT'
  and coalesce(t.metadata->>'tableId', '') = $1::text
order by t.created_at desc, t.id desc
limit 12;
      `,
      [tableId],
    ),
    fetchWsHealth(env),
  ]);
  const classification = evaluatePersistedTableSnapshot(snapshot, env);
  const meta = createTableMeta(snapshot);
  const state = snapshot.state && typeof snapshot.state === "object" ? snapshot.state : {};
  return {
    table: {
      tableId: meta.tableId,
      persistedStatus: meta.status,
      runtimeStatus: wsHealth.ok === true ? "healthy" : wsHealth.available ? "degraded" : "unknown",
      stakes: meta.stakes,
      stakesLabel: meta.stakesLabel,
      maxPlayers: meta.maxPlayers,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      lastActivityAt: meta.lastActivityAt,
      phase: meta.phase,
      turnUserId: meta.turnUserId,
      stateVersion: snapshot.stateVersion,
      handId: typeof state.handId === "string" ? state.handId : null,
      turnDeadlineAt: Number.isFinite(Number(state.turnDeadlineAt)) ? Number(state.turnDeadlineAt) : null,
      playerCount: meta.playerCount,
      humanCount: meta.humanCount,
      botCount: meta.botCount,
    },
    janitor: classification,
    seats: (snapshot.seats || []).map((seat) => ({
      userId: seat.user_id || null,
      seatNo: Number.isInteger(Number(seat.seat_no)) ? Number(seat.seat_no) : null,
      status: seat.status || null,
      isBot: seat.is_bot === true,
      botProfile: seat.bot_profile || null,
      leaveAfterHand: seat.leave_after_hand === true,
      stack: Number.isFinite(Number(seat.stack)) ? Number(seat.stack) : 0,
      lastSeenAt: seat.last_seen_at || null,
      joinedAt: seat.joined_at || seat.created_at || null,
    })),
    recentAdminActions: (Array.isArray(recentActions) ? recentActions : []).map((row) => ({
      id: row.id || null,
      userId: row.user_id || null,
      actionType: row.action_type || null,
      requestId: row.request_id || null,
      createdAt: row.created_at || null,
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
      handId: row.hand_id || null,
      phaseFrom: row.phase_from || null,
      phaseTo: row.phase_to || null,
      meta: row.meta || null,
    })),
    recentCleanupTransactions: (Array.isArray(recentCashouts) ? recentCashouts : []).map((row) => ({
      transactionId: row.transaction_id || null,
      userId: row.user_id || null,
      txType: row.tx_type || null,
      reference: row.reference || null,
      description: row.description || null,
      idempotencyKey: row.idempotency_key || null,
      createdAt: row.created_at || null,
      metadata: row.metadata || null,
    })),
    runtime: {
      wsHealth,
      env: resolveEnvVisibility(env),
    },
  };
}

function createAdminTableDetailsHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadDetails = deps.loadTableDetails || ((tableId) => loadTableDetails(tableId, env));
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
      const payload = await loadDetails(readTableId(event));
      return { statusCode: 200, headers: cors, body: JSON.stringify(payload) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400 || error?.status === 404) {
        return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminTableDetailsHandler();

export {
  createAdminTableDetailsHandler,
  handler,
  loadTableDetails,
};
