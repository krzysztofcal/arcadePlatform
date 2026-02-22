import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-heartbeat";

const makeHeartbeatHandler = ({
  requestStore,
  queries,
  sideEffects,
  failStoreResult = false,
  forbidTableTouch = false,
  tableStatus = "OPEN",
}) =>
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
            return tableStatus ? [{ status: tableStatus }] : [];
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
  const handler = makeHeartbeatHandler({ requestStore, queries, sideEffects, forbidTableTouch: true, tableStatus: "OPEN" });

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

  const closedNonReplayStore = new Map();
  const closedNonReplayQueries = [];
  const closedNonReplayEffects = { seatTouch: 0, tableTouch: 0 };
  const closedNonReplayHandler = makeHeartbeatHandler({
    requestStore: closedNonReplayStore,
    queries: closedNonReplayQueries,
    sideEffects: closedNonReplayEffects,
    forbidTableTouch: true,
    tableStatus: "CLOSED",
  });
  const closedNonReplay = await callHeartbeat(closedNonReplayHandler, "hb-closed");
  assert.equal(closedNonReplay.statusCode, 200);
  assert.deepEqual(JSON.parse(closedNonReplay.body), { ok: true, seated: true, seatNo: 3, closed: true });
  assert.equal(closedNonReplayEffects.seatTouch, 0, "closed-table heartbeat should not touch seat presence");
  assert.equal(closedNonReplayEffects.tableTouch, 0);
  assert.ok(
    closedNonReplayQueries.some((q) => q.query.toLowerCase().includes("from public.poker_tables where id = $1")),
    "closed-table heartbeat should query current table status"
  );
  assert.ok(
    closedNonReplayQueries.some((q) => q.query.toLowerCase().includes("from public.poker_seats where table_id = $1 and user_id = $2")),
    "closed-table heartbeat should still read seat state"
  );
  assert.ok(
    closedNonReplayQueries.every(
      (q) => !q.query.toLowerCase().includes("update public.poker_seats set status = 'active', last_seen_at = now()")
    ),
    "closed-table heartbeat should not update seat presence"
  );

  const replayStore = new Map();
  const replayEffects = { seatTouch: 0, tableTouch: 0 };
  const replayOpenFirst = await callHeartbeat(
    makeHeartbeatHandler({
      requestStore: replayStore,
      queries: [],
      sideEffects: replayEffects,
      forbidTableTouch: true,
      tableStatus: "OPEN",
    }),
    "hb-replay-closed"
  );
  assert.equal(replayOpenFirst.statusCode, 200);
  const replayOpenBody = JSON.parse(replayOpenFirst.body);
  assert.deepEqual(replayOpenBody, { ok: true, seated: true, seatNo: 3 });
  assert.equal(replayEffects.seatTouch, 1);

  const replayClosedQueries = [];
  const replayClosed = await callHeartbeat(
    makeHeartbeatHandler({
      requestStore: replayStore,
      queries: replayClosedQueries,
      sideEffects: replayEffects,
      forbidTableTouch: true,
      tableStatus: "CLOSED",
    }),
    "hb-replay-closed"
  );
  assert.equal(replayClosed.statusCode, 200);
  assert.deepEqual(JSON.parse(replayClosed.body), replayOpenBody);
  assert.equal(replayEffects.seatTouch, 1, "replay heartbeat should not touch seat presence when table is now CLOSED");
  assert.equal(replayEffects.tableTouch, 0);
  assert.ok(
    replayClosedQueries.some((q) => q.query.toLowerCase().includes("from public.poker_tables where id = $1")),
    "replay heartbeat should check current table status before seat touch"
  );

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
