import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { patchLeftTableByUserId } from "../netlify/functions/_shared/poker-left-flag.mjs";
import { patchSitOutByUserId } from "../netlify/functions/_shared/poker-sitout-flag.mjs";
import { loadPokerStateForUpdate, updatePokerStateLocked } from "../netlify/functions/_shared/poker-state-write-locked.mjs";
import { isStateStorageValid } from "../netlify/functions/_shared/poker-state-utils.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";

const makeJoinHarness = () => {
  const seatRowsByUserId = new Map();
  const requestStore = new Map();
  const inserts = [];

  const makeHandler = (userId) =>
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
              const seatNo = seatRowsByUserId.get(params?.[1]);
              return Number.isInteger(seatNo) ? [{ seat_no: seatNo }] : [];
            }
            if (
              sqlNormalized.includes("select seat_no") &&
              sqlNormalized.includes("from public.poker_seats") &&
              sqlNormalized.includes("status = 'active'") &&
              sqlNormalized.includes("order by seat_no asc")
            ) {
              return Array.from(seatRowsByUserId.values()).map((seat_no) => ({ seat_no }));
            }
            if (text.includes("insert into public.poker_seats")) {
              const [insertTableId, insertUserId, seatNoDb] = params;
              inserts.push({ tableId: insertTableId, userId: insertUserId, seatNoDb });
              for (const existingSeat of seatRowsByUserId.values()) {
                if (existingSeat === seatNoDb) {
                  const err = new Error("seat_taken");
                  err.code = "23505";
                  err.constraint = "poker_seats_table_id_seat_no_key";
                  throw err;
                }
              }
              seatRowsByUserId.set(insertUserId, seatNoDb);
              return [];
            }
            if (text.includes("from public.chips_accounts")) {
              return [{ id: "escrow-1" }];
            }
            if (text.includes("from public.poker_state") && text.includes("for update")) {
              return [{ version: 1, state: JSON.stringify({ tableId, seats: [], stacks: {}, pot: 0, phase: "INIT" }) }];
            }
            if (text.includes("update public.poker_state")) {
              return [{ version: 2 }];
            }
            return [];
          },
        }),
      postTransaction: async () => ({ transaction: { id: "tx-join" } }),
      getBotConfig: () => ({ enabled: false }),
      klog: () => {},
      HEARTBEAT_INTERVAL_SEC: 15,
    });

  return { makeHandler, inserts, seatRowsByUserId };
};

const callJoin = (handler, { requestId, seatNo }) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, seatNo, buyIn: 100, requestId }),
  });

const run = async () => {
  const harness = makeJoinHarness();

  const joinU1 = await callJoin(harness.makeHandler("u1"), { requestId: "join-u1", seatNo: 0 });
  const joinU2 = await callJoin(harness.makeHandler("u2"), { requestId: "join-u2", seatNo: 1 });

  assert.equal(joinU1.statusCode, 200);
  assert.equal(joinU2.statusCode, 200);
  assert.equal(JSON.parse(joinU1.body).seatNo, 0);
  assert.equal(JSON.parse(joinU2.body).seatNo, 1);

  assert.deepEqual(
    harness.inserts.map((entry) => ({ userId: entry.userId, seatNoDb: entry.seatNoDb })),
    [
      { userId: "u1", seatNoDb: 1 },
      { userId: "u2", seatNoDb: 2 },
    ],
    "join should map UI seat domain to DB seat_no domain consistently"
  );

  const taken = await callJoin(harness.makeHandler("u3"), { requestId: "join-u3", seatNo: 0 });
  assert.equal(taken.statusCode, 409);
  assert.deepEqual(JSON.parse(taken.body), { error: "seat_taken" });
  assert.equal(harness.seatRowsByUserId.size, 2, "seat conflict should not create an extra seat row");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
