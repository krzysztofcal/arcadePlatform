import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bot1UserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bot2UserId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "5";
process.env.POKER_BOTS_BOTS_ONLY_HAND_HARD_CAP = "40";

const makeState = () => ({
  tableId,
  phase: "TURN",
  seats: [
    { userId: humanUserId, seatNo: 1 },
    { userId: bot1UserId, seatNo: 2 },
    { userId: bot2UserId, seatNo: 3 },
  ],
  stacks: { [humanUserId]: 100, [bot1UserId]: 100, [bot2UserId]: 100 },
  pot: 20,
  community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }, { r: "J", s: "S" }],
  dealerSeatNo: 1,
  turnUserId: humanUserId,
  handId: "hand-bots-only-complete",
  handSeed: "seed-bots-only-complete",
  communityDealt: 4,
  toCallByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
  betThisRoundByUserId: { [humanUserId]: 0, [bot1UserId]: 0, [bot2UserId]: 0 },
  actedThisRoundByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
  foldedByUserId: { [humanUserId]: false, [bot1UserId]: false, [bot2UserId]: false },
  leftTableByUserId: {},
  sitOutByUserId: {},
  pendingAutoSitOutByUserId: {},
  currentBet: 0,
  lastRaiseSize: 2,
  lastActionRequestIdByUserId: {},
  botProgressCount: 0,
});

const run = async () => {
  const logs = [];
  const actionInserts = [];
  const stored = { version: 7, state: makeState(), requests: new Map() };

  const applyActionStub = (state, action) => {
    const next = {
      ...state,
      foldedByUserId: { ...(state.foldedByUserId || {}) },
      actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}) },
      leftTableByUserId: { ...(state.leftTableByUserId || {}) },
    };

    if (action.userId === humanUserId && action.type === "FOLD") {
      next.foldedByUserId[humanUserId] = true;
      next.actedThisRoundByUserId[humanUserId] = true;
      next.leftTableByUserId[humanUserId] = true;
      next.turnUserId = bot1UserId;
      return { state: next, events: [{ type: "ACTION_APPLIED" }] };
    }

    const progress = Number(state.botProgressCount || 0) + 1;
    next.botProgressCount = progress;
    next.actedThisRoundByUserId[action.userId] = true;
    if (progress >= 6) {
      next.phase = "HAND_DONE";
      next.turnUserId = null;
    } else {
      next.turnUserId = action.userId === bot1UserId ? bot2UserId : bot1UserId;
    }
    return { state: next, events: [{ type: "ACTION_APPLIED" }] };
  };

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: () => true,
    normalizeRequestId: (value) => ({ ok: true, value: String(value || "") }),
    advanceIfNeeded: (state) => ({ state, events: [] }),
    applyAction: applyActionStub,
    computeLegalActions: ({ userId }) => {
      if (userId === humanUserId) return { actions: ["FOLD"] };
      return { actions: [{ type: "CHECK" }] };
    },
    buildActionConstraints: () => ({}),
    isStateStorageValid: () => true,
    normalizeJsonState: (state) => state,
    withoutPrivateState: (state) => state,
    resetTurnTimer: (state) => state,
    clearMissedTurns: (state) => ({ changed: false, nextState: state }),
    updatePokerStateOptimistic: async (_tx, _args) => ({ ok: true, newVersion: ++stored.version }),
    deriveCommunityCards: ({ communityDealt }) => [
      { r: "A", s: "S" },
      { r: "K", s: "S" },
      { r: "Q", s: "S" },
      { r: "J", s: "S" },
      { r: "T", s: "S" },
    ].slice(0, Number(communityDealt || 0)),
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    isHoleCardsTableMissing: () => true,
    loadHoleCardsByUserId: async () => ({
      holeCardsByUserId: {
        [humanUserId]: [{ r: "A", s: "H" }, { r: "K", s: "H" }],
        [bot1UserId]: [{ r: "Q", s: "H" }, { r: "J", s: "H" }],
        [bot2UserId]: [{ r: "T", s: "H" }, { r: "9", s: "H" }],
      },
      holeCardsStatusByUserId: {},
    }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: humanUserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [
              { user_id: humanUserId, seat_no: 1, is_bot: false },
              { user_id: bot1UserId, seat_no: 2, is_bot: true },
              { user_id: bot2UserId, seat_no: 3, is_bot: true },
            ];
          }
          if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_actions")) {
            actionInserts.push(params);
            return [{ ok: true }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stored.state = JSON.parse(params?.[2] || "{}");
            stored.version += 1;
            return [{ version: stored.version }];
          }
          if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now()")) return [];
          return [];
        },
      }),
    klog: (event, payload) => logs.push({ event, payload }),
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "fold-bots-only-complete", action: { type: "FOLD" } }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.ok(["HAND_DONE", "SETTLED"].includes(payload.state?.state?.phase));

  const stopLog = logs.find((entry) => entry.event === "poker_act_bot_autoplay_stop");
  assert.equal(stopLog?.payload?.botsOnlyInHand, true);
  assert.ok(Number(stopLog?.payload?.effectiveMaxActionsPerRequest) > 5);
  assert.ok(Number(stopLog?.payload?.botActionCount) > 5);

  const botWrites = actionInserts.filter((params) => {
    const requestId = String(params?.[6] || "");
    return requestId.startsWith("bot:");
  });
  assert.ok(botWrites.length > 5, "expected bot autoplay writes to exceed normal cap");
};

run().then(() => console.log("poker-act bots-only autoplay completion behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
