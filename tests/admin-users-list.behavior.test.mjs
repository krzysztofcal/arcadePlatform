import assert from "node:assert/strict";
import test from "node:test";

const { createAdminUsersListHandler } = await import("../netlify/functions/admin-users-list.mjs");

function createEvent(queryStringParameters = {}) {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters,
  };
}

test("admin-users-list forwards filters and pagination", async () => {
  let seen = null;
  const handler = createAdminUsersListHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    listUsers: async (query) => {
      seen = query;
      return {
        items: [{ userId: "00000000-0000-4000-8000-000000000020", email: "player@example.com" }],
        pagination: { page: 2, limit: 15, total: 31, totalPages: 3, hasNextPage: true, hasPrevPage: true },
      };
    },
  });
  const response = await handler(createEvent({
    q: "player@example.com",
    page: "2",
    limit: "15",
    hasBalance: "1",
    sort: "balance_desc",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, {
    q: "player@example.com",
    page: "2",
    limit: "15",
    hasBalance: "1",
    sort: "balance_desc",
  });
  assert.equal(body.items.length, 1);
  assert.equal(body.pagination.page, 2);
  assert.equal(body.pagination.total, 31);
});
