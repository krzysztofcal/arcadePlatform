import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-join";

const makeJoinHandler = ({
  requestStore,
  queries,
  sideEffects,
  failStoreResult = false,
  existingSeatNo = null,
  conflictSeatInsertOnce = false,
  conflictUnknownUniqueOnce = false,
  tableMaxPlayers = 6,
  occupiedSeatRows = [{ seat_no: 2 }],
  alwaysSeatConflict = false,
  buyInDuplicateOnce = false,
}) =>
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
          const sqlNormalized = String(query).replace(/\s+/g, " ").trim().toLowerCase();
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
            return [{ id: tableId, status: "OPEN", max_players: tableMaxPlayers }];
          }
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2") && text.includes("limit 1")) {
            if (Number.isInteger(existingSeatNo)) return [{ seat_no: existingSeatNo }];
            if (Number.isInteger(sideEffects.seatedUserSeatNo)) return [{ seat_no: sideEffects.seatedUserSeatNo }];
            return [];
          }
          if (
            sqlNormalized.includes("select seat_no") &&
            sqlNormalized.includes("from public.poker_seats") &&
            sqlNormalized.includes("status = 'active'") &&
            sqlNormalized.includes("order by seat_no asc")
          ) {
            return (occupiedSeatRows || [])
              .filter((row) => String(row?.status || "ACTIVE").toUpperCase() === "ACTIVE")
              .map((row) => ({ seat_no: row?.seat_no }));
          }
          if (text.includes("insert into public.poker_seats")) {
            sideEffects.seatInsert += 1;
            if (Number.isInteger(params?.[2])) sideEffects.seatedUserSeatNo = params[2];
            if (alwaysSeatConflict) {
              const err = new Error("seat_taken");
              err.code = "23505";
              err.constraint = "poker_seats_table_id_seat_no_key";
              err.detail = "";
              throw err;
            }
            if (conflictSeatInsertOnce && !sideEffects.conflictSeatInsertUsed) {
              sideEffects.conflictSeatInsertUsed = true;
              const err = new Error("seat_taken");
              err.code = "23505";
              err.constraint = "poker_seats_table_id_seat_no_key";
              err.detail = "";
              throw err;
            }
            if (conflictUnknownUniqueOnce && !sideEffects.conflictUnknownUniqueUsed) {
              sideEffects.conflictUnknownUniqueUsed = true;
              const err = new Error("unique_unknown");
              err.code = "23505";
              err.constraint = "";
              err.detail = "";
              throw err;
            }
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
      sideEffects.ledgerAttempted = Number(sideEffects.ledgerAttempted || 0) + 1;
      if (buyInDuplicateOnce && !sideEffects.buyInDuplicateRaised) {
        sideEffects.buyInDuplicateRaised = true;
        const err = new Error('duplicate key value violates unique constraint "chips_transactions_idempotency_key_unique"');
        err.code = "23505";
        err.constraint = "chips_transactions_idempotency_key_unique";
        throw err;
      }
      sideEffects.ledgerSucceeded = Number(sideEffects.ledgerSucceeded || 0) + 1;
      return { transaction: { id: "tx-join" } };
    },
    klog: () => {},
    HEARTBEAT_INTERVAL_SEC: 15,
  });

const callJoin = (handler, requestId, overrides) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo: 1, buyIn: 100, requestId, ...(overrides || {}) }),
  });

