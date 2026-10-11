import { beginSql, executeSql, klog } from "./supabase-admin.mjs";
import { postTransaction } from "./chips-ledger.mjs";

const GENESIS_SYSTEM_KEY = "GENESIS";
const PROMO_BONUS_TX_TYPE = "PROMO_BONUS";
const CLAIM_POLICIES = new Set(["once", "daily", "weekly", "monthly"]);

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeCampaign(row) {
  if (!row) return null;
  const claimPolicy = CLAIM_POLICIES.has(row.claim_policy) ? row.claim_policy : "once";
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || "",
    campaignType: row.campaign_type,
    amount: Number(row.amount),
    status: row.status,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    eligibilityType: row.eligibility_type,
    eligibilityConfig: parseJsonObject(row.eligibility_config),
    claimPolicy,
    maxTotalClaims: row.max_total_claims == null ? null : Number(row.max_total_claims),
  };
}

function buildClaimPeriodKey(claimPolicy = "once", now = new Date()) {
  if (claimPolicy === "once") return "once";
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return "once";

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  if (claimPolicy === "daily") return `${year}-${month}-${day}`;
  if (claimPolicy === "monthly") return `${year}-${month}`;
  if (claimPolicy === "weekly") {
    const weekDate = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = weekDate.getUTCDay() || 7;
    weekDate.setUTCDate(weekDate.getUTCDate() + 4 - dayOfWeek);
    const weekYear = weekDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil(((weekDate - yearStart) / 86400000 + 1) / 7);
    return `${weekYear}-W${String(week).padStart(2, "0")}`;
  }

  return "once";
}

function buildCampaignIdempotencyKey(campaignCode, userId, claimPeriodKey = "once") {
  const base = `bonus:${campaignCode}:${userId}`;
  return claimPeriodKey && claimPeriodKey !== "once" ? `${base}:${claimPeriodKey}` : base;
}

async function fetchUserCreatedAt(userId, runSql = executeSql) {
  const rows = await runSql(
    `
select created_at, is_anonymous
from auth.users
where id = $1
limit 1;
`,
    [userId],
  );
  return rows?.[0] ? { createdAt: toIso(rows[0].created_at), anonymous: rows[0].is_anonymous !== false } : null;
}

async function fetchActiveCampaignRows(runSql = executeSql, code = null) {
  return await runSql(
    `
select id, code, title, description, campaign_type, amount, status, starts_at, ends_at,
       eligibility_type, eligibility_config, claim_policy, max_total_claims
from public.bonus_campaigns
where status = 'active'
  and starts_at <= timezone('utc', now())
  and (ends_at is null or ends_at > timezone('utc', now()))
  and ($1::text is null or code = $1)
order by starts_at asc, code asc;
`,
    [code],
  );
}

async function fetchClaim(campaignId, userId, claimPeriodKey, runSql = executeSql) {
  const rows = await runSql(
    `
select id, campaign_id, user_id, transaction_id, idempotency_key, claim_period_key, claimed_at, metadata
from public.bonus_claims
where campaign_id = $1
  and user_id = $2
  and claim_period_key = $3
limit 1;
`,
    [campaignId, userId, claimPeriodKey],
  );
  return rows?.[0] || null;
}

async function fetchPromoTransaction(userId, idempotencyKey, runSql = executeSql) {
  const rows = await runSql(
    `
select id, created_at, metadata
from public.chips_transactions
where user_id = $1
  and tx_type = 'PROMO_BONUS'
  and idempotency_key = $2
limit 1;
`,
    [userId, idempotencyKey],
  );
  return rows?.[0] || null;
}

async function fetchCampaignClaimCount(campaignId, runSql = executeSql) {
  const rows = await runSql(
    `
select count(*)::bigint as claim_count
from public.bonus_claims
where campaign_id = $1;
`,
    [campaignId],
  );
  return Number(rows?.[0]?.claim_count || 0);
}

async function lockCampaign(campaignId, runSql = executeSql) {
  const rows = await runSql(
    `
select *
from public.bonus_campaigns
where id = $1
for update;
`,
    [campaignId],
  );
  return rows?.[0] || null;
}

async function isAllowlisted(campaignId, userId, runSql = executeSql) {
  const rows = await runSql(
    `
select 1
from public.bonus_campaign_eligible_users
where campaign_id = $1
  and user_id = $2
limit 1;
`,
    [campaignId, userId],
  );
  return rows.length > 0;
}

