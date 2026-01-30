import assert from "node:assert/strict";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { buildHandSnapshot, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { normalizeSeatOrderFromState } from "../netlify/functions/_shared/poker-turn-timeout.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_GET_TABLE_REPAIR = "1";

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

const makeHandler = (queries, storedState, userId, options = {}) => {
  const holeCardsMap =
    options.holeCardsByUserId !== undefined ? { ...options.holeCardsByUserId } : { ...defaultHoleCards };

  return loadPokerHandler("netlify/functions/poker-get-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    buildHandSnapshot,
    withoutPrivateState,
    normalizeSeatOrderFromState,
    isHoleCardsTableMissing,
    loadHoleCardsByUserId,
    deriveDeck,
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
            if (options.holeCardsSelectError) throw options.holeCardsSelectError;
            const rows = [];
            for (const [userIdValue, cards] of Object.entries(holeCardsMap)) {
              rows.push({ user_id: userIdValue, cards });
            }
            return rows;
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            if (options.holeCardsInsertError) throw options.holeCardsInsertError;

            const paramsList = Array.isArray(params) ? params : [];
            for (let i = 0; i < paramsList.length; i += 4) {
              const userIdValue = paramsList[i + 2];
              const rawCards = paramsList[i + 3];
              if (!userIdValue) continue;

              let cards = rawCards;
              if (typeof rawCards === "string") {
                try {
                  cards = JSON.parse(rawCards);
                } catch {
                  cards = rawCards;
                }
              }
              holeCardsMap[userIdValue] = cards;
            }
            return [];
          }

          return [];
        },
      }),
    klog: options.klog || (() => {}),
  });
};

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
  assert.ok(happyPayload.hand);
  assert.equal(typeof happyPayload.hand.handId, "string");
  assert.equal(happyPayload.hand.phase, happyPayload.state.state.phase);
  assert.equal(Array.isArray(happyPayload.events), true);
  assert.deepEqual(happyPayload.events, []);
  const happyInserts = happyQueries.filter((entry) =>
    entry.query.toLowerCase().includes("insert into public.poker_hole_cards")
  );
  assert.equal(happyInserts.length, 0);

  const stringCardResponse = await makeHandler([], storedState, "user-1", {
    holeCardsByUserId: {
      "user-1": JSON.stringify(defaultHoleCards["user-1"]),
      "user-2": JSON.stringify(defaultHoleCards["user-2"]),
      "user-3": JSON.stringify(defaultHoleCards["user-3"]),
    },
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(stringCardResponse.statusCode, 200);
  const stringCardPayload = JSON.parse(stringCardResponse.body);
  assert.equal(stringCardPayload.ok, true);
  assert.ok(Array.isArray(stringCardPayload.myHoleCards));
  assert.equal(stringCardPayload.myHoleCards.length, 2);
  assert.equal(stringCardPayload.state.state.deck, undefined);
  assert.equal(stringCardPayload.state.state.holeCardsByUserId, undefined);
  assert.equal(stringCardPayload.state.state.handSeed, undefined);
  assert.equal(stringCardPayload.holeCardsByUserId, undefined);
  assert.equal(JSON.stringify(stringCardPayload).includes("holeCardsByUserId"), false);
  assert.equal(JSON.stringify(stringCardPayload).includes('"deck"'), false);
  assert.equal(JSON.stringify(stringCardPayload).includes('"handSeed"'), false);

  const malformedCardResponse = await makeHandler([], storedState, "user-1", {
    holeCardsByUserId: {
      "user-1": JSON.stringify(defaultHoleCards["user-1"]),
      "user-2": "not-json",
      "user-3": JSON.stringify(defaultHoleCards["user-3"]),
    },
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(malformedCardResponse.statusCode, 200);
  const malformedCardPayload = JSON.parse(malformedCardResponse.body);
  assert.equal(malformedCardPayload.ok, true);
  assert.ok(Array.isArray(malformedCardPayload.myHoleCards));
  assert.equal(malformedCardPayload.myHoleCards.length, 2);

  const missingTableError = new Error("missing table");
  missingTableError.code = "42P01";
  const missingTableQueries = [];
  const missingTableResponse = await makeHandler(missingTableQueries, storedState, "user-1", {
    holeCardsSelectError: missingTableError,
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(missingTableResponse.statusCode, 409);
  assert.equal(JSON.parse(missingTableResponse.body).error, "state_invalid");
  const missingTableInserts = missingTableQueries.filter((entry) =>
    entry.query.toLowerCase().includes("insert into public.poker_hole_cards")
  );
  assert.equal(missingTableInserts.length, 0);

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
  assert.equal(missingRowResponse.statusCode, 200);
  const missingRowPayload = JSON.parse(missingRowResponse.body);
  assert.equal(missingRowPayload.ok, true);
  assert.ok(Array.isArray(missingRowPayload.myHoleCards));
  assert.equal(missingRowPayload.myHoleCards.length, 2);

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
  assert.equal(invalidCardsResponse.statusCode, 200);
  const invalidCardsPayload = JSON.parse(invalidCardsResponse.body);
  assert.equal(invalidCardsPayload.ok, true);
  assert.ok(Array.isArray(invalidCardsPayload.myHoleCards));
  assert.equal(invalidCardsPayload.myHoleCards.length, 2);

  const repairQueries = [];
  const repairState = {
    ...baseState,
    phase: "FLOP",
    community: [{ r: "2", s: "S" }, { r: "3", s: "H" }, { r: "4", s: "D" }],
    communityDealt: 3,
  };
  const repairLogs = [];
  const repairResponse = await makeHandler(
    repairQueries,
    { value: JSON.stringify(repairState), version: 7 },
    "user-1",
    {
      holeCardsByUserId: {},
      klog: (event, payload) => repairLogs.push({ event, payload }),
    }
  )({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(repairResponse.statusCode, 200);
  const repairPayload = JSON.parse(repairResponse.body);
  assert.equal(repairPayload.ok, true);
  assert.ok(Array.isArray(repairPayload.myHoleCards));
  assert.equal(repairPayload.myHoleCards.length, 2);
  assert.equal(JSON.stringify(repairPayload).includes("holeCardsByUserId"), false);
  assert.equal(JSON.stringify(repairPayload).includes('"deck"'), false);
  assert.equal(JSON.stringify(repairPayload).includes('"handSeed"'), false);
  const repairInserts = repairQueries.filter((entry) =>
    entry.query.toLowerCase().includes("insert into public.poker_hole_cards")
  );
  assert.equal(repairInserts.length, 1);
  assert.ok(repairLogs.some((entry) => entry.event === "poker_get_table_hole_cards_repaired"));

  const missingSeedState = { ...baseState, handSeed: "" };
  const missingSeedQueries = [];
  const missingSeedResponse = await makeHandler(
    missingSeedQueries,
    { value: JSON.stringify(missingSeedState), version: 3 },
    "user-1",
    { holeCardsByUserId: {} }
  )({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(missingSeedResponse.statusCode, 409);
  assert.equal(JSON.parse(missingSeedResponse.body).error, "state_invalid");
  const missingSeedInserts = missingSeedQueries.filter((entry) =>
    entry.query.toLowerCase().includes("insert into public.poker_hole_cards")
  );
  assert.equal(missingSeedInserts.length, 0);

  // CHANGED: phase INIT means poker-get-table will NOT load hole cards at all.
  // So the expected status is 200, and there must be no hole-cards SELECT/INSERT queries.
  const initNoRepairState = { ...baseState, phase: "INIT" };
  const initNoRepairQueries = [];
  const initNoRepairResponse = await makeHandler(
    initNoRepairQueries,
    { value: JSON.stringify(initNoRepairState), version: 1 },
    "user-1",
    { holeCardsSelectError: new Error("state_invalid") }
  )({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(initNoRepairResponse.statusCode, 200);
  const initNoRepairPayload = JSON.parse(initNoRepairResponse.body);
  assert.equal(initNoRepairPayload.ok, true);
  assert.deepEqual(initNoRepairPayload.myHoleCards, []);

  const initNoRepairHoleCardSelects = initNoRepairQueries.filter((entry) =>
    entry.query.toLowerCase().includes("from public.poker_hole_cards")
  );
  assert.equal(initNoRepairHoleCardSelects.length, 0);

  const initNoRepairInserts = initNoRepairQueries.filter((entry) =>
    entry.query.toLowerCase().includes("insert into public.poker_hole_cards")
  );
  assert.equal(initNoRepairInserts.length, 0);

  const mismatchResponse = await makeHandler([], storedState, "user-1", {
    activeUserIds: ["user-1"],
  })({
    httpMethod: "GET",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    queryStringParameters: { tableId },
  });
  assert.equal(mismatchResponse.statusCode, 200);
  const mismatchPayload = JSON.parse(mismatchResponse.body);
  assert.equal(mismatchPayload.state.state.phase, "PREFLOP");
  assert.ok(Array.isArray(mismatchPayload.myHoleCards));
  assert.equal(mismatchPayload.myHoleCards.length, 2);

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
