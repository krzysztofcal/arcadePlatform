import assert from "node:assert/strict";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { dealHoleCards } from "../netlify/functions/_shared/poker-engine.mjs";
import { isHoleCardsTableMissing } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
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

const tableId = "31111111-1111-4111-8111-111111111111";
const humanUserId = "a1111111-1111-4111-8111-111111111111";
const botA = "b1111111-1111-4111-8111-111111111111";
const botB = "b2222222-2222-4222-8222-222222222222";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "1";

const extractActorFromInsertParams = (params) => {
  if (!Array.isArray(params)) return null;
  for (let idx = params.length - 1; idx >= 0; idx -= 1) {
    const candidate = params[idx];
    if (candidate == null) continue;
    if (typeof candidate === "object" && !Array.isArray(candidate)) {
      if (typeof candidate.actor === "string") return candidate.actor;
      continue;
    }
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.actor === "string") {
        return parsed.actor;
      }
    } catch {
      // ignore non-json params
    }
  }
  return null;
};

const makeBaseState = ({ actorUserId, includeHumanSeat }) => ({
  tableId,
  phase: "PREFLOP",
  seats: includeHumanSeat
    ? [
        { userId: humanUserId, seatNo: 1 },
        { userId: botA, seatNo: 2 },
        { userId: botB, seatNo: 3 },
      ]
    : [
        { userId: botA, seatNo: 1 },
        { userId: botB, seatNo: 2 },
      ],
  stacks: includeHumanSeat ? { [humanUserId]: 99, [botA]: 98, [botB]: 100 } : { [botA]: 99, [botB]: 100 },
  pot: 3,
  community: [],
  dealerSeatNo: 1,
  turnUserId: actorUserId,
  handId: "hand-1",
  handSeed: "seed-1",
  communityDealt: 0,
  toCallByUserId: includeHumanSeat
    ? { [humanUserId]: 1, [botA]: 0, [botB]: 2 }
    : { [botA]: 1, [botB]: 0 },
  betThisRoundByUserId: includeHumanSeat
    ? { [humanUserId]: 1, [botA]: 2, [botB]: 0 }
    : { [botA]: 1, [botB]: 2 },
  actedThisRoundByUserId: includeHumanSeat
    ? { [humanUserId]: false, [botA]: false, [botB]: false }
    : { [botA]: false, [botB]: false },
  foldedByUserId: includeHumanSeat
    ? { [humanUserId]: false, [botA]: false, [botB]: false }
    : { [botA]: false, [botB]: false },
  currentBet: 2,
  lastRaiseSize: 1,
  lastActionRequestIdByUserId: {},
});

const runScenario = async ({ authUserId, activeSeats, includeHumanSeat }) => {
  const actionInserts = [];
  const baseState = makeBaseState({ actorUserId: authUserId, includeHumanSeat });
  const seatOrder = baseState.seats.map((seat) => seat.userId);
  const holeCardsByUserId = dealHoleCards(deriveDeck(baseState.handSeed), seatOrder).holeCardsByUserId;
  const storedState = { version: 8, value: JSON.stringify(baseState) };

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    awardPotsAtShowdown,
    materializeShowdownAndPayout,
    computeShowdown,
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId: authUserId }),
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
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: authUserId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) return activeSeats;
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
    klog: () => {},
  });

  const requestId = `req-${authUserId}`;
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId, action: { type: "CALL" } }),
  });

  return { response, actionInserts, storedState, handler, requestId };
};

const run = async () => {
  const noHumans = await runScenario({
    authUserId: botA,
    includeHumanSeat: false,
    activeSeats: [
      { user_id: botA, is_bot: true },
      { user_id: botB, is_bot: true },
    ],
  });
  assert.equal(noHumans.response.statusCode, 200);
  const noHumansPayload = JSON.parse(noHumans.response.body || "{}");
  assert.equal(noHumansPayload.ok, true);
  const noHumansBotRows = noHumans.actionInserts.filter((row) => extractActorFromInsertParams(row) === "BOT");
  assert.equal(noHumansBotRows.length, 0, "bot autoplay should not run when active human count is zero");
  assert.equal(noHumans.actionInserts.length, 1, "expected only baseline user action row when no humans are active");
  assert.equal(noHumans.storedState.version, 9, "expected single state-version increment for no-human path");

  const noHumansReplay = await noHumans.handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: noHumans.requestId, action: { type: "CALL" } }),
  });
  assert.equal(noHumansReplay.statusCode, 200);
  assert.equal(noHumans.actionInserts.length, 1, "replay should not append action rows");
  assert.equal(noHumans.storedState.version, 9, "replay should not mutate version");

  const withHuman = await runScenario({
    authUserId: humanUserId,
    includeHumanSeat: true,
    activeSeats: [
      { user_id: humanUserId, is_bot: false },
      { user_id: botA, is_bot: true },
      { user_id: botB, is_bot: true },
    ],
  });
  assert.equal(withHuman.response.statusCode, 200);
  const withHumanPayload = JSON.parse(withHuman.response.body || "{}");
  assert.equal(withHumanPayload.ok, true);
  assert.ok(withHuman.actionInserts.length >= 1, "expected at least one action row from user action path");
  assert.ok(withHuman.storedState.version > 8, "expected state version to advance for with-human scenario");
};

run().then(() => console.log("poker-act bot autoplay human-gate behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
