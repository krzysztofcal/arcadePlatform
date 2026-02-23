import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "shape-compat" }),
  updatePokerStateOptimistic,
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) {
          return [{ version: 1, state: { tableId, phase: "INIT", seats: [{ userId, seatNo: 1 }], stacks: { [userId]: 50 }, pot: 0 } }];
        }
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 50 }];
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) return [{ version: 2 }];
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-1" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "shape-compat" }),
});

assert.equal(response.statusCode, 200);
const body = JSON.parse(response.body || "{}");
assert.equal(body.ok, true);
assert.equal(body.tableId, tableId);
assert.equal(typeof body.cashedOut, "number");
assert.equal(Object.prototype.hasOwnProperty.call(body, "seatNo"), true);
assert.equal(Object.prototype.hasOwnProperty.call(body, "state"), false);

console.log("poker-leave response shape compat behavior test passed");
