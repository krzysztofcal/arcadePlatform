import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, parseUuid } from "./_shared/admin-ops.mjs";
import { getUserBalance, listUserLedger } from "./_shared/chips-ledger.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";
import { parseStakes } from "./_shared/poker-stakes.mjs";

function readUserId(event) {
  const qs = event.queryStringParameters || {};
  return parseUuid(qs.userId, "invalid_user_id");
}

async function loadUserDetails(userId) {
  if (!userId) {
    throw badRequest("invalid_user_id", "invalid_user_id");
  }
  const [userRows, activeSeatRows, pokerRows, balance, recentLedger] = await Promise.all([
    executeSql(
      `
with active_seats as (
  select
    s.user_id,
    count(*) filter (where s.status = 'ACTIVE') as active_seat_count,
    count(distinct s.table_id) filter (where s.status = 'ACTIVE') as active_table_count,
    max(s.last_seen_at) as last_seat_seen_at,
    max(coalesce(t.last_activity_at, t.updated_at, t.created_at)) as last_table_activity_at
  from public.poker_seats s
  left join public.poker_tables t on t.id = s.table_id
  group by s.user_id
),
poker_activity as (
  select
    pa.user_id,
    max(pa.created_at) as last_poker_action_at
  from public.poker_actions pa
  where pa.user_id is not null
  group by pa.user_id
)
select
  u.id::text as user_id,
  u.email,
  coalesce(
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    u.id::text
  ) as display_name,
  u.created_at,
  u.last_sign_in_at,
  coalesce(ase.active_seat_count, 0) as active_seat_count,
  coalesce(ase.active_table_count, 0) as active_table_count,
  greatest(
    coalesce(pa.last_poker_action_at, to_timestamp(0)),
    coalesce(ase.last_seat_seen_at, to_timestamp(0)),
    coalesce(ase.last_table_activity_at, to_timestamp(0)),
    coalesce(u.last_sign_in_at, to_timestamp(0)),
    coalesce(u.created_at, to_timestamp(0))
  ) as last_activity_at
from auth.users u
left join active_seats ase on ase.user_id = u.id
left join poker_activity pa on pa.user_id = u.id
where u.id = $1::uuid
limit 1;
      `,
      [userId],
    ),
    executeSql(
      `
select
  s.table_id,
  s.user_id,
  s.seat_no,
  s.status,
  s.is_bot,
  s.bot_profile,
  s.leave_after_hand,
  s.stack,
  s.last_seen_at,
  s.joined_at,
  t.status as table_status,
  t.created_at as table_created_at,
  t.updated_at as table_updated_at,
  t.last_activity_at,
  t.stakes,
  t.max_players,
  ps.version as state_version,
  ps.state
from public.poker_seats s
join public.poker_tables t on t.id = s.table_id
left join public.poker_state ps on ps.table_id = t.id
where s.user_id = $1::uuid
  and s.status = 'ACTIVE'
order by coalesce(t.last_activity_at, t.updated_at, t.created_at) desc, s.seat_no asc;
      `,
      [userId],
    ),
    executeSql(
      `
select
  pa.table_id,
  pa.action_type,
  pa.amount,
  pa.created_at,
  pa.request_id,
  pa.hand_id,
  pa.phase_from,
  pa.phase_to,
  pa.meta
from public.poker_actions pa
where pa.user_id = $1::uuid
order by pa.created_at desc, pa.id desc
limit 12;
      `,
      [userId],
    ),
    getUserBalance(userId),
    listUserLedger(userId, { limit: 12 }),
  ]);
  const user = userRows?.[0];
  if (!user) {
    throw badRequest("user_not_found", "user_not_found");
  }
  const activeSeats = (Array.isArray(activeSeatRows) ? activeSeatRows : []).map((row) => {
    const stakesParsed = parseStakes(row.stakes);
    const state = row.state && typeof row.state === "object" ? row.state : {};
    return {
      tableId: row.table_id || null,
      seatNo: Number.isInteger(Number(row.seat_no)) ? Number(row.seat_no) : null,
      status: row.status || null,
      isBot: row.is_bot === true,
      botProfile: row.bot_profile || null,
      leaveAfterHand: row.leave_after_hand === true,
      stack: Number.isFinite(Number(row.stack)) ? Number(row.stack) : 0,
      lastSeenAt: row.last_seen_at || null,
      joinedAt: row.joined_at || null,
      tableStatus: row.table_status || null,
      tableCreatedAt: row.table_created_at || null,
      tableUpdatedAt: row.table_updated_at || null,
      lastActivityAt: row.last_activity_at || row.table_updated_at || row.table_created_at || null,
      maxPlayers: Number.isInteger(Number(row.max_players)) ? Number(row.max_players) : null,
      stakes: stakesParsed.ok ? stakesParsed.value : null,
      stakesLabel: stakesParsed.ok ? `${stakesParsed.value.sb}/${stakesParsed.value.bb}` : null,
      phase: typeof state.phase === "string" ? state.phase : null,
      turnUserId: typeof state.turnUserId === "string" ? state.turnUserId : null,
      stateVersion: Number.isInteger(Number(row.state_version)) ? Number(row.state_version) : null,
    };
  });
  const activeTables = [];
  const seenTableIds = new Set();
  activeSeats.forEach((seat) => {
    if (!seat.tableId || seenTableIds.has(seat.tableId)) return;
    seenTableIds.add(seat.tableId);
    activeTables.push({
      tableId: seat.tableId,
      tableStatus: seat.tableStatus,
      stakes: seat.stakes,
      stakesLabel: seat.stakesLabel,
      maxPlayers: seat.maxPlayers,
      phase: seat.phase,
      turnUserId: seat.turnUserId,
      lastActivityAt: seat.lastActivityAt,
    });
  });
  const ledgerItems = Array.isArray(recentLedger?.items) ? recentLedger.items : [];
  return {
    user: {
      userId: user.user_id || null,
      email: user.email || null,
      displayName: user.display_name || user.email || user.user_id || "",
      createdAt: user.created_at || null,
      lastSignInAt: user.last_sign_in_at || null,
      lastActivityAt: user.last_activity_at || null,
      activeSeatCount: Number.isInteger(Number(user.active_seat_count)) ? Number(user.active_seat_count) : 0,
      activeTableCount: Number.isInteger(Number(user.active_table_count)) ? Number(user.active_table_count) : 0,
    },
    balance: {
      accountId: balance.accountId,
      balance: balance.balance,
      nextEntrySeq: balance.nextEntrySeq,
      status: balance.status,
    },
    recentLedger: {
      items: ledgerItems,
      positiveCount: ledgerItems.filter((item) => Number(item?.amount) > 0).length,
      negativeCount: ledgerItems.filter((item) => Number(item?.amount) < 0).length,
    },
    activeTables,
    activeSeats,
    recentPokerActivity: (Array.isArray(pokerRows) ? pokerRows : []).map((row) => ({
      tableId: row.table_id || null,
      actionType: row.action_type || null,
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
      createdAt: row.created_at || null,
      requestId: row.request_id || null,
      handId: row.hand_id || null,
      phaseFrom: row.phase_from || null,
      phaseTo: row.phase_to || null,
      meta: row.meta || null,
    })),
  };
}

function createAdminUserDetailsHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadDetails = deps.loadUserDetails || loadUserDetails;
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
      const userId = readUserId(event);
      const payload = await loadDetails(userId);
      return { statusCode: 200, headers: cors, body: JSON.stringify(payload) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminUserDetailsHandler();

export {
  createAdminUserDetailsHandler,
  handler,
  loadUserDetails,
};
