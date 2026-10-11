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
const LIMITED_USER = "00000000-0000-4000-8000-000000000005";

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
  const limitedCampaign = {
    id: "10000000-0000-4000-8000-000000000004",
    code: "limited-2026",
    title: "Limited Bonus",
    description: "Only one total claim.",
    campaign_type: "limited",
    amount: 75,
    status: "active",
    starts_at: START_AT,
    ends_at: null,
    eligibility_type: "all_accounts",
    eligibility_config: {},
    claim_policy: "once",
    max_total_claims: 1,
  };
  const campaigns = [welcomeCampaign, allowlistCampaign, dailyCampaign, limitedCampaign];
  const users = new Map([
    [BEFORE_USER, "2025-05-31T23:59:59.000Z"],
    [AFTER_USER, "2025-06-02T12:00:00.000Z"],
    [ALLOWLIST_USER, "2025-01-02T12:00:00.000Z"],
    [LIMITED_USER, "2025-06-02T12:00:00.000Z"],
  ]);
  const allowlist = new Set([`${allowlistCampaign.id}:${ALLOWLIST_USER}`]);
  const txByKey = new Map();
  const claimsByCampaignUser = new Map();
  const posts = [];
  const deps = {
    async executeSql(query, params = []) {
      const text = String(query).toLowerCase().replace(/\s+/g, " ");
      if (text.includes("from public.bonus_campaigns")) {
        if (text.includes("for update")) {
          return campaigns.filter((campaign) => campaign.id === params[0]);
        }
        if (text.includes("campaign_type = 'poker_daily'")) return campaigns.filter((campaign) => campaign.campaign_type === "poker_daily" && ["active", "paused", "ended"].includes(campaign.status)).slice(0,1);
        const code = params[0] || null;
        return campaigns.filter((campaign) => campaign.status === "active" && (!code || campaign.code === code));
      }
      if (text.includes("from auth.users")) {
        const createdAt = users.get(params[0]);
        return createdAt ? [{ created_at: createdAt, is_anonymous: false }] : [];
      }
      if (text.includes("from public.bonus_claims")) {
        if (text.includes("count(*)")) {
          const campaignId = params[0];
          return [{
            claim_count: [...claimsByCampaignUser.values()]
              .filter((claim) => claim.campaign_id === campaignId)
              .length,
          }];
        }
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
          claimed_at: params[6] || "2026-07-07T00:00:00.000Z",
          metadata: JSON.parse(params[5]),
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
        metadata: payload.metadata,
        idempotency_key: payload.idempotencyKey,
      };
      txByKey.set(payload.idempotencyKey, transaction);
      return { transaction, entries: payload.entries, account: { balance: payload.metadata.amount } };
    },
    async beginSql(fn) {
      return await fn({
        unsafe: (query, params = []) => deps.executeSql(query, params),
      });
    },
    now: "2026-07-07T12:00:00Z",
    campaigns,
    users,
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

test("max_total_claims makes exhausted campaigns ineligible", async () => {
  const deps = createDeps();
  await claimBonusCampaign(AFTER_USER, "limited-2026", deps);

  const status = await getBonusCampaignStatus(LIMITED_USER, "limited-2026", deps);

  assert.equal(status.eligible, false);
  assert.equal(status.alreadyClaimed, false);
  assert.equal(status.reason, "max_total_claims_reached");
});

test("claim path does not post ledger transaction after max_total_claims is reached", async () => {
  const deps = createDeps();
  const first = await claimBonusCampaign(AFTER_USER, "limited-2026", deps);
  const second = await claimBonusCampaign(LIMITED_USER, "limited-2026", deps);

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.reason, "max_total_claims_reached");
  assert.equal(deps.posts.length, 1);
  assert.equal(deps.claimsByCampaignUser.size, 1);
});

test("list helper returns public campaign status summaries", async () => {
  const deps = createDeps();
  const runSql = deps.executeSql;
  let campaignReads = 0;
  deps.executeSql = async (query, params) => {
    if (String(query).includes('from public.bonus_campaigns')) campaignReads += 1;
    return runSql(query, params);
  };
  const list = await listBonusCampaignStatuses(ALLOWLIST_USER, deps);
  assert.equal(campaignReads, 1, 'evaluate listed campaign rows without per-code configuration re-reads');

  assert.equal(list.items.length, 4);
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
      { code: "limited-2026", claimPolicy: "once", eligible: true, amount: 75 },
    ],
  );
});

