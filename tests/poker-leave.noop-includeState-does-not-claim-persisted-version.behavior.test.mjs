import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "66666666-6666-4666-8666-666666666666";
const userId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const run = async () => {
  const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: null }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) return [{ version: 15, state: { tableId, phase: "INIT", seats: [], stacks: {}, pot: 0 } }];
          if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 6, status: "ACTIVE", stack: 0 }];
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            throw new Error("should_not_update_state");
          }
          return [];
        },
      }),
    postTransaction: async () => {
      throw new Error("should_not_cashout");
    },
    applyLeaveTable: () => {
      throw new Error("should_not_call_reducer_for_already_left");
    },
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true }),
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.status, "already_left");
  assert.equal(body.state, undefined);
  assert.ok(body.viewState);
};

run()
  .then(() => console.log("poker-leave noop includeState view-only contract test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
