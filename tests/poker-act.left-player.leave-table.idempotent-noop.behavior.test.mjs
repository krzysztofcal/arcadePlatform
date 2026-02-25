import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";

const tableId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";

const writeSignatures = [
  "update public.poker_state set version = version + 1",
  "insert into public.poker_actions",
  "update public.poker_tables set last_activity_at = now()",
];

const run = async () => {
  const queries = [];
  const storedByRequestId = new Map();
  let storePokerRequestResultCount = 0;

  const handler = loadPokerHandler("netlify/functions/poker-act.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    normalizeRequestId: (value) => ({ ok: true, value: value || "rid-fallback" }),
    normalizeJsonState: (value) => value,
    isStateStorageValid: () => true,
    withoutPrivateState: (state) => state,
    deriveCommunityCards: () => [],
    deriveRemainingDeck: () => [],
    maybeApplyTurnTimeout: () => {
      throw new Error("should_not_apply_timeout_for_left_leave_noop");
    },
    ensurePokerRequest: async (_tx, { requestId }) => {
      if (storedByRequestId.has(requestId)) {
        return { status: "stored", result: storedByRequestId.get(requestId) };
      }
      return { status: "claimed" };
    },
    storePokerRequestResult: async (_tx, { requestId, result }) => {
      storePokerRequestResultCount += 1;
      storedByRequestId.set(requestId, result);
    },
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
            return [
              {
                version: 12,
                state: {
                  phase: "PREFLOP",
                  seats: [
                    { userId, seatNo: 1 },
                    { userId: otherUserId, seatNo: 2 },
                  ],
                  handSeats: [
                    { userId, seatNo: 1 },
                    { userId: otherUserId, seatNo: 2 },
                  ],
                  stacks: { [userId]: 125, [otherUserId]: 88 },
                  pot: 6,
                  community: [],
                  dealerSeatNo: 1,
                  turnUserId: userId,
                  handId: "hand-left-idempotent",
                  handSeed: "seed-left-idempotent",
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
              },
            ];
          }
          return [];
        },
      }),
  });

  const requestId = "rid-left-leave-idempotent";
  const payload = { tableId, requestId, action: { type: "LEAVE_TABLE" } };

  const firstQueryCount = queries.length;
  const first = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(payload),
  });
  const firstQueries = queries.slice(firstQueryCount);

  const secondQueryCount = queries.length;
  const second = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify(payload),
  });

  const secondQueries = queries.slice(secondQueryCount);

  const firstBody = JSON.parse(first.body || "{}");
  const secondBody = JSON.parse(second.body || "{}");

  assert.equal(first.statusCode, 200);
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.replayed, false);
  assert.equal(storePokerRequestResultCount, 1);

  for (const signature of writeSignatures) {
    assert.equal(firstQueries.some((query) => query.includes(signature)), false, `unexpected write query on first call: ${signature}`);
  }

  assert.equal(second.statusCode, 200);
  assert.deepEqual(secondBody, { ...firstBody, replayed: true });
  assert.equal(storePokerRequestResultCount, 1);

  for (const signature of writeSignatures) {
    assert.equal(secondQueries.some((query) => query.includes(signature)), false, `unexpected write query on second call: ${signature}`);
  }
};

run()
  .then(() => {
    process.stdout.write("poker-act left-player leave-table idempotent noop behavior test passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  });
