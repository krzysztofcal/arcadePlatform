import assert from "node:assert/strict";
import test from "node:test";

const {
  createAdminBonusCampaignsHandler,
} = await import("../netlify/functions/admin-bonus-campaigns.mjs");

const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000010";
const DRAFT_ID = "10000000-0000-4000-8000-000000000001";
const ACTIVE_ID = "10000000-0000-4000-8000-000000000002";
const PAUSED_EMPTY_ID = "10000000-0000-4000-8000-000000000003";
const PAUSED_CLAIMED_ID = "10000000-0000-4000-8000-000000000004";

function campaignRow(overrides = {}) {
  return {
    id: DRAFT_ID,
    code: "daily-test",
    title: "Daily Test",
    description: "Daily campaign",
    campaign_type: "daily",
    amount: 50,
    status: "draft",
    starts_at: "2026-07-07T00:00:00.000Z",
    ends_at: null,
    eligibility_type: "all_accounts",
    eligibility_config: {},
    claim_policy: "daily",
    max_total_claims: 100,
    created_by: ADMIN_USER_ID,
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    claim_count: 0,
    ...overrides,
  };
}

function createEvent(method, bodyOrQuery = {}) {
  return {
    httpMethod: method,
    headers: { origin: "https://arcade.test" },
    queryStringParameters: method === "GET" ? bodyOrQuery : {},
    body: method === "POST" ? JSON.stringify(bodyOrQuery) : null,
  };
}

function createHandler(options = {}) {
  const rows = new Map([
    [DRAFT_ID, campaignRow()],
    [ACTIVE_ID, campaignRow({
      id: ACTIVE_ID,
      code: "active-test",
      status: "active",
      claim_count: 2,
    })],
    [PAUSED_EMPTY_ID, campaignRow({
      id: PAUSED_EMPTY_ID,
      code: "paused-empty-test",
      status: "paused",
      claim_count: 0,
    })],
    [PAUSED_CLAIMED_ID, campaignRow({
      id: PAUSED_CLAIMED_ID,
      code: "paused-claimed-test",
      status: "paused",
      claim_count: 1,
    })],
  ]);
  const calls = [];
  const handler = createAdminBonusCampaignsHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: options.requireAdminUser || (async () => ({ userId: ADMIN_USER_ID })),
    executeSql: async (query, params = []) => {
      calls.push({ query, params });
      const text = String(query).replace(/\s+/g, " ").trim().toLowerCase();
      if (text.includes("from public.bonus_campaigns c") && text.includes("count(*) over()")) {
        return [...rows.values()].map((row) => ({ ...row, total_count: rows.size }));
      }
      if (text.includes("from public.bonus_campaigns c") && text.includes("where c.id = $1")) {
        const row = rows.get(params[0]);
        return row ? [row] : [];
      }
      if (text.startsWith("insert into public.bonus_campaigns")) {
        assert.equal(params.length, 12);
        const row = campaignRow({
          id: "10000000-0000-4000-8000-000000000099",
          code: params[0],
          title: params[1],
          description: params[2],
          campaign_type: params[3],
          amount: params[4],
          starts_at: params[5],
          ends_at: params[6],
          eligibility_type: params[7],
          eligibility_config: JSON.parse(params[8]),
          claim_policy: params[9],
          max_total_claims: params[10],
          created_by: params[11],
        });
        rows.set(row.id, row);
        return [row];
      }
      if (text.startsWith("update public.bonus_campaigns set title")) {
        const current = rows.get(params[0]);
        const next = {
          ...current,
          title: params[1],
          description: params[2],
          campaign_type: params[3],
          amount: params[4],
          starts_at: params[5],
          ends_at: params[6],
          eligibility_type: params[7],
          eligibility_config: JSON.parse(params[8]),
          claim_policy: params[9],
          max_total_claims: params[10],
        };
        rows.set(params[0], next);
        return [next];
      }
      if (text.startsWith("update public.bonus_campaigns set status")) {
        const current = rows.get(params[0]);
        const next = { ...current, status: params[1], claim_count: params[2] };
        rows.set(params[0], next);
        return [next];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  });
  return { calls, handler, rows };
}

