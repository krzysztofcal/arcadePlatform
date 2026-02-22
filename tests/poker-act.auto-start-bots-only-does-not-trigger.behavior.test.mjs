import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "22222222-2222-4222-8222-222222222222";
const bot1UserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";

const makeStoredState = () => ({
  version: 7,
  state: {
    tableId,
    phase: "RIVER",
    handId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    handSeed: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    seats: [
      { userId: bot1UserId, seatNo: 1 },
      { userId: bot2UserId, seatNo: 2 },
    ],
    stacks: { [bot1UserId]: 100, [bot2UserId]: 100 },
    pot: 20,
    community: [],
    communityDealt: 0,
    dealerSeatNo: 1,
    turnUserId: bot1UserId,
    toCallByUserId: { [bot1UserId]: 0, [bot2UserId]: 0 },
    betThisRoundByUserId: { [bot1UserId]: 0, [bot2UserId]: 0 },
    actedThisRoundByUserId: { [bot1UserId]: false, [bot2UserId]: false },
    foldedByUserId: { [bot1UserId]: false, [bot2UserId]: false },
    leftTableByUserId: {},
    sitOutByUserId: {},
    lastActionRequestIdByUserId: {},
    currentBet: 0,
    lastRaiseSize: 0,
  },
  requests: new Map(),
});

const run = async () => {
  const actionInserts = [];
  const stored = makeStoredState();
  let autoStartCalled = false;

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: bot1UserId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
    TURN_MS,
    advanceIfNeeded,
    computeLegalActions,
    buildActionConstraints,
    isStateStorageValid,
    normalizeJsonState,
    withoutPrivateState,
    resetTurnTimer,
    updatePokerStateOptimistic,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: async ({ state }) => ({ applied: false, state, action: null, events: [] }),
    applyAction: (state) => ({
      state: {
        ...state,
        phase: "HAND_DONE",
        turnUserId: null,
        pot: 0,
      },
      events: [{ type: "HAND_SETTLED" }],
    }),
    startHandCore: async ({ currentState, expectedVersion }) => {
      autoStartCalled = true;
      return {
        updatedState: { ...currentState, phase: "PREFLOP" },
        privateState: { ...currentState, phase: "PREFLOP" },
        dealtHoleCards: {},
        newVersion: expectedVersion + 1,
      };
    },
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {} }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: bot1UserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [
              { user_id: bot1UserId, seat_no: 1, is_bot: true },
              { user_id: bot2UserId, seat_no: 2, is_bot: true },
            ];
          }
          if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stored.state = JSON.parse(params?.[2] || "{}");
            stored.version += 1;
            return [{ version: stored.version }];
          }
          if (text.includes("insert into public.poker_actions")) {
            actionInserts.push(params);
            return [{ ok: true }];
          }
          return [];
        },
      }),
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "act-bots-only", action: { type: "CHECK" } }),
  });

  if (response.statusCode !== 200) {
    throw new Error(`unexpected status ${response.statusCode}: ${response.body || ""}`);
  }
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.equal(autoStartCalled, false);
  const autoStartWrites = actionInserts.filter((row) => row?.[3] === "START_HAND" && String(row?.[6] || "").startsWith("auto-start:"));
  assert.equal(autoStartWrites.length, 0);
};

run().then(() => console.log("poker-act auto-start bots-only does-not-trigger behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
