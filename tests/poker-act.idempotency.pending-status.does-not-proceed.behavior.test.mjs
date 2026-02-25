import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const userId = "88888888-8888-4888-8888-888888888888";

const writeSignatures = [
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
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-pending" }),
    ensurePokerRequest: async () => ({ status: "pending" }),
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
    body: JSON.stringify({ tableId, requestId: "rid-pending", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 202);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.error, "request_pending");
  for (const signature of writeSignatures) {
    assert.equal(queries.some((query) => query.includes(signature)), false, `unexpected write query: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act idempotency pending-status does-not-proceed behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
