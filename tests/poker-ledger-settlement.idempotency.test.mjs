import assert from "node:assert/strict";
import { postHandSettlementToLedger } from "../netlify/functions/_shared/poker-ledger-settlement.mjs";

const tableId = "77777777-7777-4777-8777-777777777777";
const handId = "hand-ledger-1";

const runPostsOnlyPositivePayouts = async () => {
  const calls = [];
  await postHandSettlementToLedger({
    tableId,
    handSettlement: {
      handId,
      settledAt: "2026-01-01T00:00:00.000Z",
      payouts: { u1: 10, u2: 0, u3: 5 },
    },
    postTransaction: async (payload) => {
      calls.push(payload);
      return { transaction: { id: `tx-${calls.length}` } };
    },
    klog: () => {},
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotencyKey, `poker:settlement:${tableId}:${handId}:u1`);
  assert.equal(calls[1].idempotencyKey, `poker:settlement:${tableId}:${handId}:u3`);
};

const runReplaySafeIdempotency = async () => {
  const seen = new Set();
  let created = 0;
  const postTransaction = async (payload) => {
    if (seen.has(payload.idempotencyKey)) {
      return { transaction: { id: "existing" }, alreadyExists: true };
    }
    seen.add(payload.idempotencyKey);
    created += 1;
    return { transaction: { id: `created-${created}` } };
  };

  const settlement = {
    handId,
    settledAt: "2026-01-01T00:00:00.000Z",
    payouts: { u1: 15, u2: 25 },
  };

  await postHandSettlementToLedger({ tableId, handSettlement: settlement, postTransaction, klog: () => {} });
  await postHandSettlementToLedger({ tableId, handSettlement: settlement, postTransaction, klog: () => {} });

  assert.equal(created, 2);
  assert.deepEqual([...seen].sort(), [
    `poker:settlement:${tableId}:${handId}:u1`,
    `poker:settlement:${tableId}:${handId}:u2`,
  ]);
};

const runRejectsInvalidPayouts = async () => {
  await assert.rejects(
    () =>
      postHandSettlementToLedger({
        tableId,
        handSettlement: { handId, payouts: { u1: -1 } },
        postTransaction: async () => ({ transaction: { id: "tx" } }),
      }),
    /invalid_hand_settlement_payout_amount/
  );

  await assert.rejects(
    () =>
      postHandSettlementToLedger({
        tableId,
        handSettlement: { handId, payouts: { u1: 1.5 } },
        postTransaction: async () => ({ transaction: { id: "tx" } }),
      }),
    /invalid_hand_settlement_payout_amount/
  );
};

Promise.resolve()
  .then(runPostsOnlyPositivePayouts)
  .then(runReplaySafeIdempotency)
  .then(runRejectsInvalidPayouts)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
