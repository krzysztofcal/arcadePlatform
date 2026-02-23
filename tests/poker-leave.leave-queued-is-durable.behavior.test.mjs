import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "44444444-4444-4444-8444-444444444444";
const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const run = async () => {
  let capturedNextState = null;

  const currentState = {
    tableId,
    phase: "TURN",
    handId: "hand-durable-1",
    seats: [{ userId, seatNo: 5, status: "active" }],
    stacks: { [userId]: 250 },
    pot: 80,
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
          if (text.includes("from public.poker_state")) return [{ version: 21, state: currentState }];
          if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 5, status: "ACTIVE", stack: 250 }];
          return [];
        },
      }),
    updatePokerStateOptimistic: async (_tx, payload) => {
      capturedNextState = payload?.nextState || null;
      return { ok: true, newVersion: 22 };
    },
    postTransaction: async () => {
      throw new Error("should_not_cashout_during_active_hand");
    },
    applyLeaveTable: () => ({
      state: {
        ...currentState,
        leftTableByUserId: { [userId]: true },
        sitOutByUserId: { [userId]: false },
      },
    }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true }),
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.ok, true);
  assert.equal(body.status, "leave_queued");
  assert.equal(body.cashedOut, 0);
  assert.equal(body.state.version, 22);
  assert.ok(body.state.state.leftTableByUserId && body.state.state.leftTableByUserId[userId] === true);
  assert.ok(Array.isArray(body.state.state.seats) && body.state.state.seats.some((seat) => seat?.userId === userId));
  assert.equal(body.state.state.stacks?.[userId], 250);

  assert.ok(capturedNextState && capturedNextState.leftTableByUserId && capturedNextState.leftTableByUserId[userId] === true);
  assert.ok(Array.isArray(capturedNextState.seats) && capturedNextState.seats.some((seat) => seat?.userId === userId));
  assert.equal(capturedNextState.stacks?.[userId], 250);
};

run()
  .then(() => console.log("poker-leave leave queued is durable behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
