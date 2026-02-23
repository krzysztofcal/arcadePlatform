import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const run = async () => {
  let stateUpdateCount = 0;
  let seatDeleteCount = 0;
  let postTransactionCalls = 0;

  const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({
      ok: true,
      value: typeof value === "string" && value.trim() ? value.trim() : null,
    }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [{ version: 2, state: { tableId, phase: "INIT", seats: [{ userId, seatNo: 1 }], stacks: { [userId]: 0 }, pot: 0 } }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 1, status: "ACTIVE", stack: 0 }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateUpdateCount += 1;
            return [{ version: 3 }];
          }
          if (text.includes("delete from public.poker_seats")) {
            seatDeleteCount += 1;
            return [];
          }
          return [];
        },
      }),
    postTransaction: async () => {
      postTransactionCalls += 1;
      return { transaction: { id: "unexpected" } };
    },
    applyLeaveTable: () => {
      throw new Error("boom");
    },
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });

  assert.equal(response.statusCode, 409);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.error, "state_invalid");
  assert.equal(stateUpdateCount, 0);
  assert.equal(seatDeleteCount, 0);
  assert.equal(postTransactionCalls, 0);
};

run()
  .then(() => console.log("poker-leave reducer throw does-not-mutate behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
