import assert from "node:assert/strict";
import { startHandCore } from "../netlify/functions/_shared/poker-start-hand-core.mjs";

const tableId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId = "start-core-clear-hand-settlement-1";

process.env.POKER_DEAL_SECRET = process.env.POKER_DEAL_SECRET || "test-deal-secret";

const run = async () => {
  const currentState = {
    tableId,
    phase: "SETTLED",
    handId: "old-hand-id",
    handSeed: "old-seed",
    handSettlement: { handId: "old-hand-id", payouts: [] },
    seats: [
      { userId, seatNo: 1 },
      { userId: otherUserId, seatNo: 2 },
    ],
    stacks: { [userId]: 100, [otherUserId]: 100 },
    pot: 0,
    community: [],
    communityDealt: 0,
    dealerSeatNo: 1,
    turnUserId: null,
    toCallByUserId: { [userId]: 0, [otherUserId]: 0 },
    betThisRoundByUserId: { [userId]: 0, [otherUserId]: 0 },
    actedThisRoundByUserId: { [userId]: false, [otherUserId]: false },
    foldedByUserId: { [userId]: false, [otherUserId]: false },
    contributionsByUserId: { [userId]: 0, [otherUserId]: 0 },
    currentBet: 0,
    lastRaiseSize: 0,
  };

  let version = 10;
  let updateStateHits = 0;
  const tx = {
    unsafe: async (query, params) => {
      const text = String(query).toLowerCase();
      if (text.includes("insert into public.poker_hole_cards")) return [{ user_id: userId }, { user_id: otherUserId }];
      if (text.includes("update public.poker_state") && text.includes("version = version + 1")) {
        updateStateHits += 1;
        version += 1;
        const parsedState = JSON.parse(String(params?.[2] || "{}"));
        assert.equal(Object.prototype.hasOwnProperty.call(parsedState, "handSettlement"), false);
        return [{ version }];
      }
      if (text.includes("insert into public.poker_actions")) return [{ ok: true }];
      return [];
    },
  };

  const result = await startHandCore({
    tx,
    tableId,
    table: { stakes: { sb: 1, bb: 2 } },
    currentState,
    expectedVersion: version,
    validSeats: [
      { user_id: userId, seat_no: 1, stack: 100 },
      { user_id: otherUserId, seat_no: 2, stack: 100 },
    ],
    userId,
    requestId,
    previousDealerSeatNo: 1,
    makeError: (status, code) => {
      const err = new Error(code);
      err.status = status;
      err.code = code;
      return err;
    },
    deps: {
      getRng: () => () => 0.123456,
    },
  });

  assert.equal(updateStateHits, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.updatedState, "handSettlement"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.privateState, "handSettlement"), false);
};

run().then(() => console.log("poker-start-hand-core does not carry hand-settlement behavior test passed")).catch((error) => {
  console.error(error);
  process.exit(1);
});
