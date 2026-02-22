import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1UserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOT_MAX_ACTIONS_PER_REQUEST = "1";

const stored = {
  version: 10,
  state: {
    tableId,
    phase: "RIVER",
    handId: "f4e19544-dddd-4ddd-8ddd-dddddddddddd",
    handSeed: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    seats: [
      { userId: humanUserId, seatNo: 1 },
      { userId: bot1UserId, seatNo: 2 },
      { userId: bot2UserId, seatNo: 3 },
    ],
    stacks: { [humanUserId]: 100, [bot1UserId]: 100, [bot2UserId]: 100 },
    pot: 20,
    community: [],
    communityDealt: 0,
    dealerSeatNo: 1,
    turnUserId: humanUserId,
    toCallByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
    betThisRoundByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
    actedThisRoundByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
    foldedByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
    lastActionRequestIdByUserId: {},
    currentBet: 0,
    lastRaiseSize: 0,
  },
  requests: new Map(),
};

const run = async () => {
  let stateWriteCount = 0;

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
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
    maybeApplyTurnTimeout: async (state) => ({ state, timedOut: false }),
    applyAction: (state, action) => {
      if (action?.userId === humanUserId && state.phase === "RIVER") return { state: { ...state, phase: "HAND_DONE", turnUserId: null, pot: 0 }, events: [{ type: "HAND_SETTLED" }] };
      if (action?.userId === bot1UserId) return { state: { ...state, phase: "PREFLOP", turnUserId: humanUserId }, events: [{ type: "BOT_ACTED" }] };
      return { state: { ...state, phase: "PREFLOP", turnUserId: bot1UserId }, events: [{ type: "HUMAN_ACTED" }] };
    },
    chooseBotActionTrivial: () => ({ type: "CHECK" }),
    startHandCore: async ({ tx, tableId: startTableId, currentState, expectedVersion }) => {
      const nextState = {

        ...currentState,
        phase: "PREFLOP",
        handId: "c1b7e1cf-ffff-4fff-8fff-ffffffffffff",
        handSeed: "99999999-9999-4999-8999-999999999999",
        turnUserId: bot1UserId,
        showdown: { handId: "f4e19544-dddd-4ddd-8ddd-dddddddddddd", winners: [] },
      };
      const privateState = {
        ...currentState,
        phase: "PREFLOP",
        handId: "c1b7e1cf-ffff-4fff-8fff-ffffffffffff",
        handSeed: "99999999-9999-4999-8999-999999999999",
        turnUserId: bot1UserId,
        showdown: { handId: "f4e19544-dddd-4ddd-8ddd-dddddddddddd", winners: [] },
      };
      const autoWrite = await updatePokerStateOptimistic(tx, {
        tableId: startTableId,
        expectedVersion,
        nextState,
      });
      assert.equal(autoWrite.ok, true);
      return {
        updatedState: nextState,
        privateState,
        dealtHoleCards: { [humanUserId]: [], [bot1UserId]: [], [bot2UserId]: [] },
        newVersion: autoWrite.newVersion,
      };
    },
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: { [humanUserId]: [], [bot1UserId]: [], [bot2UserId]: [] } }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: humanUserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) return [
            { user_id: humanUserId, seat_no: 1, is_bot: false },
            { user_id: bot1UserId, seat_no: 2, is_bot: true },
            { user_id: bot2UserId, seat_no: 3, is_bot: true },
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
            stateWriteCount += 1;
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

  const first = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "user-act-after-bot-1", action: { type: "CHECK" } }),
  });
  assert.equal(first.statusCode, 200);
  const firstPayload = JSON.parse(first.body || "{}");
  assert.equal(firstPayload.ok, true);

  const writesAfterFirst = stateWriteCount;
  const second = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "user-act-after-bot-2", action: { type: "CHECK" } }),
  });

  assert.equal(second.statusCode, 200);
  const secondPayload = JSON.parse(second.body || "{}");
  assert.equal(secondPayload.ok, true);
  assert.equal(Boolean(secondPayload.rejected), false);
  assert.equal(String(second.body || "").includes("showdown_hand_mismatch"), false);
  assert.equal(stateWriteCount > writesAfterFirst, true);
};

run().then(() => console.log("poker-act auto-next-hand user can act after bot autoplay behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
