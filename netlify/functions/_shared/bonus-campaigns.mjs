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
select id, campaign_id, user_id, transaction_id, idempotency_key, claim_period_key, claimed_at
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
select id, max_total_claims
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
    eligible: status.eligible,
    alreadyClaimed: status.alreadyClaimed,
    reason: status.reason,
    transactionId: status.transactionId || null,
  };
}

async function getBonusCampaignStatus(userId, campaignCode, deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const now = deps.now ? new Date(deps.now) : new Date();
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

  const claimPeriodKey = buildClaimPeriodKey(campaign.claimPolicy, now);
  const idempotencyKey = buildCampaignIdempotencyKey(campaign.code, userId, claimPeriodKey);
  const userCreatedAt = await fetchUserCreatedAt(userId, runSql);
  const claim = await fetchClaim(campaign.id, userId, claimPeriodKey, runSql);
  const transaction = claim ? null : await fetchPromoTransaction(userId, idempotencyKey, runSql);

  if (claim || transaction) {
    return {
      eligible: false,
      alreadyClaimed: true,
      reason: "already_claimed",
      campaign,
      claimPeriodKey,
      idempotencyKey,
      createdAt: userCreatedAt,
      transactionId: claim?.transaction_id || transaction?.id || null,
    };
  }

  const eligibility = await evaluateEligibility(campaign, userId, userCreatedAt, runSql);
  if (!eligibility.eligible) {
    return {
      eligible: false,
      alreadyClaimed: false,
      reason: eligibility.reason,
      campaign,
      claimPeriodKey,
      idempotencyKey,
      createdAt: userCreatedAt,
      transactionId: null,
    };
  }

  const maxTotalClaims = campaign.maxTotalClaims;
  if (Number.isInteger(maxTotalClaims) && maxTotalClaims > 0) {
    const claimCount = await fetchCampaignClaimCount(campaign.id, runSql);
    if (claimCount >= maxTotalClaims) {
      return {
        eligible: false,
        alreadyClaimed: false,
        reason: "max_total_claims_reached",
        campaign,
        claimPeriodKey,
        idempotencyKey,
        createdAt: userCreatedAt,
        transactionId: null,
      };
    }
  }

  return {
    eligible: true,
    alreadyClaimed: false,
    reason: "eligible",
    campaign,
    claimPeriodKey,
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

function buildBonusCampaignEntries(userId, campaign, claimPeriodKey = "once") {
  const shared = {
    source: "bonus_campaign",
    campaign_id: campaign.id,
    campaign_code: campaign.code,
    campaign_type: campaign.campaignType,
    claim_policy: campaign.claimPolicy,
    claim_period_key: claimPeriodKey,
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

async function insertBonusClaim({ campaign, userId, transactionId, idempotencyKey, claimPeriodKey }, runSql = executeSql) {
  const metadata = {
    source: "bonus_campaign",
    campaign_id: campaign.id,
    campaign_code: campaign.code,
    campaign_type: campaign.campaignType,
    claim_policy: campaign.claimPolicy,
    claim_period_key: claimPeriodKey,
    amount: campaign.amount,
  };
  const rows = await runSql(
    `
insert into public.bonus_claims (campaign_id, user_id, transaction_id, idempotency_key, claim_period_key, metadata)
values ($1, $2, $3, $4, $5, $6::jsonb)
on conflict (campaign_id, user_id, claim_period_key) do update
set metadata = public.bonus_claims.metadata
returning id, campaign_id, user_id, transaction_id, idempotency_key, claim_period_key, claimed_at;
`,
    [campaign.id, userId, transactionId, idempotencyKey, claimPeriodKey, JSON.stringify(metadata)],
  );
  return rows?.[0] || null;
}

async function claimBonusCampaign(userId, campaignCode, deps = {}) {
  const runSql = deps.executeSql || executeSql;
  const writeTransaction = deps.postTransaction || postTransaction;
  const begin = deps.beginSql || beginSql;
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
      claim_policy: campaign.claimPolicy,
      claim_period_key: status.claimPeriodKey,
      amount: campaign.amount,
    };
    const transactionResult = await begin(async (sqlTx) => {
      const txSql = (query, params = []) => sqlTx.unsafe(query, params);
      const lockedCampaign = await lockCampaign(campaign.id, txSql);
      if (!lockedCampaign) {
        return {
          missingCampaign: true,
          result: null,
          claim: null,
        };
      }

      const existingClaim = await fetchClaim(campaign.id, userId, status.claimPeriodKey, txSql);
      const existingTransaction = existingClaim
        ? null
        : await fetchPromoTransaction(userId, status.idempotencyKey, txSql);
      if (existingClaim || existingTransaction) {
        return {
          alreadyClaimed: true,
          transactionId: existingClaim?.transaction_id || existingTransaction?.id || null,
          result: existingTransaction ? { transaction: existingTransaction, entries: [], account: null } : null,
          claim: existingClaim || null,
        };
      }

      const maxTotalClaims = lockedCampaign.max_total_claims == null ? null : Number(lockedCampaign.max_total_claims);
      if (Number.isInteger(maxTotalClaims) && maxTotalClaims > 0) {
        const claimCount = await fetchCampaignClaimCount(campaign.id, txSql);
        if (claimCount >= maxTotalClaims) {
          return {
            limitReached: true,
            result: null,
            claim: null,
          };
        }
      }

      const result = await writeTransaction({
        userId,
        txType: PROMO_BONUS_TX_TYPE,
        idempotencyKey: status.idempotencyKey,
        reference: status.idempotencyKey,
        description: campaign.title,
        metadata,
        entries: buildBonusCampaignEntries(userId, campaign, status.claimPeriodKey),
        createdBy: userId,
        tx: sqlTx,
      });
      const transactionId = result?.transaction?.id || null;
      const claim = transactionId
        ? await insertBonusClaim({
            campaign,
            userId,
            transactionId,
            idempotencyKey: status.idempotencyKey,
            claimPeriodKey: status.claimPeriodKey,
          }, txSql)
        : null;
      return {
        result,
        transactionId,
        claim,
      };
    });

    if (transactionResult?.limitReached) {
      klog("bonus_campaign_skipped", {
        ...baseLog,
        reason: "max_total_claims_reached",
        transactionId: null,
      });
      return {
        ...status,
        eligible: false,
        alreadyClaimed: false,
        claimed: false,
        reason: "max_total_claims_reached",
        transaction: null,
        entries: [],
        account: null,
      };
    }

    if (transactionResult?.missingCampaign) {
      klog("bonus_campaign_skipped", {
        ...baseLog,
        reason: "campaign_not_found",
        transactionId: null,
      });
      return {
        ...status,
        eligible: false,
        alreadyClaimed: false,
        claimed: false,
        reason: "campaign_not_found",
        transaction: null,
        entries: [],
        account: null,
      };
    }

    if (transactionResult?.alreadyClaimed) {
      return {
        ...status,
        eligible: false,
        alreadyClaimed: true,
        claimed: false,
        reason: "already_claimed",
        transactionId: transactionResult.transactionId || null,
        claim: transactionResult.claim || null,
        transaction: transactionResult.result?.transaction || null,
        entries: transactionResult.result?.entries || [],
        account: transactionResult.result?.account || null,
      };
    }

    const result = transactionResult?.result || null;
    const transactionId = transactionResult?.transactionId || null;
    const claim = transactionResult?.claim || null;
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
  buildClaimPeriodKey,
  claimBonusCampaign,
  getBonusCampaignStatus,
  listBonusCampaignStatuses,
  publicStatus,
};