function pokerDailyDeps() {
  const deps = createDeps();
  Object.assign(deps.campaigns[2], { campaign_type: "poker_daily", eligibility_config: { daily_rewards: [25, 50, 100, 200] } });
  return deps;
}

test("Poker Daily progresses indefinitely, replays paid amount, and resets only after a missed UTC day", async () => {
  const deps = pokerDailyDeps();
  for (let day = 1; day <= 100; day++) {
    const now = new Date(Date.UTC(2026, 0, day, 23, 59, 59));
    const result = await claimBonusCampaign(BEFORE_USER, "daily-login", { ...deps, now });
    assert.equal(result.claimed, true);
    assert.equal(result.streakDay, day);
    assert.equal(result.campaign.amount, [25, 50, 100, 200][Math.min(day, 4) - 1]);
    const replay = await claimBonusCampaign(BEFORE_USER, "daily-login", { ...deps, now });
    assert.equal(replay.claimed, false);
    assert.equal(replay.campaign.amount, result.campaign.amount);
    assert.equal(replay.streakDay, day);
    assert.equal(deps.posts[day - 1].entries.reduce((sum, entry) => sum + entry.amount, 0), 0);
  }
  const reset = await claimBonusCampaign(BEFORE_USER, "daily-login", { ...deps, now: new Date(Date.UTC(2026, 0, 102)) });
  assert.equal(reset.streakDay, 1);
  assert.equal(reset.campaign.amount, 25);
});

test("Poker Daily rejects malformed rewards and anonymous accounts", async () => {
  const deps = pokerDailyDeps();
  deps.campaigns[2].eligibility_config.daily_rewards = [25, 50, 100];
  assert.equal((await claimBonusCampaign(AFTER_USER, "daily-login", deps)).reason, "invalid_daily_rewards");
  deps.campaigns[2].eligibility_config.daily_rewards = [25, 50, 100, 200];
  const sql = deps.executeSql;
  deps.executeSql = async (q, p) => String(q).includes("from auth.users") ? [{ created_at: START_AT, is_anonymous: true }] : sql(q, p);
  assert.equal((await claimBonusCampaign(AFTER_USER, "daily-login", deps)).reason, "guest_not_eligible");
  assert.equal(deps.posts.length, 0);
});

test("claim rechecks End and changed configuration after campaign row lock", async () => {
  for (const change of [{ status: "ended" }, { eligibility_config: { daily_rewards: [] } }]) {
    const deps = pokerDailyDeps();
    deps.beginSql = async (fn) => {
      Object.assign(deps.campaigns[2], change);
      return fn({ unsafe: deps.executeSql });
    };
    const result = await claimBonusCampaign(AFTER_USER, "daily-login", deps);
    assert.equal(result.claimed, false);
    assert.equal(deps.posts.length, 0);
  }
});

test("Poker Daily rejects corrupt yesterday receipts and missing ledger/receipt results", async () => {
  const deps = pokerDailyDeps();
  await claimBonusCampaign(AFTER_USER, "daily-login", { ...deps, now: "2026-12-31T23:59:59Z" });
  [...deps.claimsByCampaignUser.values()][0].metadata.streak_day = 0;
  const result = await claimBonusCampaign(AFTER_USER, "daily-login", { ...deps, now: "2027-01-01T00:00:00Z" });
  assert.equal(result.reason, "invalid_daily_claim");
  const broken = pokerDailyDeps();
  await assert.rejects(claimBonusCampaign(AFTER_USER, "daily-login", { ...broken, postTransaction: async () => ({}) }), /bonus_claim_write_failed/);
  const sql = broken.executeSql;
  broken.executeSql = async (q, p) => String(q).includes("insert into public.bonus_claims") ? [] : sql(q, p);
  await assert.rejects(claimBonusCampaign(AFTER_USER, "daily-login", broken), /bonus_claim_write_failed/);
});


test("UTC decision is taken after lock wait and boundary changes abort before ledger", async () => {
  const deps = pokerDailyDeps();
  let calls = 0;
  const moved = await claimBonusCampaign(AFTER_USER, "daily-login", { ...deps, now: "2026-12-31T23:59:59Z",
    transactionNow: async () => "2027-01-01T00:00:01Z" });
  assert.equal(moved.claimPeriodKey, "2027-01-01");
  assert.equal(moved.claim.claimed_at, "2027-01-01T00:00:01.000Z");
  const abort = await claimBonusCampaign(BEFORE_USER, "daily-login", { ...deps, now: "2027-01-01T23:59:59Z",
    transactionNow: async () => ++calls === 1 ? "2027-01-01T23:59:59Z" : "2027-01-02T00:00:00Z" });
  assert.equal(abort.reason, "claim_period_changed");
  assert.equal(deps.posts.length, 1);
});

