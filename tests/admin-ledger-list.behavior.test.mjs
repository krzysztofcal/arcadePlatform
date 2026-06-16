import assert from "node:assert/strict";
import test from "node:test";

const { createAdminLedgerListHandler } = await import("../netlify/functions/admin-ledger-list.mjs");

function createEvent(queryStringParameters = {}) {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters,
  };
}

test("admin-ledger-list forwards filters and pagination", async () => {
  let seen = null;
  const handler = createAdminLedgerListHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    listLedger: async (query) => {
      seen = query;
      return {
        items: [{ transactionId: "tx-1", txType: "ADMIN_ADJUST", amount: -50 }],
        pagination: { page: 3, limit: 25, total: 81, totalPages: 4, hasNextPage: true, hasPrevPage: true },
      };
    },
  });
  const response = await handler(createEvent({
    userId: "00000000-0000-4000-8000-000000000022",
    txType: "ADMIN_ADJUST",
    page: "3",
    adminOnly: "1",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, {
    userId: "00000000-0000-4000-8000-000000000022",
    txType: "ADMIN_ADJUST",
    page: "3",
    adminOnly: "1",
  });
  assert.equal(body.items[0].txType, "ADMIN_ADJUST");
  assert.equal(body.pagination.totalPages, 4);
});
