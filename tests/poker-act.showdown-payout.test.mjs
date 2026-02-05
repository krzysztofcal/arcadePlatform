import assert from "node:assert/strict";
import { deriveCommunityCards, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";
import { advanceIfNeeded, applyAction, TURN_MS } from "../netlify/functions/_shared/poker-reducer.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";
import { parseStakes } from "../netlify/functions/_shared/poker-stakes.mjs";
import { isPlainObject, isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-secret";

const tableId = "22222222-2222-4222-8222-222222222222";
const seatOrder = ["user-1", "user-2"];
const handSeed = "seed-2";

const baseState = {
  tableId,
  phase: "RIVER",
  seats: [
    { userId: "user-1", seatNo: 1 },
    { userId: "user-2", seatNo: 2 },
  ],
  stacks: { "user-1": 80, "user-2": 70 },
  pot: 30,
  community: deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 }),
  communityDealt: 5,
  dealerSeatNo: 1,
  turnUserId: "user-2",
  handId: "hand-2",
  handSeed,
  toCallByUserId: { "user-1": 0, "user-2": 0 },
  betThisRoundByUserId: { "user-1": 0, "user-2": 0 },
  actedThisRoundByUserId: { "user-1": true, "user-2": false },
  foldedByUserId: { "user-1": false, "user-2": false },
  lastAggressorUserId: null,
  lastActionRequestIdByUserId: {},
};

const baseHoleCards = {
  "user-1": [
    { r: "A", s: "S" },
    { r: "K", s: "H" },
  ],
  "user-2": [
    { r: "Q", s: "D" },
    { r: "J", s: "C" },
  ],
};

const makeHandler = (queries, storedState, userId, options = {}) =>
  loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    awardPotsAtShowdown,
    materializeShowdownAndPayout,
    computeShowdown: options.computeShowdown || (() => ({ winners: ["user-1"] })),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId,
    isPlainObject,
    isStateStorageValid,
    TURN_MS,
    normalizeJsonState,
    withoutPrivateState,
    computeLegalActions,
    buildActionConstraints,
    maybeApplyTurnTimeout,
    resetTurnTimer,
    updatePokerStateOptimistic,
    parseStakes,
    advanceIfNeeded,
    applyAction,
    deriveCommunityCards,
    deriveRemainingDeck,
    isHoleCardsTableMissing,
    loadHoleCardsByUserId: options.loadHoleCardsByUserId || loadHoleCardsByUserId,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          queries.push({ query: String(query), params });
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0] || ""}|${params?.[1] || ""}|${params?.[2] || ""}|${params?.[3] || ""}`;
            const store = storedState.requestStore || (storedState.requestStore = {});
            const row = store[key];
            if (!row) return [];
            return [{ result_json: row.result_json || null, created_at: row.created_at }];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0] || ""}|${params?.[1] || ""}|${params?.[2] || ""}|${params?.[3] || ""}`;
            const store = storedState.requestStore || (storedState.requestStore = {});
            if (store[key]) return [];
            store[key] = { created_at: new Date().toISOString(), result_json: null };
            return [{ request_id: params?.[2] || null }];
          }
          if (text.includes("update public.poker_requests set result_json")) {
            const key = `${params?.[0] || ""}|${params?.[1] || ""}|${params?.[2] || ""}|${params?.[3] || ""}`;
            const store = storedState.requestStore || (storedState.requestStore = {});
            const row = store[key] || { created_at: new Date().toISOString(), result_json: null };
            row.result_json = params?.[4] || null;
            store[key] = row;
            return [{ ok: true }];
          }
          if (text.includes("delete from public.poker_requests")) {
            const key = `${params?.[0] || ""}|${params?.[1] || ""}|${params?.[2] || ""}|${params?.[3] || ""}`;
            const store = storedState.requestStore || (storedState.requestStore = {});
            delete store[key];
            return [{ ok: true }];
          }
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: { sb: 1, bb: 2 } }];
          if (text.includes("from public.poker_seats")) {
            const hasActive = text.includes("status = 'active'");
            const hasUserFilter = text.includes("user_id = $2");
            const okParams = Array.isArray(params) && params.length >= 2 && params[0] === tableId && params[1] === userId;
            if (hasActive && hasUserFilter && okParams) return [{ user_id: userId }];
            if (hasActive) return seatOrder.map((id, index) => ({ user_id: id, seat_no: index + 1 }));
            return [];
          }
          if (text.includes("from public.poker_state")) return [{ version: storedState.version, state: JSON.parse(storedState.value) }];
          if (text.includes("from public.poker_hole_cards")) {
            const rows = [];
            const map = options.holeCardsByUserId || baseHoleCards;
            for (const [userIdValue, cards] of Object.entries(map)) rows.push({ user_id: userIdValue, cards });
            return rows;
          }
          if (text.includes("update public.poker_state")) {
            let stateJson = null;
            if (Array.isArray(params)) {
              for (const value of params) {
                if (typeof value !== "string") continue;
                try {
                  const parsed = JSON.parse(value);
                  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.phase === "string") {
                    stateJson = value;
                    break;
                  }
                } catch {
                  // ignore non-json params
                }
              }
            }
            storedState.lastWrittenStateJson = stateJson;
            storedState.value = stateJson || storedState.value;
            storedState.version += 1;
            return [{ version: storedState.version }];
          }
          if (text.includes("insert into public.poker_actions")) return [{ ok: true }];
          return [];
        },
      }),
    klog: options.klog || (() => {}),
  });

