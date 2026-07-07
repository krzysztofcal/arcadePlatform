import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCampaignIdempotencyKey,
  buildClaimPeriodKey,
  claimBonusCampaign,
  getBonusCampaignStatus,
  listBonusCampaignStatuses,
} from "../netlify/functions/_shared/bonus-campaigns.mjs";

const START_AT = "2025-06-01T00:00:00.000Z";
const BEFORE_USER = "00000000-0000-4000-8000-000000000001";
const AFTER_USER = "00000000-0000-4000-8000-000000000003";
const ALLOWLIST_USER = "00000000-0000-4000-8000-000000000004";

function createDeps() {
  const welcomeCampaign = {
    id: "10000000-0000-4000-8000-000000000001",
    code: "welcome-2026",
    title: "500 CH Welcome Bonus",
    description: "Create an account and claim your starter chips.",
    campaign_type: "welcome",
    amount: 500,
    status: "active",
    starts_at: START_AT,
    ends_at: null,
    eligibility_type: "created_after",
    eligibility_config: { created_at_gte: START_AT },
    claim_policy: "once",
    max_total_claims: null,
  };
  const allowlistCampaign = {
    id: "10000000-0000-4000-8000-000000000002",
    code: "vip-2026",
    title: "VIP Bonus",
    description: "Selected account bonus.",
    campaign_type: "vip",
    amount: 250,
    status: "active",
    starts_at: START_AT,
    ends_at: null,
    eligibility_type: "allowlist",
    eligibility_config: {},
    claim_policy: "once",
    max_total_claims: null,
  };
  const dailyCampaign = {
    id: "10000000-0000-4000-8000-000000000003",
    code: "daily-login",
    title: "Daily Login Bonus",
    description: "Claim once per UTC day.",
    campaign_type: "daily",
    amount: 25,
    status: "active",
    starts_at: START_AT,
    ends_at: null,
    eligibility_type: "all_accounts",
    eligibility_config: {},
    claim_policy: "daily",
    max_total_claims: null,
  };
  const campaigns = [welcomeCampaign, allowlistCampaign, dailyCampaign];
  const users = new Map([
    [BEFORE_USER, "2025-05-31T23:59:59.000Z"],
    [AFTER_USER, "2025-06-02T12:00:00.000Z"],
    [ALLOWLIST_USER, "2025-01-02T12:00:00.000Z"],
  ]);
  const allowlist = new Set([`${allowlistCampaign.id}:${ALLOWLIST_USER}`]);
  const txByKey = new Map();
  const claimsByCampaignUser = new Map();
  const posts = [];
  const deps = {
    async executeSql(query, params = []) {
      const text = String(query).toLowerCase().replace(/\s+/g, " ");
      if (text.includes("from public.bonus_campaigns")) {
        const code = params[0] || null;
        return code ? campaigns.filter((campaign) => campaign.code === code) : campaigns;
      }
      if (text.includes("from auth.users")) {
        const createdAt = users.get(params[0]);
        return createdAt ? [{ created_at: createdAt }] : [];
      }
      if (text.includes("from public.bonus_claims")) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const row = claimsByCampaignUser.get(key);
        return row ? [row] : [];
      }
      if (text.includes("from public.chips_transactions")) {
        const row = txByKey.get(params[1]);
        return row && row.user_id === params[0] ? [row] : [];
      }
      if (text.includes("from public.bonus_campaign_eligible_users")) {
        return allowlist.has(`${params[0]}:${params[1]}`) ? [{ "?column?": 1 }] : [];
      }
      if (text.includes("insert into public.bonus_claims")) {
        const row = {
          id: `claim-${claimsByCampaignUser.size + 1}`,
          campaign_id: params[0],
          user_id: params[1],
          transaction_id: params[2],
          idempotency_key: params[3],
          claim_period_key: params[4],
          claimed_at: "2026-07-07T00:00:00.000Z",
        };
        claimsByCampaignUser.set(`${params[0]}:${params[1]}:${params[4]}`, row);
        return [row];
      }
      throw new Error(`unexpected query: ${text}`);
    },
    async postTransaction(payload) {
      posts.push(payload);
      const existing = txByKey.get(payload.idempotencyKey);
      if (existing) {
        return { transaction: existing, entries: [], account: { balance: payload.metadata.amount } };
      }
      const transaction = {
        id: `tx-${posts.length}`,
        user_id: payload.userId,
        tx_type: payload.txType,
        idempotency_key: payload.idempotencyKey,
      };
      txByKey.set(payload.idempotencyKey, transaction);
      return { transaction, entries: payload.entries, account: { balance: payload.metadata.amount } };
    },
    posts,
    claimsByCampaignUser,
    txByKey,
  };
  return deps;
}

