import assert from "node:assert/strict";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { dealHoleCards } from "../netlify/functions/_shared/poker-engine.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";
import { TURN_MS, advanceIfNeeded, applyAction, computeNextDealerSeatNo } from "../netlify/functions/_shared/poker-reducer.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";
import { maybeApplyTurnTimeout, normalizeSeatOrderFromState } from "../netlify/functions/_shared/poker-turn-timeout.mjs";
import {
  getRng,
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  upgradeLegacyInitStateWithSeats,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";

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
  currentBet: 0,
  lastRaiseSize: 0,
  lastActionRequestIdByUserId: {},
};

const seatOrder = baseState.seats.map((seat) => seat.userId);
const dealt = dealHoleCards(deriveDeck(baseState.handSeed), seatOrder);
const defaultHoleCards = dealt.holeCardsByUserId;

const makeHandler = (queries, storedState, userId, options = {}) =>
  loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    awardPotsAtShowdown,
    materializeShowdownAndPayout,
    computeShowdown,
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId,
    isPlainObject,
    isStateStorageValid,
    TURN_MS,
    normalizeJsonState,
    withoutPrivateState,
    maybeApplyTurnTimeout,
    advanceIfNeeded,
    applyAction: options.applyAction || applyAction,
    deriveCommunityCards,
    deriveRemainingDeck,
    computeLegalActions,
    buildActionConstraints,
    isHoleCardsTableMissing,
    resetTurnTimer,
    updatePokerStateOptimistic,
    loadHoleCardsByUserId: options.loadHoleCardsByUserId || loadHoleCardsByUserId,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          const requestStore = storedState.requests || (storedState.requests = new Map());
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", stakes: options.tableStakes ?? "{\"sb\":1,\"bb\":2}" }];
          }
          if (text.includes("from public.poker_seats")) {
            const hasActive = text.includes("status = 'active'");
            const hasUserFilter = text.includes("user_id = $2");
            const okParams = Array.isArray(params) && params.length >= 2 && params[0] === tableId && params[1] === userId;
            if (hasActive && hasUserFilter && okParams) return [{ user_id: userId }];
            if (hasActive) {
              const activeSeatUserIds = options.activeSeatUserIds || ["user-1", "user-2", "user-3"];
              return activeSeatUserIds.map((id, index) => ({ user_id: id, seat_no: index + 1 }));
            }
            return [];
          }
          if (text.includes("from public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(requestKey);
            if (!entry) return [];
            return [{ result_json: entry.resultJson, created_at: entry.createdAt }];
          }
          if (text.includes("insert into public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requestStore.has(requestKey)) return [];
            requestStore.set(requestKey, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (options.failRequestWriteOnce && !storedState.requestWriteFailed) {
              storedState.requestWriteFailed = true;
              throw new Error("request_write_failed");
            }
            const entry = requestStore.get(requestKey) || { createdAt: new Date().toISOString() };
            entry.resultJson = params?.[4] ?? null;
            requestStore.set(requestKey, entry);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            requestStore.delete(requestKey);
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
            if (text.includes("version = version + 1")) {
              if (options.updatePokerStateConflict) return [];
              storedState.value = params?.[2] || storedState.value;
              const baseVersion = Number(params?.[1]);
              storedState.version = Number.isFinite(baseVersion) ? baseVersion + 1 : storedState.version + 1;
              return [{ version: storedState.version }];
            }
            storedState.value = params?.[1] || storedState.value;
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

const makeStartHandHandler = (queries, storedState, userId, seatUserIds) => {
  const initialStacks = seatUserIds.reduce((acc, id) => {
    acc[id] = 100;
    return acc;
  }, {});
  return loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    dealHoleCards,
    deriveDeck,
    extractBearerToken: () => "token",
    getRng,
    isPlainObject,
    isStateStorageValid,
    normalizeJsonState,
    normalizeRequestId,
    upgradeLegacyInitStateWithSeats,
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    withoutPrivateState,
    computeNextDealerSeatNo,
    computeLegalActions,
    buildActionConstraints,
    TURN_MS,
    updatePokerStateOptimistic,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          const requestStore = storedState.requests || (storedState.requests = new Map());
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", max_players: 6, stakes: { sb: 1, bb: 2 } }];
          }
          if (text.includes("from public.poker_state")) {
            if (storedState.value) {
              return [{ version: 1, state: JSON.parse(storedState.value) }];
            }
            return [{ version: 1, state: { phase: "INIT", stacks: initialStacks } }];
          }
          if (text.includes("from public.poker_seats")) {
            return seatUserIds.map((id, index) => ({ user_id: id, seat_no: index + 1, status: "ACTIVE" }));
          }
          if (text.includes("from public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(requestKey);
            if (!entry) return [];
            return [{ result_json: entry.resultJson, created_at: entry.createdAt }];
          }
          if (text.includes("insert into public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (requestStore.has(requestKey)) return [];
            requestStore.set(requestKey, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const entry = requestStore.get(requestKey) || { createdAt: new Date().toISOString() };
            entry.resultJson = params?.[4] ?? null;
            requestStore.set(requestKey, entry);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("delete from public.poker_requests")) {
            const requestKey = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            requestStore.delete(requestKey);
            return [];
          }
          if (text.includes("insert into public.poker_hole_cards")) {
            const holeCardsStore = storedState.holeCardsStore;
            const insertedRows = [];
            for (let i = 0; i < params.length; i += 4) {
              const tableKey = params[i];
              const handKey = params[i + 1];
              const userKey = params[i + 2];
              const cards = JSON.parse(params[i + 3]);
              holeCardsStore.set(`${tableKey}|${handKey}|${userKey}`, cards);
              insertedRows.push({ user_id: userKey });
            }
            return insertedRows;
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
            if (text.includes("version = version + 1")) {
              storedState.value = params?.[2] || null;
              const baseVersion = Number(params?.[1]);
              storedState.version = Number.isFinite(baseVersion) ? baseVersion + 1 : (storedState.version || 1) + 1;
              return [{ version: storedState.version, state: storedState.value }];
            }
            storedState.value = params?.[1] || null;
            return [{ version: storedState.version || 1, state: storedState.value }];
          }
          return [];
        },
      }),
    klog: () => {},
  });
};

const makeGetTableHandler = (queries, storedState, userId, options = {}) =>
  loadPokerHandler("netlify/functions/poker-get-table.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    computeShowdown,
    deriveCommunityCards,
    deriveRemainingDeck,
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeJsonState,
    withoutPrivateState,
    isStateStorageValid,
    maybeApplyTurnTimeout,
    normalizeSeatOrderFromState,
    isHoleCardsTableMissing,
    computeLegalActions,
    buildActionConstraints,
    loadHoleCardsByUserId,
    updatePokerStateOptimistic,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_tables")) {
            return [
              {
                id: tableId,
                status: "OPEN",
                stakes: { sb: 1, bb: 2 },
                max_players: 6,
                created_by: "owner",
                created_at: "2024-01-01",
                updated_at: "2024-01-01",
                last_activity_at: "2024-01-01",
              },
            ];
          }
          if (text.includes("from public.poker_seats")) {
            if (text.includes("status = 'active'")) {
              return [
                { user_id: "user-1", seat_no: 1 },
                { user_id: "user-2", seat_no: 2 },
                { user_id: "user-3", seat_no: 3 },
              ];
            }
            return [
              { user_id: "user-1", seat_no: 1, status: "ACTIVE", last_seen_at: null, joined_at: null },
              { user_id: "user-2", seat_no: 2, status: "ACTIVE", last_seen_at: null, joined_at: null },
              { user_id: "user-3", seat_no: 3, status: "ACTIVE", last_seen_at: null, joined_at: null },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: storedState.version, state: JSON.parse(storedState.value) }];
          }
          if (text.includes("from public.poker_hole_cards")) {
            const rows = [];
            const map = storedState.holeCardsByUserId || defaultHoleCards;
            for (const [userIdValue, cards] of Object.entries(map)) {
              rows.push({ user_id: userIdValue, cards });
            }
            return rows;
          }
          if (text.includes("update public.poker_state")) {
            if (text.includes("version = version + 1")) {
              if (options.updatePokerStateConflict) return [];
              storedState.value = params?.[2] || storedState.value;
              const baseVersion = Number(params?.[1]);
              storedState.version = Number.isFinite(baseVersion) ? baseVersion + 1 : storedState.version + 1;
              return [{ version: storedState.version }];
            }
            storedState.value = params?.[1] || storedState.value;
            return [{ version: storedState.version }];
          }
          if (text.includes("insert into public.poker_actions")) {
            return [{ ok: true }];
          }
          return [];
        },
      }),
    klog: () => {},
  });

