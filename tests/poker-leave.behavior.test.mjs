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

const makeActiveHandHandler = ({ queries, requestStore = null, forceAdvanceWrite = false }) => {
  const stateWriteVersions = [];
  const db = {
    version: 5,
    state: {
      tableId,
      phase: "FLOP",
      handId: "hand-1",
      handSeed: "seed-1",
      seats: [{ userId, seatNo: 1 }, { userId: "user-2", seatNo: 2 }],
      stacks: { [userId]: 120, "user-2": 120 },
      leftTableByUserId: {},
      foldedByUserId: { [userId]: false, "user-2": false },
      actedThisRoundByUserId: { [userId]: false, "user-2": false },
      toCallByUserId: { [userId]: 0, "user-2": 0 },
      betThisRoundByUserId: { [userId]: 0, "user-2": 0 },
      pendingAutoSitOutByUserId: {},
      sitOutByUserId: {},
      community: [{ r: "A", s: "S" }, { r: "K", s: "D" }, { r: "Q", s: "H" }],
      communityDealt: 3,
      pot: 10,
      turnUserId: "user-2",
      turnNo: 2,
    },
    leaveActions: [],
  };

  const deps = {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    updatePokerStateOptimistic,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          queries.push({ query: String(query), params });
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests") && requestStore) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key);
            if (!entry) return [];
            return [{ result_json: entry.resultJson, created_at: entry.createdAt }];
          }
          if (text.includes("insert into public.poker_requests") && requestStore) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requestStore.has(key)) return [];
            requestStore.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests") && requestStore) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key) || { createdAt: new Date().toISOString() };
            entry.resultJson = params?.[4] ?? null;
            requestStore.set(key, entry);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests") && requestStore) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            requestStore.delete(key);
            return [];
          }
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) return [{ version: db.version, state: JSON.stringify(db.state) }];
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 1, status: "ACTIVE", stack: 120 }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            db.version += 1;
            db.state = JSON.parse(params?.[2] || "{}");
            stateWriteVersions.push(db.version);
            return [{ version: db.version }];
          }
          if (text.includes("insert into public.poker_actions") && text.includes("leave_table")) {
            const version = params?.[1];
            const handId = params?.[4] ?? null;
            const requestId = params?.[5] ?? null;
            const dedupeExists = requestId != null
              ? db.leaveActions.some((row) => row.requestId === requestId)
              : db.leaveActions.some((row) => row.handId === handId);
            if (dedupeExists) return [];
            db.leaveActions.push({ version, handId, requestId });
            return [{ id: `action-${db.leaveActions.length}` }];
          }
          if (text.includes("select user_id, seat_no, is_bot from public.poker_seats")) {
            return [
              { user_id: userId, seat_no: 1, is_bot: false },
              { user_id: "user-2", seat_no: 2, is_bot: false },
            ];
          }
          if (text.includes("update public.poker_tables set last_activity_at = now()")) {
            return [{ ok: true }];
          }
          return [];
        },
      }),
    postTransaction: async () => ({ transaction: { id: "tx-1" } }),
    klog: () => {},
  };
  if (forceAdvanceWrite) {
    deps.runAdvanceLoop = (state, _privateState, events) => {
      events.push({ type: "FORCED_ADVANCE" });
      return { nextState: { ...state, phase: "TURN" } };
    };
  }
  return { handler: loadPokerHandler("netlify/functions/poker-leave.mjs", deps), stateWriteVersions };
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

  const activeQueries = [];
  const activeHarness = makeActiveHandHandler({ queries: activeQueries });
  const activeResponse = await activeHarness.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true }),
  });
  assert.equal(activeResponse.statusCode, 200);
  const activeBody = JSON.parse(activeResponse.body);
  assert.equal(activeBody.ok, true);
  assert.equal(activeBody.status, undefined);
  assert.equal(activeBody.cashedOut, 120);
  const activeStateUpdateIndex = activeQueries.findIndex((q) =>
    q.query.toLowerCase().includes("update public.poker_state set version = version + 1")
  );
  const activeActionInsertIndex = activeQueries.findIndex(
    (q) => q.query.toLowerCase().includes("insert into public.poker_actions") && q.params?.[3] === "LEAVE_TABLE"
  );
  assert.ok(activeStateUpdateIndex >= 0);
  assert.ok(activeActionInsertIndex > activeStateUpdateIndex, "LEAVE_TABLE action should be inserted after state write");
  const activeActionInsert = activeQueries[activeActionInsertIndex];
  const leaveWriteVersion = activeHarness.stateWriteVersions[0];
  assert.equal(typeof leaveWriteVersion, "number", "active-hand leave should capture first state write version");
  assert.equal(activeActionInsert.params?.[1], leaveWriteVersion, "LEAVE_TABLE version should match leave-write post version");
  const activeBumps = activeQueries.filter((q) =>
    q.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
  ).length;
  assert.equal(activeBumps, 1, "active-hand instant leave should bump table activity once");

  const activeReqQueries = [];
  const activeReqStore = new Map();
  const activeReqHarness = makeActiveHandHandler({ queries: activeReqQueries, requestStore: activeReqStore });
  const reqId = "req-active-1";
  const reqFirst = await activeReqHarness.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true, requestId: reqId }),
  });
  assert.equal(reqFirst.statusCode, 200);
  const reqSecond = await activeReqHarness.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true, requestId: reqId }),
  });
  assert.equal(reqSecond.statusCode, 200);
  assert.deepEqual(JSON.parse(reqSecond.body), JSON.parse(reqFirst.body));
  const reqActionInserts = activeReqQueries.filter(
    (q) => q.query.toLowerCase().includes("insert into public.poker_actions") && q.params?.[3] === "LEAVE_TABLE"
  ).length;
  assert.equal(reqActionInserts, 1, "same requestId should not insert duplicate LEAVE_TABLE action");
  const reqActivityBumps = activeReqQueries.filter((q) =>
    q.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
  ).length;
  assert.equal(reqActivityBumps, 1, "replay with same requestId should not bump activity again");

  const activeNoReqQueries = [];
  const activeNoReqHarness = makeActiveHandHandler({ queries: activeNoReqQueries });
  const noReqFirst = await activeNoReqHarness.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.equal(noReqFirst.statusCode, 200);
  const noReqSecond = await activeNoReqHarness.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId }),
  });
  assert.ok(noReqSecond.statusCode === 200 || noReqSecond.statusCode === 409);
  const noReqActionInserts = activeNoReqQueries.filter(
    (q) => q.query.toLowerCase().includes("insert into public.poker_actions") && q.params?.[3] === "LEAVE_TABLE"
  ).length;
  assert.equal(noReqActionInserts, 1, "no requestId same-hand leave should dedupe LEAVE_TABLE insertion");

  const divergentQueries = [];
  const divergentHarness = makeActiveHandHandler({ queries: divergentQueries, forceAdvanceWrite: true });
  const divergentResponse = await divergentHarness.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true }),
  });
  assert.equal(divergentResponse.statusCode, 200);
  const divergentBody = JSON.parse(divergentResponse.body);
  const divergentStateUpdates = divergentQueries.filter((q) =>
    q.query.toLowerCase().includes("update public.poker_state set version = version + 1")
  );
  assert.ok(divergentStateUpdates.length >= 2, "forced advance should persist a second state write");
  const divergentLeaveWriteVersion = divergentHarness.stateWriteVersions[0];
  const divergentFinalVersion = divergentHarness.stateWriteVersions[divergentHarness.stateWriteVersions.length - 1];
  const divergentActionInsert = divergentQueries.find(
    (q) => q.query.toLowerCase().includes("insert into public.poker_actions") && q.params?.[3] === "LEAVE_TABLE"
  );
  assert.ok(divergentActionInsert, "should insert LEAVE_TABLE action in divergent active-hand flow");
  assert.equal(divergentActionInsert.params?.[1], divergentLeaveWriteVersion, "LEAVE_TABLE should use first post-leave write version");
  assert.equal(divergentBody?.state?.version, divergentFinalVersion, "response should expose final version after subsequent writes");
  const divergentBumps = divergentQueries.filter((q) =>
    q.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
  ).length;
  assert.equal(divergentBumps, 1, "multi-step active-hand leave should bump activity once");

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
