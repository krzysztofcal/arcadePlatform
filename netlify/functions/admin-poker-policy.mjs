import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, conflict, parseJsonBody } from "./_shared/admin-ops.mjs";
import { baseHeaders, beginSql, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";
import { getBotFundingSystemKeyForBuyIn } from "../../shared/poker-domain/table-economy.mjs";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const POLICY_FIELDS = [
  "normal_refill_threshold_ch", "normal_refill_amount_ch",
  "slow_refill_threshold_ch", "slow_refill_amount_ch",
];
const POOL_KEYS = [
  "POKER_BOT_BANKROLL_100",
  "POKER_BOT_BANKROLL",
  "POKER_BOT_SLOW_BANKROLL_100",
  "POKER_BOT_SLOW_BANKROLL_500",
];

function positiveSafe(value, code = "invalid_amount") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SAFE) throw badRequest(code, code);
  return parsed;
}

function normalizePolicy(row) {
  return {
    buyIn: Number(row.buy_in),
    enabled: row.enabled === true,
    normalRefillThresholdCh: Number(row.normal_refill_threshold_ch),
    normalRefillAmountCh: Number(row.normal_refill_amount_ch),
    slowRefillThresholdCh: Number(row.slow_refill_threshold_ch),
    slowRefillAmountCh: Number(row.slow_refill_amount_ch),
    revision: Number(row.revision),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  };
}

async function loadPokerPolicy(runSql = executeSql) {
  const [accessRows, tierRows, poolRows] = await Promise.all([
    runSql("select slow_threshold_ch, revision, updated_at, updated_by from public.poker_access_policy where id = 1 limit 1;"),
    runSql("select buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch, slow_refill_threshold_ch, slow_refill_amount_ch, revision, updated_at, updated_by from public.poker_bot_tier_policy order by buy_in asc;"),
    runSql("select system_key, balance, status from public.chips_accounts where account_type = 'SYSTEM' and system_key = any($1::text[]) order by system_key;", [POOL_KEYS]),
  ]);
  return {
    access: accessRows?.[0] ? {
      slowThresholdCh: Number(accessRows[0].slow_threshold_ch),
      revision: Number(accessRows[0].revision),
      updatedAt: accessRows[0].updated_at || null,
      updatedBy: accessRows[0].updated_by || null,
    } : null,
    tiers: (Array.isArray(tierRows) ? tierRows : []).map(normalizePolicy),
    pools: (Array.isArray(poolRows) ? poolRows : []).map((row) => ({
      systemKey: row.system_key || null,
      balance: Number(row.balance),
      status: row.status || null,
    })),
    propagationMs: 30_000,
  };
}

function parseTierPayload(body) {
  const buyIn = positiveSafe(body.buyIn ?? body.buy_in, "invalid_buy_in");
  const enabled = body.enabled === true;
  const values = {};
  for (const field of POLICY_FIELDS) values[field] = positiveSafe(body[field], `invalid_${field}`);
  const expectedRevision = positiveSafe(body.expectedRevision ?? body.expected_revision, "invalid_expected_revision");
  return { buyIn, enabled, values, expectedRevision };
}

async function updatePokerPolicy({ body, actorId, runTransaction = beginSql } = {}) {
  return runTransaction(async (tx) => {
    const kind = String(body.kind || body.scope || "").trim().toLowerCase();
    if (kind === "access") {
      const threshold = positiveSafe(body.slowThresholdCh ?? body.slow_threshold_ch, "invalid_slow_threshold_ch");
      const expectedRevision = positiveSafe(body.expectedRevision ?? body.expected_revision, "invalid_expected_revision");
      if (threshold > MAX_SAFE) throw badRequest("invalid_slow_threshold_ch", "invalid_slow_threshold_ch");
      const rows = await tx.unsafe("select revision from public.poker_access_policy where id = 1 for update;");
      if (!rows?.[0]) throw badRequest("policy_missing", "policy_missing");
      if (Number(rows[0].revision) !== expectedRevision) throw conflict("stale_revision", "stale_revision");
      const updated = await tx.unsafe(`
update public.poker_access_policy
set slow_threshold_ch = $1, revision = revision + 1,
    updated_at = timezone('utc', now()), updated_by = $2::uuid
where id = 1
returning slow_threshold_ch, revision, updated_at, updated_by;
`, [threshold, actorId]);
      klog("admin_poker_access_policy_updated", { actorId, revision: updated?.[0]?.revision });
      return { access: loadPokerPolicyRow(updated?.[0]), propagationMs: 30_000 };
    }
    if (kind !== "tier") throw badRequest("invalid_policy_scope", "invalid_policy_scope");
    const { buyIn, enabled, values, expectedRevision } = parseTierPayload(body);
    const rows = await tx.unsafe("select buy_in, revision from public.poker_bot_tier_policy where buy_in = $1 for update;", [buyIn]);
    if (!rows?.[0]) throw badRequest("tier_policy_missing", "tier_policy_missing");
    if (Number(rows[0].revision) !== expectedRevision) throw conflict("stale_revision", "stale_revision");
    if (enabled) {
      const normalKey = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "NORMAL" });
      const slowKey = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "SLOW" });
      const accounts = await tx.unsafe(`
select system_key from public.chips_accounts
where account_type = 'SYSTEM' and status = 'active' and system_key = any($1::text[]);
`, [[normalKey, slowKey]]);
      const keys = new Set((accounts || []).map((row) => row.system_key));
      if (!normalKey || !slowKey || !keys.has(normalKey) || !keys.has(slowKey)) throw badRequest("tier_pools_unprovisioned", "tier_pools_unprovisioned");
    }
    const updated = await tx.unsafe(`
update public.poker_bot_tier_policy
set enabled = $2,
    normal_refill_threshold_ch = $3,
    normal_refill_amount_ch = $4,
    slow_refill_threshold_ch = $5,
    slow_refill_amount_ch = $6,
    revision = revision + 1,
    updated_at = timezone('utc', now()), updated_by = $7::uuid
where buy_in = $1
returning buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch,
          slow_refill_threshold_ch, slow_refill_amount_ch, revision, updated_at, updated_by;
`, [buyIn, enabled, values.normal_refill_threshold_ch, values.normal_refill_amount_ch, values.slow_refill_threshold_ch, values.slow_refill_amount_ch, actorId]);
    klog("admin_poker_tier_policy_updated", { actorId, buyIn, enabled, revision: updated?.[0]?.revision });
    return { tier: normalizePolicy(updated?.[0]), propagationMs: 30_000 };
  });
}

function loadPokerPolicyRow(row) {
  return {
    slowThresholdCh: Number(row?.slow_threshold_ch),
    revision: Number(row?.revision),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

function createAdminPokerPolicyHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadPolicy = deps.loadPokerPolicy || loadPokerPolicy;
  const updatePolicy = deps.updatePokerPolicy || updatePokerPolicy;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    const cors = corsHeaders(event.headers?.origin || event.headers?.Origin);
    if (!cors) return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    try {
      const admin = await requireAdmin(event, env);
      if (event.httpMethod === "GET") return { statusCode: 200, headers: cors, body: JSON.stringify(await loadPolicy()) };
      if (event.httpMethod !== "PATCH" && event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
      const result = await updatePolicy({ body: parseJsonBody(event.body), actorId: admin.userId });
      return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) return adminAuthErrorResponse(error, cors);
      if (error?.status === 400 || error?.status === 409) return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      klog("admin_poker_policy_failed", { code: error?.code || "server_error" });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminPokerPolicyHandler();

export { createAdminPokerPolicyHandler, handler, loadPokerPolicy, updatePokerPolicy };