const runCase = async ({ state, action, requestId, userId, computeShowdown, storedState }) => {
  const queries = [];
  const stored = storedState || { version: 3, value: JSON.stringify(state), lastWrittenStateJson: null, requestStore: {} };
  const handler = makeHandler(queries, stored, userId, { computeShowdown });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId, action }),
  });
  return { response, queries, storedState: stored };
};

{
  const foldState = {
    ...baseState,
    toCallByUserId: { "user-1": 0, "user-2": 1 },
    betThisRoundByUserId: { "user-1": 1, "user-2": 0 },
    actedThisRoundByUserId: { "user-1": true, "user-2": false },
    currentBet: 1,
    lastRaiseSize: 1,
  };
  const totalBefore = Object.values(foldState.stacks).reduce((sum, value) => sum + value, 0) + foldState.pot;
  const result = await runCase({ state: foldState, action: { type: "FOLD" }, requestId: "req-fold-win", userId: "user-2" });
  assert.equal(result.response.statusCode, 200);
  const payload = JSON.parse(result.response.body);
  assert.equal(payload.state.state.phase, "SETTLED");
  assert.equal(payload.state.state.pot, 0);
  assert.equal(payload.state.state.handSettlement.handId, foldState.handId);
  assert.equal(payload.state.state.handSettlement.payouts["user-1"], foldState.pot);
  assert.equal(payload.state.state.turnUserId, null);
  assert.equal(payload.state.state.turnStartedAt, null);
  assert.equal(payload.state.state.turnDeadlineAt, null);
  const totalAfter = Object.values(payload.state.state.stacks).reduce((sum, value) => sum + value, 0);
  assert.equal(totalAfter, totalBefore);
  const updateCall = result.queries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(updateCall);
  const updatedState = JSON.parse(result.storedState.lastWrittenStateJson || "{}");
  assert.equal(updatedState.phase, "SETTLED");
  assert.equal(updatedState.pot, 0);
}

{
  const riverState = {
    ...baseState,
    pot: 20,
    turnUserId: "user-1",
    actedThisRoundByUserId: { "user-1": false, "user-2": true },
    foldedByUserId: { "user-1": false, "user-2": false },
  };
  const totalBefore = Object.values(riverState.stacks).reduce((sum, value) => sum + value, 0) + riverState.pot;
  const computeShowdown = () => ({ winners: ["user-2"] });
  const result = await runCase({
    state: riverState,
    action: { type: "CHECK" },
    requestId: "req-river-showdown",
    userId: "user-1",
    computeShowdown,
  });
  assert.equal(result.response.statusCode, 200);
  const payload = JSON.parse(result.response.body);
  assert.equal(payload.state.state.phase, "SETTLED");
  assert.deepEqual(payload.state.state.showdown.winners, ["user-2"]);
  assert.equal(payload.state.state.handSettlement.handId, riverState.handId);
  assert.equal(payload.state.state.handSettlement.payouts["user-2"], riverState.pot);
  assert.equal(payload.state.state.handSettlement.payouts["user-1"] || 0, 0);
  assert.equal(payload.state.state.turnUserId, null);
  assert.equal(payload.state.state.turnStartedAt, null);
  assert.equal(payload.state.state.turnDeadlineAt, null);
  const totalAfter = Object.values(payload.state.state.stacks).reduce((sum, value) => sum + value, 0);
  assert.equal(totalAfter, totalBefore);
}

