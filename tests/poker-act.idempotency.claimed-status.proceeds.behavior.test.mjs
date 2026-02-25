import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const userId = "66666666-6666-4666-8666-666666666666";
const otherUserId = "77777777-7777-4777-8777-777777777777";

const run = async () => {
  const queries = [];
  let storedResultCount = 0;
  const writeSignatures = [
    "update public.poker_state set version = version + 1",
    "insert into public.poker_actions",
    "update public.poker_tables set last_activity_at = now()",
  ];

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-claimed" }),
    normalizeJsonState: (value) => value,
    isStateStorageValid: () => true,
    withoutPrivateState: (state) => state,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    ensurePokerRequest: async () => ({ status: "claimed" }),
    storePokerRequestResult: async () => {
      storedResultCount += 1;
    },
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {}, holeCardsStatusByUserId: {} }),
    isHoleCardsTableMissing: async () => false,
    klog: () => {},
    beginSql: async (fn) =>
      fn({
        unsafe: async (query) => {
          const text = String(query).toLowerCase();
          queries.push(text);
          if (text.includes("from public.poker_tables")) {
            return [{ id: tableId, status: "OPEN", stakes: '{"sb":1,"bb":2}' }];
          }
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && text.includes("user_id = $2")) {
            return [{ user_id: userId }];
          }
          if (text.includes("from public.poker_seats") && text.includes("status = 'active'") && !text.includes("user_id = $2")) {
            return [
              { user_id: userId, seat_no: 1, is_bot: false },
              { user_id: otherUserId, seat_no: 2, is_bot: false },
            ];
          }
          if (text.includes("from public.poker_state")) {
            return [{
              version: 21,
              state: {
                phase: "PREFLOP",
                seats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
                handSeats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
                stacks: { [userId]: 100, [otherUserId]: 100 },
                pot: 0,
                community: [],
                dealerSeatNo: 1,
                turnUserId: userId,
                handId: "hand-claimed",
                handSeed: "seed-claimed",
                communityDealt: 0,
                toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
                betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
                actedThisRoundByUserId: { [userId]: false, [otherUserId]: false },
                foldedByUserId: { [userId]: false, [otherUserId]: false },
                leftTableByUserId: { [userId]: true },
                sitOutByUserId: {},
                pendingAutoSitOutByUserId: {},
                currentBet: 0,
                lastRaiseSize: 0,
                lastActionRequestIdByUserId: {},
              },
            }];
          }
          if (text.includes("update public.poker_state set version = version + 1")) {
            return [{ version: 22 }];
          }
          return [];
        },
      }),
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, requestId: "rid-claimed", action: { type: "CHECK" } }),
  });

  assert.equal(response.statusCode, 409);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.error, "player_left");
  assert.equal(storedResultCount, 0);
  assert.equal(queries.some((query) => query.includes("from public.poker_state")), true);
  for (const signature of writeSignatures) {
    assert.equal(queries.some((query) => query.includes(signature)), false, `unexpected write query: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act idempotency claimed-status proceeds behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