async function evaluateEligibility(campaign, userId, userCreatedAt, runSql = executeSql) {
  if (!userCreatedAt) return { eligible: false, reason: "user_not_found" };
  const config = campaign.eligibilityConfig || {};

  if (campaign.eligibilityType === "all_accounts") {
    return { eligible: true, reason: "eligible" };
  }

  if (campaign.eligibilityType === "created_after") {
    const threshold = toIso(config.created_at_gte || config.createdAfter || campaign.startsAt);
    if (!threshold) return { eligible: false, reason: "invalid_eligibility_config" };
    const eligible = Date.parse(userCreatedAt) >= Date.parse(threshold);
    return { eligible, reason: eligible ? "eligible" : "created_before_start" };
  }

  if (campaign.eligibilityType === "created_before") {
    const threshold = toIso(config.created_at_lte || config.createdBefore || campaign.startsAt);
    if (!threshold) return { eligible: false, reason: "invalid_eligibility_config" };
    const eligible = Date.parse(userCreatedAt) <= Date.parse(threshold);
    return { eligible, reason: eligible ? "eligible" : "created_after_cutoff" };
  }

  if (campaign.eligibilityType === "allowlist") {
    const eligible = await isAllowlisted(campaign.id, userId, runSql);
    return { eligible, reason: eligible ? "eligible" : "not_allowlisted" };
  }

  return { eligible: false, reason: "unsupported_eligibility_type" };
}

function publicStatus(status) {
  return {
    code: status.campaign.code,
    title: status.campaign.title,
    description: status.campaign.description,
    campaignType: status.campaign.campaignType,
    claimPolicy: status.campaign.claimPolicy,
    amount: status.campaign.amount,
    ...(status.campaign.campaignType === "poker_daily" ? { status: status.campaign.status, dailyRewards: status.dailyRewards, streakDay: status.streakDay, rewardDay: status.rewardDay, claimPeriodKey: status.claimPeriodKey, nextEligibleAt: status.nextEligibleAt, serverNow: status.serverNow } : {}),
    eligible: status.eligible,
    alreadyClaimed: status.alreadyClaimed,
    reason: status.reason,
    transactionId: status.transactionId || null,
  };
}

function validatePokerDaily(campaign) {
  if (campaign.campaignType !== "poker_daily") return true;
  const rewards = campaign.eligibilityConfig?.daily_rewards;
  return Array.isArray(rewards) && rewards.length === 4
    && rewards.every((amount) => Number.isSafeInteger(amount) && amount > 0)
    && campaign.amount === rewards[0] && campaign.claimPolicy === "daily"
    && campaign.eligibilityType === "all_accounts" && campaign.maxTotalClaims === null;
}

function readDailyReceipt(claim, rewards) {
  const metadata = parseJsonObject(claim?.metadata);
  const day = metadata.streak_day;
  if (!claim?.transaction_id || !Number.isSafeInteger(day) || day < 1 || day >= Number.MAX_SAFE_INTEGER
    || metadata.reward_day !== Math.min(day, 4)
    || metadata.amount !== rewards[Math.min(day, 4) - 1]
    || metadata.claim_period_key !== claim.claim_period_key) return null;
  return { streakDay: day, rewardDay: Math.min(day, 4), amount: metadata.amount };
}

async function validDailyEvidence(claim, campaign, userId, runSql) {
  const paid = readDailyReceipt(claim, campaign.eligibilityConfig.daily_rewards);
  if (!paid || claim.idempotency_key !== buildCampaignIdempotencyKey(campaign.code, userId, claim.claim_period_key)) return null;
  const transaction = await fetchPromoTransaction(userId, claim.idempotency_key, runSql);
  if (transaction) {
    const metadata = parseJsonObject(transaction.metadata);
    if (transaction.id !== claim.transaction_id || metadata.amount !== paid.amount || metadata.streak_day !== paid.streakDay) return null;
  }
  return paid;
}

