import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const run = async () => {
  const queries = [];

  const handler = loadPokerHandler("netlify/functions/poker-heartbeat.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    ensurePokerRequest: async () => ({ status: "created" }),
    storePokerRequestResult: async () => {},
    deletePokerRequest: async () => {},
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).replace(/\s+/g, " ").trim().toLowerCase();
          queries.push(text);
          if (text.includes("select status from public.poker_tables")) return [{ status: "OPEN" }];
          if (text.includes("select seat_no from public.poker_seats")) return [{ seat_no: 2 }];
          if (text.includes("update public.poker_seats set status = 'active', last_seen_at = now()")) return [];
          if (text.includes("update public.poker_tables")) {
            throw new Error(`unexpected table mutation: ${params || []}`);
          }
          return [];
        },
      }),
    klog: () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "hb-1" }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(
    queries.some((q) => q.includes("update public.poker_seats set status = 'active', last_seen_at = now()")),
    true,
    "heartbeat should refresh active seat presence"
  );
  assert.equal(
    queries.some((q) => q.includes("update public.poker_tables") && q.includes("last_activity_at")),
    false,
    "heartbeat must not bump poker_tables.last_activity_at"
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
