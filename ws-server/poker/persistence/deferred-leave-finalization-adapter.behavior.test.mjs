import test from "node:test";
import assert from "node:assert/strict";
import { createDeferredLeaveFinalizer } from "./deferred-leave-finalization-adapter.mjs";

test("deferred leave finalizer passes the WS SQL boundary to the shared operation", async () => {
  const beginSql = async (fn) => fn({ unsafe: async () => [] });
  let received = null;
  const finalize = createDeferredLeaveFinalizer({
    env: {},
    beginSql,
    loadLeaveModule: async () => ({
      finalizeDeferredLeavesAfterSettlement: async (args) => {
        received = args;
        return { ok: true, changed: true, closed: false };
      },
    }),
  });

  const result = await finalize({ tableId: "table-1" });
  assert.equal(result.ok, true);
  assert.equal(received.tableId, "table-1");
  assert.equal(typeof received.beginSql, "function");
});

test("deferred leave finalizer preserves terminal accounting failures as non-retryable", async () => {
  const finalize = createDeferredLeaveFinalizer({
    env: {},
    beginSql: async () => {},
    loadLeaveModule: async () => ({
      finalizeDeferredLeavesAfterSettlement: async () => {
        const error = new Error("terminal invariant");
        error.code = "terminal_accounting_invariant_failed";
        throw error;
      },
    }),
  });

  const result = await finalize({ tableId: "table-1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "terminal_accounting_invariant_failed");
  assert.equal(result.retryable, false);
});
