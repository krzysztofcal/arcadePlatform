import assert from "node:assert/strict";
import { createDeck, dealHoleCards, shuffle } from "../netlify/functions/_shared/poker-engine.mjs";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { TURN_MS } from "../netlify/functions/_shared/poker-reducer.mjs";
import {
  getRng,
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  upgradeLegacyInitStateWithSeats,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "user-1";
const initialStacks = { "user-1": 100, "user-2": 100, "user-3": 100 };

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
    deriveDeck,
    extractBearerToken: () => "token",
    getRng,
    isPlainObject,
    isStateStorageValid,
    shuffle,
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    upgradeLegacyInitStateWithSeats,
    withoutPrivateState,
    computeLegalActions,
    buildActionConstraints,
    TURN_MS,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: 6, stakes: { sb: 1, bb: 2 } }];
          }
          if (text.includes("from public.poker_state")) {
            if (storedState.value) {
              return [{ version: 2, state: JSON.parse(storedState.value) }];
            }
            return [{ version: 1, state: { phase: "INIT", stacks: initialStacks } }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: "user-1", seat_no: 1, status: "ACTIVE" },
              { user_id: "user-2", seat_no: 3, status: "ACTIVE" },
              { user_id: "user-3", seat_no: 5, status: "ACTIVE" },
            ];
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            const holeCardsStore = storedState.holeCardsStore;
            if (storedState.holeCardsInsertError) {
              const err = new Error(storedState.holeCardsInsertError.message || "relation does not exist");
              err.code = storedState.holeCardsInsertError.code;
              throw err;
            }
            for (let i = 0; i < params.length; i += 4) {
              const tableKey = params[i];
              const handKey = params[i + 1];
              const userKey = params[i + 2];
              const cards = JSON.parse(params[i + 3]);
              holeCardsStore.set(`${tableKey}|${handKey}|${userKey}`, cards);
            }
            return [];
          }
          if (text.includes("from public.poker_hole_cards")) {
            const holeCardsStore = storedState.holeCardsStore;
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}`;
            if (holeCardsStore.has(key)) {
              return [{ cards: holeCardsStore.get(key) }];
            }
            return [];
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

const runHappyPath = async () => {
  const originalRng = globalThis.__TEST_RNG__;
  globalThis.__TEST_RNG__ = makeRng(42);
  const queries = [];
  const storedState = { value: null, holeCardsStore: new Map(), holeCardsInsertError: null };
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
  assert.equal(payload.replayed, false);
  assert.equal(payload.tableId, tableId);
  assert.ok(payload.state);
  assert.equal(typeof payload.state.version, "number");
  assert.equal(payload.state.state.phase, "PREFLOP");
  assert.ok(Array.isArray(payload.state.state.community));
  assert.equal(payload.state.state.community.length, 0);
  assert.equal(payload.state.state.pot, 3);
  assert.equal(payload.state.state.turnUserId, "user-1");
  assert.ok(Array.isArray(payload.myHoleCards));
  assert.equal(payload.myHoleCards.length, 2);
  assert.ok(Array.isArray(payload.legalActions));
  assert.ok(payload.actionConstraints);
  assert.ok("toCall" in payload.actionConstraints);
  assert.ok("minRaiseTo" in payload.actionConstraints);
  assert.ok("maxRaiseTo" in payload.actionConstraints);
  assert.ok("maxBetAmount" in payload.actionConstraints);
  assert.equal(payload.actionConstraints.toCall, 2);
  assert.equal(payload.actionConstraints.minRaiseTo, 3);
  assert.equal(payload.state.state.holeCardsByUserId, undefined);
  assert.equal(payload.state.state.handSeed, undefined);
  assert.equal(payload.holeCardsByUserId, undefined);
  assert.ok(!response.body.includes("holeCardsByUserId"));
  assert.ok(!response.body.includes("\"deck\""));
  assert.ok(!response.body.includes("\"handSeed\""));

  const insertHoleCardsIndex = queries.findIndex((q) => q.query.toLowerCase().includes("insert into public.poker_hole_cards"));
  const updateCall = queries.find((q) => q.query.toLowerCase().includes("version = version + 1"));
  const updateIndex = queries.findIndex((q) => q.query.toLowerCase().includes("version = version + 1"));
  assert.ok(updateCall, "expected update to poker_state");
  assert.ok(insertHoleCardsIndex !== -1, "expected insert into poker_hole_cards");
  assert.ok(insertHoleCardsIndex < updateIndex, "expected hole cards insert before state update");
  const updatedState = JSON.parse(updateCall.params?.[1] || "{}");
  assert.ok(updatedState.handId, "state should include handId");
  assert.equal(updatedState.deck, undefined);
  assert.equal(typeof updatedState.handSeed, "string");
  assert.equal(updatedState.communityDealt, 0);
  assert.equal(updatedState.holeCardsByUserId, undefined);
  assert.equal(typeof updatedState.toCallByUserId, "object");
  assert.equal(typeof updatedState.betThisRoundByUserId, "object");
  assert.equal(typeof updatedState.actedThisRoundByUserId, "object");
  assert.equal(typeof updatedState.foldedByUserId, "object");
  assert.equal(typeof updatedState.lastActionRequestIdByUserId, "object");
  assert.equal(typeof updatedState.stacks, "object");
  if (Object.prototype.hasOwnProperty.call(updatedState.stacks, userId)) {
    assert.equal(typeof updatedState.stacks[userId], "number");
  }
  assert.equal(updatedState.toCallByUserId[userId], 2);
  assert.equal(updatedState.betThisRoundByUserId[userId], 0);
  assert.equal(updatedState.actedThisRoundByUserId[userId], false);
  assert.equal(updatedState.foldedByUserId[userId], false);
  assert.equal(updatedState.currentBet, 2);
  assert.equal(updatedState.lastRaiseSize, 1);
  const seatOrder = ["user-1", "user-2", "user-3"];
  const deck = deriveDeck(updatedState.handSeed);
  const pos = seatOrder.indexOf(userId);
  assert.ok(pos >= 0, "test assumes user is seated");
  const expectedHoleCards = [deck[pos], deck[pos + seatOrder.length]];
  assert.deepEqual(payload.myHoleCards, expectedHoleCards, "myHoleCards must match deterministic deck from handSeed");
  assert.ok(
    queries.some((q) => q.query.toLowerCase().includes("insert into public.poker_actions")),
    "expected start hand action insert"
  );
  const actionInserts = queries.filter((q) => q.query.toLowerCase().includes("insert into public.poker_actions"));
  const startInsert = actionInserts.find((entry) => entry.params?.[3] === "START_HAND");
  const sbInsert = actionInserts.find((entry) => entry.params?.[3] === "POST_SB");
  const bbInsert = actionInserts.find((entry) => entry.params?.[3] === "POST_BB");
  assert.ok(startInsert, "expected start hand action insert payload");
  assert.ok(sbInsert, "expected post sb action insert payload");
  assert.ok(bbInsert, "expected post bb action insert payload");
  const actionParams = startInsert.params || [];
  assert.equal(actionParams.length, 10);
  assert.equal(actionParams[0], tableId);
  assert.equal(actionParams[3], "START_HAND");
  assert.equal(actionParams[5], updatedState.handId);
  assert.equal(actionParams[6], "req-1");
  assert.equal(actionParams[7], "INIT");
  assert.equal(actionParams[8], "PREFLOP");
  const actionMeta = JSON.parse(actionParams[9] || "{}");
  assert.equal(actionMeta?.determinism?.handSeed, updatedState.handSeed);

  const cardKeys = payload.myHoleCards.map((card) => `${card.r}-${card.s}`);
  const uniqueKeys = new Set(cardKeys);
  assert.equal(uniqueKeys.size, cardKeys.length, "hole cards should be unique");

  return { handler, queries, storedState, payload };
};

const runReplayPath = async () => {
  const { handler, queries, storedState, payload } = await runHappyPath();
  const updateCount = queries.filter((q) => q.query.toLowerCase().includes("update public.poker_state")).length;
  const actionCount = queries.filter((q) => q.query.toLowerCase().includes("insert into public.poker_actions")).length;
  const replayResponse = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-1" }),
  });
  assert.equal(replayResponse.statusCode, 200);
  const replayPayload = JSON.parse(replayResponse.body);
  const storedStateValue = JSON.parse(storedState.value || "{}");
  const holeCardKey = `${tableId}|${storedStateValue.handId}|${userId}`;
  assert.equal(replayPayload.ok, true);
  assert.equal(replayPayload.replayed, true);
  assert.equal(replayPayload.state.version, payload.state.version);
  assert.equal(replayPayload.state.state.phase, "PREFLOP");
  assert.deepEqual(replayPayload.myHoleCards, storedState.holeCardsStore.get(holeCardKey));
  assert.ok(Array.isArray(replayPayload.legalActions));
  assert.ok(replayPayload.actionConstraints);
  assert.ok("toCall" in replayPayload.actionConstraints);
  assert.ok("minRaiseTo" in replayPayload.actionConstraints);
  assert.ok("maxRaiseTo" in replayPayload.actionConstraints);
  assert.ok("maxBetAmount" in replayPayload.actionConstraints);

  const updateCalls = queries.filter((q) => q.query.toLowerCase().includes("update public.poker_state"));
  const actionCalls = queries.filter((q) => q.query.toLowerCase().includes("insert into public.poker_actions"));
  assert.equal(updateCalls.length, updateCount);
  assert.equal(actionCalls.length, actionCount);
  assert.ok(queries.some((q) => q.query.toLowerCase().includes("from public.poker_hole_cards")));

  const differentResponse = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-2" }),
  });
  assert.equal(differentResponse.statusCode, 409);
  const differentPayload = JSON.parse(differentResponse.body);
  assert.equal(differentPayload.error, "already_in_hand");
};

const runHeadsUpBlinds = async () => {
  const queries = [];
  const storedState = { value: null, holeCardsStore: new Map(), holeCardsInsertError: null };
  const handler = loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    createDeck,
    dealHoleCards,
    deriveDeck,
    extractBearerToken: () => "token",
    getRng,
    isPlainObject,
    isStateStorageValid,
    shuffle,
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    upgradeLegacyInitStateWithSeats,
    withoutPrivateState,
    computeLegalActions,
    buildActionConstraints,
    TURN_MS,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: 6, stakes: { sb: 1, bb: 2 } }];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 1, state: { phase: "INIT", stacks: { "user-1": 100, "user-2": 100 } } }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: "user-1", seat_no: 1, status: "ACTIVE" },
              { user_id: "user-2", seat_no: 2, status: "ACTIVE" },
            ];
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            for (let i = 0; i < params.length; i += 4) {
              const tableKey = params[i];
              const handKey = params[i + 1];
              const userKey = params[i + 2];
              const cards = JSON.parse(params[i + 3]);
              storedState.holeCardsStore.set(`${tableKey}|${handKey}|${userKey}`, cards);
            }
            return [];
          }
          if (text.includes("update public.poker_state")) {
            storedState.value = params?.[1] || null;
            return [{ version: 2, state: storedState.value }];
          }
          if (text.includes("insert into public.poker_actions")) {
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
    body: JSON.stringify({ tableId, requestId: "req-heads-up" }),
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  const state = payload.state.state;
  assert.equal(state.turnUserId, "user-1");
  assert.equal(state.pot, 3);
  assert.equal(state.betThisRoundByUserId["user-1"], 1);
  assert.equal(state.betThisRoundByUserId["user-2"], 2);
  assert.equal(state.toCallByUserId["user-1"], 1);
  assert.equal(state.toCallByUserId["user-2"], 0);
  assert.equal(state.currentBet, 2);
  assert.equal(state.lastRaiseSize, 1);
  const actionInserts = queries.filter((q) => q.query.toLowerCase().includes("insert into public.poker_actions"));
  assert.ok(actionInserts.some((entry) => entry.params?.[3] === "POST_SB"));
  assert.ok(actionInserts.some((entry) => entry.params?.[3] === "POST_BB"));
};

const runInvalidDeal = async () => {
  const originalRng = globalThis.__TEST_RNG__;
  globalThis.__TEST_RNG__ = makeRng(7);
  const queries = [];
  const storedState = { value: null, holeCardsStore: new Map(), holeCardsInsertError: null };
  const handler = loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    createDeck,
    dealHoleCards: () => ({ holeCardsByUserId: { "user-1": [], "user-2": [], "user-3": [] }, deck: [] }),
    deriveDeck,
    extractBearerToken: () => "token",
    getRng,
    isPlainObject,
    isStateStorageValid,
    shuffle,
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    upgradeLegacyInitStateWithSeats,
    withoutPrivateState,
    computeLegalActions,
    buildActionConstraints,
    TURN_MS,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: 6, stakes: { sb: 1, bb: 2 } }];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: 1, state: { phase: "INIT", stacks: initialStacks } }];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: "user-1", seat_no: 1, status: "ACTIVE" },
              { user_id: "user-2", seat_no: 3, status: "ACTIVE" },
              { user_id: "user-3", seat_no: 5, status: "ACTIVE" },
            ];
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            storedState.holeCardsStore.set("unexpected", params);
            return [];
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
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-invalid" }),
  });
  globalThis.__TEST_RNG__ = originalRng;

  assert.equal(response.statusCode, 409);
  assert.ok(response.body, "response body should not be empty");
  const payload = JSON.parse(response.body);
  assert.equal(payload.error, "state_invalid");
  assert.ok(!queries.some((q) => q.query.toLowerCase().includes("insert into public.poker_hole_cards")));
  assert.ok(!queries.some((q) => q.query.toLowerCase().includes("version = version + 1")));
};

const runMissingHoleCardsTable = async () => {
  const originalRng = globalThis.__TEST_RNG__;
  globalThis.__TEST_RNG__ = makeRng(9);
  const queries = [];
  const storedState = {
    value: null,
    holeCardsStore: new Map(),
    holeCardsInsertError: { code: "42P01", message: "relation \"poker_hole_cards\" does not exist" },
  };
  const handler = makeHandler(queries, storedState);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-missing-table" }),
  });
  globalThis.__TEST_RNG__ = originalRng;

  assert.equal(response.statusCode, 409);
  const payload = JSON.parse(response.body);
  assert.equal(payload.error, "state_invalid");
  assert.ok(!queries.some((q) => q.query.toLowerCase().includes("version = version + 1")));
  assert.ok(!queries.some((q) => q.query.toLowerCase().includes("insert into public.poker_actions")));
};

const runMissingDealSecret = async () => {
  const originalSecret = process.env.POKER_DEAL_SECRET;
  delete process.env.POKER_DEAL_SECRET;
  const queries = [];
  const storedState = { value: null, holeCardsStore: new Map(), holeCardsInsertError: null };
  const handler = makeHandler(queries, storedState);
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-missing-secret" }),
  });
  if (originalSecret) {
    process.env.POKER_DEAL_SECRET = originalSecret;
  } else {
    delete process.env.POKER_DEAL_SECRET;
  }
  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error, "state_invalid");
};

const runMissingStateRow = async () => {
  const queries = [];
  const handler = loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    createDeck,
    dealHoleCards,
    deriveDeck,
    extractBearerToken: () => "token",
    getRng,
    isPlainObject,
    isStateStorageValid,
    shuffle,
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    upgradeLegacyInitStateWithSeats,
    withoutPrivateState,
    computeLegalActions,
    buildActionConstraints,
    TURN_MS,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: 6, stakes: { sb: 1, bb: 2 } }];
          }
          if (text.includes("from public.poker_state")) {
            return [];
          }
          if (text.includes("from public.poker_seats")) {
            return [
              { user_id: "user-1", seat_no: 1, status: "ACTIVE" },
              { user_id: "user-2", seat_no: 3, status: "ACTIVE" },
            ];
          }
          return [];
        },
      }),
    klog: () => {},
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-missing-state" }),
  });

  assert.equal(response.statusCode, 409);
  assert.ok(response.body, "response body should not be empty");
  const payload = JSON.parse(response.body);
  assert.equal(payload.error, "state_invalid");
};

await runHappyPath();
await runReplayPath();
await runHeadsUpBlinds();
await runInvalidDeal();
await runMissingHoleCardsTable();
await runMissingDealSecret();
await runMissingStateRow();
