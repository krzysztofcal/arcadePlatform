import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { checkWsBuyInCapability } from "./_shared/poker-ws-runtime-notify.mjs";
import { isConfiguredPokerBuyIn, readPokerProgression } from "../../shared/poker-domain/poker-progression.mjs";
import { DEFAULT_CASH_TABLE_BUY_IN_CHIPS, isCanonicalPokerStakes } from "../../shared/poker-domain/table-economy.mjs";

const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });

function requestedTableId(event) {
  const query = event?.queryStringParameters || {};
  const value = query.tableId || query.table_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTableStakes(value) {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

async function readRejoinableTableIds(tx, userId) {
  const rows = await tx.unsafe(
    `
select distinct t.id
from public.poker_tables t
join public.poker_seats s on s.table_id = t.id
where t.status = 'OPEN'
  and s.user_id = $1
  and s.status = 'ACTIVE';
    `,
    [userId]
  );
  return (rows || [])
    .map((row) => typeof row?.id === "string" ? row.id : null)
    .filter(Boolean);
}

async function readTableAccess(tx, { userId, tableId, progression }) {
  const rows = await tx.unsafe(
    "select id, status, buy_in, stakes from public.poker_tables where id = $1 limit 1;",
    [tableId]
  );
  const table = rows?.[0] || null;
  if (!table) return { tableId, buyIn: null, allowed: false, rejoin: false, reason: "table_not_found" };

  const buyIn = Number(table.buy_in);
  const normalizedBuyIn = Number.isSafeInteger(buyIn) && buyIn > 0 ? buyIn : null;
  if (String(table.status || "").toUpperCase() !== "OPEN") {
    return { tableId, buyIn: normalizedBuyIn, allowed: false, rejoin: false, reason: String(table.status || "").toUpperCase() === "CLOSED" ? "table_closed" : "table_not_open" };
  }

  const seatRows = await tx.unsafe(
    "select 1 from public.poker_seats where table_id = $1 and user_id = $2 and status = 'ACTIVE' limit 1;",
    [tableId, userId]
  );
  if (seatRows?.length) {
    return { tableId, buyIn: normalizedBuyIn, allowed: true, rejoin: true, reason: "rejoin" };
  }
  if (!normalizedBuyIn || !isConfiguredPokerBuyIn(normalizedBuyIn, progression?.tiers?.map((tier) => tier.buyIn) || [])) {
    return { tableId, buyIn: normalizedBuyIn, allowed: false, rejoin: false, reason: "invalid_buy_in" };
  }
  if (!isCanonicalPokerStakes(normalizedBuyIn, normalizeTableStakes(table.stakes))) {
    return { tableId, buyIn: normalizedBuyIn, allowed: false, rejoin: false, reason: "invalid_table_economy" };
  }
  if (!progression.availableBuyIns.includes(normalizedBuyIn)) {
    return { tableId, buyIn: normalizedBuyIn, allowed: false, rejoin: false, reason: "buy_in_tier_locked" };
  }
  return { tableId, buyIn: normalizedBuyIn, allowed: true, rejoin: false, reason: "available" };
}

export async function handler(event) {
  if (process.env.CHIPS_ENABLED !== "1") {
    return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
  }
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: mergeHeaders(cors), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: mergeHeaders(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: mergeHeaders(cors), body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const tableId = requestedTableId(event);
    const result = await beginSql(async (tx) => {
      const progression = await readPokerProgression(tx, { userId: auth.userId });
      const rejoinableTableIds = await readRejoinableTableIds(tx, auth.userId);
      const tableAccess = tableId
        ? await readTableAccess(tx, { userId: auth.userId, tableId, progression })
        : null;
      return { progression, rejoinableTableIds, tableAccess };
    });
    let tableAccess = result.tableAccess;
    if (tableAccess?.allowed === true
      && tableAccess.rejoin !== true
      && Number(tableAccess.buyIn) !== DEFAULT_CASH_TABLE_BUY_IN_CHIPS) {
      const capability = await checkWsBuyInCapability({ klog });
      if (!capability?.ok) {
        klog("poker_progression_table_access_capability_unavailable", {
          tableId: tableAccess.tableId,
          buyIn: tableAccess.buyIn,
          reason: capability?.reason || "unknown"
        });
        tableAccess = {
          ...tableAccess,
          allowed: false,
          rejoin: false,
          reason: "ws_buy_in_capability_unavailable"
        };
      }
    }
    return {
      statusCode: 200,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ userId: auth.userId, ...result.progression, rejoinableTableIds: result.rejoinableTableIds, tableAccess })
    };
  } catch (error) {
    const code = error?.code === "poker_buy_in_tiers_config_invalid"
      ? "poker_buy_in_config_invalid"
      : "server_error";
    klog("poker_progression_error", { code });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: code }) };
  }
}
