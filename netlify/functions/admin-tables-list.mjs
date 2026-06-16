import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import {
  badRequest,
  buildPagination,
  createTableMeta,
  evaluatePersistedTableSnapshot,
  loadPersistedTableSnapshots,
  parseBoolFlag,
  parsePageLimit,
  parseTimestamp,
  resolveJanitorConfig,
} from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";
import { parseStakes } from "./_shared/poker-stakes.mjs";

const SORT_SQL = {
  last_activity_desc: "coalesce(last_activity_at, updated_at, created_at) desc, created_at desc",
  last_activity_asc: "coalesce(last_activity_at, updated_at, created_at) asc, created_at asc",
  created_at_desc: "created_at desc",
  created_at_asc: "created_at asc",
  player_count_desc: "player_count desc, coalesce(last_activity_at, updated_at, created_at) desc",
};

function parseSort(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "last_activity_desc";
  if (!Object.prototype.hasOwnProperty.call(SORT_SQL, normalized)) {
    throw badRequest("invalid_sort", "invalid_sort");
  }
  return normalized;
}

function parseStatus(value) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!normalized) return "OPEN";
  if (!["OPEN", "CLOSED", "ALL"].includes(normalized)) {
    throw badRequest("invalid_status", "invalid_status");
  }
  return normalized;
}

