import assert from "node:assert/strict";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { dealHoleCards } from "../netlify/functions/_shared/poker-engine.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";
import { advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import {
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
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
  toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
  betThisRoundByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
  actedThisRoundByUserId: { "user-1": false, "user-2": false, "user-3": false },
  foldedByUserId: { "user-1": false, "user-2": false, "user-3": false },
  lastAggressorUserId: null,
  lastActionRequestIdByUserId: {},
};

const seatOrder = baseState.seats.map((seat) => seat.userId);
const dealt = dealHoleCards(deriveDeck(baseState.handSeed), seatOrder);
const defaultHoleCards = dealt.holeCardsByUserId;

const makeHandler = (queries, storedState, userId, options = {}) =>
  loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId,
    isPlainObject,
    isStateStorageValid,
    normalizeJsonState,
    withoutPrivateState,
    advanceIfNeeded,
    applyAction: options.applyAction || applyAction,
    deriveCommunityCards,
    deriveRemainingDeck,
    isHoleCardsTableMissing,
    loadHoleCardsByUserId,
    computeShowdown,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN" }];
          }
          if (text.includes("from public.poker_seats")) {
            const hasActive = text.includes("status = 'active'");
            const hasUserFilter = text.includes("user_id = $2");
            const okParams = Array.isArray(params) && params.length >= 2 && params[0] === tableId && params[1] === userId;
            if (hasActive && hasUserFilter && okParams) return [{ user_id: userId }];
            if (hasActive) {
              return [
                { user_id: "user-1", seat_no: 1 },
                { user_id: "user-2", seat_no: 2 },
                { user_id: "user-3", seat_no: 3 },
              ];
            }
            return [];
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
          if (text.includes("update public.poker_state")) {
            storedState.value = params?.[1] || storedState.value;
            storedState.version += 1;
            return [{ version: storedState.version }];
          }
          if (text.includes("insert into public.poker_actions")) {
            return [{ ok: true }];
          }
          return [];
        },
      }),
    klog: options.klog || (() => {}),
  });

const runCase = async ({ state, action, requestId, userId, klogCalls, holeCardsByUserId, holeCardsError, applyAction: applyActionOverride }) => {
  const queries = [];
  const storedState = { value: JSON.stringify(state), version: 3 };
  const handler = makeHandler(queries, storedState, userId, {
    klog: klogCalls ? (kind, data) => klogCalls.push({ kind, data }) : undefined,
    holeCardsByUserId,
    holeCardsError,
    applyAction: applyActionOverride,
  });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId, action }),
  });
  return { response, queries };
};

