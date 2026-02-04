import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-1";

const mockTx = (seatStack) => ({
  unsafe: async (query, params) => {
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
    if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
      const baseVersion = Number(params?.[1] ?? 1);
      return [{ version: Number.isFinite(baseVersion) ? baseVersion + 1 : 2 }];
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
    updatePokerStateOptimistic,
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

const makeHandlerWithRequests = (seatStack, postCalls, queries, requestStore) =>
  loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    updatePokerStateOptimistic,
    beginSql: async (fn) => {
      const tx = mockTx(seatStack);
      return fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key);
            if (!entry) return [];
            return [{ result_json: entry.resultJson, created_at: entry.createdAt }];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requestStore.has(key)) return [];
            requestStore.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key) || { createdAt: new Date().toISOString() };
            entry.resultJson = params?.[4] ?? null;
            requestStore.set(key, entry);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            requestStore.delete(key);
            return [];
          }
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
  const updatedStateJson = stateUpdate.params?.[2];
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

  const repeatCalls = [];
  const repeatQueries = [];
  const repeatHandler = makeHandler(null, repeatCalls, repeatQueries);
  const repeatResponse = await repeatHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(repeatResponse.statusCode, 200);

  const requestStore = new Map();
  const idempotentCalls = [];
  const idempotentQueries = [];
  const idempotentHandler = makeHandlerWithRequests(null, idempotentCalls, idempotentQueries, requestStore);
  const requestId = "request-1";
  const first = await idempotentHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });
  assert.equal(first.statusCode, 200);
  const firstBody = JSON.parse(first.body);
  const second = await idempotentHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), firstBody);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
