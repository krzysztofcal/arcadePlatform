import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoritativeRebuyExecutor } from "./authoritative-rebuy-adapter.mjs";

function dependencies(executePokerRebuyAuthoritative) {
  return {
    env: { SUPABASE_DB_URL: "postgres://example.invalid/db" },
    beginSql: async (fn) => fn({ unsafe: async () => [] }),
    loadRebuyModule: async () => ({ executePokerRebuyAuthoritative }),
    loadPostTransaction: async () => async () => ({ transaction: { id: "tx" } }),
    loadLockedStateHelpers: async () => ({
      loadStateForUpdate: async () => ({ ok: true }),
      updateStateLocked: async () => ({ ok: true }),
      validateStateForStorage: () => true
    }),
    klog: () => {}
  };
}

test("authoritative rebuy adapter forwards the fixed command to shared domain", async () => {
  let captured = null;
  const executor = createAuthoritativeRebuyExecutor(dependencies(async (args) => {
    captured = args;
    return { ok: true, tableId: args.tableId, userId: args.userId, stack: 100, stateVersion: 9 };
  }));
  const result = await executor({ tableId: "table", userId: "user", requestId: "request", amount: 100 });
  assert.equal(result.ok, true);
  assert.equal(captured.tableId, "table");
  assert.equal(captured.amount, 100);
  assert.equal(typeof captured.postTransactionFn, "function");
});

test("authoritative rebuy adapter maps insufficient funds and fails closed for file-only runtime", async () => {
  const insufficient = createAuthoritativeRebuyExecutor(dependencies(async () => {
    throw Object.assign(new Error("insufficient_funds"), { code: "insufficient_funds" });
  }));
  assert.deepEqual(await insufficient({ tableId: "table", userId: "user", requestId: "request" }), { ok: false, code: "insufficient_chips" });

  const fileOnly = createAuthoritativeRebuyExecutor({
    ...dependencies(async () => ({ ok: true })),
    env: { WS_PERSISTED_STATE_FILE: "/tmp/poker.json" }
  });
  assert.deepEqual(await fileOnly({ tableId: "table", userId: "user", requestId: "request" }), { ok: false, code: "temporarily_unavailable" });
});
