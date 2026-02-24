import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-heartbeat-timeout";

const run = async () => {
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

  let actionInsert = null;
  const queries = [];
  let tableTouchCount = 0;
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
      state: { ...state, turnUserId: userId, actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}), [state.turnUserId]: true } },
      action: { userId: state.turnUserId, type: "CHECK" },
      requestId: "auto:timeout:test",
    }),
    updatePokerStateOptimistic: async (_tx, { expectedVersion }) => ({ ok: true, newVersion: expectedVersion + 1 }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push(text);
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("from public.poker_tables where id = $1")) return [{ status: "OPEN" }];
          if (text.includes("from public.poker_state where table_id = $1")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_seats where table_id = $1 and user_id = $2")) return [{ seat_no: 2 }];
          if (text.includes("update public.poker_seats set status = 'active'")) return [];
          if (text.includes("insert into public.poker_actions")) {
            actionInsert = { version: params?.[1], userId: params?.[2], actionType: params?.[3], requestId: params?.[6] };
            return [{ ok: true }];
          }
          if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")) {
            tableTouchCount += 1;
            return [];
          }
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "hb-timeout-1" }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(payload.state?.version, stored.version + 1);
  assert.equal(payload.state?.state?.actedThisRoundByUserId?.["cccccccc-cccc-4ccc-8ccc-cccccccccccc"], true);
  assert.equal(actionInsert?.actionType, "CHECK");
  assert.equal(
    queries.some((q) => q.includes("for update")),
    false,
    "heartbeat should avoid for update lock on state read"
  );
  assert.equal(
    queries.some((q) => q.includes("where not exists (select 1 from public.poker_actions where table_id = $1 and request_id = $7)")),
    true,
    "heartbeat timeout action insert should be guarded for idempotency"
  );
  assert.equal(
    queries.some((q) => q.includes("insert into public.poker_actions")),
    true,
    "heartbeat timeout should record a poker_actions row"
  );
  assert.equal(actionInsert?.requestId, `heartbeat-timeout:${tableId}:v${stored.version}`);
  assert.equal(tableTouchCount, 1);
};

run().then(() => console.log("poker-heartbeat applies turn timeout behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
