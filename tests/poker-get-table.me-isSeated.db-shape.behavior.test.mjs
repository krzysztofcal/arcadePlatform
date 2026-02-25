import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { deriveCommunityCards, deriveDeck, deriveRemainingDeck } from "../netlify/functions/_shared/poker-deal-deterministic.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "../netlify/functions/_shared/poker-hole-cards-store.mjs";
import { buildActionConstraints, computeLegalActions } from "../netlify/functions/_shared/poker-legal-actions.mjs";
import { advanceIfNeeded } from "../netlify/functions/_shared/poker-reducer.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "../netlify/functions/_shared/poker-state-utils.mjs";
import { maybeApplyTurnTimeout, normalizeSeatOrderFromState } from "../netlify/functions/_shared/poker-turn-timeout.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "seat-user";

const state = {
  tableId,
  phase: "INIT",
  seats: [{ userId, seatNo: 2 }],
  stacks: { [userId]: 100 },
  leftTableByUserId: { [userId]: false },
  sitOutByUserId: { [userId]: false },
};

const handler = loadPokerHandler("netlify/functions/poker-get-table.mjs", {
  baseHeaders: () => ({}),
  corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
  extractBearerToken: () => "token",
  verifySupabaseJwt: async () => ({ valid: true, userId }),
  isValidUuid: () => true,
  isStateStorageValid,
  normalizeJsonState,
  withoutPrivateState,
  computeLegalActions,
  buildActionConstraints,
  normalizeSeatOrderFromState,
  isHoleCardsTableMissing,
  loadHoleCardsByUserId,
  maybeApplyTurnTimeout,
  advanceIfNeeded,
  deriveDeck,
  deriveCommunityCards,
  deriveRemainingDeck,
  updatePokerStateOptimistic: async () => ({ ok: true, newVersion: 2 }),
  beginSql: async (fn) =>
    fn({
      unsafe: async (query) => {
        const text = String(query).toLowerCase();
        if (text.includes("from public.poker_tables")) return [{ id: tableId, stakes: "1/2", max_players: 6, status: "OPEN" }];
        if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && text.includes("is_bot = false")) {
          return [{ user_id: userId, seat_no: 2 }];
        }
        if (text.includes("from public.poker_seats")) {
          return [{ user_id: userId, seat_no: 2, status: "ACTIVE", is_bot: false }];
        }
        if (text.includes("from public.poker_state")) return [{ version: 1, state }];
        if (text.includes("from public.poker_hole_cards")) return [];
        return [];
      },
    }),
  klog: () => {},
});

const response = await handler({
  httpMethod: "GET",
  headers: { origin: "https://example.test", authorization: "Bearer token" },
  queryStringParameters: { tableId },
});

assert.equal(response.statusCode, 200);
const payload = JSON.parse(response.body || "{}");
assert.equal(payload.me?.userId, userId);
assert.equal(payload.me?.isSeated, true);
assert.equal(payload.me?.isLeft, false);

console.log("poker-get-table me isSeated db-shape behavior test passed");
