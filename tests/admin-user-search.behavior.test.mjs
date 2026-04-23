import assert from "node:assert/strict";
import test from "node:test";

const { createAdminUserSearchHandler } = await import("../netlify/functions/admin-user-search.mjs");

function createEvent(query) {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test" },
    queryStringParameters: { q: query },
  };
}

test("admin-user-search supports email queries", async () => {
  const handler = createAdminUserSearchHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    searchUsers: async (query) => {
      assert.equal(query, "player@example.com");
      return [{ userId: "00000000-0000-4000-8000-000000000030", email: "player@example.com", displayName: "Player" }];
    },
  });
  const response = await handler(createEvent("player@example.com"));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.items[0].email, "player@example.com");
});

test("admin-user-search supports userId queries", async () => {
  const handler = createAdminUserSearchHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    searchUsers: async (query) => {
      assert.equal(query, "00000000-0000-4000-8000-000000000031");
      return [{ userId: query, email: "target@example.com", displayName: "Target" }];
    },
  });
  const response = await handler(createEvent("00000000-0000-4000-8000-000000000031"));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.items[0].userId, "00000000-0000-4000-8000-000000000031");
});
