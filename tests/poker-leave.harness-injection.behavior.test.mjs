import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "12121212-1212-4121-8121-121212121212";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "leave-harness-inject" }),
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  updatePokerStateOptimistic: async () => ({ ok: true, newVersion: 2 }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) {
          return [{ version: 1, state: { tableId, phase: "INIT", seats: [{ userId, seatNo: 1 }], stacks: { [userId]: 100 }, pot: 0 } }];
        }
        if (text.includes("from public.poker_seats") && text.includes("for update")) {
          return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        }
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "leave-harness-inject", includeState: true }),
});

assert.ok(response && typeof response.statusCode === "number");
assert.notEqual(response.statusCode, 500);
console.log("poker-leave harness injection behavior test passed");
