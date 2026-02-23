import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "55555555-5555-4555-8555-555555555555";
const userId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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
    normalizeRequestId: () => ({ ok: true, value: null }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [{ version: 9, state: { tableId, phase: "INIT", seats: [], stacks: {}, pot: 0 } }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 3, status: "ACTIVE", stack: 10 }];
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateUpdateCount += 1;
            return [{ version: 10 }];
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
      const err = new Error("invalid_player");
      err.code = "invalid_player";
      throw err;
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
  assert.equal(body.cashedOut, 0);
  assert.ok(body.state && body.state.state);
  const seats = Array.isArray(body.state.state.seats) ? body.state.state.seats : [];
  const stacks = body.state.state.stacks && typeof body.state.state.stacks === "object" ? body.state.state.stacks : {};
  assert.equal(seats.some((seat) => seat?.userId === userId), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stacks, userId), false);
  assert.equal(postTransactionCalls, 0);
  assert.equal(stateUpdateCount, 0);
  assert.equal(seatDeleteCount, 1);
};

run()
  .then(() => console.log("poker-leave noop state sanitized behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
