import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { createDeck, dealHoleCards, shuffle } from "../netlify/functions/_shared/poker-engine.mjs";
import { deriveDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { TURN_MS, advanceIfNeeded, applyAction } from "../netlify/functions/_shared/poker-reducer.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import {
  getRng,
  isPlainObject,
  isStateStorageValid,
  normalizeJsonState,
  upgradeLegacyInitStateWithSeats,
  withoutPrivateState,
} from "../netlify/functions/_shared/poker-state-utils.mjs";
import { normalizeRequestId } from "../netlify/functions/_shared/poker-request-id.mjs";
import { resetTurnTimer } from "../netlify/functions/_shared/poker-turn-timer.mjs";
import { clearMissedTurns } from "../netlify/functions/_shared/poker-missed-turns.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "21111111-1111-4111-8111-111111111111";
const botA = "b1111111-1111-4111-8111-111111111111";
const botB = "b2222222-2222-4222-8222-222222222222";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";
process.env.POKER_BOTS_MAX_ACTIONS_PER_REQUEST = "2";

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

const run = async () => {
  const actionRows = [];
  const stateHolder = {
    version: 5,
    state: {
      tableId,
      phase: "INIT",
      stacks: {
        [botA]: 200,
        [botB]: 200,
      },
    },
  };

  const buildHandler = () =>
    loadPokerHandler("netlify/functions/poker-start-hand.mjs", {
      baseHeaders: () => ({}),
      corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
      extractBearerToken: () => "token",
      verifySupabaseJwt: async () => ({ valid: true, userId: botA }),
      isValidUuid: () => true,
      createDeck,
      dealHoleCards,
      deriveDeck,
      getRng,
      isPlainObject,
      isStateStorageValid,
      shuffle,
      normalizeJsonState,
      normalizeRequestId,
      upgradeLegacyInitStateWithSeats,
      withoutPrivateState,
      computeLegalActions,
      computeNextDealerSeatNo: () => 2,
      buildActionConstraints,
      updatePokerStateOptimistic,
      TURN_MS,
      applyAction,
      advanceIfNeeded,
      resetTurnTimer,
      clearMissedTurns,
      klog: () => {},
      beginSql: async (fn) =>
        fn({
          unsafe: async (query, params) => {
            const text = String(query).toLowerCase();
            if (text.includes("from public.poker_tables")) {
              return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
            }
            if (text.includes("from public.poker_state") && text.includes("version, state")) {
              return [{ version: stateHolder.version, state: stateHolder.state }];
            }
            if (text.includes("from public.poker_seats")) {
              return [
                { user_id: botA, seat_no: 1, status: "ACTIVE", is_bot: true, stack: 200 },
                { user_id: botB, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 200 },
              ];
            }
            if (text.includes("from public.poker_requests")) return [];
            if (text.includes("insert into public.poker_requests")) return [{ request_id: params?.[2] }];
            if (text.includes("update public.poker_requests")) return [{ request_id: params?.[2] }];
            if (text.includes("delete from public.poker_requests")) return [];
            if (text.includes("select cards from public.poker_hole_cards")) {
              return [{ cards: [{ r: "a", s: "s" }, { r: "k", s: "h" }] }];
            }
            if (text.includes("insert into public.poker_hole_cards")) {
              const insertedRows = [];
              for (let i = 0; i < params.length; i += 4) insertedRows.push({ user_id: params[i + 2] });
              return insertedRows;
            }
            if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
              stateHolder.state = JSON.parse(params?.[2] || "{}");
              stateHolder.version += 1;
              return [{ version: stateHolder.version }];
            }
            if (text.includes("insert into public.poker_actions")) {
              actionRows.push(params);
              return [];
            }
            if (text.includes("update public.poker_tables set last_activity_at = now(), updated_at = now()")) return [];
            return [];
          },
        }),
    });

  const handler = buildHandler();
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "bot-start-gated-1" }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body || "{}");
  assert.equal(payload.ok, true);
  const initialVersion = 5;
  assert.equal(stateHolder.state?.phase, "PREFLOP");
  assert.ok(stateHolder.version > initialVersion, "expected persisted state/version mutation");
  const botActorRows = actionRows.filter((row) => extractActorFromInsertParams(row) === "BOT");
  assert.equal(botActorRows.length, 0, "expected no bot autoplay action rows when no active humans");
  assert.equal(actionRows.length, 3, "expected START_HAND + blinds baseline only");
  const actionRowCountAfterFirst = actionRows.length;

  const replay = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "bot-start-gated-1" }),
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(actionRows.length, actionRowCountAfterFirst, "replay must not append action rows");
  assert.equal(actionRows.filter((row) => extractActorFromInsertParams(row) === "BOT").length, 0);
};

run().then(() => console.log("poker-start-hand bot autoplay human-gate behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