const run = async () => {
  const requestStore = new Map();
  const queries = [];
  const sideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0 };
  const handler = makeJoinHandler({ requestStore, queries, sideEffects });

  const first = await callJoin(handler, "join-1");
  assert.equal(first.statusCode, 200);
  const firstBody = JSON.parse(first.body);
  assert.equal(firstBody.ok, true);
  assert.equal(sideEffects.seatInsert, 1);
  assert.equal(sideEffects.ledgerSucceeded, 1);
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
  assert.equal(sideEffects.ledgerSucceeded, 1, "replayed join should not re-run ledger tx");
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
  const pendingSideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0 };
  const failingStoreHandler = makeJoinHandler({
    requestStore: pendingStore,
    queries: pendingQueries,
    sideEffects: pendingSideEffects,
    failStoreResult: true,
  });

  const failed = await callJoin(failingStoreHandler, "join-pending");
  assert.equal(failed.statusCode, 500);
  assert.equal(pendingSideEffects.seatInsert, 1);
  assert.equal(pendingSideEffects.ledgerSucceeded, 1);

  const retry = await callJoin(makeJoinHandler({ requestStore: pendingStore, queries: [], sideEffects: pendingSideEffects }), "join-pending");
  assert.equal(retry.statusCode, 202);
  assert.deepEqual(JSON.parse(retry.body), { error: "request_pending", requestId: "join-pending" });
  assert.equal(pendingSideEffects.seatInsert, 1, "pending join should not re-run seat insert");
  assert.equal(pendingSideEffects.ledgerSucceeded, 1, "pending join should not re-run ledger tx");

  const rejoinQueries = [];
  const rejoinSideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0 };
  const rejoinHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: rejoinQueries,
    sideEffects: rejoinSideEffects,
    existingSeatNo: 4,
  });
  const rejoin = await callJoin(rejoinHandler, "join-rejoin");
  assert.equal(rejoin.statusCode, 200);
  assert.equal(JSON.parse(rejoin.body).seatNo, 3);
  assert.equal(rejoinSideEffects.seatInsert, 0);
  assert.equal(rejoinSideEffects.ledgerSucceeded, 0);
  const rejoinStateWrites = rejoinQueries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(rejoinStateWrites.length > 0, "rejoin should update poker_state");
  const rejoinStatePayload = rejoinStateWrites[0]?.params?.[1];
  const rejoinState = JSON.parse(rejoinStatePayload);
  assert.equal(rejoinState.leftTableByUserId[userId], false);
  assert.equal(rejoinState.missedTurnsByUserId?.[userId], undefined);
  assert.equal(rejoinState.sitOutByUserId?.[userId], false);
  const rejoinSeatPatched = rejoinStateWrites.some((entry) => {
    var payload = entry?.params?.[1];
    if (typeof payload !== 'string') return false;
    var parsed = JSON.parse(payload);
    return Array.isArray(parsed?.seats) && parsed.seats.some((seat) => seat?.userId === userId && seat?.seatNo === 4);
  });
  assert.equal(rejoinSeatPatched, true, "rejoin should patch poker_state seats with DB seat when missing");
  const rejoinBody = JSON.parse(rejoin.body);
  assert.equal(rejoinBody.me.userId, userId);
  assert.equal(rejoinBody.me.isSeated, true);
  assert.equal(rejoinBody.me.isLeft, false);
  assert.equal(rejoinBody.me.isSitOut, false);

  const conflictQueries = [];
  const conflictSideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0, conflictSeatInsertUsed: false };
  const conflictHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: conflictQueries,
    sideEffects: conflictSideEffects,
    conflictSeatInsertOnce: true,
  });
  const conflictJoin = await callJoin(conflictHandler, "join-conflict");
  assert.equal(conflictJoin.statusCode, 409);
  assert.deepEqual(JSON.parse(conflictJoin.body), { error: "seat_taken" });
  assert.equal(conflictSideEffects.seatInsert, 1, "non-autoSeat join should fail immediately on seat conflict");
  assert.equal(conflictSideEffects.ledgerSucceeded, 0, "failed seat insert should not post ledger transaction");

  const autoSeatQueries = [];
  const autoSeatSideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0, conflictSeatInsertUsed: false };
  const autoSeatHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: autoSeatQueries,
    sideEffects: autoSeatSideEffects,
    conflictSeatInsertOnce: true,
  });
  const autoSeatJoin = await callJoin(autoSeatHandler, "join-auto-seat", {
    seatNo: undefined,
    autoSeat: true,
    preferredSeatNo: 1,
  });
  assert.equal(autoSeatJoin.statusCode, 200);
  const autoSeatBody = JSON.parse(autoSeatJoin.body);
  assert.equal(autoSeatBody.ok, true);
  assert.equal(autoSeatBody.seatNo, 2, "autoSeat join should wrap to next free seat when preferred seat is taken");

  const autoSeatJoinStr = await callJoin(autoSeatHandler, "join-auto-seat-str", {
    seatNo: undefined,
    autoSeat: "true",
    preferredSeatNo: 1,
  });
  assert.equal(autoSeatJoinStr.statusCode, 200);

  const activeSeatQueries = [];
  const activeSeatIsOccupiedHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: activeSeatQueries,
    sideEffects: { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0, conflictSeatInsertUsed: false },
    conflictSeatInsertOnce: true,
    tableMaxPlayers: 6,
    occupiedSeatRows: [{ seat_no: 2, status: "ACTIVE" }],
  });
  const activeSeatIsOccupiedJoin = await callJoin(activeSeatIsOccupiedHandler, "join-auto-seat-active-occupied", {
    seatNo: undefined,
    autoSeat: true,
    preferredSeatNo: 1,
  });
  assert.equal(activeSeatIsOccupiedJoin.statusCode, 200);
  const activeSeatQueryCount = activeSeatQueries.filter((entry) => {
    const sqlNormalized = String(entry.query).replace(/\s+/g, " ").trim().toLowerCase();
    return (
      sqlNormalized.includes("select seat_no") &&
      sqlNormalized.includes("from public.poker_seats") &&
      sqlNormalized.includes("status = 'active'") &&
      sqlNormalized.includes("order by seat_no asc")
    );
  }).length;
  assert.ok(activeSeatQueryCount >= 1, "autoSeat retry should query ACTIVE seats");
  assert.equal(
    JSON.parse(activeSeatIsOccupiedJoin.body).seatNo,
    2,
    "autoSeat should skip ACTIVE seats during retries and choose DB seat 3 (UI seat 2)"
  );


  const duplicateSideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0, buyInDuplicateRaised: false };
  const duplicateHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: [],
    sideEffects: duplicateSideEffects,
    buyInDuplicateOnce: true,
  });
  const duplicateJoin = await callJoin(duplicateHandler, "join-dup-idempotency");
  assert.equal(duplicateJoin.statusCode, 200);
  assert.equal(JSON.parse(duplicateJoin.body).ok, true);
  assert.equal(duplicateSideEffects.seatInsert, 1);
  assert.equal(duplicateSideEffects.ledgerAttempted, 1);
  assert.equal(duplicateSideEffects.ledgerSucceeded, 0);

  const seatedSideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0 };
  const seatedHandler = makeJoinHandler({ requestStore: new Map(), queries: [], sideEffects: seatedSideEffects });
  const firstJoin = await callJoin(seatedHandler, "join-already-seated-1");
  assert.equal(firstJoin.statusCode, 200);
  assert.equal(seatedSideEffects.ledgerSucceeded, 1);
  const secondJoin = await callJoin(seatedHandler, "join-already-seated-2");
  assert.equal(secondJoin.statusCode, 200);
  assert.equal(seatedSideEffects.ledgerSucceeded, 1, "already-seated join should not call buy-in transaction again");
  assert.equal(JSON.parse(secondJoin.body).seatNo, JSON.parse(firstJoin.body).seatNo);



  const fullHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: [],
    sideEffects: { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0 },
    tableMaxPlayers: 2,
    occupiedSeatRows: [{ seat_no: 1 }, { seat_no: 2 }],
    alwaysSeatConflict: true,
  });
  const fullJoin = await callJoin(fullHandler, "join-table-full", { autoSeat: true, preferredSeatNo: 0 });
  assert.equal(fullJoin.statusCode, 409);
  assert.deepEqual(JSON.parse(fullJoin.body), { error: "table_full" });

  const unknownConflictSideEffects = { seatInsert: 0, ledgerAttempted: 0, ledgerSucceeded: 0, conflictUnknownUniqueUsed: false };
  const unknownConflictHandler = makeJoinHandler({
    requestStore: new Map(),
    queries: [],
    sideEffects: unknownConflictSideEffects,
    conflictUnknownUniqueOnce: true,
  });
  const unknownConflict = await callJoin(unknownConflictHandler, "join-unknown-unique");
  assert.equal(unknownConflict.statusCode, 409);
  assert.deepEqual(JSON.parse(unknownConflict.body), { error: "seat_taken" });
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