const runCase = async ({
  state,
  action,
  requestId,
  userId,
  klogCalls,
  holeCardsByUserId,
  holeCardsError,
  applyAction: applyActionOverride,
  activeSeatUserIds,
  loadHoleCardsByUserId: loadHoleCardsByUserIdOverride,
  updatePokerStateConflict,
}) => {
  const queries = [];
  const storedState = { value: JSON.stringify(state), version: 3 };
  const handler = makeHandler(queries, storedState, userId, {
    klog: klogCalls ? (kind, data) => klogCalls.push({ kind, data }) : undefined,
    holeCardsByUserId,
    holeCardsError,
    applyAction: applyActionOverride,
    activeSeatUserIds,
    loadHoleCardsByUserId: loadHoleCardsByUserIdOverride,
    updatePokerStateConflict,
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

  {
    const invalidStakesQueries = [];
    const invalidHandler = makeHandler(invalidStakesQueries, storedState, "user-1", {
      tableStakes: "{\"sb\":0,\"bb\":0}",
      holeCardsByUserId: defaultHoleCards,
      activeSeatUserIds: ["user-1", "user-2", "user-3"],
    });
    const invalidStakesResponse = await invalidHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-invalid-stakes", action: { type: "CHECK" } }),
    });
    assert.equal(invalidStakesResponse.statusCode, 409);
    assert.equal(JSON.parse(invalidStakesResponse.body).error, "invalid_stakes");
    assert.ok(!invalidStakesQueries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_actions")));
    assert.ok(!invalidStakesQueries.some((entry) => entry.query.toLowerCase().includes("update public.poker_state")));
  }

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

  {
    const sitoutResponse = await runCase({
      state: { ...baseState, sitOutByUserId: { "user-1": true } },
      action: { type: "CHECK" },
      requestId: "req-sitout",
      userId: "user-1",
    });
    assert.equal(sitoutResponse.response.statusCode, 409);
    assert.equal(JSON.parse(sitoutResponse.response.body).error, "player_sitout");
    assert.ok(!sitoutResponse.queries.some((entry) => entry.query.toLowerCase().includes("update public.poker_state")));
    assert.ok(!sitoutResponse.queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_actions")));
  }

  {
    const clearedResponse = await runCase({
      state: { ...baseState, missedTurnsByUserId: { "user-1": 1 } },
      action: { type: "CHECK" },
      requestId: "req-clear-missed",
      userId: "user-1",
    });
    assert.equal(clearedResponse.response.statusCode, 200);
    const updateCall = clearedResponse.queries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
    assert.ok(updateCall, "expected poker_state update for missed-turns clear");
    const updatedState = JSON.parse(updateCall.params?.[2] || "{}");
    assert.equal(updatedState.missedTurnsByUserId?.["user-1"], undefined);
  }

  {
    const conflictResponse = await runCase({
      state: baseState,
      action: { type: "CHECK" },
      requestId: "req-conflict",
      userId: "user-1",
      updatePokerStateConflict: true,
    });
    assert.equal(conflictResponse.response.statusCode, 409);
    assert.equal(JSON.parse(conflictResponse.response.body).error, "state_conflict");
    assert.ok(
      !conflictResponse.queries.some((entry) => entry.query.toLowerCase().includes("insert into public.poker_actions"))
    );
  }

  const nonContiguousSeats = [
    { userId: "user-1", seatNo: 1 },
    { userId: "user-2", seatNo: 3 },
    { userId: "user-3", seatNo: 5 },
  ];
  const nonContiguousState = {
    ...baseState,
    seats: nonContiguousSeats,
    dealerSeatNo: 2,
    turnUserId: "user-1",
  };
  const nonContiguousOrder = nonContiguousSeats.map((seat) => seat.userId);
  const nonContiguousHoleCards = dealHoleCards(deriveDeck(nonContiguousState.handSeed), nonContiguousOrder).holeCardsByUserId;
  const invalidDealerResponse = await runCase({
    state: nonContiguousState,
    action: { type: "CHECK" },
    requestId: "req-invalid-dealer",
    userId: "user-1",
    holeCardsByUserId: nonContiguousHoleCards,
    activeSeatUserIds: nonContiguousOrder,
  });
  assert.equal(invalidDealerResponse.response.statusCode, 200, invalidDealerResponse.response.body);
  const invalidDealerPayload = JSON.parse(invalidDealerResponse.response.body);
  assert.equal(invalidDealerPayload.state.state.dealerSeatNo, 1);

  const invalidBet = await runCase({
    state: baseState,
    action: { type: "BET", amount: 1000 },
    requestId: "req-too-big",
    userId: "user-1",
  });
  assert.equal(invalidBet.response.statusCode, 400);
  assert.equal(JSON.parse(invalidBet.response.body).error, "invalid_amount");

  const raiseState = {
    ...baseState,
    stacks: { ...baseState.stacks, "user-1": 20 },
    toCallByUserId: { ...baseState.toCallByUserId, "user-1": 5 },
    betThisRoundByUserId: { ...baseState.betThisRoundByUserId, "user-1": 2 },
    currentBet: 7,
    lastRaiseSize: 2,
  };
  const invalidRaise = await runCase({
    state: raiseState,
    action: { type: "RAISE", amount: 30 },
    requestId: "req-raise-too-big",
    userId: "user-1",
  });
  assert.equal(invalidRaise.response.statusCode, 400);
  assert.equal(JSON.parse(invalidRaise.response.body).error, "invalid_amount");

  const validRaise = await runCase({
    state: raiseState,
    action: { type: "RAISE", amount: 20 },
    requestId: "req-raise-ok",
    userId: "user-1",
  });
  assert.equal(validRaise.response.statusCode, 200);

  const minRaiseState = {
    ...baseState,
    stacks: { ...baseState.stacks, "user-1": 6 },
    betThisRoundByUserId: { ...baseState.betThisRoundByUserId, "user-1": 6 },
    toCallByUserId: { ...baseState.toCallByUserId, "user-1": 4 },
    currentBet: 10,
    lastRaiseSize: 4,
  };
  const shortRaise = await runCase({
    state: minRaiseState,
    action: { type: "RAISE", amount: 11 },
    requestId: "req-raise-short",
    userId: "user-1",
  });
  assert.equal(shortRaise.response.statusCode, 400);
  assert.equal(JSON.parse(shortRaise.response.body).error, "invalid_amount");

  const allInRaise = await runCase({
    state: minRaiseState,
    action: { type: "RAISE", amount: 12 },
    requestId: "req-raise-all-in",
    userId: "user-1",
  });
  assert.equal(allInRaise.response.statusCode, 200);

  const checkState = {
    ...baseState,
    toCallByUserId: { ...baseState.toCallByUserId, "user-1": 5 },
    currentBet: 5,
  };
  const invalidCheck = await runCase({
    state: checkState,
    action: { type: "CHECK" },
    requestId: "req-check",
    userId: "user-1",
  });
  assert.equal(invalidCheck.response.statusCode, 403);
  assert.equal(JSON.parse(invalidCheck.response.body).error, "action_not_allowed");

  const invalidCall = await runCase({
    state: baseState,
    action: { type: "CALL" },
    requestId: "req-call",
    userId: "user-1",
  });
  assert.equal(invalidCall.response.statusCode, 403);
  assert.equal(JSON.parse(invalidCall.response.body).error, "action_not_allowed");

  const allInState = {
    ...baseState,
    stacks: { ...baseState.stacks, "user-1": 10 },
  };
  const allInBet = await runCase({
    state: allInState,
    action: { type: "BET", amount: 10 },
    requestId: "req-all-in",
    userId: "user-1",
  });
  assert.equal(allInBet.response.statusCode, 200);
  const allInPayload = JSON.parse(allInBet.response.body);
  assert.equal(allInPayload.state.state.stacks["user-1"], 0);
  assert.equal(allInPayload.state.state.contributionsByUserId["user-1"], 10);

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

  {
    const timerStart = Date.now() - 2000;
    const timerState = {
      ...baseState,
      turnUserId: "user-1",
      turnStartedAt: timerStart,
      turnDeadlineAt: timerStart + TURN_MS,
    };
    const timerQueries = [];
    const timerStoredState = { value: JSON.stringify(timerState), version: 1 };
    const timerHandler = makeHandler(timerQueries, timerStoredState, "user-1");
    const firstResponse = await timerHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-timer-1", action: { type: "CHECK" } }),
    });
    assert.equal(firstResponse.statusCode, 200);
    const firstPayload = JSON.parse(firstResponse.body);
    const firstState = firstPayload.state.state;
    assert.equal(firstState.turnUserId, "user-2");
    assert.ok(firstState.turnStartedAt > timerStart);
    assert.equal(firstState.turnDeadlineAt - firstState.turnStartedAt, TURN_MS);

    const secondResponse = await timerHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-timer-1", action: { type: "CHECK" } }),
    });
    assert.equal(secondResponse.statusCode, 200);
    const secondPayload = JSON.parse(secondResponse.body);
    assert.equal(secondPayload.replayed, true);
    assert.equal(secondPayload.state.state.turnStartedAt, firstState.turnStartedAt);
    assert.equal(secondPayload.state.state.turnDeadlineAt, firstState.turnDeadlineAt);
  }

  {
    const timerStart = Date.now() - 2000;
    const rejectState = {
      ...baseState,
      turnUserId: "user-1",
      turnStartedAt: timerStart,
      turnDeadlineAt: timerStart + TURN_MS,
    };
    const rejectQueries = [];
    const rejectStoredState = { value: JSON.stringify(rejectState), version: 1 };
    const rejectHandler = makeHandler(rejectQueries, rejectStoredState, "user-2");
    const rejectResponse = await rejectHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-not-your-turn", action: { type: "CHECK" } }),
    });
    assert.equal(rejectResponse.statusCode, 403);
    assert.equal(JSON.parse(rejectResponse.body).error, "not_your_turn");
    assert.equal(rejectStoredState.value, JSON.stringify(rejectState));
  }

  {
    const foldState = {
      ...baseState,
      seats: [
        { userId: "user-1", seatNo: 1 },
        { userId: "user-2", seatNo: 2 },
      ],
      stacks: { "user-1": 100, "user-2": 100 },
      toCallByUserId: { "user-1": 1, "user-2": 0 },
      betThisRoundByUserId: { "user-1": 0, "user-2": 1 },
      actedThisRoundByUserId: { "user-1": false, "user-2": true },
      foldedByUserId: { "user-1": false, "user-2": false },
      currentBet: 1,
      lastRaiseSize: 1,
      turnUserId: "user-1",
      turnStartedAt: Date.now() - 1500,
      turnDeadlineAt: Date.now() + 5000,
      handId: "hand-fold",
      handSeed: "seed-fold",
    };
    const foldSeatOrder = foldState.seats.map((seat) => seat.userId);
    const foldHoleCards = dealHoleCards(deriveDeck(foldState.handSeed), foldSeatOrder).holeCardsByUserId;
    const foldLogs = [];
    const foldResponse = await runCase({
      state: foldState,
      action: { type: "FOLD" },
      requestId: "req-fold-hand-done",
      userId: "user-1",
      holeCardsByUserId: foldHoleCards,
      activeSeatUserIds: foldSeatOrder,
      klogCalls: foldLogs,
    });
    assert.equal(foldResponse.response.statusCode, 200);
    const foldPayload = JSON.parse(foldResponse.response.body);
    assert.equal(foldPayload.state.state.phase, "SETTLED");
    assert.equal(foldPayload.state.state.turnStartedAt, null);
    assert.equal(foldPayload.state.state.turnDeadlineAt, null);
    assert.ok(foldLogs.some((entry) => entry.kind === "poker_turn_timer_skipped"));
    assert.ok(!foldLogs.some((entry) => entry.kind === "poker_turn_timer_reset"));
  }

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
  assert.ok(Array.isArray(user1Payload.legalActions));
  assert.ok(user1Payload.actionConstraints);
  assert.ok("toCall" in user1Payload.actionConstraints);
  assert.ok("minRaiseTo" in user1Payload.actionConstraints);
  assert.ok("maxRaiseTo" in user1Payload.actionConstraints);
  assert.ok("maxBetAmount" in user1Payload.actionConstraints);
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
  assert.ok(Array.isArray(replayPayload.legalActions));
  assert.ok(replayPayload.actionConstraints);
  assert.ok("toCall" in replayPayload.actionConstraints);
  assert.ok("minRaiseTo" in replayPayload.actionConstraints);
  assert.ok("maxRaiseTo" in replayPayload.actionConstraints);
  assert.ok("maxBetAmount" in replayPayload.actionConstraints);
  const updateCountAfterReplay = queries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state")).length;
  assert.equal(updateCountAfterReplay, updateCountBeforeReplay);
  const holeCardQueries = queries.filter((entry) => entry.query.toLowerCase().includes("from public.poker_hole_cards"));
  assert.ok(holeCardQueries.length >= 1);

  {
    const idemQueries = [];
    const idemStored = { value: JSON.stringify(baseState), version: 4, requests: new Map() };
    const idemHandler = makeHandler(idemQueries, idemStored, "user-1");
    const firstResponse = await idemHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-idem-1", action: { type: "CHECK" } }),
    });
    assert.equal(firstResponse.statusCode, 200);
    const firstPayload = JSON.parse(firstResponse.body);
    assert.equal(firstPayload.replayed, false);
    const tableTouchCountAfterFirst = idemQueries.filter((entry) =>
      entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
    ).length;
    assert.equal(tableTouchCountAfterFirst, 1, "act should bump table activity once when mutation is first applied");
    const updateCountBefore = idemQueries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state")).length;
    idemStored.value = JSON.stringify(baseState);
    idemStored.version = 4;
    const secondResponse = await idemHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-idem-1", action: { type: "CHECK" } }),
    });
    assert.equal(secondResponse.statusCode, 200);
    const secondPayload = JSON.parse(secondResponse.body);
    assert.equal(secondPayload.replayed, true);
    const tableTouchCountAfterReplay = idemQueries.filter((entry) =>
      entry.query.toLowerCase().includes("update public.poker_tables set last_activity_at = now(), updated_at = now() where id = $1")
    ).length;
    assert.equal(tableTouchCountAfterReplay, tableTouchCountAfterFirst, "replayed act should not bump table activity");
    const updateCountAfter = idemQueries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state")).length;
    assert.equal(updateCountAfter, updateCountBefore);
  }

  {
    const failQueries = [];
    const failStored = { value: JSON.stringify(baseState), version: 4, requests: new Map() };
    const failHandler = makeHandler(failQueries, failStored, "user-1", { failRequestWriteOnce: true });
    const firstResponse = await failHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-write-fail", action: { type: "CHECK" } }),
    });
    assert.equal(firstResponse.statusCode, 500);
    const updateCountAfterFirst = failQueries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state")).length;
    const secondResponse = await failHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-write-fail", action: { type: "CHECK" } }),
    });
    assert.equal(secondResponse.statusCode, 202);
    const secondPayload = JSON.parse(secondResponse.body);
    assert.equal(secondPayload.error, "request_pending");
    assert.equal(secondPayload.requestId, "req-write-fail");
    const updateCountAfterSecond = failQueries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state")).length;
    assert.equal(updateCountAfterSecond, updateCountAfterFirst);
  }

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

  {
    const startQueries = [];
    const startState = { value: null, holeCardsStore: new Map() };
    const startHandler = makeStartHandHandler(startQueries, startState, "user-1", ["user-1", "user-2"]);
    const startResponse = await startHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-start-1" }),
    });
    assert.equal(startResponse.statusCode, 200);
    const startedState = JSON.parse(startState.value);
    const holeCardsByUserId = {};
    for (const [key, cards] of startState.holeCardsStore.entries()) {
      const [, handKey, userKey] = key.split("|");
      if (handKey === startedState.handId) {
        holeCardsByUserId[userKey] = cards;
      }
    }
    const storedActState = { value: JSON.stringify(startedState), version: 1 };
    const firstUserId = startedState.turnUserId;
    const secondUserId = firstUserId === "user-1" ? "user-2" : "user-1";
    const actQueries = [];
    const handlerFirst = makeHandler(actQueries, storedActState, firstUserId, {
      holeCardsByUserId,
      activeSeatUserIds: ["user-1", "user-2"],
    });
    const firstCheck = await handlerFirst({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-check-1", action: { type: "CALL" } }),
    });
    assert.equal(firstCheck.statusCode, 200, firstCheck.body);
    const handlerSecond = makeHandler(actQueries, storedActState, secondUserId, {
      holeCardsByUserId,
      activeSeatUserIds: ["user-1", "user-2"],
    });
    const secondCheck = await handlerSecond({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-check-2", action: { type: "CHECK" } }),
    });
    assert.equal(secondCheck.statusCode, 200);
    const secondPayload = JSON.parse(secondCheck.body);
    assert.equal(secondPayload.state.state.phase, "FLOP");
    assert.equal(secondPayload.state.state.community.length, 3);
    assert.equal(typeof secondPayload.state.version, "number");
    assert.ok(secondPayload.state.version > 1);
    assert.ok(Array.isArray(secondPayload.myHoleCards));
    assert.equal(secondPayload.myHoleCards.length, 2);
  }

  {
    const prevDealSecret = process.env.POKER_DEAL_SECRET;
    process.env.POKER_DEAL_SECRET = prevDealSecret || "test-secret";
    const startQueries = [];
    const startState = { value: null, holeCardsStore: new Map() };
    try {
      const startHandler = makeStartHandHandler(startQueries, startState, "user-1", ["user-1", "user-2"]);
      const startResponse = await startHandler({
        httpMethod: "POST",
        headers: { origin: "https://example.test", authorization: "Bearer token" },
        body: JSON.stringify({ tableId, requestId: "req-start-2" }),
      });
      assert.equal(startResponse.statusCode, 200);
      const startedState = JSON.parse(startState.value);
      const holeCardsByUserId = {};
      for (const [key, cards] of startState.holeCardsStore.entries()) {
        const [, handKey, userKey] = key.split("|");
        if (handKey === startedState.handId) {
          holeCardsByUserId[userKey] = cards;
        }
      }
      const storedActState = { value: JSON.stringify(startedState), version: 1 };
      const firstUserId = startedState.turnUserId;
      const secondUserId = firstUserId === "user-1" ? "user-2" : "user-1";
      const actQueries = [];
      const handlerFirst = makeHandler(actQueries, storedActState, firstUserId, {
        holeCardsByUserId,
        activeSeatUserIds: ["user-1", "user-2"],
      });
      const firstCheck = await handlerFirst({
        httpMethod: "POST",
        headers: { origin: "https://example.test", authorization: "Bearer token" },
        body: JSON.stringify({ tableId, requestId: "req-preflop-1", action: { type: "CALL" } }),
      });
      assert.equal(firstCheck.statusCode, 200);
      const handlerSecond = makeHandler(actQueries, storedActState, secondUserId, {
        holeCardsByUserId,
        activeSeatUserIds: ["user-1", "user-2"],
      });
      const secondCheck = await handlerSecond({
        httpMethod: "POST",
        headers: { origin: "https://example.test", authorization: "Bearer token" },
        body: JSON.stringify({ tableId, requestId: "req-preflop-2", action: { type: "CHECK" } }),
      });
      assert.equal(secondCheck.statusCode, 200);
      const secondPayload = JSON.parse(secondCheck.body);
      assert.equal(secondPayload.state.state.phase, "FLOP");
      assert.equal(secondPayload.state.state.community.length, 3);
      const flopVersion = secondPayload.state.version;
      const flopTurnUserId = secondPayload.state.state.turnUserId;
      const flopSecondUserId = flopTurnUserId === firstUserId ? secondUserId : firstUserId;
      const handlerFlopFirst = makeHandler(actQueries, storedActState, flopTurnUserId, {
        holeCardsByUserId,
        activeSeatUserIds: ["user-1", "user-2"],
      });
      const flopCheck = await handlerFlopFirst({
        httpMethod: "POST",
        headers: { origin: "https://example.test", authorization: "Bearer token" },
        body: JSON.stringify({ tableId, requestId: "req-flop-1", action: { type: "CHECK" } }),
      });
      assert.equal(flopCheck.statusCode, 200);
      const handlerFlopSecond = makeHandler(actQueries, storedActState, flopSecondUserId, {
        holeCardsByUserId,
        activeSeatUserIds: ["user-1", "user-2"],
      });
      const flopSecondCheck = await handlerFlopSecond({
        httpMethod: "POST",
        headers: { origin: "https://example.test", authorization: "Bearer token" },
        body: JSON.stringify({ tableId, requestId: "req-flop-2", action: { type: "CHECK" } }),
      });
      assert.equal(flopSecondCheck.statusCode, 200);
      const flopPayload = JSON.parse(flopSecondCheck.body);
      assert.equal(flopPayload.state.state.phase, "TURN");
      assert.equal(flopPayload.state.state.community.length, 4);
      assert.ok(typeof flopPayload.state.version === "number");
      assert.ok(flopPayload.state.version > flopVersion);
      assert.ok(Array.isArray(flopPayload.myHoleCards));
      assert.equal(flopPayload.myHoleCards.length, 2);
      assert.equal(flopPayload.state.state.holeCardsByUserId, undefined);
      assert.equal(flopPayload.state.state.handSeed, undefined);
      assert.equal(flopPayload.state.state.deck, undefined);
      assert.equal(flopPayload.holeCardsByUserId, undefined);
      assert.equal(flopPayload.deck, undefined);
      assert.equal(JSON.stringify(flopPayload).includes("holeCardsByUserId"), false);
      assert.equal(JSON.stringify(flopPayload).includes('"deck"'), false);
      assert.equal(JSON.stringify(flopPayload).includes('"handSeed"'), false);
    } finally {
      if (prevDealSecret === undefined) {
        delete process.env.POKER_DEAL_SECRET;
      } else {
        process.env.POKER_DEAL_SECRET = prevDealSecret;
      }
    }
  }

  const updateCall = queries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(updateCall, "expected poker_state update");
  assert.ok(updateCall.query.toLowerCase().includes("where table_id = $1 and version = $2"));
  const updatedState = JSON.parse(updateCall.params?.[2] || "{}");
  assert.equal(updatedState.holeCardsByUserId, undefined);
  assert.equal(updatedState.deck, undefined);
  assert.equal(updatedState.communityDealt, updatedState.community.length);
  assert.equal(typeof updatedState.handSeed, "string");

  const actionInserts = queries.filter((entry) => entry.query.toLowerCase().includes("insert into public.poker_actions"));
  assert.equal(actionInserts.length, 3);
  actionInserts.forEach((entry) => {
    const params = entry.params || [];
    assert.equal(params.length, 10);
    assert.equal(params[0], tableId);
    assert.equal(typeof params[5], "string");
    assert.ok(params[5]);
    assert.equal(typeof params[6], "string");
    assert.ok(params[6]);
    assert.equal(typeof params[7], "string");
    assert.equal(typeof params[8], "string");
  });

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

  {
    const showdownState = {
      ...baseState,
      phase: "RIVER",
      pot: 25,
      community: deriveCommunityCards({ handSeed: baseState.handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 }),
      communityDealt: 5,
      turnUserId: "user-1",
      actedThisRoundByUserId: { "user-1": false, "user-2": true, "user-3": true },
      foldedByUserId: { "user-1": false, "user-2": false, "user-3": true },
      toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
      betThisRoundByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    };
    const totalBefore = Object.values(showdownState.stacks).reduce((sum, value) => sum + value, 0) + showdownState.pot;
    const showdownResponse = await runCase({
      state: showdownState,
      action: { type: "CHECK" },
      requestId: "req-showdown",
      userId: "user-1",
    });
    assert.equal(showdownResponse.response.statusCode, 200);
    const showdownPayload = JSON.parse(showdownResponse.response.body);
    assert.equal(showdownPayload.state.state.phase, "SETTLED");
    assert.ok(Array.isArray(showdownPayload.state.state.showdown?.winners));
    assert.ok(showdownPayload.state.state.showdown.winners.length > 0);
    assert.equal(showdownPayload.state.state.pot, 0);
    const showdownPayloadText = JSON.stringify(showdownPayload);
    assert.equal(showdownPayloadText.includes("revealedHoleCardsByUserId"), false);
    assert.equal(showdownPayloadText.includes("holeCardsByUserId"), false);
    assert.equal(showdownPayloadText.includes('"deck"'), false);
    assert.equal(showdownPayloadText.includes('"handSeed"'), false);
    const fullCommunity = deriveCommunityCards({ handSeed: baseState.handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 });
    assert.deepEqual(showdownPayload.state.state.community, fullCommunity);
    const expectedShowdown = computeShowdown({
      community: fullCommunity,
      players: [
        { userId: "user-1", holeCards: defaultHoleCards["user-1"] },
        { userId: "user-2", holeCards: defaultHoleCards["user-2"] },
      ],
    });
    const expectedWinners = seatOrder.filter((userId) => expectedShowdown.winners.includes(userId));
    assert.deepEqual(showdownPayload.state.state.showdown.winners, expectedWinners);
    const totalAfter = Object.values(showdownPayload.state.state.stacks).reduce((sum, value) => sum + value, 0);
    assert.equal(totalAfter, totalBefore);
  }

  {
    const showdownState = {
      ...baseState,
      phase: "RIVER",
      pot: 10,
      community: deriveCommunityCards({ handSeed: baseState.handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 }),
      communityDealt: 5,
      turnUserId: "user-1",
      actedThisRoundByUserId: { "user-1": false, "user-2": true, "user-3": true },
      foldedByUserId: { "user-1": false, "user-2": false, "user-3": true },
      toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
      betThisRoundByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    };
    let capturedActiveUserIds = null;
    const holeCardsLoader = async (_tx, { activeUserIds }) => {
      capturedActiveUserIds = activeUserIds.slice();
      return { holeCardsByUserId: defaultHoleCards };
    };
    const showdownResponse = await runCase({
      state: showdownState,
      action: { type: "CHECK" },
      requestId: "req-showdown-hole-cards",
      userId: "user-1",
      loadHoleCardsByUserId: holeCardsLoader,
    });
    assert.equal(showdownResponse.response.statusCode, 200);
    assert.deepEqual(capturedActiveUserIds, ["user-1", "user-2", "user-3"]);
    const payload = JSON.parse(showdownResponse.response.body);
    const winners = payload.state.state.showdown?.winners || [];
    assert.ok(winners.length > 0);
    assert.equal(winners.includes("user-3"), false);
  }

  {
    const showdownState = {
      ...baseState,
      phase: "RIVER",
      pot: 20,
      community: deriveCommunityCards({ handSeed: baseState.handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 }),
      communityDealt: 5,
      turnUserId: "user-1",
      actedThisRoundByUserId: { "user-1": false, "user-2": true, "user-3": true },
      foldedByUserId: { "user-1": false, "user-2": false, "user-3": true },
      toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
      betThisRoundByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
      contributionsByUserId: { "user-1": 10, "user-2": 5, "user-3": 5 },
    };
    const showdownResponse = await runCase({
      state: showdownState,
      action: { type: "CHECK" },
      requestId: "req-showdown-sidepot",
      userId: "user-1",
    });
    assert.equal(showdownResponse.response.statusCode, 200);
    const payload = JSON.parse(showdownResponse.response.body);
    assert.equal(payload.state.state.pot, 0);
    assert.ok(Array.isArray(payload.state.state.showdown?.potsAwarded));
    assert.ok(payload.state.state.showdown.potsAwarded.length > 0);
    assert.equal(payload.state.state.showdown.potAwardedTotal, 15);
  }

  {
    const versionQueries = [];
    const versionState = { ...baseState };
    const versionStored = { value: JSON.stringify(versionState), version: 5 };
    const versionHandler = makeHandler(versionQueries, versionStored, "user-1");
    const versionResponse = await versionHandler({
      httpMethod: "POST",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      body: JSON.stringify({ tableId, requestId: "req-version-1", action: { type: "CHECK" } }),
    });
    assert.equal(versionResponse.statusCode, 200);
    const updateEntry = versionQueries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
    assert.ok(updateEntry);
    assert.ok(updateEntry.query.toLowerCase().includes("where table_id = $1 and version = $2"));
    assert.equal(updateEntry.params?.[1], 5);
  }

  const inactiveSeatResponse = await runCase({
    state: baseState,
    action: { type: "CHECK" },
    requestId: "req-missing-seat",
    userId: "user-1",
    activeSeatUserIds: ["user-1", "user-2"],
  });
  assert.equal(inactiveSeatResponse.response.statusCode, 200);


  const staleSeatState = {
    ...baseState,
    seats: [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
      { userId: "user-3", seatNo: 3 },
      { userId: "user-x", seatNo: 4 },
    ],
  };
  const staleSeatResponse = await runCase({
    state: staleSeatState,
    action: { type: "CHECK" },
    requestId: "req-stale-seat-user",
    userId: "user-1",
    activeSeatUserIds: ["user-1", "user-2", "user-3"],
    holeCardsByUserId: {
      "user-1": defaultHoleCards["user-1"],
      "user-2": defaultHoleCards["user-2"],
      "user-3": defaultHoleCards["user-3"],
    },
  });
  assert.equal(staleSeatResponse.response.statusCode, 200);
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

  const actorInvalidCardsResponse = await runCase({
    state: baseState,
    action: { type: "CHECK" },
    requestId: "req-actor-invalid-cards",
    userId: "user-1",
    holeCardsByUserId: {
      ...defaultHoleCards,
      "user-1": [{ r: "A", s: "S" }],
    },
  });
  assert.equal(actorInvalidCardsResponse.response.statusCode, 409);
  assert.equal(JSON.parse(actorInvalidCardsResponse.response.body).error, "state_invalid");

  {
    const seatUserIdsInOrder = seatOrder.slice();
    const timeoutState = {
      ...baseState,
      phase: "FLOP",
      pot: 20,
      stacks: { ...baseState.stacks, "user-1": 0 },
      community: deriveCommunityCards({ handSeed: baseState.handSeed, seatUserIdsInOrder, communityDealt: 3 }),
      communityDealt: 3,
      turnNo: 2,
      turnUserId: "user-2",
      turnStartedAt: Date.now() - 30000,
      turnDeadlineAt: Date.now() - 1000,
      actedThisRoundByUserId: { "user-1": false, "user-2": false, "user-3": true },
      toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
      betThisRoundByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    };
    const privateState = {
      ...timeoutState,
      deck: deriveRemainingDeck({
        handSeed: baseState.handSeed,
        seatUserIdsInOrder,
        communityDealt: timeoutState.communityDealt,
      }),
      holeCardsByUserId: defaultHoleCards,
    };
    const timeoutResult = maybeApplyTurnTimeout({
      tableId,
      state: timeoutState,
      privateState,
      nowMs: Date.now(),
    });
    assert.equal(timeoutResult.applied, true);
    assert.notEqual(timeoutResult.state.phase, "HAND_DONE");
    assert.equal(timeoutResult.state.pot, 0);
    if (timeoutResult.state.phase === "SHOWDOWN" || timeoutResult.state.phase === "SETTLED") {
      assert.ok(timeoutResult.state.showdown);
    }
  }

  {
    const timeoutState = {
      ...baseState,
      turnNo: 1,
      turnStartedAt: Date.now() - 30000,
      turnDeadlineAt: Date.now() - 1000,
    };
    const queriesTimeout = [];
    const storedTimeout = { value: JSON.stringify(timeoutState), version: 1 };
    const getTableHandler = makeGetTableHandler(queriesTimeout, storedTimeout, "user-2");
    const timeoutResponse = await getTableHandler({
      httpMethod: "GET",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      queryStringParameters: { tableId },
      path: `/poker-get-table/${tableId}`,
    });
    assert.equal(timeoutResponse.statusCode, 200);
    const timeoutBody = JSON.parse(timeoutResponse.body);
    assert.equal(timeoutBody.state.state.turnUserId, "user-2");
    assert.equal(timeoutBody.state.version, 2);
  }

  {
    const timeoutState = {
      ...baseState,
      turnNo: 1,
      turnStartedAt: Date.now() - 30000,
      turnDeadlineAt: Date.now() - 1000,
    };
    const queriesTimeout = [];
    const storedTimeout = { value: JSON.stringify(timeoutState), version: 1 };
    const getTableHandler = makeGetTableHandler(queriesTimeout, storedTimeout, "user-2", {
      updatePokerStateConflict: true,
    });
    const timeoutResponse = await getTableHandler({
      httpMethod: "GET",
      headers: { origin: "https://example.test", authorization: "Bearer token" },
      queryStringParameters: { tableId },
      path: `/poker-get-table/${tableId}`,
    });
    assert.equal(timeoutResponse.statusCode, 200);
    const timeoutBody = JSON.parse(timeoutResponse.body);
    assert.equal(timeoutBody.state.state.turnUserId, "user-1");
    assert.equal(timeoutBody.state.version, 1);
  }

  {
    const timeoutState = {
      ...baseState,
      turnNo: 2,
      turnUserId: "user-1",
      turnStartedAt: 0,
      turnDeadlineAt: 1,
      missedTurnsByUserId: { "user-1": 1 },
    };
    const realNow = Date.now;
    Date.now = () => 999999;
    let timeoutCase;
    try {
      timeoutCase = await runCase({
        state: timeoutState,
        action: { type: "CHECK" },
        requestId: "req-timeout-sitout",
        userId: "user-1",
      });
    } finally {
      Date.now = realNow;
    }
    assert.equal(timeoutCase.response.statusCode, 200);
    const timeoutBody = JSON.parse(timeoutCase.response.body);
    assert.ok(timeoutBody.events.some((event) => event.type === "PLAYER_AUTO_SITOUT_PENDING"));
    const timeoutUpdate = timeoutCase.queries.find(
      (entry) =>
        entry.query.toLowerCase().includes("update public.poker_state") &&
        entry.query.toLowerCase().includes("version = version + 1")
    );
    assert.ok(timeoutUpdate, "timeout should persist poker_state");
    const persistedState = JSON.parse(timeoutUpdate.params?.[2]);
    assert.equal(persistedState.sitOutByUserId?.["user-1"], undefined);
    assert.equal(persistedState.pendingAutoSitOutByUserId?.["user-1"], true);
  }
};

await run();
