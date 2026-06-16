import assert from "node:assert/strict";
import test from "node:test";

const { createAdminTablesListHandler } = await import("../netlify/functions/admin-tables-list.mjs");

function createEvent(queryStringParameters = {}) {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters,
  };
}

test("admin-tables-list forwards filters and pagination", async () => {
  let seen = null;
  const handler = createAdminTablesListHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    listTables: async (query) => {
      seen = query;
      return {
        items: [{ tableId: "00000000-0000-4000-8000-000000000111", status: "OPEN", janitor: { healthy: false, reasonCode: "stale_human_last_seen_expired" } }],
        pagination: { page: 1, limit: 20, total: 4, totalPages: 1, hasNextPage: false, hasPrevPage: false },
      };
    },
  });
  const response = await handler(createEvent({
    status: "OPEN",
    hasStaleSeats: "1",
    idleMinutes: "15",
    sort: "last_activity_desc",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, {
    status: "OPEN",
    hasStaleSeats: "1",
    idleMinutes: "15",
    sort: "last_activity_desc",
  });
  assert.equal(body.items[0].janitor.reasonCode, "stale_human_last_seen_expired");
  assert.equal(body.pagination.total, 4);
});