test("admin-bonus-campaigns lists campaigns with claim counts", async () => {
  const { handler } = createHandler();
  const response = await handler(createEvent("GET", { page: "1", limit: "20" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.items.length, 4);
  assert.equal(body.items[0].claimPolicy, "daily");
  assert.equal(body.items[1].claimCount, 2);
});

test("admin-bonus-campaigns creates draft campaigns only", async () => {
  const { handler } = createHandler();
  const response = await handler(createEvent("POST", {
    action: "create",
    campaign: {
      code: "anniversary-2026",
      title: "Anniversary 2026",
      description: "Anniversary chips",
      campaignType: "anniversary",
      amount: 250,
      startsAt: "2026-07-10T00:00:00.000Z",
      endsAt: "2026-07-17T00:00:00.000Z",
      eligibilityType: "all_accounts",
      eligibilityConfig: {},
      claimPolicy: "once",
      maxTotalClaims: 500,
    },
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.campaign.status, "draft");
  assert.equal(body.campaign.code, "anniversary-2026");
  assert.equal(body.campaign.createdBy, ADMIN_USER_ID);
});

test("admin-bonus-campaigns rejects edits outside draft status", async () => {
  const { handler } = createHandler();
  const response = await handler(createEvent("POST", {
    action: "update",
    campaignId: ACTIVE_ID,
    campaign: {
      title: "Changed",
      campaignType: "active",
      amount: 999,
      startsAt: "2026-07-10T00:00:00.000Z",
      eligibilityType: "all_accounts",
      eligibilityConfig: {},
      claimPolicy: "once",
    },
  }));

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: "campaign_not_draft" });
});

test("admin-bonus-campaigns allows safe date edits for paused campaigns without claims", async () => {
  const { handler } = createHandler();
  const response = await handler(createEvent("POST", {
    action: "update",
    campaignId: PAUSED_EMPTY_ID,
    campaign: {
      title: "Paused Retimed",
      description: "Retimed paused campaign",
      campaignType: "daily",
      amount: 50,
      startsAt: "2026-07-15T00:00:00.000Z",
      endsAt: "2026-07-22T00:00:00.000Z",
      eligibilityType: "all_accounts",
      eligibilityConfig: {},
      claimPolicy: "daily",
      maxTotalClaims: 200,
    },
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.campaign.status, "paused");
  assert.equal(body.campaign.claimCount, 0);
  assert.equal(body.campaign.title, "Paused Retimed");
  assert.equal(body.campaign.startsAt, "2026-07-15T00:00:00.000Z");
  assert.equal(body.campaign.endsAt, "2026-07-22T00:00:00.000Z");
  assert.equal(body.campaign.maxTotalClaims, 200);
});

test("admin-bonus-campaigns keeps immutable fields locked after publication", async () => {
  const { handler } = createHandler();
  const response = await handler(createEvent("POST", {
    action: "update",
    campaignId: PAUSED_EMPTY_ID,
    campaign: {
      title: "Paused Retimed",
      campaignType: "daily",
      amount: 999,
      startsAt: "2026-07-15T00:00:00.000Z",
      eligibilityType: "all_accounts",
      eligibilityConfig: {},
      claimPolicy: "daily",
    },
  }));

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: "campaign_immutable_fields_locked" });
});

test("admin-bonus-campaigns rejects paused campaign edits after claims exist", async () => {
  const { handler } = createHandler();
  const response = await handler(createEvent("POST", {
    action: "update",
    campaignId: PAUSED_CLAIMED_ID,
    campaign: {
      title: "Paused Retimed",
      campaignType: "daily",
      amount: 50,
      startsAt: "2026-07-15T00:00:00.000Z",
      eligibilityType: "all_accounts",
      eligibilityConfig: {},
      claimPolicy: "daily",
    },
  }));

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), { error: "campaign_not_draft" });
});

test("admin-bonus-campaigns enforces status transitions", async () => {
  const { handler } = createHandler();
  const first = await handler(createEvent("POST", {
    action: "set_status",
    campaignId: DRAFT_ID,
    status: "active",
  }));
  const invalid = await handler(createEvent("POST", {
    action: "set_status",
    campaignId: DRAFT_ID,
    status: "draft",
  }));

  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).campaign.status, "active");
  assert.equal(invalid.statusCode, 409);
  assert.deepEqual(JSON.parse(invalid.body), { error: "invalid_status_transition" });
});
