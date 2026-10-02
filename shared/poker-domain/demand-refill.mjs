/**
 * Demand-driven pool refill primitive (§32).
 *
 * Called only from authoritative positive bot-funding paths (seed, replacement,
 * managed top-up). The caller cannot select an arbitrary SYSTEM key, MINT
 * amount, or pool class — everything is derived from the tier policy.
 *
 * One refill attempt per funding demand. No refill-until-target loop.
 * Multiple distinct demands may refill the same pool in the same hour while
 * the hourly cap allows. Same-demand replay never double-MINTs.
 */

import { getBotFundingSystemKeyForBuyIn } from "./table-economy.mjs";
import { isValidTierPolicy } from "./bot-access.mjs";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

const isSafePositiveInteger = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

/**
 * Derive the current UTC-hour bucket from a Date.
 * Returns ISO string like "2026-10-01T20:00:00.000Z".
 */
export function utcHourBucketStart(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw fail("invalid_refill_clock");
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

/**
 * Deterministic idempotency key for a demand refill attempt.
 * Bound to the funding demand identity + pool + hour bucket.
 */
export function demandRefillIdempotencyKey({ bankrollSystemKey, policyRevision, bucket, fundingDemandId }) {
  const pool = typeof bankrollSystemKey === "string" ? bankrollSystemKey.trim() : "";
  const revision = isSafePositiveInteger(policyRevision) ? Number(policyRevision) : 0;
  const demandId = typeof fundingDemandId === "string" ? fundingDemandId.trim() : "";
  if (!pool || !revision || !demandId || typeof bucket !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(bucket)) {
    throw fail("invalid_demand_refill_identity");
  }
  return `demand-refill:${pool}:${revision}:${bucket}:${demandId}`;
}

function poolCapField(poolClass) {
  return String(poolClass).toUpperCase() === "SLOW"
    ? "slow_hourly_refill_cap_ch" : "normal_hourly_refill_cap_ch";
}

function poolThresholdField(poolClass) {
  return String(poolClass).toUpperCase() === "SLOW"
    ? "slow_refill_threshold_ch" : "normal_refill_threshold_ch";
}

function poolAmountField(poolClass) {
  return String(poolClass).toUpperCase() === "SLOW"
    ? "slow_refill_amount_ch" : "normal_refill_amount_ch";
}

async function databaseNow(tx) {
  const rows = await tx.unsafe("select clock_timestamp() as now;");
  const now = new Date(rows?.[0]?.now);
  if (!Number.isFinite(now.getTime())) throw fail("invalid_refill_clock");
  return now;
}

/**
 * Attempt one demand-driven refill for an exact pool.
 *
 * @param {Object} options
 * @param {Object} options.tx            — active DB transaction
 * @param {number} options.buyIn         — tier buy-in
 * @param {string} options.poolClass     — "NORMAL" or "SLOW"
 * @param {string} options.fundingDemandId — idempotency identity of the funding demand
 * @param {number} options.requiredDebitCh — the amount the caller needs to debit (optional, for smart refill)
 * @param {Function} options.postTransactionFn — ledger postTransaction function
 * @returns {Object} { status, poolKey, amount?, ... }
 */
export async function attemptDemandRefill({
  tx,
  buyIn,
  poolClass,
  fundingDemandId,
  requiredDebitCh = 0,
  postTransactionFn,
} = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw fail("demand_refill_tx_required");
  if (typeof postTransactionFn !== "function") throw fail("demand_refill_post_tx_required");

  const normalizedClass = String(poolClass || "").toUpperCase();
  if (normalizedClass !== "NORMAL" && normalizedClass !== "SLOW") {
    return { status: "invalid_class", poolClass: normalizedClass };
  }

  const normalizedBuyIn = Number(buyIn);
  if (!isSafePositiveInteger(normalizedBuyIn)) {
    return { status: "invalid_buy_in", buyIn };
  }

  const poolKey = getBotFundingSystemKeyForBuyIn(normalizedBuyIn, { poolClass: normalizedClass });
  if (!poolKey) return { status: "unprovisioned_key", buyIn: normalizedBuyIn, poolClass: normalizedClass };

  // Set bounded transaction timeouts
  await tx.unsafe("set local lock_timeout = '5s';");
  await tx.unsafe("set local statement_timeout = '10s';");

  // 1. Read/lock current tier policy
  const policyRows = await tx.unsafe(`
    select buy_in, enabled,
           normal_refill_threshold_ch, normal_refill_amount_ch,
           slow_refill_threshold_ch, slow_refill_amount_ch,
           normal_hourly_refill_cap_ch, slow_hourly_refill_cap_ch,
           revision
    from public.poker_bot_tier_policy
    where buy_in = $1
    for share;
  `, [normalizedBuyIn]);

  const policy = policyRows?.[0];
  if (!policy || !isValidTierPolicy(policy)) {
    return { status: "policy_missing", buyIn: normalizedBuyIn };
  }
  if (policy.enabled !== true) {
    return { status: "tier_disabled", buyIn: normalizedBuyIn };
  }

  const revision = Number(policy.revision);
  const threshold = Number(policy[poolThresholdField(normalizedClass)]);
  const chunkAmount = Number(policy[poolAmountField(normalizedClass)]);
  const rawCap = policy[poolCapField(normalizedClass)];
  const hourlyCap = rawCap === null || rawCap === undefined ? null : Number(rawCap);

  if (!isSafePositiveInteger(threshold) || !isSafePositiveInteger(chunkAmount)) {
    return { status: "policy_invalid", buyIn: normalizedBuyIn, poolClass: normalizedClass };
  }
  if (hourlyCap !== null && (!isSafePositiveInteger(hourlyCap))) {
    return { status: "policy_invalid", buyIn: normalizedBuyIn, poolClass: normalizedClass };
  }

  // 2. Derive UTC-hour bucket from DB time
  const bucket = utcHourBucketStart(await databaseNow(tx));

  // 3. Lock GENESIS first, then pool advisory lock (deadlock prevention)
  await tx.unsafe(`
    select id from public.chips_accounts
    where account_type = 'SYSTEM' and system_key = 'GENESIS'
    for update;
  `);
  await tx.unsafe("select pg_advisory_xact_lock(hashtext($1));", [`demand-refill:${poolKey}:${bucket}`]);

  // 4. Check same-demand replay (idempotency)
  const idempotencyKey = demandRefillIdempotencyKey({
    bankrollSystemKey: poolKey,
    policyRevision: revision,
    bucket,
    fundingDemandId: String(fundingDemandId || ""),
  });

  const replayRows = await tx.unsafe(`
    select id from public.chips_transaction_idempotency
    where idempotency_key = $1
    limit 1;
  `, [idempotencyKey]);
  if (replayRows?.[0]) {
    return { status: "replay", poolKey, bucket, idempotencyKey };
  }

  // 5. Read current pool balance
  const accountRows = await tx.unsafe(`
    select id, balance, status
    from public.chips_accounts
    where account_type = 'SYSTEM' and system_key = $1
    for update;
  `, [poolKey]);
  const account = accountRows?.[0];
  if (!account || String(account.status).toLowerCase() !== "active") {
    return { status: "unprovisioned", poolKey };
  }

  const balance = Number(account.balance);
  if (!Number.isSafeInteger(balance) || balance < 0) throw fail("demand_refill_balance_invalid");

  // 6. Check if refill is needed: below threshold OR cannot cover debit
  const needsRefill = balance < threshold || (requiredDebitCh > 0 && balance < requiredDebitCh);
  if (!needsRefill) {
    return { status: "no_op", poolKey, balance, threshold };
  }

  // 7. Calculate hourly usage from ledger
  let alreadyRefilledThisHour = 0;
  if (hourlyCap !== null) {
    const usageRows = await tx.unsafe(`
      select coalesce(sum((e.amount)::bigint), 0) as total_refilled
      from public.chips_transactions t
      join public.chips_entries e on e.transaction_id = t.id
      where t.tx_type = 'MINT'
        and t.metadata ->> 'purpose' = 'poker_pool_refill'
        and t.metadata ->> 'bankrollSystemKey' = $1
        and t.metadata ->> 'bucket' = $2
        and e.account_type = 'SYSTEM'
        and e.system_key = $1
        and e.amount > 0;
    `, [poolKey, bucket]);
    alreadyRefilledThisHour = Number(usageRows?.[0]?.total_refilled || 0);
  }

  // 8. Calculate remaining allowance
  let allowedAmount;
  if (hourlyCap === null) {
    // Unlimited
    allowedAmount = chunkAmount;
  } else {
    const remaining = Math.max(0, hourlyCap - alreadyRefilledThisHour);
    if (remaining <= 0) {
      return {
        status: "cap_exhausted",
        poolKey,
        bucket,
        hourlyCap,
        alreadyRefilledThisHour,
      };
    }
    allowedAmount = Math.min(chunkAmount, remaining);
  }

  // If the allowed amount can't cover the required debit and the pool is insufficient,
  // don't MINT a useless partial refill (§32)
  if (requiredDebitCh > 0 && (balance + allowedAmount) < requiredDebitCh) {
    return {
      status: "insufficient_allowance",
      poolKey,
      bucket,
      balance,
      allowedAmount,
      requiredDebitCh,
    };
  }

  // 9. Verify bucket hasn't expired during locks
  if (bucket !== utcHourBucketStart(await databaseNow(tx))) {
    return { status: "stale_bucket", poolKey, bucket };
  }

  // 10. Post the MINT through the balanced ledger
  const result = await postTransactionFn({
    userId: null,
    tx,
    txType: "MINT",
    idempotencyKey,
    reference: idempotencyKey,
    description: `Demand poker ${normalizedClass} pool refill`,
    createdBy: null,
    trustedScheduledRefill: true,
    metadata: {
      purpose: "poker_pool_refill",
      bankrollSystemKey: poolKey,
      buyIn: normalizedBuyIn,
      poolClass: normalizedClass,
      policyRevision: revision,
      bucket,
      trigger: "demand",
      fundingDemandId: String(fundingDemandId || ""),
    },
    entries: [
      { accountType: "SYSTEM", systemKey: "GENESIS", amount: -allowedAmount },
      { accountType: "SYSTEM", systemKey: poolKey, amount: allowedAmount },
    ],
  });

  // Final bucket check
  if (bucket !== utcHourBucketStart(await databaseNow(tx))) {
    throw fail("demand_refill_bucket_expired");
  }

  return {
    status: "refilled",
    poolKey,
    amount: allowedAmount,
    bucket,
    idempotencyKey,
    transaction: result?.transaction || null,
  };
}
