import assert from "node:assert/strict";
import { createDeck, dealHoleCards, shuffle } from "../netlify/functions/_shared/poker-engine.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-1";

const makeRng = (seed) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const makeHandler = (queries, storedState) =>
  loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    createDeck,
    dealHoleCards,
    extractBearerToken: () => "token",
    shuffle,
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: 6 }];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 1, state: { phase: "INIT", stacks: {} } }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: "user-1", seat_no: 1, status: "ACTIVE" },
              { user_id: "user-2", seat_no: 3, status: "ACTIVE" },
              { user_id: "user-3", seat_no: 5, status: "ACTIVE" },
            ];
          }
          if (text.includes("update public.poker_state")) {
            storedState.value = params?.[1] || null;
            return [{ version: 2, state: storedState.value }];
          }
          return [];
        },
      }),
    klog: () => {},
  });

const run = async () => {
  const originalRng = globalThis.__TEST_RNG__;
  globalThis.__TEST_RNG__ = makeRng(42);
  const queries = [];
  const storedState = { value: null };
  const handler = makeHandler(queries, storedState);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-1" }),
  });
  globalThis.__TEST_RNG__ = originalRng;

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.tableId, tableId);
  assert.ok(payload.state);
  assert.equal(typeof payload.state.version, "number");
  assert.equal(payload.state.state.phase, "PREFLOP");
  assert.ok(Array.isArray(payload.state.state.community));
  assert.equal(payload.state.state.community.length, 0);
  assert.equal(payload.state.state.pot, 0);
  assert.ok(["user-1", "user-2", "user-3"].includes(payload.state.state.turnUserId));
  assert.ok(Array.isArray(payload.myHoleCards));
  assert.equal(payload.myHoleCards.length, 2);
  assert.equal(payload.state.state.holeCardsByUserId, undefined);
  assert.equal(payload.holeCardsByUserId, undefined);

  const updateCall = queries.find((q) => q.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(updateCall, "expected update to poker_state");
  const updatedState = JSON.parse(updateCall.params?.[1] || "{}");
  assert.ok(updatedState.holeCardsByUserId, "state should include hole cards by user id");
  assert.ok(Array.isArray(updatedState.holeCardsByUserId[userId]), "caller should have hole cards stored");
  assert.equal(updatedState.holeCardsByUserId[userId].length, 2);
  assert.deepEqual(payload.myHoleCards, updatedState.holeCardsByUserId[userId]);

  const cardKeys = payload.myHoleCards.map((card) => `${card.r}-${card.s}`);
  const uniqueKeys = new Set(cardKeys);
  assert.equal(uniqueKeys.size, cardKeys.length, "hole cards should be unique");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
