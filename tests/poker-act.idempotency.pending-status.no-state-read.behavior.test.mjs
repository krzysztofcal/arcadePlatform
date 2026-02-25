import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const userId = "99999999-9999-4999-8999-999999999999";

const forbiddenReadSignatures = [
  "from public.poker_state",
  "from public.poker_tables",
  "from public.poker_seats",
];

const run = async () => {
  const queries = [];

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-pending-read" }),
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
    body: JSON.stringify({ tableId, requestId: "rid-pending-read", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 202);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.error, "request_pending");

  for (const signature of forbiddenReadSignatures) {
    assert.equal(queries.some((query) => query.includes(signature)), false, `unexpected read query: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act idempotency pending-status no-state-read behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