const run = async () => {
  const queries = [];
  const storedState = { value: JSON.stringify(baseState), version: 7 };

  const invalidRequest = await makeHandler(queries, storedState, "user-1")({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "", action: { type: "CHECK" } }),
  });
  assert.equal(invalidRequest.statusCode, 400);
  assert.equal(JSON.parse(invalidRequest.body).error, "invalid_request_id");

  const invalidAmount = await makeHandler(queries, storedState, "user-1")({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-bad", action: { type: "BET", amount: 0 } }),
  });
  assert.equal(invalidAmount.statusCode, 400);
  assert.equal(JSON.parse(invalidAmount.body).error, "invalid_action");

  const invalidBet = await runCase({
    state: baseState,
    action: { type: "BET", amount: 1000 },
    requestId: "req-too-big",
    userId: "user-1",
  });
  assert.equal(invalidBet.response.statusCode, 400);
  assert.equal(JSON.parse(invalidBet.response.body).error, "invalid_action");

  const raiseState = {
    ...baseState,
    stacks: { ...baseState.stacks, "user-1": 20 },
    toCallByUserId: { ...baseState.toCallByUserId, "user-1": 5 },
    betThisRoundByUserId: { ...baseState.betThisRoundByUserId, "user-1": 2 },
  };
  const invalidRaise = await runCase({
    state: raiseState,
    action: { type: "RAISE", amount: 30 },
    requestId: "req-raise-too-big",
    userId: "user-1",
  });
  assert.equal(invalidRaise.response.statusCode, 400);
  assert.equal(JSON.parse(invalidRaise.response.body).error, "invalid_action");

  const validRaise = await runCase({
    state: raiseState,
    action: { type: "RAISE", amount: 20 },
    requestId: "req-raise-ok",
    userId: "user-1",
  });
  assert.equal(validRaise.response.statusCode, 200);

  const checkState = {
    ...baseState,
    toCallByUserId: { ...baseState.toCallByUserId, "user-1": 5 },
  };
  const invalidCheck = await runCase({
    state: checkState,
    action: { type: "CHECK" },
    requestId: "req-check",
    userId: "user-1",
  });
  assert.equal(invalidCheck.response.statusCode, 400);
  assert.equal(JSON.parse(invalidCheck.response.body).error, "invalid_action");

  const invalidCall = await runCase({
    state: baseState,
    action: { type: "CALL" },
    requestId: "req-call",
    userId: "user-1",
  });
  assert.equal(invalidCall.response.statusCode, 400);
  assert.equal(JSON.parse(invalidCall.response.body).error, "invalid_action");

  const corruptCalls = [];
  const corruptState = {
    ...baseState,
    community: [{ r: "A", s: "S" }],
    communityDealt: 0,
  };
  const corruptResponse = await runCase({
    state: corruptState,
    action: { type: "CHECK" },
    requestId: "req-corrupt",
    userId: "user-1",
    klogCalls: corruptCalls,
  });
  assert.equal(corruptResponse.response.statusCode, 409);
  assert.equal(JSON.parse(corruptResponse.response.body).error, "state_invalid");
  const corruptEntry = corruptCalls.find((entry) => entry.kind === "poker_act_rejected");
  assert.ok(corruptEntry);
  assert.equal(corruptEntry.data?.code, "community_len_mismatch");

  const storageCheck = isStateStorageValid(
    { phase: "HAND_DONE", seats: baseState.seats },
    { requirePrivate: false }
  );
  assert.equal(storageCheck, true);

  const handlerUser2 = makeHandler(queries, storedState, "user-2");
  const notTurn = await handlerUser2({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-1", action: { type: "CHECK" } }),
  });
  assert.equal(notTurn.statusCode, 403);
  assert.equal(JSON.parse(notTurn.body).error, "not_your_turn");

  const handlerUser1 = makeHandler(queries, storedState, "user-1");
  const user1Check = await handlerUser1({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-2", action: { type: "CHECK" } }),
  });
  assert.equal(user1Check.statusCode, 200);
  const user1Payload = JSON.parse(user1Check.body);
  assert.equal(user1Payload.ok, true);
  assert.equal(user1Payload.state.state.holeCardsByUserId, undefined);
  assert.equal(user1Payload.state.state.handSeed, undefined);
  assert.equal(user1Payload.state.state.deck, undefined);
  assert.ok(Array.isArray(user1Payload.myHoleCards));
  assert.equal(user1Payload.myHoleCards.length, 2);
  assert.equal(user1Payload.replayed, false);
  assert.equal(user1Payload.holeCardsByUserId, undefined);
  assert.equal(user1Payload.deck, undefined);
  assert.equal(user1Payload.state.holeCardsByUserId, undefined);
  assert.equal(JSON.stringify(user1Payload).includes("holeCardsByUserId"), false);
  assert.equal(JSON.stringify(user1Payload).includes('"deck"'), false);
  assert.equal(JSON.stringify(user1Payload).includes('"handSeed"'), false);

  const updateCountBeforeReplay = queries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state")).length;
  const replayResponse = await handlerUser1({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-2", action: { type: "CHECK" } }),
  });
  assert.equal(replayResponse.statusCode, 200);
  const replayPayload = JSON.parse(replayResponse.body);
  assert.equal(replayPayload.replayed, true);
  const updateCountAfterReplay = queries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state")).length;
  assert.equal(updateCountAfterReplay, updateCountBeforeReplay);
  const holeCardQueries = queries.filter((entry) => entry.query.toLowerCase().includes("from public.poker_hole_cards"));
  assert.ok(holeCardQueries.length >= 1);

  const handlerUser2Turn = makeHandler(queries, storedState, "user-2");
  const user2Check = await handlerUser2Turn({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-3", action: { type: "CHECK" } }),
  });
  assert.equal(user2Check.statusCode, 200);

  const handlerUser3 = makeHandler(queries, storedState, "user-3");
  const user3Check = await handlerUser3({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-4", action: { type: "CHECK" } }),
  });
  assert.equal(user3Check.statusCode, 200);
  const user3Payload = JSON.parse(user3Check.body);
  assert.equal(user3Payload.state.state.phase, "FLOP");
  assert.equal(user3Payload.state.state.community.length, 3);
  assert.equal(user3Payload.state.state.communityDealt, 3);
  const derivedDeck = deriveDeck(baseState.handSeed);
  const expectedCommunity = derivedDeck.slice(6, 9);
  assert.deepEqual(user3Payload.state.state.community, expectedCommunity);
  const holeKeys = new Set(
    Object.values(defaultHoleCards)
      .flat()
      .map((card) => `${card.r}-${card.s}`)
  );
  for (const card of user3Payload.state.state.community) {
    assert.equal(holeKeys.has(`${card.r}-${card.s}`), false, "community must not overlap hole cards");
  }
  assert.ok(user3Payload.events.some((event) => event.type === "STREET_ADVANCED"));
  assert.ok(user3Payload.events.some((event) => event.type === "COMMUNITY_DEALT"));
  assert.equal(user3Payload.state.state.holeCardsByUserId, undefined);
  assert.equal(user3Payload.state.state.handSeed, undefined);
  assert.equal(user3Payload.state.state.deck, undefined);
  assert.equal(user3Payload.holeCardsByUserId, undefined);
  assert.equal(user3Payload.deck, undefined);
  assert.equal(user3Payload.state.holeCardsByUserId, undefined);
  assert.equal(JSON.stringify(user3Payload).includes("holeCardsByUserId"), false);
  assert.equal(JSON.stringify(user3Payload).includes('"deck"'), false);
  assert.equal(JSON.stringify(user3Payload).includes('"handSeed"'), false);

  const updateCall = queries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(updateCall, "expected poker_state update");
  const updatedState = JSON.parse(updateCall.params?.[1] || "{}");
  assert.equal(updatedState.holeCardsByUserId, undefined);
  assert.equal(updatedState.deck, undefined);
  assert.equal(updatedState.communityDealt, updatedState.community.length);
  assert.equal(typeof updatedState.handSeed, "string");

  const actionInserts = queries.filter((entry) => entry.query.toLowerCase().includes("insert into public.poker_actions"));
  assert.equal(actionInserts.length, 3);

  let capturedKeys = null;
  const applyActionWrapped = (state, action) => {
    capturedKeys = Object.keys(state.holeCardsByUserId || {}).sort();
    return applyAction(state, action);
  };
  const filteredResponse = await runCase({
    state: baseState,
    action: { type: "CHECK" },
    requestId: "req-filtered",
    userId: "user-1",
    holeCardsByUserId: {
      ...defaultHoleCards,
      "user-999": [
        { r: "2", s: "H" },
        { r: "3", s: "H" },
      ],
    },
    applyAction: applyActionWrapped,
  });
  assert.equal(filteredResponse.response.statusCode, 200);
  assert.deepEqual(capturedKeys, ["user-1", "user-2", "user-3"]);

  const missingTableError = new Error("missing table");
  missingTableError.code = "42P01";
  const missingTableResponse = await runCase({
    state: baseState,
    action: { type: "CHECK" },
    requestId: "req-missing-table",
    userId: "user-1",
    holeCardsError: missingTableError,
  });
  assert.equal(missingTableResponse.response.statusCode, 409);
  assert.equal(JSON.parse(missingTableResponse.response.body).error, "state_invalid");

  const invalidCardsResponse = await runCase({
    state: baseState,
    action: { type: "CHECK" },
    requestId: "req-invalid-cards",
    userId: "user-1",
    holeCardsByUserId: {
      ...defaultHoleCards,
      "user-2": [],
    },
  });
  assert.equal(invalidCardsResponse.response.statusCode, 409);
  assert.equal(JSON.parse(invalidCardsResponse.response.body).error, "state_invalid");

  const missingRowResponse = await runCase({
    state: baseState,
    action: { type: "CHECK" },
    requestId: "req-missing-row",
    userId: "user-1",
    holeCardsByUserId: {
      "user-1": defaultHoleCards["user-1"],
      "user-2": defaultHoleCards["user-2"],
    },
  });
  assert.equal(missingRowResponse.response.statusCode, 409);
  assert.equal(JSON.parse(missingRowResponse.response.body).error, "state_invalid");

  const showdownCommunity = deriveCommunityCards({
    handSeed: baseState.handSeed,
    seatUserIdsInOrder: seatOrder,
    communityDealt: 5,
  });
  const showdownState = {
    ...baseState,
    phase: "SHOWDOWN",
    turnUserId: null,
    community: showdownCommunity,
    communityDealt: showdownCommunity.length,
    foldedByUserId: { ...baseState.foldedByUserId, "user-3": true },
  };
  const showdownHoleCards = {
    "user-1": [
      { r: "A", s: "S" },
      { r: "K", s: "S" },
    ],
    "user-2": [
      { r: "Q", s: "H" },
      { r: "J", s: "H" },
    ],
    "user-3": [
      { r: "9", s: "D" },
      { r: "9", s: "C" },
    ],
  };
  const showdownQueries = [];
  const showdownStoredState = { value: JSON.stringify(showdownState), version: 10 };
  const showdownHandler = makeHandler(showdownQueries, showdownStoredState, "user-1", {
    holeCardsByUserId: showdownHoleCards,
  });
  const showdownResponse = await showdownHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-showdown", action: { type: "CHECK" } }),
  });
  assert.equal(showdownResponse.statusCode, 200);
  const showdownPayload = JSON.parse(showdownResponse.body);
  assert.ok(showdownPayload.state.state.showdown);
  assert.deepEqual(Object.keys(showdownPayload.state.state.showdown.revealedHoleCardsByUserId).sort(), ["user-1", "user-2"]);
  assert.deepEqual(
    showdownPayload.state.state.showdown.revealedHoleCardsByUserId["user-1"],
    showdownHoleCards["user-1"]
  );
  assert.equal(showdownPayload.myHoleCards.length, 0);
  const expectedShowdown = computeShowdown({
    community: showdownCommunity,
    players: [
      { userId: "user-1", holeCards: showdownHoleCards["user-1"] },
      { userId: "user-2", holeCards: showdownHoleCards["user-2"] },
    ],
  });
  assert.deepEqual(showdownPayload.state.state.showdown.winners, expectedShowdown.winners);
  const showdownUpdateCount = showdownQueries.filter((entry) =>
    entry.query.toLowerCase().includes("update public.poker_state")
  ).length;
  const showdownActionCount = showdownQueries.filter((entry) =>
    entry.query.toLowerCase().includes("insert into public.poker_actions")
  ).length;
  const showdownReplayResponse = await showdownHandler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "req-showdown", action: { type: "CHECK" } }),
  });
  assert.equal(showdownReplayResponse.statusCode, 200);
  const showdownUpdateCountAfter = showdownQueries.filter((entry) =>
    entry.query.toLowerCase().includes("update public.poker_state")
  ).length;
  const showdownActionCountAfter = showdownQueries.filter((entry) =>
    entry.query.toLowerCase().includes("insert into public.poker_actions")
  ).length;
  assert.equal(showdownUpdateCountAfter, showdownUpdateCount);
  assert.equal(showdownActionCountAfter, showdownActionCount);
};

await run();
