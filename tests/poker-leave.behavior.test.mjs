import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-1";

const mockTx = (seatStack) => ({
  unsafe: async (query) => {
    const text = String(query).toLowerCase();
    if (text.includes("from public.poker_tables")) {
      return [{ id: tableId, status: "OPEN" }];
    }
    if (text.includes("from public.poker_seats") && text.includes("for update")) {
      return [{ seat_no: 1, status: "ACTIVE", stack: seatStack }];
    }
    if (text.includes("from public.poker_state")) {
      return [
        {
          version: 1,
          state: JSON.stringify({
            tableId,
            seats: [{ userId, seatNo: 1 }],
            stacks: { "someone-else": 123 },
            pot: 0,
          }),
        },
      ];
    }
    return [];
  },
});

const makeHandler = (seatStack, postCalls, queries) =>
  loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: null }),
    beginSql: async (fn) => {
      const tx = mockTx(seatStack);
      return fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          return tx.unsafe(query, params);
        },
      });
    },
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-1" } };
    },
    klog: () => {},
  });

const run = async () => {
  const postCalls = [];
  const queries = [];
  const handler = makeHandler(null, postCalls, queries);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.cashedOut, 0);
  assert.equal(postCalls.length, 0);
  assert.ok(
    queries.some((q) => q.query.toLowerCase().includes("delete from public.poker_seats")),
    "leave should delete poker_seats row"
  );
  const stateUpdate = queries.find((q) =>
    q.query.toLowerCase().includes("update public.poker_state set version = version + 1")
  );
  assert.ok(stateUpdate, "leave should update poker_state");
  const updatedStateJson = stateUpdate.params?.[1];
  assert.ok(updatedStateJson, "leave should pass updated state JSON as 2nd param");
  const updatedState = JSON.parse(updatedStateJson);
  assert.ok(Array.isArray(updatedState.seats), "updatedState.seats should be array");
  assert.ok(!updatedState.seats.some((seat) => seat?.userId === userId), "user should be removed from seats");
  assert.ok(updatedState.stacks && typeof updatedState.stacks === "object", "updatedState.stacks should be object");
  assert.equal(updatedState.stacks["someone-else"], 123, "leave should keep other stacks in cache");
  assert.equal(updatedState.stacks[userId], undefined, "leave should remove user from stacks");

  const negativeCalls = [];
  const negativeQueries = [];
  const negativeHandler = makeHandler(-50, negativeCalls, negativeQueries);
  const negativeResponse = await negativeHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(negativeResponse.statusCode, 200);
  const negativeBody = JSON.parse(negativeResponse.body);
  assert.equal(negativeBody.ok, true);
  assert.equal(negativeBody.cashedOut, 0);
  assert.equal(negativeCalls.length, 0);
  assert.ok(
    negativeQueries.some((q) => q.query.toLowerCase().includes("delete from public.poker_seats")),
    "leave should delete poker_seats row when stack is negative"
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
