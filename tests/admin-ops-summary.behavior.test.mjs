import assert from "node:assert/strict";
import test from "node:test";

const { createAdminOpsSummaryHandler, loadLedgerCapacity, loadPokerEscrowResidualSummary, resolveLedgerDbWarningMb } = await import("../netlify/functions/admin-ops-summary.mjs");

function createEvent() {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters: {},
  };
}

test("admin-ops-summary returns ops contract", async () => {
  const handler = createAdminOpsSummaryHandler({
    env: { CHIPS_ENABLED: "0" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    loadOpsSummary: async () => ({
      janitor: { openTableCount: 4, staleHumanSeatCount: 2, staleOpenTableCount: 1, flaggedTableCount: 3, idleThresholdMinutes: 15 },
      recentJanitorActivity: { adminActions: [], cleanupTransactions: [] },
      runtime: { buildId: "abc123", chipsEnabled: false, adminUserIdsConfigured: true, janitorConfig: {}, wsHealth: { available: true, ok: true, status: 200 }, healthy: false },
    }),
  });
  const response = await handler(createEvent());
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.janitor.openTableCount, 4);
  assert.equal(body.runtime.buildId, "abc123");
  assert.equal(body.runtime.chipsEnabled, false);
  assert.equal(body.runtime.healthy, false);
});

test("admin-ops-summary still rejects a non-admin during maintenance", async () => {
  let loadCalls = 0;
  const handler = createAdminOpsSummaryHandler({
    env: { CHIPS_ENABLED: "0" },
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
    loadOpsSummary: async () => {
      loadCalls += 1;
      return {};
    },
  });
  const response = await handler(createEvent());

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "admin_required" });
  assert.equal(loadCalls, 0);
});

test("admin-ops-summary maps a PostgreSQL summary failure to the isolation probe contract", async () => {
  const handler = createAdminOpsSummaryHandler({
    env: { CHIPS_ENABLED: "0" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    loadOpsSummary: async () => {
      const error = new Error("connect timeout");
      error.code = "CONNECT_TIMEOUT";
      throw error;
    },
  });
  const response = await handler(createEvent());

  assert.equal(response.statusCode, 500);
  assert.equal(response.body, JSON.stringify({ error: "server_error" }));
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

function ledgerRowFixture() {
  return [{
    tx_rows: 19800,
    entry_rows: 39700,
    tx_table_bytes: 20000000,
    tx_index_bytes: 4000000,
    tx_total_bytes: 24000000,
    entry_table_bytes: 10000000,
    entry_index_bytes: 3000000,
    entry_total_bytes: 13000000,
    db_total_bytes: 200000000,
  }];
}

test("ledger capacity maps SQL rows to the ops contract with table/index/total sizes", async () => {
  const summary = await loadLedgerCapacity(
    { ADMIN_LEDGER_DB_WARNING_MB: "800" },
    async () => ledgerRowFixture(),
  );

  assert.equal(summary.available, true);
  assert.equal(summary.transactionRowCount, 19800);
  assert.equal(summary.entryRowCount, 39700);
  assert.equal(summary.transactionTableBytes, 20000000);
  assert.equal(summary.transactionIndexBytes, 4000000);
  assert.equal(summary.transactionTotalBytes, 24000000);
  assert.equal(summary.entryTableBytes, 10000000);
  assert.equal(summary.entryIndexBytes, 3000000);
  assert.equal(summary.entryTotalBytes, 13000000);
  assert.equal(summary.ledgerTotalBytes, 37000000);
  assert.equal(summary.dbTotalBytes, 200000000);
  assert.equal(summary.ledgerSharePercent, 18.5);
  assert.equal(summary.warningThresholdBytes, 800 * 1024 * 1024);
  assert.equal(summary.capacityStatus, "OK");
  assert.ok(typeof summary.measuredAt === "string" && summary.measuredAt.length > 0);
});

test("ledger capacity reports warning when database size reaches the threshold", async () => {
  const summary = await loadLedgerCapacity(
    { ADMIN_LEDGER_DB_WARNING_MB: "100" },
    async () => [{
      tx_rows: 19800, entry_rows: 39700,
      tx_table_bytes: 20000000, tx_index_bytes: 4000000, tx_total_bytes: 24000000,
      entry_table_bytes: 10000000, entry_index_bytes: 3000000, entry_total_bytes: 13000000,
      db_total_bytes: 200 * 1024 * 1024,
    }],
  );

  assert.equal(summary.available, true);
  assert.equal(summary.warningThresholdBytes, 100 * 1024 * 1024);
  assert.equal(summary.capacityStatus, "warning");
});

test("ledger capacity stays OK when the warning threshold is disabled", async () => {
  const summary = await loadLedgerCapacity(
    { ADMIN_LEDGER_DB_WARNING_MB: "0" },
    async () => ledgerRowFixture(),
  );

  assert.equal(summary.available, true);
  assert.equal(summary.warningThresholdBytes, 0);
  assert.equal(summary.capacityStatus, "OK");
  assert.ok(summary.transactionRowCount > 0, "measurements still reported when threshold disabled");
});

test("ledger capacity falls back to the default threshold for invalid env values", () => {
  assert.equal(resolveLedgerDbWarningMb("abc"), 800);
  assert.equal(resolveLedgerDbWarningMb("-5"), 800);
  assert.equal(resolveLedgerDbWarningMb("1.9"), 800);
  assert.equal(resolveLedgerDbWarningMb(undefined), 800);
  assert.equal(resolveLedgerDbWarningMb(""), 800);
  assert.equal(resolveLedgerDbWarningMb("120"), 120);
});

test("ledger capacity returns available:false without raw error on SQL failure", async () => {
  const summary = await loadLedgerCapacity(
    { ADMIN_LEDGER_DB_WARNING_MB: "800" },
    async () => { throw Object.assign(new Error("connect timeout"), { code: "CONNECT_TIMEOUT" }); },
  );

  assert.equal(summary.available, false);
  assert.equal(summary.transactionRowCount, null);
  assert.equal(summary.dbTotalBytes, null);
  assert.equal(summary.capacityStatus, null);
  assert.equal("error" in summary, false);
  assert.equal(summary.warningThresholdBytes, 800 * 1024 * 1024);
});
