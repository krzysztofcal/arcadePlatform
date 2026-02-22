import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1UserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "5";

const run = async () => {
  const logs = [];
  const stored = {
    version: 9,
    requests: new Map(),
    state: {
      tableId,
      phase: "PREFLOP",
      seats: [
        { userId: humanUserId, seatNo: 1 },
        { userId: bot1UserId, seatNo: 2 },
        { userId: bot2UserId, seatNo: 3 },
      ],
      stacks: { [humanUserId]: 100, [bot1UserId]: 100, [bot2UserId]: 100 },
      pot: 2,
      community: [],
      dealerSeatNo: 1,
      turnUserId: humanUserId,
      handId: "hand-fold-1",
      handSeed: "seed-fold-1",
      communityDealt: 0,
      toCallByUserId: { [humanUserId]: 1, [bot1UserId]: 0, [bot2UserId]: 0 },
      betThisRoundByUserId: { [humanUserId]: 0, [bot1UserId]: 1, [bot2UserId]: 1 },
      actedThisRoundByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
      foldedByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
      currentBet: 1,
      lastRaiseSize: 1,
      lastActionRequestIdByUserId: {},
    },
  };

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
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
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    loadHoleCardsByUserId: async () => ({
      holeCardsByUserId: {
        [humanUserId]: [{ r: "A", s: "S" }, { r: "K", s: "S" }],
        [bot1UserId]: [{ r: "Q", s: "S" }, { r: "J", s: "S" }],
        [bot2UserId]: [{ r: "T", s: "S" }, { r: "9", s: "S" }],
      },
      holeCardsStatusByUserId: {},
    }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: humanUserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) return [{ user_id: humanUserId, seat_no: 1, is_bot: false }, { user_id: bot1UserId, seat_no: 2, is_bot: true }, { user_id: bot2UserId, seat_no: 3, is_bot: true }];
          if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) { stored.version += 1; stored.state = JSON.parse(params?.[2] || "{}"); return [{ version: stored.version }]; }
          if (text.includes("insert into public.poker_actions")) return [{ ok: true }];
          if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now()")) return [];
          return [];
        },
      }),
    klog: (event, payload) => logs.push({ event, payload }),
  });

  const response = await handler({ httpMethod: "POST", headers: { origin: "https://example.test", authorization: "Bearer token" }, body: JSON.stringify({ tableId, requestId: "fold-autoplay", action: { type: "FOLD" } }) });
  assert.equal(response.statusCode, 200);
  const stopLog = logs.find((entry) => entry.event === "poker_act_bot_autoplay_stop");
  assert.equal(stopLog?.payload?.botsOnlyInHand, true);
  assert.ok(Number(stopLog?.payload?.effectiveMaxActionsPerRequest) > 5);
};

run().then(() => console.log("poker-act bots-only autoplay completion behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
