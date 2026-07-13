import assert from "node:assert/strict";
import test from "node:test";

const { createChipsLedgerHandler } = await import("../netlify/functions/chips-ledger.mjs");

const USER_ID = "00000000-0000-4000-8000-000000000123";

function event(queryStringParameters) {
  return {
    httpMethod: "GET",
    headers: { origin: "https://arcade.test", authorization: "Bearer token" },
    queryStringParameters,
  };
}

test("chips-ledger forwards numbered pagination and returns total page metadata", async () => {
  let seen = null;
  const handler = createChipsLedgerHandler({
    env: { CHIPS_ENABLED: "1" },
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
    listUserLedgerPage: async (userId, options) => {
      seen = { userId, options };
      return {
        items: [{ entry_seq: 51, amount: 25 }],
        pagination: { page: 6, limit: 10, total: 96, totalPages: 10, hasPreviousPage: true, hasNextPage: true },
      };
    },
  });

  const response = await handler(event({ page: "6", limit: "10" }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, { userId: USER_ID, options: { page: 6, limit: 10 } });
  assert.equal(body.pagination.totalPages, 10);
  assert.equal(body.pagination.total, 96);
  assert.equal(body.items[0].entry_seq, 51);
});

test("chips-ledger rejects invalid numbered pages", async () => {
  const handler = createChipsLedgerHandler({
    env: { CHIPS_ENABLED: "1" },
    verifySupabaseJwt: async () => ({ valid: true, userId: USER_ID }),
  });

  const response = await handler(event({ page: "0", limit: "10" }));
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_page" });
});