async function campaignStatus(userId, campaign, now, runSql) {
  const base = { campaign, eligible: false, alreadyClaimed: false, reason: "campaign_not_found", transactionId: null };
  if (!campaign) return base;
  const daily = campaign.campaignType === "poker_daily";
  const claimPeriodKey = buildClaimPeriodKey(campaign.claimPolicy, now);
  const idempotencyKey = buildCampaignIdempotencyKey(campaign.code, userId, claimPeriodKey);
  Object.assign(base, { claimPeriodKey, idempotencyKey });
  if (daily) {
    base.serverNow = now.toISOString();
    base.nextEligibleAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
    if (!validatePokerDaily(campaign)) return { ...base, reason: "invalid_daily_rewards" };
    base.dailyRewards = campaign.eligibilityConfig.daily_rewards;
  }
  const user = await fetchUserCreatedAt(userId, runSql);
  base.createdAt = user?.createdAt || null;
  if (daily && user?.anonymous) return { ...base, reason: "guest_not_eligible" };
  const eligibility = await evaluateEligibility(campaign, userId, base.createdAt, runSql);
  if (!eligibility.eligible) return { ...base, reason: eligibility.reason };
  const claim = await fetchClaim(campaign.id, userId, claimPeriodKey, runSql);
  const transaction = claim ? null : await fetchPromoTransaction(userId, idempotencyKey, runSql);
  if (claim || transaction) {
    if (daily) {
      const paid = await validDailyEvidence(claim, campaign, userId, runSql);
      if (!paid) return { ...base, reason: "invalid_daily_claim" };
      Object.assign(base, paid);
      base.campaign = { ...campaign, amount: paid.amount };
    }
    return { ...base, alreadyClaimed: true, reason: "already_claimed", transactionId: claim?.transaction_id || transaction?.id };
  }
  if (daily) {
    const yesterday = buildClaimPeriodKey("daily", new Date(now.getTime() - 86400000));
    const previous = await fetchClaim(campaign.id, userId, yesterday, runSql);
    const paid = previous ? await validDailyEvidence(previous, campaign, userId, runSql) : null;
    if (previous && !paid) return { ...base, reason: "invalid_daily_claim" };
    base.streakDay = paid ? paid.streakDay + 1 : 1;
    base.rewardDay = Math.min(base.streakDay, 4);
    base.campaign = { ...campaign, amount: base.dailyRewards[base.rewardDay - 1] };
  }
  if (campaign.status !== "active" || !campaign.startsAt || Date.parse(campaign.startsAt) > now.getTime()
    || (campaign.endsAt && Date.parse(campaign.endsAt) <= now.getTime())) return { ...base, reason: "campaign_inactive" };
  if (Number.isInteger(campaign.maxTotalClaims) && campaign.maxTotalClaims > 0
    && await fetchCampaignClaimCount(campaign.id, runSql) >= campaign.maxTotalClaims) return { ...base, reason: "max_total_claims_reached" };
  return { ...base, eligible: true, reason: "eligible" };
}

async function getBonusCampaignStatus(userId, campaignCode, deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const rows = await fetchActiveCampaignRows(runSql, campaignCode);
  return campaignStatus(userId, normalizeCampaign(rows?.[0]), deps.now ? new Date(deps.now) : new Date(), runSql);
}

async function listBonusCampaignStatuses(userId, deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const rows = await fetchActiveCampaignRows(runSql, null);
  const items = [];
  for (const row of rows) {
    const status = await getBonusCampaignStatus(userId, row.code, deps);
    if (status.campaign) items.push(publicStatus(status));
  }
  if (!deps.includeDailyStatus) return { items };
  const dailyRows = await runSql(`
select * from public.bonus_campaigns
where campaign_type = 'poker_daily' and status in ('active', 'paused', 'ended')
order by (status = 'active') desc, created_at desc, id desc limit 1;
`, []);
  const status = await campaignStatus(userId, normalizeCampaign(dailyRows?.[0]), deps.now ? new Date(deps.now) : new Date(), runSql);
  return { items, dailyBonus: status.campaign ? publicStatus(status) : null };
}

function buildBonusCampaignEntries(userId, campaign, claimPeriodKey = "once") {
  const shared = {
    source: "bonus_campaign",
    campaign_id: campaign.id,
    campaign_code: campaign.code,
    campaign_type: campaign.campaignType,
    claim_policy: campaign.claimPolicy,
    claim_period_key: claimPeriodKey,
    ...campaign.awardMetadata,
  };
  return [
    {
      accountType: "USER",
      userId,
      amount: campaign.amount,
      metadata: { ...shared, entry_role: "bonus_recipient" },
    },
    {
      accountType: "SYSTEM",
      systemKey: GENESIS_SYSTEM_KEY,
      amount: -campaign.amount,
      metadata: { ...shared, entry_role: "genesis_offset" },
    },
  ];
}

