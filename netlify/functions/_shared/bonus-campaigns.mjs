import { executeSql, klog } from "./supabase-admin.mjs";
import { postTransaction } from "./chips-ledger.mjs";

const GENESIS_SYSTEM_KEY = "GENESIS";
const PROMO_BONUS_TX_TYPE = "PROMO_BONUS";

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
    maxTotalClaims: row.max_total_claims == null ? null : Number(row.max_total_claims),
  };
}

function buildCampaignIdempotencyKey(campaignCode, userId) {
  return `bonus:${campaignCode}:${userId}`;
}

async function fetchUserCreatedAt(userId, runSql = executeSql) {
  const rows = await runSql(
    `
select created_at
from auth.users
where id = $1
limit 1;
`,
    [userId],
  );
  return toIso(rows?.[0]?.created_at);
}

async function fetchActiveCampaignRows(runSql = executeSql, code = null) {
  return await runSql(
    `
select id, code, title, description, campaign_type, amount, status, starts_at, ends_at,
       eligibility_type, eligibility_config, max_total_claims
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

async function fetchClaim(campaignId, userId, runSql = executeSql) {
  const rows = await runSql(
    `
select id, campaign_id, user_id, transaction_id, idempotency_key, claimed_at
from public.bonus_claims
where campaign_id = $1
  and user_id = $2
limit 1;
`,
    [campaignId, userId],
  );
  return rows?.[0] || null;
}

async function fetchPromoTransaction(userId, idempotencyKey, runSql = executeSql) {
  const rows = await runSql(
    `
select id, created_at
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
    amount: status.campaign.amount,
    eligible: status.eligible,
    alreadyClaimed: status.alreadyClaimed,
    reason: status.reason,
    transactionId: status.transactionId || null,
  };
}

async function getBonusCampaignStatus(userId, campaignCode, deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const rows = await fetchActiveCampaignRows(runSql, campaignCode);
  const campaign = normalizeCampaign(rows?.[0]);
  if (!campaign) {
    return {
      eligible: false,
      alreadyClaimed: false,
      reason: "campaign_not_found",
      campaign: null,
      idempotencyKey: null,
    };
  }

  const idempotencyKey = buildCampaignIdempotencyKey(campaign.code, userId);
  const userCreatedAt = await fetchUserCreatedAt(userId, runSql);
  const claim = await fetchClaim(campaign.id, userId, runSql);
  const transaction = claim ? null : await fetchPromoTransaction(userId, idempotencyKey, runSql);

  if (claim || transaction) {
    return {
      eligible: false,
      alreadyClaimed: true,
      reason: "already_claimed",
      campaign,
      idempotencyKey,
      createdAt: userCreatedAt,
      transactionId: claim?.transaction_id || transaction?.id || null,
    };
  }

  const eligibility = await evaluateEligibility(campaign, userId, userCreatedAt, runSql);
  return {
    eligible: eligibility.eligible,
    alreadyClaimed: false,
    reason: eligibility.reason,
    campaign,
    idempotencyKey,
    createdAt: userCreatedAt,
    transactionId: null,
  };
}

async function listBonusCampaignStatuses(userId, deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const rows = await fetchActiveCampaignRows(runSql, null);
  const items = [];
  for (const row of rows) {
    const status = await getBonusCampaignStatus(userId, row.code, deps);
    if (status.campaign) items.push(publicStatus(status));
  }
  return { items };
}

function buildBonusCampaignEntries(userId, campaign) {
  const shared = {
    source: "bonus_campaign",
    campaign_id: campaign.id,
    campaign_code: campaign.code,
    campaign_type: campaign.campaignType,
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

async function insertBonusClaim({ campaign, userId, transactionId, idempotencyKey }, runSql = executeSql) {
  const metadata = {
    source: "bonus_campaign",
    campaign_id: campaign.id,
    campaign_code: campaign.code,
    campaign_type: campaign.campaignType,
    amount: campaign.amount,
  };
  const rows = await runSql(
    `
insert into public.bonus_claims (campaign_id, user_id, transaction_id, idempotency_key, metadata)
values ($1, $2, $3, $4, $5::jsonb)
on conflict (campaign_id, user_id) do update
set metadata = public.bonus_claims.metadata
returning id, campaign_id, user_id, transaction_id, idempotency_key, claimed_at;
`,
    [campaign.id, userId, transactionId, idempotencyKey, JSON.stringify(metadata)],
  );
  return rows?.[0] || null;
}

async function claimBonusCampaign(userId, campaignCode, deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const writeTransaction = deps.postTransaction || postTransaction;
  const status = await getBonusCampaignStatus(userId, campaignCode, deps);
  const campaign = status.campaign;
  const baseLog = {
    userId,
    campaignId: campaign?.id || null,
    campaignCode: campaign?.code || campaignCode || null,
    campaignType: campaign?.campaignType || null,
    eligible: status.eligible,
    alreadyClaimed: status.alreadyClaimed,
    amount: campaign?.amount || null,
    reason: status.reason,
  };

  if (!status.eligible || !campaign) {
    klog("bonus_campaign_skipped", {
      ...baseLog,
      transactionId: status.transactionId || null,
    });
    return { ...status, claimed: false, transaction: null, entries: [], account: null };
  }

  try {
    const metadata = {
      source: "bonus_campaign",
      campaign_id: campaign.id,
      campaign_code: campaign.code,
      campaign_type: campaign.campaignType,
      amount: campaign.amount,
    };
    const result = await writeTransaction({
      userId,
      txType: PROMO_BONUS_TX_TYPE,
      idempotencyKey: status.idempotencyKey,
      reference: status.idempotencyKey,
      description: campaign.title,
      metadata,
      entries: buildBonusCampaignEntries(userId, campaign),
      createdBy: userId,
    });
    const transactionId = result?.transaction?.id || null;
    const claim = transactionId
      ? await insertBonusClaim({ campaign, userId, transactionId, idempotencyKey: status.idempotencyKey }, runSql)
      : null;
    klog("bonus_campaign_claimed", {
      ...baseLog,
      transactionId,
    });
    return {
      ...status,
      eligible: false,
      alreadyClaimed: true,
      claimed: true,
      reason: "claimed",
      transactionId,
      claim,
      transaction: result?.transaction || null,
      entries: result?.entries || [],
      account: result?.account || null,
    };
  } catch (error) {
    klog("bonus_campaign_failed", {
      ...baseLog,
      reason: error?.code || error?.message || "server_error",
    });
    throw error;
  }
}

export {
  GENESIS_SYSTEM_KEY,
  PROMO_BONUS_TX_TYPE,
  buildBonusCampaignEntries,
  buildCampaignIdempotencyKey,
  claimBonusCampaign,
  getBonusCampaignStatus,
  listBonusCampaignStatuses,
  publicStatus,
};