async function listTables(filters = {}, env = process.env) {
  const pageInfo = parsePageLimit(filters, { defaultLimit: 20, maxLimit: 100 });
  const sort = parseSort(filters.sort);
  const status = parseStatus(filters.status);
  const tableId = typeof filters.tableId === "string" ? filters.tableId.trim() : "";
  const phase = typeof filters.phase === "string" ? filters.phase.trim().toUpperCase() : "";
  const idleMinutes = filters.idleMinutes == null || filters.idleMinutes === ""
    ? null
    : Math.max(1, Math.min(10_000, Number.parseInt(String(filters.idleMinutes), 10)));
  if (filters.idleMinutes != null && filters.idleMinutes !== "" && !Number.isInteger(idleMinutes)) {
    throw badRequest("invalid_idle_minutes", "invalid_idle_minutes");
  }
  const hasActiveHumans = parseBoolFlag(filters.hasActiveHumans);
  const hasBotsOnly = parseBoolFlag(filters.hasBotsOnly);
  const hasStaleSeats = parseBoolFlag(filters.hasStaleSeats);
  const janitorConfig = resolveJanitorConfig(env);
  const staleHumanCutoffIso = new Date(
    Date.now() - Math.max(janitorConfig.activeSeatFreshMs, janitorConfig.seatedReconnectGraceMs),
  ).toISOString();
  const idleCutoffIso = idleMinutes ? new Date(Date.now() - (idleMinutes * 60 * 1000)).toISOString() : null;
  const stakesFilter = typeof filters.stakes === "string" && filters.stakes.trim()
    ? parseStakes(filters.stakes)
    : null;
  if (stakesFilter && !stakesFilter.ok) {
    throw badRequest("invalid_stakes", "invalid_stakes");
  }
  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (status !== "ALL") where.push(`status = ${nextParam(status)}`);
  if (tableId) where.push(`table_id::text ilike ${nextParam(`%${tableId}%`)}`);
  if (phase) where.push(`phase = ${nextParam(phase)}`);
  if (stakesFilter?.ok) {
    where.push(`stakes_sb = ${nextParam(stakesFilter.value.sb)}`);
    where.push(`stakes_bb = ${nextParam(stakesFilter.value.bb)}`);
  }
  if (hasActiveHumans === true) where.push("human_count > 0");
  if (hasActiveHumans === false) where.push("human_count = 0");
  if (hasBotsOnly === true) where.push("human_count = 0 and bot_count > 0");
  if (hasBotsOnly === false) where.push("not (human_count = 0 and bot_count > 0)");
  if (hasStaleSeats === true) where.push("stale_human_seat_count > 0");
  if (hasStaleSeats === false) where.push("stale_human_seat_count = 0");
  if (idleCutoffIso) where.push(`coalesce(last_activity_at, updated_at, created_at) <= ${nextParam(idleCutoffIso)}::timestamptz`);
  const whereSql = where.length ? `where ${where.join("\n  and ")}` : "";
  const query = `
with seat_stats as (
  select
    s.table_id,
    count(*) filter (where s.status = 'ACTIVE') as player_count,
    count(*) filter (where s.status = 'ACTIVE' and coalesce(s.is_bot, false) = false) as human_count,
    count(*) filter (where s.status = 'ACTIVE' and coalesce(s.is_bot, false) = true) as bot_count,
    count(*) filter (
      where s.status = 'ACTIVE'
        and coalesce(s.is_bot, false) = false
        and (s.last_seen_at is null or s.last_seen_at <= ${nextParam(staleHumanCutoffIso)}::timestamptz)
    ) as stale_human_seat_count
  from public.poker_seats s
  group by s.table_id
),
base as (
  select
    t.id as table_id,
    t.stakes,
    coalesce((t.stakes->>'sb')::int, null) as stakes_sb,
    coalesce((t.stakes->>'bb')::int, null) as stakes_bb,
    t.max_players,
    t.status,
    t.created_by,
    t.created_at,
    t.updated_at,
    t.last_activity_at,
    coalesce(ss.player_count, 0) as player_count,
    coalesce(ss.human_count, 0) as human_count,
    coalesce(ss.bot_count, 0) as bot_count,
    coalesce(ss.stale_human_seat_count, 0) as stale_human_seat_count,
    upper(coalesce(ps.state->>'phase', 'HAND_DONE')) as phase
  from public.poker_tables t
  left join public.poker_state ps on ps.table_id = t.id
  left join seat_stats ss on ss.table_id = t.id
),
filtered as (
  select * from base
  ${whereSql}
)
select
  filtered.*,
  count(*) over() as total_count
from filtered
order by ${SORT_SQL[sort]}
offset ${nextParam(pageInfo.offset)}
limit ${nextParam(pageInfo.limit)};
  `;
  const rows = await executeSql(query, params);
  const tableIds = (Array.isArray(rows) ? rows : []).map((row) => row.table_id).filter(Boolean);
  const snapshots = await loadPersistedTableSnapshots(tableIds);
  const items = (Array.isArray(rows) ? rows : []).map((row) => {
    const snapshot = snapshots.get(row.table_id);
    const classification = snapshot ? evaluatePersistedTableSnapshot(snapshot, env) : null;
    const meta = snapshot ? createTableMeta(snapshot) : {};
    return {
      tableId: row.table_id || null,
      status: row.status || null,
      maxPlayers: Number.isInteger(Number(row.max_players)) ? Number(row.max_players) : null,
      stakes: meta.stakes || null,
      stakesLabel: meta.stakesLabel || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      lastActivityAt: row.last_activity_at || row.updated_at || row.created_at || null,
      playerCount: Number.isInteger(Number(row.player_count)) ? Number(row.player_count) : 0,
      humanCount: Number.isInteger(Number(row.human_count)) ? Number(row.human_count) : 0,
      botCount: Number.isInteger(Number(row.bot_count)) ? Number(row.bot_count) : 0,
      staleHumanSeatCount: Number.isInteger(Number(row.stale_human_seat_count)) ? Number(row.stale_human_seat_count) : 0,
      phase: row.phase || "HAND_DONE",
      janitor: classification,
    };
  });
  return {
    items,
    pagination: buildPagination({
      page: pageInfo.page,
      limit: pageInfo.limit,
      total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
    }),
  };
}

function createAdminTablesListHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const listTablesFn = deps.listTables || ((filters) => listTables(filters, env));
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
      const payload = await listTablesFn(event.queryStringParameters || {});
      return { statusCode: 200, headers: cors, body: JSON.stringify(payload) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400 || error?.status === 409) {
        return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminTablesListHandler();

export {
  createAdminTablesListHandler,
  handler,
  listTables,
};
