import assert from "node:assert/strict";
import test from "node:test";

const { createAdminMeHandler } = await import("../netlify/functions/admin-me.mjs");
const { createAdminUserBalanceHandler } = await import("../netlify/functions/admin-user-balance.mjs");
const { createAdminUserLedgerHandler } = await import("../netlify/functions/admin-user-ledger.mjs");

function event(method, queryStringParameters = {}) {
  return {
    httpMethod: method,
    headers: { origin: "https://arcade.test" },
    queryStringParameters,
  };
}

test("admin-me returns admin payload for an allowlisted caller", async () => {
  const handler = createAdminMeHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
  });
  const response = await handler(event("GET"));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    ok: true,
    isAdmin: true,
    userId: "00000000-0000-4000-8000-000000000010",
  });
});

test("admin-me fails closed for non-admin callers", async () => {
  const handler = createAdminMeHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
  });
  const response = await handler(event("GET"));

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "admin_required" });
});

test("admin-user-balance returns target user balance", async () => {
  let seenUserId = null;
  const handler = createAdminUserBalanceHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    getUserBalance: async (userId) => {
      seenUserId = userId;
      return { accountId: "acct-55", balance: 1234, nextEntrySeq: 9, status: "active" };
    },
  });
  const response = await handler(event("GET", { userId: "00000000-0000-4000-8000-000000000055" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(seenUserId, "00000000-0000-4000-8000-000000000055");
  assert.equal(body.balance, 1234);
  assert.equal(body.userId, "00000000-0000-4000-8000-000000000055");
});

test("admin-user-ledger returns target user entries with cursor params", async () => {
  let seenArgs = null;
  const handler = createAdminUserLedgerHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: async () => ({ userId: "00000000-0000-4000-8000-000000000010" }),
    listUserLedger: async (userId, options) => {
      seenArgs = { userId, options };
      return {
        items: [
          {
            entry_seq: 7,
            amount: -50,
            tx_type: "ADMIN_ADJUST",
            description: "rollback",
          },
        ],
        nextCursor: "cursor-2",
      };
    },
  });
  const response = await handler(event("GET", {
    userId: "00000000-0000-4000-8000-000000000077",
    cursor: "cursor-1",
    limit: "15",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-chips-ledger-version"] != null, true);
  assert.deepEqual(seenArgs, {
    userId: "00000000-0000-4000-8000-000000000077",
    options: { cursor: "cursor-1", limit: 15 },
  });
  assert.equal(body.items.length, 1);
  assert.equal(body.nextCursor, "cursor-2");
});
