import assert from "node:assert/strict";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { dealHoleCards } from "../netlify/functions/_shared/poker-engine.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";
import { isPlainObject, isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "1";

const baseState = {
  tableId,
  phase: "PREFLOP",
  seats: [
    { userId: humanUserId, seatNo: 1 },
    { userId: botUserId, seatNo: 2 },
  ],
  stacks: { [humanUserId]: 99, [botUserId]: 101 },
  pot: 3,
  community: [],
  dealerSeatNo: 1,
  turnUserId: humanUserId,
  handId: "hand-1",
  handSeed: "seed-1",
  communityDealt: 0,
  toCallByUserId: { [humanUserId]: 1, [botUserId]: 0 },
  betThisRoundByUserId: { [humanUserId]: 1, [botUserId]: 2 },
  actedThisRoundByUserId: { [humanUserId]: false, [botUserId]: false },
  foldedByUserId: { [humanUserId]: false, [botUserId]: false },
  currentBet: 2,
  lastRaiseSize: 1,
  lastActionRequestIdByUserId: {},
};

const seatOrder = baseState.seats.map((s) => s.userId);
const holeCardsByUserId = dealHoleCards(deriveDeck(baseState.handSeed), seatOrder).holeCardsByUserId;

const run = async () => {
  const actionInserts = [];
  const logs = [];
  const storedState = { version: 8, value: JSON.stringify(baseState), requests: new Map() };

  const mockedTimeout = ({ state }) => ({
    applied: true,
    state: {
      ...state,
      foldedByUserId: { ...state.foldedByUserId, [humanUserId]: true },
      actedThisRoundByUserId: { ...state.actedThisRoundByUserId, [humanUserId]: true },
      turnUserId: botUserId,
      lastActionRequestIdByUserId: { ...state.lastActionRequestIdByUserId, [humanUserId]: "auto-timeout" },
    },
    events: [{ type: "ACTION", action: { type: "FOLD", userId: humanUserId, reason: "timeout" } }],
    action: { userId: humanUserId, type: "FOLD", amount: null },
  });

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    awardPotsAtShowdown,
    materializeShowdownAndPayout,
    computeShowdown,
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: humanUserId }),
    isValidUuid: () => true,
    normalizeRequestId,
    isPlainObject,
    isStateStorageValid,
    TURN_MS,
    normalizeJsonState,
    withoutPrivateState,
    maybeApplyTurnTimeout: mockedTimeout,
    advanceIfNeeded,
    applyAction,
    deriveCommunityCards,
    deriveRemainingDeck,
    computeLegalActions,
    buildActionConstraints,
    isHoleCardsTableMissing,
    resetTurnTimer,
    updatePokerStateOptimistic,
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId }),
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: humanUserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) {
            return [
              { user_id: humanUserId, is_bot: false },
              { user_id: botUserId, is_bot: true },
            ];
          }
          if (text.includes("from public.poker_state")) return [{ version: storedState.version, state: JSON.parse(storedState.value) }];
          if (text.includes("from public.poker_requests")) return [];
          if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
          if (text.includes("delete from public.poker_requests")) return [];
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            storedState.value = params?.[2];
            storedState.version = Number(params?.[1]) + 1;
            return [{ version: storedState.version }];
          }
          if (text.includes("insert into public.poker_actions")) {
            actionInserts.push(params);
            return [{ ok: true }];
          }
          return [];
        },
      }),
    klog: (event, payload) => logs.push({ event, payload }),
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "human-timeout-1", action: { type: "CALL" } }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);

  const timeoutRows = actionInserts.filter((row) => String(row?.[6] || "").startsWith("timeout-"));
  const botRows = actionInserts.filter((row) => String(row?.[6] || "").startsWith("bot:"));
  assert.ok(timeoutRows.length >= 1, "expected timeout action row");
  assert.ok(botRows.length >= 1, "expected at least one bot action row");

  const botMeta = botRows.map((row) => JSON.parse(row?.[9] || "null")).find((meta) => meta?.actor === "BOT");
  assert.equal(botMeta?.actor, "BOT");
  assert.equal(botMeta?.botUserId, botUserId);

  assert.equal(payload.state?.version, storedState.version, "expected payload version to match latest stored version");
  assert.ok(Array.isArray(payload.events), "expected events array");
  assert.ok(payload.events.length >= 1, "expected events to include bot progression");
  assert.ok(logs.some((entry) => entry.event === "poker_act_bot_autoplay_attempt"));
  assert.ok(logs.some((entry) => entry.event === "poker_act_bot_autoplay_stop"));
};

run().then(() => console.log("poker-act timeout-applied bot autoplay behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
