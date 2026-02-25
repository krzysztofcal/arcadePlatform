import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "56565656-5656-4656-8656-565656565656";
const userId = "78787878-7878-4878-8878-787878787878";
const requestId = "rid-stored-nonok";

const gameplayWriteSignatures = [
  "update public.poker_state set version = version + 1",
  "insert into public.poker_actions",
  "update public.poker_tables set last_activity_at = now()",
];

const run = async () => {
  const queries = [];

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeRequestId: (value) => ({ ok: true, value: value || requestId }),
    ensurePokerRequest: async () => ({ status: "stored", result: { pending: true, requestId } }),
    storePokerRequestResult: async () => {
      throw new Error("should_not_store_when_serving_stored_nonok_result");
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          queries.push(String(query).toLowerCase());
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId, action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 202);
  const body = JSON.parse(response.body || "{}");
  assert.deepEqual(body, { error: "request_pending", requestId });

  for (const signature of gameplayWriteSignatures) {
    assert.equal(queries.some((query) => query.includes(signature)), false, `unexpected gameplay write query: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act idempotency stored nonok object not-mutated behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
