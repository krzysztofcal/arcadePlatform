import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "44444444-4444-4444-8444-444444444444";
const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherUserId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let nextStatePersisted = null;

const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  normalizeRequestId: (value) => ({ ok: true, value }),
  updatePokerStateOptimistic,
  beginSql: async (fn) =>
    fn({
      unsafe: async (query, params) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
        if (text.includes("from public.poker_state")) {
          return [{
            version: 10,
            state: {
              tableId,
              phase: "INIT",
              seats: [{ userId, seatNo: 2 }, { userId: otherUserId, seatNo: 4 }],
              stacks: { [userId]: 125, [otherUserId]: 140 },
              holeCardsByUserId: { [userId]: [{ r: "A", s: "S" }, { r: "A", s: "H" }] },
              deck: [{ r: "K", s: "S" }],
              pot: 0,
            },
          }];
        }
        if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 2, status: "ACTIVE", stack: 125 }];
        if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
          nextStatePersisted = JSON.parse(params?.[2] || "{}");
          return [{ version: 11 }];
        }
        return [];
      },
    }),
  postTransaction: async () => ({ transaction: { id: "tx-2" } }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "POST",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  body: JSON.stringify({ tableId, requestId: "leave-seat-clear", includeState: true }),
});

assert.equal(response.statusCode, 200);
const body = JSON.parse(response.body || "{}");
assert.equal(body.ok, true);
const returnedState = body.state?.state || {};
const returnedSeats = Array.isArray(returnedState.seats) ? returnedState.seats : [];
const returnedStacks = returnedState.stacks && typeof returnedState.stacks === "object" ? returnedState.stacks : {};

assert.equal(returnedSeats.some((seat) => seat?.userId === userId), false);
assert.equal(Object.prototype.hasOwnProperty.call(returnedStacks, userId), false);
assert.equal(returnedState.deck, undefined);
assert.equal(returnedState.holeCardsByUserId, undefined);
assert.ok(nextStatePersisted);

console.log("poker-leave clears seat in response behavior test passed");
