import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, conflict, parseJsonBody } from "./_shared/admin-ops.mjs";
import { baseHeaders, beginSql, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";
import {
  CANONICAL_POKER_BOT_POOL_KEYS,
  getBotFundingSystemKeyForBuyIn,
} from "../../shared/poker-domain/table-economy.mjs";
import {
  deriveSlowRecoveryThresholdCh,
  DEFAULT_SLOW_HYSTERESIS_BPS,
  MIN_SLOW_HYSTERESIS_BPS,
  MAX_SLOW_HYSTERESIS_BPS
} from "../../shared/poker-domain/bot-access.mjs";

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const POLICY_FIELDS = [
  "normal_refill_threshold_ch", "normal_refill_amount_ch",
  "slow_refill_threshold_ch", "slow_refill_amount_ch",
];
const POOL_KEYS = CANONICAL_POKER_BOT_POOL_KEYS;

function positiveSafe(value, code = "invalid_amount") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SAFE) throw badRequest(code, code);
  return parsed;
}

function parseHysteresisBps(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  const num = Number(value);
  if (!Number.isSafeInteger(num)) return null;
  if (typeof value === "string" && !/^\s*\d+\s*$/.test(value)) return null;
  return num;
}

function parseHysteresisPercent(rawPercent) {
  if (rawPercent === null || rawPercent === undefined || typeof rawPercent === "boolean") return null;
  const str = String(rawPercent).trim();
  const match = str.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const decimals = match[2] || "";
  const sigDecimals = decimals.replace(/0+$/, "");
  if (sigDecimals.length > 2) return null;
  const whole = Number(match[1]);
  const frac = (decimals.slice(0, 2)).padEnd(2, "0");
  const bps = whole * 100 + Number(frac);
  return Number.isSafeInteger(bps) ? bps : null;
}

function normalizePolicy(row) {
  const normalCap = row.normal_hourly_refill_cap_ch;
  const slowCap = row.slow_hourly_refill_cap_ch;
  return {
    buyIn: Number(row.buy_in),
    enabled: row.enabled === true,
    normalRefillThresholdCh: Number(row.normal_refill_threshold_ch),
    normalRefillAmountCh: Number(row.normal_refill_amount_ch),
    slowRefillThresholdCh: Number(row.slow_refill_threshold_ch),
    slowRefillAmountCh: Number(row.slow_refill_amount_ch),
    normalHourlyRefillCapCh: normalCap === null || normalCap === undefined ? null : Number(normalCap),
    slowHourlyRefillCapCh: slowCap === null || slowCap === undefined ? null : Number(slowCap),
    revision: Number(row.revision),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  };
}

