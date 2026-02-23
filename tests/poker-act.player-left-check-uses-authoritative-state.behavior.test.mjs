import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "88888888-8888-4888-8888-888888888888";
const userId = "12121212-1212-4121-8121-121212121212";

const run = async () => {
  let stateUpdateCount = 0;

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: "rid-authoritative" }),
    normalizeJsonState: (value) => value,
    isStateStorageValid: () => true,
    withoutPrivateState: (state) => state,
    computeLegalActions: () => {
      throw new Error("should_not_reach_legal_actions");
    },
    buildActionConstraints: () => ({}),
    resetTurnTimer: (state) => state,
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          if (text.includes("from public.poker_seats") && text.includes("user_id = $2")) return [{ user_id: userId }];
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'")) return [{ user_id: userId, seat_no: 1, is_bot: false }];
          if (text.includes("from public.poker_state")) {
            return [{
              version: 9,
              state: {
                phase: "PREFLOP",
                seats: [{ userId, seatNo: 1 }],
                stacks: { [userId]: 100 },
                pot: 0,
                community: [],
                dealerSeatNo: 1,
                turnUserId: userId,
                handId: "hand-authoritative",
                handSeed: "seed-authoritative",
                communityDealt: 0,
                toCallByUserId: { [userId]: 0 },
                betThisRoundByUserId: { [userId]: 0 },
                actedThisRoundByUserId: { [userId]: false },
                foldedByUserId: { [userId]: false },
                leftTableByUserId: { [userId]: true },
                sitOutByUserId: { [userId]: false },
                pendingAutoSitOutByUserId: {},
                currentBet: 0,
                lastRaiseSize: 0,
                lastActionRequestIdByUserId: {},
              },
            }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stateUpdateCount += 1;
            return [{ version: 10 }];
          }
          return [];
        },
      }),
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {}, holeCardsStatusByUserId: {} }),
    isHoleCardsTableMissing: async () => false,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "rid-authoritative", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 409);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.error, "player_left");
  assert.equal(stateUpdateCount, 0);
};

run().then(() => console.log("poker-act player_left uses authoritative state behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
