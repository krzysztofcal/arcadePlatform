import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userId = "55555555-5555-4555-8555-555555555555";

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
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-stored" }),
    ensurePokerRequest: async () => ({
      status: "stored",
      result: {
        ok: true,
        tableId,
        replayed: false,
        state: { version: 99, state: { phase: "PREFLOP" } },
        me: { userId, isSeated: true, isLeft: true, isSitOut: false },
        myHoleCards: [],
        events: [],
        legalActions: [],
        actionConstraints: {},
      },
    }),
    storePokerRequestResult: async () => {
      throw new Error("should_not_store_when_request_is_already_stored");
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
    body: JSON.stringify({ tableId, requestId: "rid-stored", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.ok, true);
  assert.equal(body.replayed, true);

  for (const signature of writeSignatures) {
    assert.equal(queries.some((query) => query.includes(signature)), false, `unexpected write query: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act idempotency stored replay sets replayed true behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
