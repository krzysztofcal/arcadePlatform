import assert from "node:assert/strict";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { dealHoleCards } from "../netlify/functions/_shared/poker-engine.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { awardPotsAtShowdown } from "../netlify/functions/_shared/poker-payout.mjs";
import { materializeShowdownAndPayout } from "../netlify/functions/_shared/poker-materialize-showdown.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { computeShowdown } from "../netlify/functions/_shared/poker-showdown.mjs";
import { maybeApplyTurnTimeout } from "../netlify/functions/_shared/poker-turn-timeout.mjs";
import { isPlainObject, isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const humanUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const botA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const botB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "1";

const baseState = {
  tableId,
  phase: "PREFLOP",
  seats: [
    { userId: humanUserId, seatNo: 1 },
    { userId: botA, seatNo: 2 },
    { userId: botB, seatNo: 3 },
  ],
  stacks: { [humanUserId]: 99, [botA]: 98, [botB]: 100 },
  pot: 3,
  community: [],
  dealerSeatNo: 1,
  turnUserId: humanUserId,
  handId: "hand-1",
  handSeed: "seed-1",
  communityDealt: 0,
  toCallByUserId: { [humanUserId]: 1, [botA]: 0, [botB]: 2 },
  betThisRoundByUserId: { [humanUserId]: 1, [botA]: 2, [botB]: 0 },
  actedThisRoundByUserId: { [humanUserId]: false, [botA]: false, [botB]: false },
  foldedByUserId: { [humanUserId]: false, [botA]: false, [botB]: false },
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
    maybeApplyTurnTimeout,
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
              { user_id: botA, is_bot: true },
              { user_id: botB, is_bot: true },
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
    body: JSON.stringify({ tableId, requestId: "human-call-1", action: { type: "CALL" } }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  assert.ok(payload.state?.version >= 10, "expected version to include at least one bot mutation");
  const botRows = actionInserts.filter((row) => row?.[2] === botA || row?.[2] === botB);
  assert.ok(botRows.length >= 1, "expected at least one bot action row");
  assert.equal(payload.state?.version, storedState.version, "expected payload version to match latest stored version");
  const botVersions = botRows.map((row) => Number(row?.[1])).filter(Number.isFinite);
  assert.ok(botVersions.length >= 1, "expected bot action versions");
  assert.equal(Math.max(...botVersions), payload.state?.version, "expected latest bot action version to match payload version");
  const botMeta = botRows.map((row) => JSON.parse(row?.[9] || "null")).find((m) => m?.actor === "BOT");
  assert.equal(botMeta?.actor, "BOT");
  assert.equal(botMeta?.reason, "AUTO_TURN");
  assert.equal(typeof botMeta?.policyVersion, "string");
  const botRequestIds = botRows.map((row) => String(row?.[6] || ""));
  assert.ok(botRequestIds.every((id) => id.startsWith("bot:")), "expected bot request ids to use bot: prefix");
  assert.ok(botRequestIds.some((id) => id.includes("human-call-1")), "expected bot request id to include human requestId namespace");
  assert.ok(Array.isArray(payload.events), "expected events array");
  assert.ok(payload.events.length >= 1, "expected events to include bot progression");
  const stopLog = logs.find((entry) => entry.event === "poker_act_bot_autoplay_stop");
  assert.equal(typeof stopLog?.payload?.reason, "string");
};

run().then(() => console.log("poker-act bot autoplay behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
