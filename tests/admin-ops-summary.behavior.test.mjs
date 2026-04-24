import assert from "node:assert/strict";
import test from "node:test";

const { createAdminOpsSummaryHandler } = await import("../netlify/functions/admin-ops-summary.mjs");

function createEvent() {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters: {},
  };
}

test("admin-ops-summary returns ops contract", async () => {
  const handler = createAdminOpsSummaryHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    loadOpsSummary: async () => ({
      janitor: { openTableCount: 4, staleHumanSeatCount: 2, staleOpenTableCount: 1, flaggedTableCount: 3, idleThresholdMinutes: 15 },
      recentJanitorActivity: { adminActions: [], cleanupTransactions: [] },
      runtime: { buildId: "abc123", chipsEnabled: true, adminUserIdsConfigured: true, janitorConfig: {}, wsHealth: { available: true, ok: true, status: 200 }, healthy: true },
    }),
  });
  const response = await handler(createEvent());
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.janitor.openTableCount, 4);
  assert.equal(body.runtime.buildId, "abc123");
  assert.equal(body.runtime.healthy, true);
});
