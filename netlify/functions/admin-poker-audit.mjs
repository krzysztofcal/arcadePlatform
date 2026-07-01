import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const HIDDEN_META_KEYS = new Set(["deck", "holeCardsByUserId", "privateState", "privateCards"]);

function normalizeText(value, maxLength = 128) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseMeta(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return parseMeta(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, innerValue] of Object.entries(value)) {
    if (HIDDEN_META_KEYS.has(key)) continue;
    if (Array.isArray(innerValue)) {
      out[key] = innerValue.map((item) => parseMetaValue(item));
    } else {
      out[key] = parseMetaValue(innerValue);
    }
  }
  return out;
}

function parseMetaValue(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => parseMetaValue(item));
  const out = {};
  for (const [key, innerValue] of Object.entries(value)) {
    if (HIDDEN_META_KEYS.has(key)) continue;
    out[key] = parseMetaValue(innerValue);
  }
  return out;
}

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
}

function normalizePayoutMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([userId, amount]) => typeof userId === "string" && userId.trim() && Number.isFinite(Number(amount)))
      .map(([userId, amount]) => [userId.trim(), Number(amount)])
  );
}

function payoutTotal(payoutByUserId) {
  return Object.values(payoutByUserId || {}).reduce((sum, amount) => sum + (Number.isFinite(Number(amount)) ? Number(amount) : 0), 0);
}

function normalizeSettlement(row) {
  if (!row) return null;
  const meta = parseMeta(row.meta);
  const payoutByUserId = normalizePayoutMap(meta.payoutByUserId);
  return {
    reason: typeof meta.reason === "string" ? meta.reason : null,
    settledAt: typeof meta.settledAt === "string" ? meta.settledAt : (row.created_at || null),
    communityCards: normalizeStringList(meta.communityCards),
    winners: normalizeStringList(meta.winners),
    payoutByUserId,
    payoutTotal: payoutTotal(payoutByUserId),
    potsAwarded: Array.isArray(meta.potsAwarded) ? meta.potsAwarded : [],
    evaluatedHands: Array.isArray(meta.evaluatedHands) ? meta.evaluatedHands : []
  };
}

function normalizeAction(row) {
  const meta = parseMeta(row?.meta);
  return {
    createdAt: row?.created_at || null,
    version: Number.isInteger(Number(row?.version)) ? Number(row.version) : null,
    actionType: row?.action_type || null,
    userId: row?.user_id || null,
    requestId: row?.request_id || null,
    source: typeof meta.source === "string" ? meta.source : null,
    phaseFrom: row?.phase_from || meta.phaseFrom || null,
    phaseTo: row?.phase_to || meta.phaseTo || null,
    amount: normalizeNumber(row?.amount ?? meta.amount),
    potTotalBefore: normalizeNumber(meta.potTotalBefore),
    potTotalAfter: normalizeNumber(meta.potTotalAfter),
    currentBetBefore: normalizeNumber(meta.currentBetBefore),
    currentBetAfter: normalizeNumber(meta.currentBetAfter),
    toCall: normalizeNumber(meta.toCall),
    actorStackBefore: normalizeNumber(meta.actorStackBefore),
    actorStackAfter: normalizeNumber(meta.actorStackAfter)
  };
}

function handSummaryFromRows(rows) {
  const sorted = (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
    const leftTime = Date.parse(left?.created_at || "") || 0;
    const rightTime = Date.parse(right?.created_at || "") || 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return Number(left?.id || 0) - Number(right?.id || 0);
  });
  const first = sorted[0] || {};
  const settlementRow = sorted.find((row) => row?.action_type === "HAND_SETTLED") || null;
  const settlement = normalizeSettlement(settlementRow);
  return {
    tableId: first.table_id || null,
    handId: first.hand_id || null,
    startedAt: first.created_at || null,
    settledAt: settlement?.settledAt || null,
    actionCount: sorted.filter((row) => row?.action_type !== "HAND_SETTLED").length,
    winnerUserIds: settlement?.winners || [],
    potTotal: settlement?.payoutTotal ?? null,
    hasSettlement: !!settlementRow
  };
}

function selectedHandFromRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (sourceRows.length === 0) return null;
  const settlementRow = sourceRows.find((row) => row?.action_type === "HAND_SETTLED") || null;
  const actions = sourceRows.filter((row) => row?.action_type !== "HAND_SETTLED").map(normalizeAction);
  const summary = handSummaryFromRows(sourceRows);
  return {
    tableId: summary.tableId,
    handId: summary.handId,
    startedAt: summary.startedAt,
    settledAt: summary.settledAt,
    actionCount: summary.actionCount,
    hasSettlement: summary.hasSettlement,
    actions,
    settlement: normalizeSettlement(settlementRow)
  };
}

function groupRowsByHand(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const tableId = row?.table_id || "";
    const handId = row?.hand_id || "";
    if (!tableId || !handId) continue;
    const key = `${tableId}:${handId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

function buildWhere({ tableId, handId }) {
  const clauses = ["hand_id is not null", "hand_id <> ''"];
  const params = [];
  if (tableId) {
    params.push(`%${tableId}%`);
    clauses.push(`table_id::text ilike $${params.length}`);
  }
  if (handId) {
    params.push(handId);
    clauses.push(`hand_id = $${params.length}`);
  }
  return { whereSql: clauses.join(" and "), params };
}

async function loadPokerAudit({ tableId = "", handId = "", limit = DEFAULT_LIMIT, executeSqlFn = executeSql } = {}) {
  const normalizedTableId = normalizeText(tableId);
  const normalizedHandId = normalizeText(handId);
  const boundedLimit = parseLimit(limit);
  if (!normalizedTableId && !normalizedHandId) {
    throw badRequest("missing_filter", "missing_filter");
  }
  const where = buildWhere({ tableId: normalizedTableId, handId: normalizedHandId });
  const handRows = await executeSqlFn(
    `
with matching_hands as (
  select table_id, hand_id, max(created_at) as last_action_at
  from public.poker_actions
  where ${where.whereSql}
  group by table_id, hand_id
  order by max(created_at) desc
  limit $${where.params.length + 1}
)
select pa.id, pa.table_id::text as table_id, pa.version, pa.user_id::text as user_id, pa.action_type, pa.amount, pa.hand_id, pa.request_id, pa.phase_from, pa.phase_to, pa.meta, pa.created_at
from public.poker_actions pa
join matching_hands mh on mh.table_id = pa.table_id and mh.hand_id = pa.hand_id
order by mh.last_action_at desc, pa.table_id::text asc, pa.hand_id asc, pa.version asc nulls last, pa.created_at asc, pa.id asc;
    `,
    where.params.concat(boundedLimit)
  );
  const groups = groupRowsByHand(handRows);
  const hands = groups.map(handSummaryFromRows).sort((left, right) => {
    const leftTime = Date.parse(left.settledAt || left.startedAt || "") || 0;
    const rightTime = Date.parse(right.settledAt || right.startedAt || "") || 0;
    return rightTime - leftTime;
  });
  let selectedHand = null;
  if (normalizedHandId && groups.length > 0) {
    const exactGroup = groups.find((group) => group.some((row) => row?.hand_id === normalizedHandId && (!normalizedTableId || String(row?.table_id || "").includes(normalizedTableId)))) || groups[0];
    selectedHand = selectedHandFromRows(exactGroup);
  }
  return { ok: true, hands, selectedHand };
}

function createAdminPokerAuditHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadAudit = deps.loadPokerAudit || ((params) => loadPokerAudit({ ...params, executeSqlFn: deps.executeSql || executeSql }));
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
      const qs = event.queryStringParameters || {};
      const payload = await loadAudit({
        tableId: qs.tableId,
        handId: qs.handId,
        limit: qs.limit
      });
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

const handler = createAdminPokerAuditHandler();

export {
  createAdminPokerAuditHandler,
  handler,
  loadPokerAudit,
  parseMeta,
  selectedHandFromRows
};
