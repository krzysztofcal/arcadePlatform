import assert from "node:assert/strict";
import { loadPokerHandler } from "./helpers/poker-test-helpers.mjs";
import { updatePokerStateOptimistic } from "../netlify/functions/_shared/poker-state-write.mjs";

const tableId = "33333333-3333-4333-8333-333333333333";
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherUserId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const run = async () => {
  let seatDeleteCount = 0;
  let postTransactionCalls = 0;

  const stored = {
    version: 11,
    state: {
      tableId,
      phase: "FLOP",
      handId: "hand-1",
      handSeed: "seed-1",
      communityDealt: 3,
      seats: [
        { userId, seatNo: 2 },
        { userId: otherUserId, seatNo: 3 },
      ],
      handSeats: [
        { userId, seatNo: 2 },
        { userId: otherUserId, seatNo: 3 },
      ],
      stacks: { [userId]: 125, [otherUserId]: 180 },
      contributionsByUserId: { [userId]: 25, [otherUserId]: 25 },
      pot: 50,
      turnUserId: otherUserId,
      dealerSeatNo: 2,
      toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
      betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
      actedThisRoundByUserId: { [userId]: false, [otherUserId]: false },
      foldedByUserId: { [userId]: false, [otherUserId]: false },
      leftTableByUserId: { [userId]: false, [otherUserId]: false },
      sitOutByUserId: { [userId]: false, [otherUserId]: false },
      pendingAutoSitOutByUserId: {},
      allInByUserId: { [userId]: false, [otherUserId]: false },
      community: [{ r: "A", s: "S" }, { r: "K", s: "S" }, { r: "Q", s: "S" }],
      deck: [{ r: "2", s: "D" }],
    },
  };

  const handler = loadPokerHandler("netlify/functions/poker-leave.mjs", {
    baseHeaders: () => ({}),
    corsHeaders: () => ({ "access-control-allow-origin": "https://example.test" }),
    extractBearerToken: () => "token",
    verifySupabaseJwt: async () => ({ valid: true, userId }),
    isValidUuid: () => true,
    normalizeRequestId: () => ({ ok: true, value: "active-detach-1" }),
    updatePokerStateOptimistic,
    ensurePokerRequest: async () => ({ status: "proceed" }),
    storePokerRequestResult: async () => {},
    deletePokerRequest: async () => {},
    beginSql: async (fn) =>
      fn({
        unsafe: async (query, params) => {
          const text = String(query).toLowerCase();
          if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
          if (text.includes("from public.poker_state")) return [{ version: stored.version, state: stored.state }];
          if (text.includes("from public.poker_seats") && text.includes("for update")) {
            return [{ seat_no: 2, status: "ACTIVE", stack: 125 }];
          }
          if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
            stored.state = JSON.parse(params?.[2] || "{}");
            stored.version += 1;
            return [{ version: stored.version }];
          }
          if (text.includes("delete from public.poker_seats")) {
            seatDeleteCount += 1;
            return [];
          }
          return [];
        },
      }),
    postTransaction: async ({ entries }) => {
      postTransactionCalls += 1;
      assert.equal(entries?.[1]?.amount, 125);
      return { transaction: { id: "tx-1" } };
    },
    klog: () => {},
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "https://example.test", authorization: "Bearer token" },
    body: JSON.stringify({ tableId, includeState: true, requestId: "active-detach-1" }),
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || "{}");
  assert.equal(body.ok, true);
  assert.equal(body.status, undefined);
  assert.equal(body.cashedOut, 125);
  assert.equal(postTransactionCalls, 1);
  assert.equal(seatDeleteCount, 1);
  assert.equal(body.state.state.seats.some((seat) => seat?.userId === userId), false);
  assert.equal(body.state.state.handSeats.some((seat) => seat?.userId === userId), true);
  assert.equal(body.state.state.leftTableByUserId?.[userId], true);
  assert.equal(body.state.state.stacks?.[userId], undefined);
  assert.equal(body.state.state.contributionsByUserId?.[userId], 25);
  assert.equal(body.state.state.pot, 50);
};

run()
  .then(() => console.log("poker-leave active hand instant detach behavior test passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
