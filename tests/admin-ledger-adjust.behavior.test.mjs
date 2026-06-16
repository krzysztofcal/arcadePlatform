import assert from "node:assert/strict";
import test from "node:test";

const { createAdminLedgerAdjustHandler } = await import("../netlify/functions/admin-ledger-adjust.mjs");

function createEvent(body, headers = {}) {
  return {
    httpMethod: "POST",
    headers: {
      origin: "https://arcade.test",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function createHandler(options = {}) {
  const calls = [];
  const seen = new Map();
  const handler = createAdminLedgerAdjustHandler({
    env: { CHIPS_ENABLED: "1" },
    requireAdminUser: options.requireAdminUser || (async () => ({ userId: "00000000-0000-4000-8000-000000000010" })),
    postTransaction: options.postTransaction || (async (payload) => {
      calls.push(payload);
      if (seen.has(payload.idempotencyKey)) {
        return seen.get(payload.idempotencyKey);
      }
      const result = {
        transaction: { id: `tx-${seen.size + 1}`, idempotency_key: payload.idempotencyKey, tx_type: payload.txType },
        entries: payload.entries,
        account: { id: "acct-1", balance: payload.entries[0].amount },
      };
      seen.set(payload.idempotencyKey, result);
      return result;
    }),
  });
  return { calls, handler };
}

test("admin-ledger-adjust succeeds for positive adjustments", async () => {
  const { calls, handler } = createHandler();
  const response = await handler(createEvent({
    userId: "00000000-0000-4000-8000-000000000020",
    amount: 500,
    reason: "promo correction",
    idempotencyKey: "client-1",
  }));
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.amount, 500);
  assert.equal(body.transaction.tx_type, "ADMIN_ADJUST");
  assert.equal(calls[0].entries[0].amount, 500);
  assert.equal(calls[0].entries[1].amount, -500);
  assert.equal(calls[0].metadata.source, "admin_page");
  assert.equal(calls[0].metadata.admin_user_id, "00000000-0000-4000-8000-000000000010");
  assert.equal(calls[0].metadata.target_user_id, "00000000-0000-4000-8000-000000000020");
});

test("admin-ledger-adjust succeeds for negative adjustments", async () => {
  const { calls, handler } = createHandler();
  const response = await handler(createEvent({
    userId: "00000000-0000-4000-8000-000000000021",
    amount: -125,
    reason: "duplicate reward rollback",
    idempotencyKey: "client-2",
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(calls[0].entries[0].amount, -125);
  assert.equal(calls[0].entries[1].amount, 125);
});

test("admin-ledger-adjust rejects missing reason", async () => {
  const { calls, handler } = createHandler();
  const response = await handler(createEvent({
    userId: "00000000-0000-4000-8000-000000000022",
    amount: 50,
    reason: "   ",
    idempotencyKey: "client-3",
  }));
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "missing_reason" });
  assert.equal(calls.length, 0);
});

test("admin-ledger-adjust rejects zero amount", async () => {
  const { calls, handler } = createHandler();
  const response = await handler(createEvent({
    userId: "00000000-0000-4000-8000-000000000023",
    amount: 0,
    reason: "noop",
    idempotencyKey: "client-4",
  }));
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "invalid_amount" });
  assert.equal(calls.length, 0);
});

test("admin-ledger-adjust rejects unauthorized callers", async () => {
  const { handler } = createHandler({
    requireAdminUser: async () => {
      const error = new Error("admin_required");
      error.status = 403;
      error.code = "admin_required";
      throw error;
    },
  });
  const response = await handler(createEvent({
    userId: "00000000-0000-4000-8000-000000000024",
    amount: 10,
    reason: "test",
    idempotencyKey: "client-5",
  }));
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "admin_required" });
});

test("admin-ledger-adjust is replay-safe for the same idempotency key", async () => {
  const { handler } = createHandler();
  const event = createEvent({
    userId: "00000000-0000-4000-8000-000000000025",
    amount: 75,
    reason: "manual top-up",
    idempotencyKey: "client-6",
  });
  const first = await handler(event);
  const second = await handler(event);
  const firstBody = JSON.parse(first.body);
  const secondBody = JSON.parse(second.body);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(firstBody.transaction.id, secondBody.transaction.id);
  assert.equal(firstBody.idempotencyKey, secondBody.idempotencyKey);
});
