import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-join";

const makeJoinHandler = ({ requestStore, queries, sideEffects, failStoreResult = false, existingSeatNo = null }) =>
  loadPokerHandler("netlify/functions/poker-join.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    loadPokerStateForUpdate,
    updatePokerStateLocked,
    patchLeftTableByUserId,
    patchSitOutByUserId,
    isStateStorageValid,
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
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: 6 }];
          }
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) {
            if (Number.isInteger(existingSeatNo)) return [{ seat_no: existingSeatNo }];
            return [];
          }
          if (text.includes("insert into public.poker_seats")) {
            sideEffects.seatInsert += 1;
            return [];
          }
          if (text.includes("from public.chips_accounts")) {
            return [{ id: "escrow-1" }];
          }
          if (text.includes("from public.poker_state") && text.includes("for update")) {
            return [
              {
                version: 1,
                state: JSON.stringify({
                  tableId,
                  seats: [],
                  stacks: {},
                  pot: 0,
                  phase: "INIT",
                  leftTableByUserId: { [userId]: true },
                  missedTurnsByUserId: { [userId]: 1 },
                  sitOutByUserId: { [userId]: true },
                }),
              },
            ];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            return [{ version: 2 }];
          }
          if (text.includes("update public.poker_tables")) {
            return [];
          }
          return [];
        },
      }),
    postTransaction: async () => {
      sideEffects.ledger += 1;
      return { transaction: { id: "tx-join" } };
    },
    klog: () => {},
    HEARTBEAT_INTERVAL_SEC: 15,
  });

const callJoin = (handler, requestId) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 2, buyIn: 100, requestId }),
  });

const run = async () => {
  const requestStore = new Map();
  const queries = [];
  const sideEffects = { seatInsert: 0, ledger: 0 };
  const handler = makeJoinHandler({ requestStore, queries, sideEffects });

  const first = await callJoin(handler, "join-1");
  assert.equal(first.statusCode, 200);
  const firstBody = JSON.parse(first.body);
  assert.equal(firstBody.ok, true);
  assert.equal(sideEffects.seatInsert, 1);
  assert.equal(sideEffects.ledger, 1);
  const tableTouchCountAfterFirst = queries.filter((entry) =>
    entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
  ).length;
  assert.equal(tableTouchCountAfterFirst, 1, "join should bump table activity once when mutation is first applied");
  const stateWrite = queries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(stateWrite, "join should write poker_state under lock");
  const statePayload = stateWrite?.params?.[1];
  const parsedState = JSON.parse(statePayload);
  assert.equal(parsedState.leftTableByUserId[userId], false);
  assert.equal(parsedState.missedTurnsByUserId?.[userId], undefined);
  assert.equal(parsedState.sitOutByUserId?.[userId], false);
  assert.equal(firstBody.me.userId, userId);
  assert.equal(firstBody.me.isSeated, true);
  assert.equal(firstBody.me.isLeft, false);
  assert.equal(firstBody.me.isSitOut, false);

  const second = await callJoin(handler, "join-1");
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), firstBody);
  assert.equal(sideEffects.seatInsert, 1, "replayed join should not re-run seat insert");
  assert.equal(sideEffects.ledger, 1, "replayed join should not re-run ledger tx");
  const tableTouchCountAfterReplay = queries.filter((entry) =>
    entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
  ).length;
  assert.equal(tableTouchCountAfterReplay, tableTouchCountAfterFirst, "replayed join should not bump table activity");
  assert.ok(
    queries.some((q) =>
      q.query.toLowerCase().includes("from public.poker_requests where table_id = $1 and user_id = $2 and request_id = $3 and kind = $4")
    ),
    "join should scope poker_requests reads by table/user/request/kind"
  );

  const pendingStore = new Map();
  const pendingQueries = [];
  const pendingSideEffects = { seatInsert: 0, ledger: 0 };
  const failingStoreHandler = makeJoinHandler({
    requestStore: pendingStore,
    queries: pendingQueries,
    sideEffects: pendingSideEffects,
    failStoreResult: true,
  });

  const failed = await callJoin(failingStoreHandler, "join-pending");
  assert.equal(failed.statusCode, 500);
  assert.equal(pendingSideEffects.seatInsert, 1);
  assert.equal(pendingSideEffects.ledger, 1);

  const retry = await callJoin(makeJoinHandler({ requestStore: pendingStore, queries: [], sideEffects: pendingSideEffects }), "join-pending");
  assert.equal(retry.statusCode, 202);
  assert.deepEqual(JSON.parse(retry.body), { error: "request_pending", requestId: "join-pending" });
  assert.equal(pendingSideEffects.seatInsert, 1, "pending join should not re-run seat insert");
  assert.equal(pendingSideEffects.ledger, 1, "pending join should not re-run ledger tx");

  const rejoinQueries = [];
  const rejoinSideEffects = { seatInsert: 0, ledger: 0 };
  const rejoinHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: rejoinQueries,
    sideEffects: rejoinSideEffects,
    existingSeatNo: 4,
  });
  const rejoin = await callJoin(rejoinHandler, "join-rejoin");
  assert.equal(rejoin.statusCode, 200);
  assert.equal(JSON.parse(rejoin.body).seatNo, 4);
  assert.equal(rejoinSideEffects.seatInsert, 0);
  assert.equal(rejoinSideEffects.ledger, 0);
  const rejoinStateWrite = rejoinQueries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(rejoinStateWrite, "rejoin should update poker_state to clear flags");
  const rejoinStatePayload = rejoinStateWrite?.params?.[1];
  const rejoinState = JSON.parse(rejoinStatePayload);
  assert.equal(rejoinState.leftTableByUserId[userId], false);
  assert.equal(rejoinState.missedTurnsByUserId?.[userId], undefined);
  assert.equal(rejoinState.sitOutByUserId?.[userId], false);
  const rejoinBody = JSON.parse(rejoin.body);
  assert.equal(rejoinBody.me.userId, userId);
  assert.equal(rejoinBody.me.isSeated, true);
  assert.equal(rejoinBody.me.isLeft, false);
  assert.equal(rejoinBody.me.isSitOut, false);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
