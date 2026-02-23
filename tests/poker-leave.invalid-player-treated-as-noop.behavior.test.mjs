import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId = "leave-rid-123";

const run = async () => {
  let stateUpdateCount = 0;
  let seatDeleteCount = 0;
  let postTransactionCalls = 0;
  let storedResults = 0;

  const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: requestId }),
    ensurePokerRequest: async () => ({ status: "acquired" }),
    storePokerRequestResult: async (_tx, payload) => {
      storedResults += 1;
      assert.equal(payload.requestId, requestId);
      assert.equal(payload.kind, "LEAVE");
      assert.equal(payload.result.ok, true);
      assert.equal(payload.result.status, "already_left");
      assert.equal(payload.result.cashedOut, 0);
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [{ version: 7, state: { tableId, phase: "INIT", seats: [{ userId, seatNo: 4 }], stacks: {}, pot: 0 } }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 4, status: "ACTIVE", stack: 0 }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateUpdateCount += 1;
            return [{ version: 8 }];
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
    body: JSON.stringify({ tableId, requestId }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "already_left");
  assert.equal(payload.cashedOut, 0);
  assert.equal(payload.seatNo, 4);
  assert.equal(postTransactionCalls, 0);
  assert.equal(stateUpdateCount, 0);
  assert.equal(seatDeleteCount, 1);
  assert.equal(storedResults, 1);

  let boomStateUpdates = 0;
  let boomPostTransactions = 0;
  const boomHandler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: requestId }),
    ensurePokerRequest: async () => ({ status: "acquired" }),
    storePokerRequestResult: async () => {
      throw new Error("should_not_store_on_boom");
    },
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [{ version: 7, state: { tableId, phase: "INIT", seats: [{ userId, seatNo: 4 }], stacks: {}, pot: 0 } }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 4, status: "ACTIVE", stack: 0 }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            boomStateUpdates += 1;
            return [{ version: 8 }];
          }
          return [];
        },
      }),
    postTransaction: async () => {
      boomPostTransactions += 1;
      return { transaction: { id: "unexpected" } };
    },
    applyLeaveTable: () => {
      throw new Error("boom");
    },
    klog: () => {},
  });

  const boomResponse = await boomHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });

  assert.equal(boomResponse.statusCode, 409);
  const boomPayload = JSON.parse(boomResponse.body || "{}");
  assert.equal(boomPayload.error, "state_invalid");
  assert.equal(boomPostTransactions, 0);
  assert.equal(boomStateUpdates, 0);

};

run()
  .then(() => console.log("poker-leave invalid_player noop requestId test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
