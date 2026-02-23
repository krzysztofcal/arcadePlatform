import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let stateUpdateCount = 0;
let seatDeleteCount = 0;

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: () => ({ ok: true, value: "missing-state" }),
  updatePokerStateOptimistic,
  ensurePokerRequest: async () => ({ status: "proceed" }),
  storePokerRequestResult: async () => {},
  deletePokerRequest: async () => {},
  applyLeaveTable: () => ({ state: null, events: [] }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) {
          return [{
            version: 1,
            state: {
              tableId,
              phase: "INIT",
              seats: [{ userId, seatNo: 1 }],
              stacks: { [userId]: 100 },
              pot: 0,
            },
          }];
        }
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 100 }];
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          stateUpdateCount += 1;
          return [{ version: 2 }];
        }
        if (text.includes("delete from public.poker_seats")) {
          seatDeleteCount += 1;
          return [];
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
  body: JSON.stringify({ tableId, requestId: "missing-state", includeState: true }),
});

assert.equal(response.statusCode, 409);
const body = JSON.parse(response.body || "{}");
assert.equal(body.error, "state_invalid");
assert.equal(stateUpdateCount, 0);
assert.equal(seatDeleteCount, 0);

console.log("poker-leave reducer missing state does not wipe behavior test passed");
