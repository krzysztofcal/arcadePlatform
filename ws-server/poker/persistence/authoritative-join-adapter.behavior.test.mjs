import test from "node:test";
import assert from "node:assert/strict";
import { createAuthoritativeJoinExecutor } from "./authoritative-join-adapter.mjs";

test("authoritative join adapter returns unavailable when join core is missing", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    loadJoinModule: async () => ({})
  });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" });
  assert.deepEqual(result, { ok: false, code: "temporarily_unavailable" });
});

test("authoritative join adapter maps unknown thrown errors", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => {
        throw new Error("boom");
      }
    })
  });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" });
  assert.deepEqual(result, { ok: false, code: "authoritative_join_failed" });
});

test("authoritative join adapter forwards only shared-core supported args", async () => {
  let captured = null;
  const execute = createAuthoritativeJoinExecutor({
    env: { WS_DEFAULT_BUYIN: "25" },
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async (args) => {
        captured = args;
        return { ok: true, seatNo: 2, rejoin: false };
      }
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" });
  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 2);
  assert.equal(result.rejoin, false);
  assert.deepEqual(Object.keys(captured || {}).sort(), ["beginSql", "klog", "requestId", "tableId", "userId"]);
  assert.equal(Object.hasOwn(captured, "buyIn"), false);
  assert.equal(Object.hasOwn(captured, "autoSeat"), false);
  assert.equal(Object.hasOwn(captured, "preferredSeatNo"), false);
  assert.equal(Object.hasOwn(captured, "seatNo"), false);
  assert.equal(Object.hasOwn(captured, "env"), false);
});

test("authoritative join adapter preserves explicit rejoin semantics", async () => {
  const execute = createAuthoritativeJoinExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({ ok: true }),
    loadJoinModule: async () => ({
      executePokerJoinAuthoritative: async () => ({ ok: true, seatNo: 3, rejoin: true })
    })
  });
  const result = await execute({ tableId: "t1", userId: "u1", requestId: "r2" });
  assert.equal(result.ok, true);
  assert.equal(result.seatNo, 3);
  assert.equal(result.rejoin, true);
});
