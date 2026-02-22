import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { dealHoleCards } from "../netlify/functions/_shared/poker-engine.mjs";
import { deriveCommunityCards } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const handId = "c1b7e1cf-ffff-4fff-8fff-ffffffffffff";
const oldHandId = "f4e19544-dddd-4ddd-8ddd-dddddddddddd";
const seatUserIds = ["user-1", "user-2", "user-3"];

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";

const handSeed = "seed-1";
const dealt = dealHoleCards(deriveDeck(handSeed), seatUserIds);

const stored = {
  version: 8,
  state: {
    tableId,
    phase: "RIVER",
    handId,
    handSeed,
    showdown: { handId: oldHandId, winners: [] },
    seats: [
      { userId: "user-1", seatNo: 1 },
      { userId: "user-2", seatNo: 2 },
      { userId: "user-3", seatNo: 3 },
    ],
    stacks: { "user-1": 100, "user-2": 0, "user-3": 0 },
    pot: 10,
    community: deriveCommunityCards({ handSeed, seatUserIdsInOrder: seatUserIds, communityDealt: 5 }),
    communityDealt: 5,
    dealerSeatNo: 1,
    turnUserId: "user-1",
    toCallByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    betThisRoundByUserId: { "user-1": 0, "user-2": 0, "user-3": 0 },
    actedThisRoundByUserId: { "user-1": false, "user-2": true, "user-3": true },
    foldedByUserId: { "user-1": false, "user-2": true, "user-3": true },
    lastActionRequestIdByUserId: {},
    currentBet: 0,
    lastRaiseSize: 0,
  },
  requests: new Map(),
};

const run = async () => {
  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: "user-1" }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
    awardPotsAtShowdown,
    materializeShowdownAndPayout,
    computeShowdown,
    TURN_MS,
    advanceIfNeeded,
    applyAction,
    computeLegalActions,
    buildActionConstraints,
    isStateStorageValid,
    normalizeJsonState,
    withoutPrivateState,
    resetTurnTimer,
    updatePokerStateOptimistic,
    deriveCommunityCards,
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: async (state) => ({ state, timedOut: false }),
    chooseBotActionTrivial: () => ({ type: "CHECK" }),
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: dealt.holeCardsByUserId }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: "user-1" }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) return [
            { user_id: "user-1", seat_no: 1, is_bot: false },
            { user_id: "user-2", seat_no: 2, is_bot: false },
            { user_id: "user-3", seat_no: 3, is_bot: false },
          ];
          if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const row = stored.requests.get(key);
            return row ? [{ result_json: row.resultJson, created_at: row.createdAt }] : [];
          }
          if (text.includes("insert into public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            if (stored.requests.has(key)) return [];
            stored.requests.set(key, { resultJson: null, createdAt: new Date().toISOString() });
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_requests")) {
            const key = `${params?.[0]}|${params?.[1]}|${params?.[2]}|${params?.[3]}`;
            const row = stored.requests.get(key) || { createdAt: new Date().toISOString() };
            row.resultJson = params?.[4] ?? null;
            stored.requests.set(key, row);
            return [{ request_id: params?.[2] }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stored.state = JSON.parse(params?.[2] || "{}");
            stored.version += 1;
            return [{ version: stored.version }];
          }
          if (text.includes("insert into public.poker_actions")) return [{ ok: true }];
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "mismatch-materialize-1", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(Boolean(payload.rejected), false);
  assert.equal(String(response.body || "").includes("showdown_hand_mismatch"), false);
  assert.ok(payload.state?.state?.showdown);
  assert.equal(payload.state.state.showdown.handId, payload.state.state.handId);
  assert.ok(Array.isArray(payload.state.state.showdown.winners));
  assert.ok(payload.state.state.showdown.winners.length > 0);
};

run().then(() => console.log("poker-act mismatched showdown does not block materialization behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