test("created-after welcome campaign preserves current eligibility boundary", async () => {
  const deps = createDeps();
  const before = await getBonusCampaignStatus(BEFORE_USER, "welcome-2026", deps);
  const after = await getBonusCampaignStatus(AFTER_USER, "welcome-2026", deps);

  assert.equal(before.eligible, false);
  assert.equal(before.reason, "created_before_start");
  assert.equal(after.eligible, true);
  assert.equal(after.reason, "eligible");
  assert.equal(after.campaign.amount, 500);
  assert.equal(after.idempotencyKey, buildCampaignIdempotencyKey("welcome-2026", AFTER_USER));
  assert.equal(after.claimPeriodKey, "once");
});

test("allowlist campaign only allows selected users", async () => {
  const deps = createDeps();
  const selected = await getBonusCampaignStatus(ALLOWLIST_USER, "vip-2026", deps);
  const other = await getBonusCampaignStatus(AFTER_USER, "vip-2026", deps);

  assert.equal(selected.eligible, true);
  assert.equal(other.eligible, false);
  assert.equal(other.reason, "not_allowlisted");
});

test("claim writes PROMO_BONUS ledger transaction and bonus claim row", async () => {
  const deps = createDeps();
  const result = await claimBonusCampaign(AFTER_USER, "welcome-2026", deps);
  const payload = deps.posts[0];

  assert.equal(result.claimed, true);
  assert.equal(result.transactionId, "tx-1");
  assert.equal(payload.txType, "PROMO_BONUS");
  assert.equal(payload.idempotencyKey, `bonus:welcome-2026:${AFTER_USER}`);
  assert.equal(payload.reference, payload.idempotencyKey);
  assert.equal(payload.metadata.source, "bonus_campaign");
  assert.equal(payload.metadata.campaign_code, "welcome-2026");
  assert.equal(payload.metadata.claim_policy, "once");
  assert.equal(payload.metadata.claim_period_key, "once");
  assert.deepEqual(
    payload.entries.map((entry) => ({
      accountType: entry.accountType,
      userId: entry.userId || null,
      systemKey: entry.systemKey || null,
      amount: entry.amount,
    })),
    [
      { accountType: "USER", userId: AFTER_USER, systemKey: null, amount: 500 },
      { accountType: "SYSTEM", userId: null, systemKey: "GENESIS", amount: -500 },
    ],
  );
  assert.equal(deps.claimsByCampaignUser.size, 1);
  assert.equal(JSON.stringify(payload).includes("guestChips"), false);
});

test("repeated claim does not grant a second bonus", async () => {
  const deps = createDeps();
  const first = await claimBonusCampaign(AFTER_USER, "welcome-2026", deps);
  const second = await claimBonusCampaign(AFTER_USER, "welcome-2026", deps);

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.alreadyClaimed, true);
  assert.equal(deps.posts.length, 1);
  assert.equal(deps.claimsByCampaignUser.size, 1);
});

test("daily claim policy grants once per UTC day", async () => {
  const deps = createDeps();
  const todayDeps = { ...deps, now: "2026-07-07T12:00:00.000Z" };
  const tomorrowDeps = { ...deps, now: "2026-07-08T00:00:01.000Z" };

  const first = await claimBonusCampaign(AFTER_USER, "daily-login", todayDeps);
  const second = await claimBonusCampaign(AFTER_USER, "daily-login", todayDeps);
  const third = await claimBonusCampaign(AFTER_USER, "daily-login", tomorrowDeps);

  assert.equal(buildClaimPeriodKey("daily", new Date("2026-07-07T12:00:00.000Z")), "2026-07-07");
  assert.equal(first.claimed, true);
  assert.equal(first.claimPeriodKey, "2026-07-07");
  assert.equal(second.claimed, false);
  assert.equal(second.reason, "already_claimed");
  assert.equal(third.claimed, true);
  assert.equal(third.claimPeriodKey, "2026-07-08");
  assert.deepEqual(
    deps.posts.map((post) => post.idempotencyKey),
    [`bonus:daily-login:${AFTER_USER}:2026-07-07`, `bonus:daily-login:${AFTER_USER}:2026-07-08`],
  );
  assert.equal(deps.claimsByCampaignUser.size, 2);
});

test("list helper returns public campaign status summaries", async () => {
  const deps = createDeps();
  const list = await listBonusCampaignStatuses(ALLOWLIST_USER, deps);

  assert.equal(list.items.length, 3);
  assert.deepEqual(
    list.items.map((item) => ({
      code: item.code,
      claimPolicy: item.claimPolicy,
      eligible: item.eligible,
      amount: item.amount,
    })),
    [
      { code: "welcome-2026", claimPolicy: "once", eligible: false, amount: 500 },
      { code: "vip-2026", claimPolicy: "once", eligible: true, amount: 250 },
      { code: "daily-login", claimPolicy: "daily", eligible: true, amount: 25 },
    ],
  );
});
