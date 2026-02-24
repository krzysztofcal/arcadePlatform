import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-heartbeat-conflict-minimal";

const callHeartbeat = async (handler, requestId) => {
  const bodyPayload = { tableId, requestId };
  assert.deepEqual(Object.keys(bodyPayload).sort(), ["requestId", "tableId"]);
  return handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(bodyPayload),
  });
};

const run = async () => {
  const requests = new Map();

  const handler = loadPokerHandler("netlify/functions/poker-heartbeat.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: value ?? null }),
    normalizeJsonState: (value) => value,
    withoutPrivateState: (value) => value,
    isStateStorageValid: () => true,
    maybeApplyTurnTimeout: ({ state }) => ({
      applied: true,
      state,
      action: { userId: state.turnUserId, type: "CHECK" },
    }),
    updatePokerStateOptimistic: async () => ({ ok: false, reason: "conflict" }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const row = requests.get(key);
            return row ? [{ result_json: row.resultJson, created_at: row.createdAt }] : [];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requests.has(key)) return [];
            requests.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const row = requests.get(key) || { createdAt: new Date().toISOString() };
            row.resultJson = params?.[4] ?? null;
            requests.set(key, row);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_tables where id = $1")) return [{ status: "OPEN" }];
          if (text.includes("from public.poker_state where table_id = $1")) {
            return [{
              version: 5,
              state: {
                phase: "PREFLOP",
                handSeed: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                handId: "hand-c",
                communityDealt: 0,
                turnUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                turnDeadlineAt: 12345,
              },
            }];
          }
          if (text.includes("from public.poker_seats where table_id = $1 and user_id = $2")) return [{ seat_no: 2 }];
          if (text.includes("update public.poker_seats set status = 'active'")) return [];
          if (text.includes("update public.poker_tables set last_activity_at")) return [];
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await callHeartbeat(handler, "hb-conflict-minimal-1");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body || "{}"), { ok: true, seated: true, seatNo: 2 });
};

run().then(() => console.log("poker-heartbeat conflict request body minimal behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