test("Daily paid evidence must match ledger; configured amounts are authoritative under lock", async () => {
  const deps = pokerDailyDeps();
  deps.beginSql = async (fn) => {
    deps.campaigns[2].amount = 30;
    deps.campaigns[2].eligibility_config.daily_rewards = [30,60,120,240];
    return fn({ unsafe: deps.executeSql });
  };
  const first = await claimBonusCampaign(AFTER_USER, "daily-login", deps);
  assert.equal(first.campaign.amount, 30);
  deps.txByKey.get(first.idempotencyKey).metadata.amount = 31;
  assert.equal((await getBonusCampaignStatus(AFTER_USER, "daily-login", deps)).reason, "invalid_daily_claim");
});


test("Daily status projection is unavailable before publication and shows claimed/paused server progress", async () => {
  const deps = pokerDailyDeps();
  deps.campaigns[2].status = "draft";
  assert.equal((await listBonusCampaignStatuses(AFTER_USER, { ...deps, includeDailyStatus: true })).dailyBonus, null);
  deps.campaigns[2].status = "active";
  await claimBonusCampaign(AFTER_USER, "daily-login", deps);
  const paid = await listBonusCampaignStatuses(AFTER_USER, { ...deps, includeDailyStatus: true });
  assert.equal(paid.dailyBonus.streakDay, 1);
  assert.equal(paid.dailyBonus.alreadyClaimed, true);
  deps.campaigns[2].status = "paused";
  const paused = await listBonusCampaignStatuses(AFTER_USER, { ...deps, includeDailyStatus: true, now: "2026-07-08T00:00:00Z" });
  assert.equal(paused.dailyBonus.status, "paused");
  assert.equal(paused.dailyBonus.eligible, false);
  assert.equal(paused.dailyBonus.amount, 50);
  assert.equal(paused.dailyBonus.nextEligibleAt, "2026-07-09T00:00:00.000Z");
});

test("Daily receipt without matching PROMO_BONUS transaction fails closed for replay and continuation", async () => {
  const deps = pokerDailyDeps();
  const today = "2026-07-07T12:00:00Z";
  const first = await claimBonusCampaign(AFTER_USER, "daily-login", { ...deps, now: today });
  assert.equal(first.claimed, true);
  deps.txByKey.delete(first.idempotencyKey);

  for (const now of [today, "2026-07-08T00:00:00Z"]) {
    const status = await getBonusCampaignStatus(AFTER_USER, "daily-login", { ...deps, now });
    assert.equal(status.eligible, false);
    assert.equal(status.reason, "invalid_daily_claim");
    const result = await claimBonusCampaign(AFTER_USER, "daily-login", { ...deps, now });
    assert.equal(result.claimed, false);
    assert.equal(result.reason, "invalid_daily_claim");
  }
  assert.equal(deps.posts.length, 1);
  assert.equal(deps.claimsByCampaignUser.size, 1);
});


test("combined campaign list retains Welcome and authoritative Daily status with two configuration reads", async () => {
  const deps = pokerDailyDeps();
  await claimBonusCampaign(AFTER_USER, "daily-login", deps);
  const runSql = deps.executeSql;
  let campaignReads = 0;
  deps.executeSql = async (query, params) => {
    if (String(query).includes('from public.bonus_campaigns')) campaignReads += 1;
    return runSql(query, params);
  };
  const result = await listBonusCampaignStatuses(AFTER_USER, { ...deps, includeDailyStatus: true });
  assert.equal(campaignReads, 2, 'one active list plus separate latest Daily selector');
  assert.equal(result.items.find(item => item.campaignType === 'welcome').amount, 500);
  assert.equal(result.dailyBonus.alreadyClaimed, true);
  assert.equal(result.dailyBonus.streakDay, 1);
  assert.equal(result.dailyBonus.amount, 25);
  assert.equal(result.dailyBonus.nextEligibleAt, '2026-07-08T00:00:00.000Z');
  deps.campaigns[2].status = 'paused';
  campaignReads = 0;
  const paused = await listBonusCampaignStatuses(AFTER_USER, { ...deps, includeDailyStatus: true });
  assert.equal(campaignReads, 2);
  assert.equal(paused.items.some(item => item.campaignType === 'poker_daily'), false);
  assert.equal(paused.dailyBonus.status, 'paused');
  assert.equal(paused.dailyBonus.eligible, false);
});
