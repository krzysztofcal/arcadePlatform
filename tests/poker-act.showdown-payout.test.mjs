import assert from "node:assert/strict";
import { deriveCommunityCards, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";
import { advanceIfNeeded, applyAction, TURN_MS } from "../netlify/functions/_shared/poker-reducer.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";
import {
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
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
    maybeApplyTurnTimeout,
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
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN" }];
          }
          if (text.includes("from public.poker_seats")) {
            const hasActive = text.includes("status = 'active'");
            const hasUserFilter = text.includes("user_id = $2");
            const okParams = Array.isArray(params) && params.length >= 2 && params[0] === tableId && params[1] === userId;
            if (hasActive && hasUserFilter && okParams) return [{ user_id: userId }];
            if (hasActive) return seatOrder.map((id, index) => ({ user_id: id, seat_no: index + 1 }));
            return [];
          }
          if (text.includes("from public.poker_state")) {
            return [{ version: storedState.version, state: JSON.parse(storedState.value) }];
          }
          if (text.includes("from public.poker_hole_cards")) {
            const rows = [];
            const map = options.holeCardsByUserId || baseHoleCards;
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

const runCase = async ({ state, action, requestId, userId, computeShowdown, storedState }) => {
  const queries = [];
  const stored = storedState || { version: 3, value: JSON.stringify(state) };
  const handler = makeHandler(queries, stored, userId, { computeShowdown });
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId, action }),
  });
  return { response, queries, storedState: stored };
};

{
  const totalBefore = Object.values(baseState.stacks).reduce((sum, value) => sum + value, 0) + baseState.pot;
  const result = await runCase({
    state: baseState,
    action: { type: "FOLD" },
    requestId: "req-fold-win",
    userId: "user-2",
  });
  assert.equal(result.response.statusCode, 200);
  const payload = JSON.parse(result.response.body);
  assert.deepEqual(payload.state.state.showdown.winners, ["user-1"]);
  assert.equal(payload.state.state.showdown.reason, "all_folded");
  assert.equal(payload.state.state.pot, 0);
  assert.equal(payload.state.state.stacks["user-1"], baseState.stacks["user-1"] + baseState.pot);
  const totalAfter = Object.values(payload.state.state.stacks).reduce((sum, value) => sum + value, 0);
  assert.equal(totalAfter, totalBefore);
  const updateCall = result.queries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(updateCall);
  const updatedState = JSON.parse(updateCall.params?.[1] || "{}");
  assert.equal(updatedState.pot, 0);
  assert.ok(updatedState.showdown);
}

{
  const riverState = {
    ...baseState,
    phase: "RIVER",
    pot: 20,
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 5 }),
    communityDealt: 5,
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
  assert.equal(payload.state.state.phase, "SHOWDOWN");
  assert.deepEqual(payload.state.state.showdown.winners, ["user-2"]);
  assert.equal(payload.state.state.pot, 0);
  assert.equal(payload.state.state.stacks["user-2"], riverState.stacks["user-2"] + riverState.pot);
  const totalAfter = Object.values(payload.state.state.stacks).reduce((sum, value) => sum + value, 0);
  assert.equal(totalAfter, totalBefore);
  const updateCall = result.queries.find((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.ok(updateCall);
  const updatedState = JSON.parse(updateCall.params?.[1] || "{}");
  assert.equal(updatedState.pot, 0);
  assert.ok(updatedState.showdown);
}

{
  const storedState = { version: 7, value: JSON.stringify(baseState) };
  const first = await runCase({
    state: baseState,
    action: { type: "FOLD" },
    requestId: "req-fold-win",
    userId: "user-2",
    storedState,
  });
  assert.equal(first.response.statusCode, 200);
  const firstPayload = JSON.parse(first.response.body);
  const storedAfterFirst = storedState.value;
  const second = await runCase({
    state: JSON.parse(storedState.value),
    action: { type: "FOLD" },
    requestId: "req-fold-win",
    userId: "user-2",
    storedState,
  });
  assert.equal(second.response.statusCode, 200);
  const secondPayload = JSON.parse(second.response.body);
  assert.equal(secondPayload.replayed, true);
  assert.equal(secondPayload.state.state.pot, 0);
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
  const storedState = { version: 9, value: JSON.stringify(riverState) };
  const computeShowdown = () => ({ winners: ["user-2"] });
  const first = await runCase({
    state: riverState,
    action: { type: "CHECK" },
    requestId: "req-river-showdown",
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
    requestId: "req-river-showdown",
    userId: "user-1",
    computeShowdown,
    storedState,
  });
  assert.equal(second.response.statusCode, 200);
  const secondPayload = JSON.parse(second.response.body);
  assert.equal(secondPayload.replayed, true);
  assert.deepEqual(secondPayload.state.state.stacks, firstPayload.state.state.stacks);
  assert.equal(secondPayload.state.state.pot, 0);
  const updateCalls = second.queries.filter((entry) => entry.query.toLowerCase().includes("update public.poker_state"));
  assert.equal(updateCalls.length, 0);
}

{
  const incompleteState = {
    ...baseState,
    phase: "TURN",
    pot: 10,
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatOrder, communityDealt: 4 }),
    communityDealt: 4,
    turnUserId: "user-1",
    foldedByUserId: { "user-1": false, "user-2": true },
    actedThisRoundByUserId: { "user-1": false, "user-2": true },
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
    turnUserId: "user-2",
  };
  const result = await runCase({
    state: mismatchState,
    action: { type: "CHECK" },
    requestId: "req-showdown-mismatch",
    userId: "user-2",
  });
  assert.equal(result.response.statusCode, 409);
  assert.equal(JSON.parse(result.response.body).error, "state_invalid");
}

{
  const potState = {
    ...baseState,
    showdown: { handId: baseState.handId, winners: ["user-1"], reason: "computed" },
    pot: 5,
    turnUserId: "user-2",
  };
  const result = await runCase({
    state: potState,
    action: { type: "CHECK" },
    requestId: "req-showdown-pot",
    userId: "user-2",
  });
  assert.equal(result.response.statusCode, 409);
  assert.equal(JSON.parse(result.response.body).error, "state_invalid");
}