async function insertBonusClaim({ campaign, userId, transactionId, idempotencyKey, claimPeriodKey, decisionAt }, runSql = executeSql) {
  const metadata = {
    source: "bonus_campaign",
    campaign_id: campaign.id,
    campaign_code: campaign.code,
    campaign_type: campaign.campaignType,
    claim_policy: campaign.claimPolicy,
    claim_period_key: claimPeriodKey,
    amount: campaign.amount,
    ...campaign.awardMetadata,
  };
  const rows = await runSql(
    `
insert into public.bonus_claims (campaign_id, user_id, transaction_id, idempotency_key, claim_period_key, metadata, claimed_at)
values ($1, $2, $3, $4, $5, ($6::text)::jsonb, $7::timestamptz)
on conflict (campaign_id, user_id, claim_period_key) do update
set metadata = public.bonus_claims.metadata
returning id, campaign_id, user_id, transaction_id, idempotency_key, claim_period_key, claimed_at;
`,
    [campaign.id, userId, transactionId, idempotencyKey, claimPeriodKey, JSON.stringify(metadata), decisionAt],
  );
  return rows?.[0] || null;
}

async function transactionClock(deps, runSql) {
  const value = deps.transactionNow ? await deps.transactionNow() : deps.now || (await runSql("select clock_timestamp() as decision_at;", []))?.[0]?.decision_at;
  const now = new Date(value);
  if (Number.isNaN(now.getTime())) throw new Error("invalid_claim_clock");
  return now;
}

async function claimBonusCampaign(userId, campaignCode, deps = {}) {
  const writeTransaction = deps.postTransaction || postTransaction;
  const begin = deps.beginSql || beginSql;
  const preflight = await getBonusCampaignStatus(userId, campaignCode, deps);
  const empty = { claimed: false, transaction: null, entries: [], account: null };
  if (!preflight.eligible || !preflight.campaign) return { ...preflight, ...empty };
  try {
    return await begin(async (sqlTx) => {
      const txSql = (query, params = []) => sqlTx.unsafe(query, params);
      const campaign = normalizeCampaign(await lockCampaign(preflight.campaign.id, txSql));
      const now = await transactionClock(deps, txSql);
      const status = await campaignStatus(userId, campaign, now, txSql);
      if (!status.eligible) return { ...status, ...empty };
      const finalNow = await transactionClock(deps, txSql);
      if (buildClaimPeriodKey(campaign.claimPolicy, finalNow) !== status.claimPeriodKey
        || (campaign.endsAt && Date.parse(campaign.endsAt) <= finalNow.getTime())) {
        return { ...status, ...empty, eligible: false, reason: "claim_period_changed" };
      }
      const award = { ...status.campaign };
      if (campaign.campaignType === "poker_daily") award.awardMetadata = {
        streak_day: status.streakDay, reward_day: status.rewardDay,
        amount: award.amount, claim_decision_at: finalNow.toISOString(),
      };
      const entries = buildBonusCampaignEntries(userId, award, status.claimPeriodKey);
      const metadata = { ...entries[0].metadata, amount: award.amount };
      delete metadata.entry_role;
      const result = await writeTransaction({
        userId, txType: PROMO_BONUS_TX_TYPE, idempotencyKey: status.idempotencyKey,
        reference: status.idempotencyKey, description: award.title, metadata, entries,
        createdBy: userId, tx: sqlTx,
      });
      const transactionId = result?.transaction?.id;
      if (!transactionId) throw new Error("bonus_claim_write_failed");
      const claim = await insertBonusClaim({ campaign: award, userId, transactionId,
        idempotencyKey: status.idempotencyKey, claimPeriodKey: status.claimPeriodKey,
        decisionAt: finalNow.toISOString() }, txSql);
      if (!claim?.id || claim.transaction_id !== transactionId) throw new Error("bonus_claim_write_failed");
      klog("bonus_campaign_claimed", { userId, campaignCode, transactionId, amount: award.amount });
      return { ...status, eligible: false, alreadyClaimed: true, claimed: true, reason: "claimed",
        transactionId, claim, transaction: result.transaction, entries: result.entries || [], account: result.account || null };
    });
  } catch (error) {
    klog("bonus_campaign_failed", { userId, campaignCode, reason: error?.code || error?.message || "server_error" });
    throw error;
  }
}

export {
  GENESIS_SYSTEM_KEY,
  PROMO_BONUS_TX_TYPE,
  buildBonusCampaignEntries,
  buildCampaignIdempotencyKey,
  buildClaimPeriodKey,
  claimBonusCampaign,
  getBonusCampaignStatus,
  listBonusCampaignStatuses,
  publicStatus,
  validatePokerDaily,
};
