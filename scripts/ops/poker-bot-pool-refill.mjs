import { beginSql, klog } from "../../netlify/functions/_shared/supabase-admin.mjs";
import { postTransaction } from "../../netlify/functions/_shared/chips-ledger.mjs";
import { getBotFundingSystemKeyForBuyIn } from "../../shared/poker-domain/table-economy.mjs";
import { isValidTierPolicy } from "../../shared/poker-domain/bot-access.mjs";

export const REFILL_BUCKET_MS = 3 * 60 * 60 * 1000;
export const CANONICAL_REPOSITORY = "krzysztofcal/arcadePlatform";
export const REFILL_WORKFLOW_FILE = ".github/workflows/poker-bot-pool-refill.yml";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function positiveSafeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function utcBucketStart(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw fail("invalid_refill_clock");
  const hours = date.getUTCHours();
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(hours - (hours % 3));
  return date.toISOString();
}

export function refillIdempotencyKey({ bankrollSystemKey, policyRevision, bucket }) {
  const pool = typeof bankrollSystemKey === "string" ? bankrollSystemKey.trim() : "";
  const revision = positiveSafeInteger(policyRevision);
  if (!pool || !revision || typeof bucket !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(bucket)) {
    throw fail("invalid_refill_identity");
  }
  return `poker-pool-refill:${pool}:${revision}:${bucket}`;
}

export function resolveRefillAuthorization(env = process.env, { mode = env.POKER_BOT_REFILL_MODE || "dry-run" } = {}) {
  const repository = String(env.GITHUB_REPOSITORY || CANONICAL_REPOSITORY).trim();
  const ref = String(env.POKER_BOT_REFILL_REVIEWED_REF || env.GITHUB_REF || "").trim();
  const normalizedMode = String(mode || "dry-run").trim().toLowerCase();
  const target = String(env.POKER_BOT_REFILL_TARGET || "stage").trim().toLowerCase();
  const stageCanary = env.POKER_BOT_REFILL_STAGE_CANARY === "1";
  const requestedPoolClass = String(env.POKER_BOT_REFILL_POOL_CLASS || "").trim().toUpperCase();
  if (repository !== CANONICAL_REPOSITORY) throw fail("refill_repository_mismatch");
  if (!/^refs\/(heads|tags)\/[A-Za-z0-9._\/-]+$/.test(ref) && !/^[0-9a-f]{40}$/.test(ref) && ref !== "main") {
    throw fail("refill_reviewed_ref_required");
  }
  if (normalizedMode !== "dry-run" && normalizedMode !== "mutate") throw fail("refill_mode_invalid");
  if (target !== "stage" && target !== "production") throw fail("refill_target_invalid");
  if (normalizedMode === "mutate" && env.POKER_BOT_REFILL_FEATURE_ENABLED !== "1") {
    throw fail("refill_feature_disabled");
  }
  if (normalizedMode === "mutate" && env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    throw fail("refill_dispatch_required");
  }
  if (stageCanary && (target !== "stage" || normalizedMode !== "mutate")) {
    throw fail("refill_stage_canary_scope_invalid");
  }
  if (requestedPoolClass && !["NORMAL", "SLOW"].includes(requestedPoolClass)) {
    throw fail("refill_pool_class_invalid");
  }
  if (stageCanary && requestedPoolClass !== "NORMAL") {
    throw fail("refill_stage_canary_pool_class_invalid");
  }
  const ownerCanaryActor = stageCanary
    && env.GITHUB_REPOSITORY_OWNER === CANONICAL_REPOSITORY.split("/")[0]
    && env.GITHUB_ACTOR === env.GITHUB_REPOSITORY_OWNER;
  if (normalizedMode === "mutate" && env.GITHUB_ACTOR !== "arcade-poker-refill-dispatch" && !ownerCanaryActor) {
    throw fail("refill_actor_not_allowed");
  }
  if (normalizedMode === "mutate" && target === "stage") {
    if (!/^[0-9a-f]{40}$/.test(ref)) throw fail("refill_stage_reviewed_sha_required");
    if (env.GITHUB_SHA !== ref) throw fail("refill_dispatch_sha_mismatch");
    if (env.POKER_BOT_REFILL_CHECKED_SHA !== ref) throw fail("refill_checked_sha_mismatch");
  }
  if (normalizedMode === "mutate" && target === "production") {
    if (env.GITHUB_REF !== "refs/heads/main") throw fail("refill_main_ref_required");
    if (ref !== "main") throw fail("refill_production_ref_required");
    if (env.POKER_BOT_REFILL_CHECKED_SHA && env.POKER_BOT_REFILL_CHECKED_SHA !== env.GITHUB_SHA) {
      throw fail("refill_checked_sha_mismatch");
    }
    if (env.POKER_BOT_REFILL_PRODUCTION_GO !== "1") throw fail("refill_production_go_required");
  }
  return {
    repository,
    ref,
    mode: normalizedMode,
    dryRun: normalizedMode !== "mutate",
    target,
    stageCanary,
    poolClass: requestedPoolClass || null,
  };
}

function poolFields(poolClass) {
  return String(poolClass).toUpperCase() === "SLOW"
    ? { threshold: "slow_refill_threshold_ch", amount: "slow_refill_amount_ch" }
    : { threshold: "normal_refill_threshold_ch", amount: "normal_refill_amount_ch" };
}

async function databaseNow(tx) {
  // now()/CURRENT_TIMESTAMP freeze at transaction start and miss lock waits.
  const rows = await tx.unsafe("select clock_timestamp() as now;");
  const now = new Date(rows?.[0]?.now);
  if (!Number.isFinite(now.getTime())) throw fail("invalid_refill_clock");
  return now;
}

