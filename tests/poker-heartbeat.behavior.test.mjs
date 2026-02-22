import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-heartbeat";

const makeHeartbeatHandler = ({ requestStore, queries, sideEffects, failStoreResult = false, forbidTableTouch = false }) =>
  loadPokerHandler("netlify/functions/poker-heartbeat.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    beginSql: async (fn) =>
      fn({
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
            if (failStoreResult) throw new Error("store_failed");
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
          if (text.includes("from public.poker_tables where id = $1")) {
            return [{ status: "OPEN" }];
          }
          if (text.includes("from public.poker_seats where table_id = $1 and user_id = $2")) {
            return [{ seat_no: 3 }];
          }
          if (text.includes("update public.poker_seats set status = 'active'")) {
            sideEffects.seatTouch += 1;
            return [];
          }
          if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")) {
            if (forbidTableTouch) throw new Error("unexpected_table_activity_touch");
            sideEffects.tableTouch += 1;
            return [];
          }
          return [];
        },
      }),
    klog: () => {},
  });

const callHeartbeat = (handler, requestId) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });

const run = async () => {
  const requestStore = new Map();
  const queries = [];
  const sideEffects = { seatTouch: 0, tableTouch: 0 };
  const handler = makeHeartbeatHandler({ requestStore, queries, sideEffects, forbidTableTouch: true });

  const first = await callHeartbeat(handler, "hb-1");
  assert.equal(first.statusCode, 200);
  const firstBody = JSON.parse(first.body);
  assert.equal(firstBody.ok, true);
  assert.equal(sideEffects.seatTouch, 1);
  assert.equal(sideEffects.tableTouch, 0);

  const second = await callHeartbeat(handler, "hb-1");
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), firstBody);
  assert.equal(sideEffects.seatTouch, 2, "replayed heartbeat should refresh seat touch");
  assert.equal(sideEffects.tableTouch, 0, "heartbeat should never touch table activity");
  assert.ok(
    queries.some((q) =>
      q.query.toLowerCase().includes("from public.poker_requests where table_id = $1 and user_id = $2 and request_id = $3 and kind = $4")
    ),
    "heartbeat should scope poker_requests reads by table/user/request/kind"
  );
  assert.ok(
    queries.every((q) =>
      !q.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
    ),
    "heartbeat must not update table activity timestamps"
  );

  const pendingStore = new Map();
  const pendingEffects = { seatTouch: 0, tableTouch: 0 };
  const failingStoreHandler = makeHeartbeatHandler({
    requestStore: pendingStore,
    queries: [],
    sideEffects: pendingEffects,
    failStoreResult: true,
    forbidTableTouch: true,
  });
  const failed = await callHeartbeat(failingStoreHandler, "hb-pending");
  assert.equal(failed.statusCode, 500);
  assert.equal(pendingEffects.seatTouch, 1);
  assert.equal(pendingEffects.tableTouch, 0);

  const retry = await callHeartbeat(
    makeHeartbeatHandler({ requestStore: pendingStore, queries: [], sideEffects: pendingEffects, forbidTableTouch: true }),
    "hb-pending"
  );
  assert.equal(retry.statusCode, 202);
  assert.deepEqual(JSON.parse(retry.body), { error: "request_pending", requestId: "hb-pending" });
  assert.equal(pendingEffects.seatTouch, 1, "pending heartbeat should not rerun seat touch");
  assert.equal(pendingEffects.tableTouch, 0, "pending heartbeat should never touch table activity");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
