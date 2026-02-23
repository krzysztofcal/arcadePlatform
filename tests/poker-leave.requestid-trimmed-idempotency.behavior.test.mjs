import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const run = async () => {
  let capturedIdempotencyKey = null;
  let reducerRequestId = null;

  const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: typeof value === "string" ? value : null }),
    updatePokerStateOptimistic,
    applyLeaveTable: (state, payload) => {
      reducerRequestId = payload?.requestId ?? null;
      return {
        state: {
          ...state,
          seats: [],
          stacks: {},
          phase: "INIT",
          pot: 0,
        },
      };
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [{ version: 5, state: { tableId, phase: "INIT", seats: [{ userId, seatNo: 1 }], stacks: { [userId]: 120 }, pot: 0 } }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 1, status: "ACTIVE", stack: 120 }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            const baseVersion = Number(params?.[1] ?? 0);
            return [{ version: baseVersion + 1 }];
          }
          return [];
        },
      }),
    postTransaction: async (payload) => {
      capturedIdempotencyKey = payload?.idempotencyKey || null;
      return { transaction: { id: "tx-leave-trimmed-request" } };
    },
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "  abc  " }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedIdempotencyKey, `poker:leave:${tableId}:${userId}:abc`);
  assert.equal(reducerRequestId, "abc");
  assert.equal(capturedIdempotencyKey.includes("  abc  "), false);
};

run()
  .then(() => console.log("poker-leave requestId trimmed idempotency behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