async function boundRefillTransaction(tx) {
  await tx.unsafe("set local lock_timeout = '5s';");
  await tx.unsafe("set local statement_timeout = '10s';");
  await tx.unsafe("set local idle_in_transaction_session_timeout = '10s';");
}

export async function refillPool({
  tx,
  policy,
  poolClass,
  bucket,
  dryRun = true,
  postTransactionFn = postTransaction,
} = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw fail("refill_tx_required");
  if (!isValidTierPolicy(policy) || policy.enabled !== true) return { status: "disabled" };
  await boundRefillTransaction(tx);
  const currentBucket = utcBucketStart(await databaseNow(tx));
  bucket ??= currentBucket;
  if (bucket !== currentBucket) return { status: "stale_bucket" };
  const buyIn = positiveSafeInteger(policy.buy_in ?? policy.buyIn);
  const revision = positiveSafeInteger(policy.revision);
  const normalizedClass = String(poolClass || "").toUpperCase();
  const poolKey = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: normalizedClass });
  const fields = poolFields(normalizedClass);
  const threshold = positiveSafeInteger(policy[fields.threshold]);
  const amount = positiveSafeInteger(policy[fields.amount]);
  if (!buyIn || !revision || !poolKey || !threshold || !amount) return { status: "unprovisioned" };
  const idempotencyKey = refillIdempotencyKey({ bankrollSystemKey: poolKey, policyRevision: revision, bucket });

  // Acquire the ledger's debit account too: it otherwise waits on GENESIS
  // after our freshness check. Lock it before bucket locks to avoid deadlocks
  // between concurrent runs that process several pools in one transaction.
  await tx.unsafe(`
select id from public.chips_accounts
where account_type = 'SYSTEM' and system_key = 'GENESIS'
for update;
`);
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", [`poker-pool-refill:${poolKey}:${bucket}`]);
  const consumedRows = await tx.unsafe(`
select id, idempotency_key, metadata
from public.chips_transactions
where tx_type = 'MINT'
  and metadata ->> 'purpose' = 'poker_pool_refill'
  and metadata ->> 'bankrollSystemKey' = $1
  and metadata ->> 'bucket' = $2
order by id asc
limit 1;
`, [poolKey, bucket]);
  if (consumedRows?.[0]) return { status: "replay", poolKey, bucket, transaction: consumedRows[0] };

  const accountRows = await tx.unsafe(`
select id, balance, status
from public.chips_accounts
where account_type = 'SYSTEM' and system_key = $1
for update;
`, [poolKey]);
  if (bucket !== utcBucketStart(await databaseNow(tx))) return { status: "stale_bucket", poolKey, bucket };
  const account = accountRows?.[0];
  if (!account || String(account.status).toLowerCase() !== "active") return { status: "unprovisioned", poolKey };
  const balance = Number(account.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) throw fail("refill_balance_invalid");
  if (balance >= threshold) return { status: "no_op", poolKey, balance, threshold };
  if (dryRun) return { status: "would_refill", poolKey, balance, threshold, amount, idempotencyKey };

  const result = await postTransactionFn({
    userId: null,
    tx,
    txType: "MINT",
    idempotencyKey,
    reference: idempotencyKey,
    description: `Scheduled poker ${normalizedClass} pool refill`,
    createdBy: null,
    trustedScheduledRefill: true,
    metadata: {
      purpose: "poker_pool_refill",
      bankrollSystemKey: poolKey,
      buyIn,
      poolClass: normalizedClass,
      policyRevision: revision,
      bucket,
    },
    entries: [
      { accountType: "SYSTEM", systemKey: "GENESIS", amount: -amount },
      { accountType: "SYSTEM", systemKey: poolKey, amount },
    ],
  });
  // A later ledger/trigger/index wait must roll back, never commit an old bucket.
  if (bucket !== utcBucketStart(await databaseNow(tx))) throw fail("refill_bucket_expired");
  return { status: "refilled", poolKey, amount, idempotencyKey, transaction: result?.transaction || null };
}

export async function runRefill({
  env = process.env,
  beginSqlFn = beginSql,
  postTransactionFn = postTransaction,
} = {}) {
  const authorization = resolveRefillAuthorization(env);
  return beginSqlFn(async (tx) => {
    await boundRefillTransaction(tx);
    const startedAt = await databaseNow(tx);
    const bucket = utcBucketStart(startedAt);
    const policyRows = await tx.unsafe(`
select buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch,
       slow_refill_threshold_ch, slow_refill_amount_ch, revision
from public.poker_bot_tier_policy
where enabled = true
order by buy_in asc
for share;
`);
    const outcomes = [];
    for (const policy of Array.isArray(policyRows) ? policyRows : []) {
      for (const poolClass of authorization.poolClass ? [authorization.poolClass] : ["NORMAL", "SLOW"]) {
        if ((await databaseNow(tx)).getTime() - startedAt.getTime() > 60_000) {
          throw fail("refill_transaction_expired");
        }
        outcomes.push(await refillPool({
          tx,
          policy,
          poolClass,
          bucket,
          dryRun: authorization.dryRun,
          postTransactionFn,
        }));
      }
    }
    const finishedAt = await databaseNow(tx);
    if (utcBucketStart(finishedAt) !== bucket) throw fail("refill_bucket_expired");
    if (finishedAt.getTime() - startedAt.getTime() > 60_000) throw fail("refill_transaction_expired");
    return { authorization, bucket, outcomes };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRefill()
    .then((result) => klog("poker_bot_pool_refill_complete", {
      bucket: result.bucket,
      mode: result.authorization.mode,
      outcomes: result.outcomes.map(({ status, poolKey }) => ({ status, poolKey })),
    }))
    .catch((error) => {
      klog("poker_bot_pool_refill_failed", { code: error?.code || "refill_failed" });
      process.exitCode = 1;
    });
}
