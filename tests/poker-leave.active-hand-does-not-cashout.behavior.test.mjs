import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const run = async () => {
  let stateUpdateCount = 0;
  let seatDeleteCount = 0;
  let postTransactionCalls = 0;
  let capturedNextState = null;

  const currentState = {
    tableId,
    phase: "FLOP",
    handId: "hand-1",
    seats: [{ userId, seatNo: 2, status: "active" }],
    stacks: { [userId]: 125 },
    pot: 30,
  };

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
          if (text.includes("from public.poker_state")) return [{ version: 11, state: currentState }];
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 2, status: "ACTIVE", stack: 125 }];
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
    updatePokerStateOptimistic: async (_tx, payload) => {
      stateUpdateCount += 1;
      capturedNextState = payload?.nextState || null;
      return { ok: true, newVersion: 12 };
    },
    applyLeaveTable: () => ({
      state: {
        ...currentState,
        seats: [{ userId, seatNo: 2, status: "folded" }],
        stacks: { [userId]: 125 },
        leftTableByUserId: { [userId]: true },
        sitOutByUserId: { [userId]: false },
      },
    }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.ok, true);
  assert.equal(body.status, "leave_queued");
  assert.equal(body.cashedOut, 0);
  assert.equal(postTransactionCalls, 0);
  assert.equal(seatDeleteCount, 0);
  assert.equal(stateUpdateCount, 1);
  assert.ok(capturedNextState && capturedNextState.leftTableByUserId && capturedNextState.leftTableByUserId[userId] === true);
  const queuedSeat = Array.isArray(capturedNextState?.seats) ? capturedNextState.seats.find((seat) => seat?.userId === userId) : null;
  assert.ok(queuedSeat);
  assert.notEqual(queuedSeat.status, "LEAVING");
  assert.equal(capturedNextState?.stacks?.[userId], 125);
};

run()
  .then(() => console.log("poker-leave active hand does not cashout behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