{
  const foldState = {
    ...baseState,
    toCallByUserId: { "user-1": 0, "user-2": 1 },
    betThisRoundByUserId: { "user-1": 1, "user-2": 0 },
    actedThisRoundByUserId: { "user-1": true, "user-2": false },
    currentBet: 1,
    lastRaiseSize: 1,
  };
  const storedState = { version: 7, value: JSON.stringify(foldState), lastWrittenStateJson: null, requestStore: {} };
  const first = await runCase({
    state: foldState,
    action: { type: "FOLD" },
    requestId: "req-fold-replay",
    userId: "user-2",
    storedState,
  });
  assert.equal(first.response.statusCode, 200);
  const storedAfterFirst = storedState.value;
  const second = await runCase({
    state: JSON.parse(storedState.value),
    action: { type: "FOLD" },
    requestId: "req-fold-replay",
    userId: "user-2",
    storedState,
  });
  assert.equal(second.response.statusCode, 200);
  const secondPayload = JSON.parse(second.response.body);
  assert.equal(secondPayload.replayed, true);
  assert.equal(storedState.value, storedAfterFirst);
  const updateCalls = second.queries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.equal(updateCalls.length, 0);
}

{
  const riverState = {
    ...baseState,
    pot: 20,
    turnUserId: "user-1",
    actedThisRoundByUserId: { "user-1": false, "user-2": true },
    foldedByUserId: { "user-1": false, "user-2": false },
  };
  const computeShowdown = () => ({ winners: ["user-2"] });
  const storedState = { version: 9, value: JSON.stringify(riverState), lastWrittenStateJson: null, requestStore: {} };
  const first = await runCase({
    state: riverState,
    action: { type: "CHECK" },
    requestId: "req-river-replay",
    userId: "user-1",
    computeShowdown,
    storedState,
  });
  assert.equal(first.response.statusCode, 200);
  const firstPayload = JSON.parse(first.response.body);
  const storedAfterFirst = storedState.value;
  const second = await runCase({
    state: JSON.parse(storedState.value),
    action: { type: "CHECK" },
    requestId: "req-river-replay",
    userId: "user-1",
    computeShowdown,
    storedState,
  });
  assert.equal(second.response.statusCode, 200);
  const secondPayload = JSON.parse(second.response.body);
  assert.equal(secondPayload.replayed, true);
  assert.deepEqual(secondPayload.state.state.stacks, firstPayload.state.state.stacks);
  assert.equal(storedState.value, storedAfterFirst);
  const updateCalls = second.queries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.equal(updateCalls.length, 0);
}

{
  const incompleteState = {
    ...baseState,
    phase: "SHOWDOWN",
    pot: 10,
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 4 }),
    communityDealt: 4,
    turnUserId: "user-1",
    foldedByUserId: { "user-1": false, "user-2": false },
    actedThisRoundByUserId: { "user-1": true, "user-2": true },
  };
  const result = await runCase({
    state: incompleteState,
    action: { type: "CHECK" },
    requestId: "req-incomplete-community",
    userId: "user-1",
  });
  assert.equal(result.response.statusCode, 409);
  assert.equal(JSON.parse(result.response.body).error, "state_invalid");
}

{
  const mismatchState = {
    ...baseState,
    showdown: { handId: "other-hand", winners: ["user-1"], reason: "computed" },
    pot: 0,
    turnUserId: null,
  };
  const result = await runCase({
    state: mismatchState,
    action: { type: "CHECK" },
    requestId: "req-showdown-mismatch",
    userId: "user-1",
  });
  assert.equal(result.response.statusCode, 409);
  assert.equal(JSON.parse(result.response.body).error, "state_invalid");
}

{
  const settledExisting = {
    ...baseState,
    phase: "SETTLED",
    pot: 0,
    turnUserId: null,
    showdown: {
      handId: baseState.handId,
      winners: ["user-1"],
      potsAwarded: [{ amount: 30, winners: ["user-1"], eligibleUserIds: ["user-1", "user-2"] }],
      reason: "computed",
    },
    handSettlement: {
      handId: baseState.handId,
      settledAt: "2026-01-01T00:00:00.000Z",
      payouts: { "user-1": 30 },
    },
  };
  const first = materializeShowdownAndPayout({
    state: settledExisting,
    seatUserIdsInOrder: seatOrder,
    holeCardsByUserId: baseHoleCards,
    computeShowdown: () => ({ winners: ["user-1"] }),
    awardPotsAtShowdown,
  }).nextState;
  const second = materializeShowdownAndPayout({
    state: first,
    seatUserIdsInOrder: seatOrder,
    holeCardsByUserId: baseHoleCards,
    computeShowdown: () => ({ winners: ["user-1"] }),
    awardPotsAtShowdown,
  }).nextState;
  assert.deepEqual(second, first);
}
