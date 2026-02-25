import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "abab0000-abab-4bab-8bab-abab00000000";
const userId = "10101010-2020-4020-8020-101010101010";
const otherUserId = "30303030-4040-4040-8040-303030303030";

const gameplayWriteSignatures = [
  "update public.poker_state set version = version + 1",
  "insert into public.poker_actions",
  "update public.poker_tables set last_activity_at = now()",
];

const run = async () => {
  const queries = [];
  let ensureCallCount = 0;

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-pending-then-claimed" }),
    normalizeJsonState: (value) => value,
    isStateStorageValid: () => true,
    withoutPrivateState: (state) => state,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: ({ state }) => ({ applied: false, state, action: null, events: [] }),
    ensurePokerRequest: async () => {
      ensureCallCount += 1;
      if (ensureCallCount === 1) return { status: "pending" };
      return { status: "claimed" };
    },
    storePokerRequestResult: async () => {},
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
              version: 17,
              state: {
                phase: "PREFLOP",
                seats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
                handSeats: [{ userId, seatNo: 1 }, { userId: otherUserId, seatNo: 2 }],
                stacks: { [userId]: 100, [otherUserId]: 100 },
                pot: 0,
                community: [],
                dealerSeatNo: 1,
                turnUserId: userId,
                handId: "hand-pending-then-claimed",
                handSeed: "seed-pending-then-claimed",
                communityDealt: 0,
                toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
                betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
                actedThisRoundByUserId: { [userId]: false, [otherUserId]: false },
                foldedByUserId: { [userId]: false, [otherUserId]: false },
                leftTableByUserId: { [userId]: true },
                sitOutByUserId: { [userId]: false, [otherUserId]: false },
                pendingAutoSitOutByUserId: {},
                currentBet: 0,
                lastRaiseSize: 0,
                lastActionRequestIdByUserId: {},
              },
            }];
          }
          return [];
        },
      }),
  });

  const payload = { tableId, requestId: "rid-pending-then-claimed", action: { type: "CHECK" } };

  const pendingStart = queries.length;
  const first = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(payload),
  });
  const pendingQueries = queries.slice(pendingStart);

  assert.equal(first.statusCode, 202);
  const firstBody = JSON.parse(first.body || "{}");
  assert.equal(firstBody.error, "request_pending");
  assert.equal(pendingQueries.some((q) => q.includes("from public.poker_state")), false);
  assert.equal(pendingQueries.some((q) => q.includes("from public.poker_tables")), false);
  assert.equal(pendingQueries.some((q) => q.includes("from public.poker_seats")), false);
  for (const signature of gameplayWriteSignatures) {
    assert.equal(pendingQueries.some((q) => q.includes(signature)), false, `unexpected gameplay write during pending: ${signature}`);
  }

  const claimedStart = queries.length;
  const second = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(payload),
  });
  const claimedQueries = queries.slice(claimedStart);

  assert.notEqual(second.statusCode, 202);
  const secondBody = JSON.parse(second.body || "{}");
  assert.equal(second.statusCode, 409);
  assert.equal(secondBody.error, "player_left");
  assert.equal(claimedQueries.some((q) => q.includes("from public.poker_state")), true);
  for (const signature of gameplayWriteSignatures) {
    assert.equal(claimedQueries.some((q) => q.includes(signature)), false, `unexpected gameplay write during claimed path: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act idempotency pending-then-claimed proceeds behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
