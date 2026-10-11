import assert from "node:assert/strict";
import test from "node:test";

const { createBonusCampaignsHandler } = await import("../netlify/functions/bonus-campaigns.mjs");

const USER_ID = "00000000-0000-4000-8000-000000000003";

function createEvent(method, body = null) {
  return {
    httpMethod: method,
    headers: {
      origin: "https://arcade.test",
      authorization: "Bearer token",
    },
    body: body == null ? null : JSON.stringify(body),
  };
}

test("bonus-campaigns GET returns only claimable campaigns", async () => {
  const handler = createBonusCampaignsHandler({
    env: { CHIPS_ENABLED: "1" },
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    listBonusCampaignStatuses: async (userId) => {
      assert.equal(userId, USER_ID);
      return {
        items: [
          { code: "daily-active-2026", title: "Daily bonus", amount: 20, eligible: true, alreadyClaimed: false, claimPolicy: "daily", reason: "eligible" },
          { code: "welcome-2026", title: "Welcome", amount: 500, eligible: false, alreadyClaimed: true, claimPolicy: "once", reason: "already_claimed" },
        ],
      };
    },
  });

  const response = await handler(createEvent("GET"));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.items.map((item) => item.code), ["daily-active-2026"]);
  assert.equal(body.items[0].amount, 20);
  assert.equal(body.items[0].claimPolicy, "daily");
});

test("bonus-campaigns POST claims the requested campaign code", async () => {
  let seen = null;
  const handler = createBonusCampaignsHandler({
    env: { CHIPS_ENABLED: "1" },
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    claimBonusCampaign: async (userId, code) => {
      seen = { userId, code };
      return {
        claimed: true,
        eligible: false,
        alreadyClaimed: true,
        reason: "claimed",
        transactionId: "tx-1",
        campaign: { code, title: "Daily bonus", amount: 20 },
        transaction: { id: "tx-1" },
        account: { balance: 916 },
      };
    },
  });

  const response = await handler(createEvent("POST", { code: "daily-active-2026" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, { userId: USER_ID, code: "daily-active-2026" });
  assert.equal(body.claimed, true);
  assert.equal(body.code, "daily-active-2026");
  assert.equal(body.amount, 20);
});

test("bonus-campaigns POST rejects invalid campaign codes", async () => {
  const handler = createBonusCampaignsHandler({
    env: { CHIPS_ENABLED: "1" },
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
  });

  const response = await handler(createEvent("POST", { code: "../bad" }));

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_campaign_code" });
});


test("opt-in Daily status includes claimed/paused state without changing default GET", async () => {
  const dailyBonus = { code: "daily-streak", status: "paused", amount: 200, streakDay: 5, alreadyClaimed: true };
  const handler = createBonusCampaignsHandler({ env: { CHIPS_ENABLED: "1" },
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    listBonusCampaignStatuses: async (_user, options) => ({ items: [], ...(options.includeDailyStatus ? { dailyBonus } : {}) }) });
  const ordinary = await handler(createEvent("GET"));
  assert.deepEqual(JSON.parse(ordinary.body), { items: [] });
  const daily = await handler({ ...createEvent("GET"), queryStringParameters: { includeDailyStatus: "1" } });
  assert.deepEqual(JSON.parse(daily.body).dailyBonus, dailyBonus);
});

test("Poker Daily POST exposes actual paid amount and uncapped streak", async () => {
  const handler = createBonusCampaignsHandler({ env: { CHIPS_ENABLED: "1" },
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    claimBonusCampaign: async () => ({ claimed: true, eligible: false, alreadyClaimed: true,
      streakDay: 100, rewardDay: 4, transactionId: "paid-tx",
      claimPeriodKey: "daily:2026-10-11", nextEligibleAt: "2026-10-12T00:00:00.000Z",
      serverNow: "2026-10-11T12:00:00.000Z",
      campaign: { code: "daily-streak", campaignType: "poker_daily", amount: 200 } }) });
  const response = await handler(createEvent("POST", { code: "daily-streak" }));
  const body = JSON.parse(response.body);
  assert.equal(body.amount, 200);
  assert.equal(body.streakDay, 100);
  assert.equal(body.rewardDay, 4);
  assert.equal(body.eligible, false);
  assert.equal(body.alreadyClaimed, true);
  assert.equal(body.claimed, true);
  assert.equal(body.transactionId, "paid-tx");
  assert.equal(body.claimPeriodKey, "daily:2026-10-11");
  assert.equal(body.nextEligibleAt, "2026-10-12T00:00:00.000Z");
  assert.equal(body.serverNow, "2026-10-11T12:00:00.000Z");
});
