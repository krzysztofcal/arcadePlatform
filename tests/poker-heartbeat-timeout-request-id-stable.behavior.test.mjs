import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-heartbeat-timeout-stable";

const callHeartbeat = (handler, requestId) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });

const run = async () => {
  const requests = new Map();
  const actionInsertKeys = new Set();
  const actionInsertAttempts = [];
  const stateRowsByCall = [
    {
      version: 5,
      state: {
        phase: "PREFLOP",
        handSeed: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        handId: "hand-1",
        communityDealt: 0,
        turnUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        turnDeadlineAt: 12345,
      },
    },
    {
      version: 6,
      state: {
        phase: "PREFLOP",
        handSeed: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        handId: "hand-1",
        communityDealt: 0,
        turnUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        turnDeadlineAt: 12345,
      },
    },
  ];
  let stateReadCount = 0;

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
      state: { ...state, turnUserId: userId },
      action: { userId: state.turnUserId, type: "CHECK" },
    }),
    updatePokerStateOptimistic: async (_tx, { expectedVersion }) => ({ ok: true, newVersion: expectedVersion + 1 }),
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
            const row = stateRowsByCall[Math.min(stateReadCount, stateRowsByCall.length - 1)];
            stateReadCount += 1;
            return [row];
          }
          if (text.includes("from public.poker_seats where table_id = $1 and user_id = $2")) return [{ seat_no: 2 }];
          if (text.includes("update public.poker_seats set status = 'active'")) return [];
          if (text.includes("insert into public.poker_actions") && text.includes("where not exists")) {
            const key = `${params?.[0]}|${params?.[6]}`;
            actionInsertAttempts.push(key);
            actionInsertKeys.add(key);
            return [{ ok: true }];
          }
          if (text.includes("update public.poker_tables set last_activity_at")) return [];
          return [];
        },
      }),
    klog: () => {},
  });

  const first = await callHeartbeat(handler, "hb-timeout-stable-1");
  assert.equal(first.statusCode, 200);
  const second = await callHeartbeat(handler, "hb-timeout-stable-2");
  assert.equal(second.statusCode, 200);

  const stableId = `heartbeat-timeout:${tableId}:hand-1:12345`;
  assert.equal(actionInsertAttempts.length, 2, "test should exercise repeated timeout insert attempts");
  assert.equal(actionInsertKeys.size, 1, "timeout request id should remain stable for same timeout event");
  assert.equal(actionInsertKeys.has(`${tableId}|${stableId}`), true);
};

run().then(() => console.log("poker-heartbeat timeout request id stable behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
