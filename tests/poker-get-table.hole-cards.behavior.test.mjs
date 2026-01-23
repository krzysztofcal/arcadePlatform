import assert from "node:assert/strict";
import { normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const handId = "hand-1";

const baseState = {
  tableId,
  handId,
  phase: "FLOP",
  seats: [
    { userId: "user-1", seatNo: 1 },
    { userId: "user-2", seatNo: 2 },
  ],
  community: [],
  deck: [{ r: "A", s: "S" }],
  holeCardsByUserId: {
    "user-1": [{ r: "2", s: "S" }, { r: "3", s: "S" }],
    "user-2": [{ r: "4", s: "S" }, { r: "5", s: "S" }],
  },
};

const makeHandler = (queries, holeCardsStore, authUserId) =>
  loadPokerHandler("netlify/functions/poker-get-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () =>
      authUserId ? { valid: true, userId: authUserId } : { valid: false, reason: "missing_token" },
    normalizeJsonState,
    withoutPrivateState,
    isValidUuid: () => true,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [
              {
                id: tableId,
                stakes: "1/2",
                max_players: 6,
                status: "OPEN",
                created_by: "user-1",
                created_at: "2024-01-01T00:00:00.000Z",
                updated_at: "2024-01-01T00:10:00.000Z",
                last_activity_at: "2024-01-01T00:10:00.000Z",
              },
            ];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              {
                user_id: "user-1",
                seat_no: 1,
                status: "ACTIVE",
                last_seen_at: "2024-01-01T00:05:00.000Z",
                joined_at: "2024-01-01T00:00:00.000Z",
              },
              {
                user_id: "user-2",
                seat_no: 2,
                status: "ACTIVE",
                last_seen_at: "2024-01-01T00:06:00.000Z",
                joined_at: "2024-01-01T00:01:00.000Z",
              },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 3, state: baseState }];
          }
          if (text.includes("from public.poker_hole_cards")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}`;
            const cards = holeCardsStore.get(key);
            return cards ? [{ cards }] : [];
          }
          return [];
        },
      }),
    klog: () => {},
  });

const runSeated = async () => {
  const queries = [];
  const holeCardsStore = new Map();
  holeCardsStore.set(`${tableId}|${handId}|user-1`, [
    { r: "2", s: "S" },
    { r: "3", s: "S" },
  ]);
  const handler = makeHandler(queries, holeCardsStore, "user-1");
  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.myHoleCards));
  assert.equal(payload.myHoleCards.length, 2);
  assert.equal(payload.state.state.holeCardsByUserId, undefined);
  assert.equal(payload.state.state.deck, undefined);
  assert.equal(JSON.stringify(payload).includes("holeCardsByUserId"), false);
  assert.equal(JSON.stringify(payload).includes('"deck"'), false);
  assert.ok(
    queries.some((entry) => entry.query.toLowerCase().includes("from public.poker_hole_cards")),
    "expected hole card select"
  );
};

const runNotSeated = async () => {
  const queries = [];
  const holeCardsStore = new Map();
  const handler = makeHandler(queries, holeCardsStore, "user-9");
  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.myHoleCards));
  assert.equal(payload.myHoleCards.length, 0);
  assert.equal(
    queries.some((entry) => entry.query.toLowerCase().includes("from public.poker_hole_cards")),
    false
  );
};

const runAnonymous = async () => {
  const queries = [];
  const holeCardsStore = new Map();
  const handler = makeHandler(queries, holeCardsStore, null);
  const response = await handler({
    httpMethod: "GET",
    headers: { origin: "https://example.test" },
    queryStringParameters: { tableId },
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.myHoleCards));
  assert.equal(payload.myHoleCards.length, 0);
  assert.equal(
    queries.some((entry) => entry.query.toLowerCase().includes("from public.poker_hole_cards")),
    false
  );
};

await runSeated();
await runNotSeated();
await runAnonymous();
