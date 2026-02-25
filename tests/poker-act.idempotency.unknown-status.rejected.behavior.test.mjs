import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "abababab-abab-4bab-8bab-abababababab";
const userId = "12121212-3434-4545-8989-121212121212";

const forbiddenSignatures = [
  "from public.poker_state",
  "from public.poker_tables",
  "from public.poker_seats",
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
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-unknown-status" }),
    ensurePokerRequest: async () => ({ status: "weird_status" }),
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
    body: JSON.stringify({ tableId, requestId: "rid-unknown-status", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 409);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.error, "state_invalid");

  for (const signature of forbiddenSignatures) {
    assert.equal(queries.some((query) => query.includes(signature)), false, `unexpected query: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act idempotency unknown-status rejected behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
