import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-heartbeat-timeout-idempotent";

const callHeartbeat = (handler, requestId) =>
  handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId }),
  });

const run = async () => {
  const requests = new Map();
  const actionKeys = new Set();
  let actionInsertCalls = 0;
  let lastTimeoutRequestId = null;
  let updateCalls = 0;
  const stored = {
    version: 5,
    state: {
      phase: "PREFLOP",
      handSeed: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      handId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      communityDealt: 0,
      turnUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      turnDeadlineAt: Date.now() - 1000,
      seats: [{ userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", seatNo: 1 }, { userId, seatNo: 2 }],
      stacks: { "cccccccc-cccc-4ccc-8ccc-cccccccccccc": 100, [userId]: 100 },
      toCallByUserId: { "cccccccc-cccc-4ccc-8ccc-cccccccccccc": 0, [userId]: 0 },
      betThisRoundByUserId: { "cccccccc-cccc-4ccc-8ccc-cccccccccccc": 0, [userId]: 0 },
      actedThisRoundByUserId: { "cccccccc-cccc-4ccc-8ccc-cccccccccccc": false, [userId]: false },
      foldedByUserId: { "cccccccc-cccc-4ccc-8ccc-cccccccccccc": false, [userId]: false },
    },
  };

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
    updatePokerStateOptimistic: async (_tx, { expectedVersion }) => {
      updateCalls += 1;
      if (updateCalls === 1) return { ok: true, newVersion: expectedVersion + 1 };
      return { ok: false, reason: "conflict" };
    },
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
          if (text.includes("from public.poker_state where table_id = $1")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_seats where table_id = $1 and user_id = $2")) return [{ seat_no: 2 }];
          if (text.includes("update public.poker_seats set status = 'active'")) return [];
          if (text.includes("insert into public.poker_actions") && text.includes("where not exists")) {
            actionInsertCalls += 1;
            const key = `${params?.[0]}|${params?.[6]}`;
            lastTimeoutRequestId = params?.[6] ?? null;
            if (!actionKeys.has(key)) actionKeys.add(key);
            return [{ ok: true }];
          }
          if (text.includes("update public.poker_tables set last_activity_at")) return [];
          return [];
        },
      }),
    klog: () => {},
  });

  const first = await callHeartbeat(handler, "hb-timeout-idempotent-1");
  assert.equal(first.statusCode, 200);
  const firstBody = JSON.parse(first.body || "{}");
  assert.equal(firstBody.state?.version, 6);

  const second = await callHeartbeat(handler, "hb-timeout-idempotent-1");
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body || "{}"), firstBody);

  assert.equal(actionKeys.size, 1, "timeout action insert should be idempotent");
  assert.equal(actionInsertCalls, 1, "timeout action insert should only be attempted once across idempotent replay");
  assert.equal(
    lastTimeoutRequestId,
    `heartbeat-timeout:${tableId}:${stored.state.handId}:${stored.state.turnDeadlineAt}`,
    "deterministic timeout request id should use table + expectedVersion"
  );
  assert.equal(
    actionKeys.has(`${tableId}|${lastTimeoutRequestId}`),
    true,
    "deterministic timeout request id should use table + expectedVersion"
  );
};

run().then(() => console.log("poker-heartbeat timeout idempotent action insert behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
