import assert from "node:assert/strict";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";

const baseState = {
  tableId,
  phase: "PREFLOP",
  seats: [
    { userId: "user-1", seatNo: 1 },
    { userId: "user-2", seatNo: 2 },
    { userId: "user-3", seatNo: 3 },
  ],
  stacks: { "user-1": 100, "user-2": 100, "user-3": 100 },
  pot: 0,
  community: [],
  dealerSeatNo: 1,
  turnUserId: "user-1",
  handId: "hand-1",
  handSeed: "seed-1",
  communityDealt: 0,
};

const defaultHoleCards = {
  "user-1": [{ r: "A", s: "S" }, { r: "K", s: "S" }],
  "user-2": [{ r: "Q", s: "H" }, { r: "J", s: "H" }],
  "user-3": [{ r: "9", s: "D" }, { r: "9", s: "C" }],
};

const makeHandler = (queries, storedState, userId, options = {}) =>
  loadPokerHandler("netlify/functions/poker-get-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    withoutPrivateState,
    isHoleCardsTableMissing,
    loadHoleCardsByUserId,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, stakes: "1/2", max_players: 6, status: "OPEN" }];
          }
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            const activeUserIds = options.activeUserIds || ["user-1", "user-2", "user-3"];
            return activeUserIds.map((id, index) => ({ user_id: id, seat_no: index + 1 }));
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: "user-1", seat_no: 1, status: "ACTIVE" },
              { user_id: "user-2", seat_no: 2, status: "ACTIVE" },
              { user_id: "user-3", seat_no: 3, status: "ACTIVE" },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: storedState.version, state: JSON.parse(storedState.value) }];
          }
          if (text.includes("from public.poker_hole_cards")) {
            if (options.holeCardsError) throw options.holeCardsError;
            const rows = [];
            const map = options.holeCardsByUserId || defaultHoleCards;
            for (const [userIdValue, cards] of Object.entries(map)) {
              rows.push({ user_id: userIdValue, cards });
            }
            return rows;
          }
          return [];
        },
      }),
    klog: options.klog || (() => {}),
  });

const run = async () => {
  const happyQueries = [];
  const storedState = { value: JSON.stringify(baseState), version: 4 };
  const happyHandler = makeHandler(happyQueries, storedState, "user-1");
  const happyResponse = await happyHandler({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(happyResponse.statusCode, 200);
  const happyPayload = JSON.parse(happyResponse.body);
  assert.equal(happyPayload.ok, true);
  assert.ok(Array.isArray(happyPayload.myHoleCards));
  assert.equal(happyPayload.myHoleCards.length, 2);
  assert.equal(happyPayload.state.state.deck, undefined);
  assert.equal(happyPayload.state.state.holeCardsByUserId, undefined);
  assert.equal(happyPayload.state.state.handSeed, undefined);
  assert.equal(happyPayload.holeCardsByUserId, undefined);
  assert.equal(JSON.stringify(happyPayload).includes("holeCardsByUserId"), false);
  assert.equal(JSON.stringify(happyPayload).includes('"deck"'), false);
  assert.equal(JSON.stringify(happyPayload).includes('"handSeed"'), false);

  const missingTableError = new Error("missing table");
  missingTableError.code = "42P01";
  const missingTableResponse = await makeHandler([], storedState, "user-1", {
    holeCardsError: missingTableError,
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(missingTableResponse.statusCode, 409);
  assert.equal(JSON.parse(missingTableResponse.body).error, "state_invalid");

  const missingRowResponse = await makeHandler([], storedState, "user-1", {
    holeCardsByUserId: {
      "user-1": defaultHoleCards["user-1"],
      "user-2": defaultHoleCards["user-2"],
    },
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(missingRowResponse.statusCode, 409);
  assert.equal(JSON.parse(missingRowResponse.body).error, "state_invalid");

  const invalidCardsResponse = await makeHandler([], storedState, "user-1", {
    holeCardsByUserId: {
      ...defaultHoleCards,
      "user-2": [],
    },
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(invalidCardsResponse.statusCode, 409);
  assert.equal(JSON.parse(invalidCardsResponse.body).error, "state_invalid");

  const mismatchResponse = await makeHandler([], storedState, "user-1", {
    activeUserIds: ["user-1", "user-2"],
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(mismatchResponse.statusCode, 409);
  assert.equal(JSON.parse(mismatchResponse.body).error, "state_invalid");

  const initState = {
    ...baseState,
    phase: "INIT",
    handId: "",
  };
  const nonActionQueries = [];
  const nonActionResponse = await makeHandler(
    nonActionQueries,
    { value: JSON.stringify(initState), version: 2 },
    "user-1"
  )({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(nonActionResponse.statusCode, 200);
  const nonActionPayload = JSON.parse(nonActionResponse.body);
  assert.deepEqual(nonActionPayload.myHoleCards, []);
  const holeCardQueries = nonActionQueries.filter((entry) =>
    entry.query.toLowerCase().includes("from public.poker_hole_cards")
  );
  assert.equal(holeCardQueries.length, 0);
};

await run();