async function loadPokerPolicy(runSql = executeSql) {
  const [accessRows, tierRows, poolRows] = await Promise.all([
    runSql("select slow_threshold_ch, slow_hysteresis_bps, slow_recovery_threshold_ch, revision, updated_at, updated_by from public.poker_access_policy where id = 1 limit 1;"),
    runSql("select buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch, slow_refill_threshold_ch, slow_refill_amount_ch, normal_hourly_refill_cap_ch, slow_hourly_refill_cap_ch, revision, updated_at, updated_by from public.poker_bot_tier_policy order by buy_in asc;"),
    runSql("select system_key, balance, status from public.chips_accounts where account_type = 'SYSTEM' and system_key = any($1::text[]) order by system_key;", [POOL_KEYS]),
  ]);
  return {
    access: accessRows?.[0] ? {
      slowThresholdCh: Number(accessRows[0].slow_threshold_ch),
      slowHysteresisBps: Number(accessRows[0].slow_hysteresis_bps ?? DEFAULT_SLOW_HYSTERESIS_BPS),
      slowRecoveryThresholdCh: Number(accessRows[0].slow_recovery_threshold_ch),
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

function parseNullablePositiveSafe(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SAFE) return undefined; // undefined = invalid
  return parsed;
}

function parseTierPayload(body) {
  const buyIn = positiveSafe(body.buyIn ?? body.buy_in, "invalid_buy_in");
  const enabled = body.enabled === true;
  const values = {};
  for (const field of POLICY_FIELDS) values[field] = positiveSafe(body[field], `invalid_${field}`);
  // §32: hourly cap — null = Unlimited, positive integer = finite cap
  const normalCap = parseNullablePositiveSafe(body.normal_hourly_refill_cap_ch);
  if (normalCap === undefined) throw badRequest("invalid_normal_hourly_refill_cap_ch", "invalid_normal_hourly_refill_cap_ch");
  const slowCap = parseNullablePositiveSafe(body.slow_hourly_refill_cap_ch);
  if (slowCap === undefined) throw badRequest("invalid_slow_hourly_refill_cap_ch", "invalid_slow_hourly_refill_cap_ch");
  values.normal_hourly_refill_cap_ch = normalCap;
  values.slow_hourly_refill_cap_ch = slowCap;
  const expectedRevision = positiveSafe(body.expectedRevision ?? body.expected_revision, "invalid_expected_revision");
  return { buyIn, enabled, values, expectedRevision };
}

async function updatePokerPolicy({ body, actorId, runTransaction = beginSql } = {}) {
  return runTransaction(async (tx) => {
    const kind = String(body.kind || body.scope || "").trim().toLowerCase();
    if (kind === "access") {
      const threshold = positiveSafe(body.slowThresholdCh ?? body.slow_threshold_ch, "invalid_slow_threshold_ch");

      const hasBps = (body.slowHysteresisBps !== undefined) || (body.slow_hysteresis_bps !== undefined);
      const hasPercent = body.slowHysteresisPercent !== undefined;
      if (!hasBps && !hasPercent) {
        throw badRequest("invalid_slow_hysteresis_bps", "invalid_slow_hysteresis_bps");
      }

      let hysteresisBps = null;
      if (hasBps) {
        const rawBps = body.slowHysteresisBps !== undefined ? body.slowHysteresisBps : body.slow_hysteresis_bps;
        const parsedBps = parseHysteresisBps(rawBps);
        if (parsedBps === null || parsedBps < MIN_SLOW_HYSTERESIS_BPS || parsedBps > MAX_SLOW_HYSTERESIS_BPS) {
          throw badRequest("invalid_slow_hysteresis_bps", "invalid_slow_hysteresis_bps");
        }
        if (hasPercent) {
          const parsedPercentBps = parseHysteresisPercent(body.slowHysteresisPercent);
          if (parsedPercentBps !== parsedBps) {
            throw badRequest("invalid_slow_hysteresis_bps", "invalid_slow_hysteresis_bps");
          }
        }
        hysteresisBps = parsedBps;
      } else {
        const parsedPercentBps = parseHysteresisPercent(body.slowHysteresisPercent);
        if (parsedPercentBps === null || parsedPercentBps < MIN_SLOW_HYSTERESIS_BPS || parsedPercentBps > MAX_SLOW_HYSTERESIS_BPS) {
          throw badRequest("invalid_slow_hysteresis_bps", "invalid_slow_hysteresis_bps");
        }
        hysteresisBps = parsedPercentBps;
      }

      const expectedRevision = positiveSafe(body.expectedRevision ?? body.expected_revision, "invalid_expected_revision");
      if (threshold > MAX_SAFE) throw badRequest("invalid_slow_threshold_ch", "invalid_slow_threshold_ch");

      const derivedRecovery = deriveSlowRecoveryThresholdCh(threshold, hysteresisBps);
      if (derivedRecovery === null || derivedRecovery >= threshold || derivedRecovery <= 0) {
        throw badRequest("invalid_threshold_relationship", "invalid_threshold_relationship");
      }

      const rows = await tx.unsafe("select revision from public.poker_access_policy where id = 1 for update;");
      if (!rows?.[0]) throw badRequest("policy_missing", "policy_missing");
      if (Number(rows[0].revision) !== expectedRevision) throw conflict("stale_revision", "stale_revision");
      const updated = await tx.unsafe(`
update public.poker_access_policy
set slow_threshold_ch = $1, slow_hysteresis_bps = $2, slow_recovery_threshold_ch = $3, revision = revision + 1,
    updated_at = timezone('utc', now()), updated_by = $4::uuid
where id = 1
returning slow_threshold_ch, slow_hysteresis_bps, slow_recovery_threshold_ch, revision, updated_at, updated_by;
`, [threshold, hysteresisBps, derivedRecovery, actorId]);
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
    normal_hourly_refill_cap_ch = $8,
    slow_hourly_refill_cap_ch = $9,
    revision = revision + 1,
    updated_at = timezone('utc', now()), updated_by = $7::uuid
where buy_in = $1
returning buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch,
          slow_refill_threshold_ch, slow_refill_amount_ch,
          normal_hourly_refill_cap_ch, slow_hourly_refill_cap_ch,
          revision, updated_at, updated_by;
`, [buyIn, enabled, values.normal_refill_threshold_ch, values.normal_refill_amount_ch, values.slow_refill_threshold_ch, values.slow_refill_amount_ch, actorId, values.normal_hourly_refill_cap_ch, values.slow_hourly_refill_cap_ch]);
    klog("admin_poker_tier_policy_updated", { actorId, buyIn, enabled, revision: updated?.[0]?.revision });
    return { tier: normalizePolicy(updated?.[0]), propagationMs: 30_000 };
  });
}

function loadPokerPolicyRow(row) {
  return {
    slowThresholdCh: Number(row?.slow_threshold_ch),
    slowHysteresisBps: Number(row?.slow_hysteresis_bps ?? DEFAULT_SLOW_HYSTERESIS_BPS),
    slowRecoveryThresholdCh: Number(row?.slow_recovery_threshold_ch),
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
