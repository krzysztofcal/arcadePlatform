import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-1";

const mockTx = (seatStack, stateStack = undefined) => ({
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
            stacks:
              stateStack === undefined
                ? { "someone-else": 123 }
                : { "someone-else": 123, [userId]: stateStack },
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

const mockConflictTx = (seatStack) => ({
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
          version: 2,
          state: JSON.stringify({
            tableId,
            seats: [{ userId, seatNo: 1 }, { userId: "user-2", seatNo: 2 }],
            stacks: { "someone-else": 123, "user-2": 50 },
            pot: 0,
          }),
        },
      ];
    }
    if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
      return [];
    }
    return [];
  },
});

const makeHandler = (seatStack, postCalls, queries, stateStack = undefined) =>
  loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: null }),
    updatePokerStateOptimistic,
    beginSql: async (fn) => {
      const tx = mockTx(seatStack, stateStack);
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

const makeHandlerWithRequests = (seatStack, postCalls, queries, requestStore, stateStack = undefined) =>
  loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    updatePokerStateOptimistic,
    beginSql: async (fn) => {
      const tx = mockTx(seatStack, stateStack);
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



const makeStatefulHandler = (seatStack, stateStack, postCalls, queries) => {
  const db = {
    seatPresent: true,
    version: 1,
    state: {
      tableId,
      seats: [{ userId, seatNo: 1 }],
      stacks: { "someone-else": 123, [userId]: stateStack },
      pot: 0,
    },
  };

  return loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: null }),
    updatePokerStateOptimistic,
    beginSql: async (fn) => {
      return fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) {
            return [{ version: db.version, state: JSON.stringify(db.state) }];
          }
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return db.seatPresent ? [{ seat_no: 1, status: "ACTIVE", stack: seatStack }] : [];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            db.version += 1;
            db.state = JSON.parse(params?.[2] || "{}");
            return [{ version: db.version }];
          }
          if (text.includes("delete from public.poker_seats")) {
            db.seatPresent = false;
            return [];
          }
          return [];
        },
      });
    },
    postTransaction: async (payload) => {
      postCalls.push(payload);
      return { transaction: { id: "tx-1" } };
    },
    klog: () => {},
  });
};
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
  assert.equal(
    queries.filter((q) => q.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")).length,
    1,
    "leave should bump table activity once when state mutates"
  );
  assert.equal(
    queries.filter((q) => q.query.toLowerCase().includes("insert into public.poker_actions") && q.params?.[3] === "LEAVE_TABLE").length,
    0,
    "non-hand leave should not insert LEAVE_TABLE action"
  );
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

  const authoritativeCalls = [];
  const authoritativeQueries = [];
  const authoritativeHandler = makeHandler(100, authoritativeCalls, authoritativeQueries, 124);
  const authoritativeResponse = await authoritativeHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(authoritativeResponse.statusCode, 200);
  const authoritativeBody = JSON.parse(authoritativeResponse.body);
  assert.equal(authoritativeBody.ok, true);
  assert.equal(authoritativeBody.cashedOut, 124, "leave should cash out authoritative poker_state stack");
  assert.equal(authoritativeCalls.length, 1, "leave should execute one ledger transaction");
  assert.equal(authoritativeCalls[0]?.entries?.[1]?.amount, 124, "ledger credit should match state stack");
  const authoritativeStateUpdate = authoritativeQueries.find((q) =>
    q.query.toLowerCase().includes("update public.poker_state set version = version + 1")
  );
  assert.ok(authoritativeStateUpdate, "leave should update poker_state for authoritative stack cashout");
  const authoritativeUpdatedState = JSON.parse(authoritativeStateUpdate.params?.[2] || "{}");
  assert.ok(
    !authoritativeUpdatedState.seats?.some((seat) => seat?.userId === userId),
    "authoritative cashout should remove user from seats"
  );
  assert.equal(
    authoritativeUpdatedState.stacks?.[userId],
    undefined,
    "authoritative cashout should remove user stack from state"
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
  const idempotentHandler = makeHandlerWithRequests(250, idempotentCalls, idempotentQueries, requestStore);
  const requestId = "request-1";
  const first = await idempotentHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });
  assert.equal(first.statusCode, 200);
  const firstBody = JSON.parse(first.body);
  assert.equal(idempotentCalls.length, 1, "first idempotent leave should perform one cashout side effect");
  const second = await idempotentHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), firstBody);
  assert.equal(idempotentCalls.length, 1, "replayed leave should not execute cashout side effect twice");

  const nonIdempotentCalls = [];
  const nonIdempotentQueries = [];
  const nonIdempotentHandler = makeStatefulHandler(100, 124, nonIdempotentCalls, nonIdempotentQueries);
  const nonIdempotentFirst = await nonIdempotentHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(nonIdempotentFirst.statusCode, 200);
  assert.equal(nonIdempotentCalls.length, 1, "first non-idempotent leave should cash out once");
  const nonIdempotentSecond = await nonIdempotentHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(nonIdempotentSecond.statusCode, 200);
  assert.equal(nonIdempotentCalls.length, 1, "second non-idempotent leave should not double-credit after state cleanup");
  const nonIdempotentSecondBody = JSON.parse(nonIdempotentSecond.body);
  assert.equal(nonIdempotentSecondBody.cashedOut, 0, "second non-idempotent leave should cash out zero when already left");
  const secondActivityBumps = nonIdempotentQueries.filter((q) =>
    q.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
  ).length;
  assert.equal(secondActivityBumps, 1, "already-left replay should not bump table activity without mutation");

  const requestScopedRead = idempotentQueries.find((q) =>
    q.query.toLowerCase().includes("from public.poker_requests where table_id = $1 and user_id = $2 and request_id = $3 and kind = $4")
  );
  assert.ok(requestScopedRead, "leave should scope poker_requests reads by table/user/request/kind");

  const pendingStore = new Map();
  pendingStore.set(`${tableId}|${userId}|request-pending|LEAVE`, { resultJson: null, createdAt: new Date().toISOString() });
  const pendingCalls = [];
  const pendingQueries = [];
  const pendingHandler = makeHandlerWithRequests(250, pendingCalls, pendingQueries, pendingStore);
  const pendingResponse = await pendingHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "request-pending" }),
  });
  assert.equal(pendingResponse.statusCode, 202);
  assert.deepEqual(JSON.parse(pendingResponse.body), { error: "request_pending", requestId: "request-pending" });
  assert.equal(pendingCalls.length, 0, "pending leave should not execute side effects");

  const conflictHandler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: null }),
    updatePokerStateOptimistic,
    beginSql: async (fn) => fn(mockConflictTx(null)),
    postTransaction: async () => ({ transaction: { id: "tx-1" } }),
    klog: () => {},
  });
  const conflictResponse = await conflictHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(conflictResponse.statusCode, 409);
  const conflictBody = JSON.parse(conflictResponse.body);
  assert.equal(conflictBody.error, "state_conflict");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
