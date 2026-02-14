import { isPlainObject } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const run = async () => {
  const queries = [];
  const requestStore = new Map();
  const storedPayload = {
    ok: true,
    tableId,
    state: { version: 22, state: { phase: "PREFLOP", turnUserId: userId, community: [], communityDealt: 0 } },
    myHoleCards: [{ r: 14, s: "S" }, { r: 13, s: "S" }],
    replayed: true,
    legalActions: ["CHECK"],
    actionConstraints: {},
  };
  requestStore.set(`${tableId}|${userId}|start-idem-1|START_HAND`, {
    resultJson: JSON.stringify(storedPayload),
    createdAt: new Date().toISOString(),
  });

  const handler = loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    isPlainObject,
    normalizeRequestId,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push(text);
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(key);
            if (!entry) return [];
            return [{ result_json: entry.resultJson, created_at: entry.createdAt }];
          }
          if (text.includes("insert into public.poker_requests")) return [];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("update public.poker_state") || text.includes("insert into public.poker_actions") || text.includes("insert into public.poker_hole_cards")) {
            throw new Error("mutation_query_not_expected_on_replay");
          }
          if (text.includes("from public.poker_tables") || text.includes("from public.poker_state") || text.includes("from public.poker_seats")) {
            throw new Error("should_not_reach_table_or_state_queries_on_stored_replay");
          }
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "start-idem-1" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body || "{}"), { ...storedPayload, replayed: true });
  assert.ok(!queries.some((q) => q.includes("update public.poker_state")), "expected no state mutation");
  assert.ok(!queries.some((q) => q.includes("insert into public.poker_actions")), "expected no action inserts");
  assert.ok(!queries.some((q) => q.includes("insert into public.poker_hole_cards")), "expected no hole-card inserts");
};

run().then(() => console.log("poker-start-hand idempotency replay stored-result behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
