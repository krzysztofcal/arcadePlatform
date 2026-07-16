import assert from "node:assert/strict";
import test from "node:test";

const { createAdminOpsSummaryHandler, loadPokerEscrowResidualSummary } = await import("../netlify/functions/admin-ops-summary.mjs");

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

test("poker escrow monitoring treats positive orphan escrow as a problem", async () => {
  let capturedSql = "";
  const summary = await loadPokerEscrowResidualSummary(async (sql) => {
    capturedSql = sql;
    return [{
      total_account_count: 3,
      closed_residual_table_count: 0,
      closed_residual_chips: 0,
      orphan_residual_account_count: 1,
      orphan_residual_chips: 500,
      problem_account_count: 1,
      problem_chips: 500,
      largest_residual_chips: 500,
      latest_escrow_update_at: "2026-07-16T15:00:00.000Z",
      items: [{ tableId: "missing-table", balance: 500, status: "ORPHANED" }],
    }];
  });

  assert.match(capturedSql, /left join public\.poker_tables/i);
  assert.match(capturedSql, /t\.id is null/i);
  assert.equal(summary.closedResidualTableCount, 0);
  assert.equal(summary.orphanResidualAccountCount, 1);
  assert.equal(summary.problemAccountCount, 1);
  assert.equal(summary.problemChips, 500);
  assert.equal(summary.latestEscrowUpdateAt, "2026-07-16T15:00:00.000Z");
  assert.equal(summary.items[0].status, "ORPHANED");
});
