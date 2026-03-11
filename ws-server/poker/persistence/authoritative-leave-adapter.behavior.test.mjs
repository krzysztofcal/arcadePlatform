import test from "node:test";
import assert from "node:assert/strict";
import { createAuthoritativeLeaveExecutor } from "./authoritative-leave-adapter.mjs";

test("default loader uses single explicit artifact-relative path", () => {
  const source = createAuthoritativeLeaveExecutor.toString();
  assert.match(source, /\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs/);
  assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs/);
});



test("ws-local authoritative leave bridge resolves from adapter runtime location", async () => {
  const module = await import("../../shared/poker-domain/leave.mjs");
  assert.equal(typeof module.executePokerLeave, "function");
});


test("default loader execution path does not collapse to loader-unavailable taxonomy", async () => {
  const execute = createAuthoritativeLeaveExecutor({
    env: { WS_AUTHORITATIVE_LEAVE_MODULE_PATH: "" },
    beginSql: async (fn) => fn({}),
    klog: () => {}
  });

  const result = await execute({ tableId: "table_default_loader", userId: "user_default_loader", requestId: "req_default_loader" });
  assert.notEqual(result.code, "temporarily_unavailable");
});


test("authoritative adapter taxonomy: loader failure returns temporarily_unavailable", async () => {
  const logs = [];
  const execute = createAuthoritativeLeaveExecutor({
    env: {},
    klog: (kind, data) => logs.push({ kind, data }),
    loadAuthoritativeLeaveModule: async () => {
      throw new Error("module_not_found");
    }
  });

  const result = await execute({ tableId: "table_missing", userId: "user_missing", requestId: "req_missing" });
  assert.deepEqual(result, { ok: false, code: "temporarily_unavailable" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].kind, "ws_leave_authoritative_unavailable");
});

test("authoritative adapter taxonomy: execute failure without code returns authoritative_leave_failed", async () => {
  const logs = [];
  const execute = createAuthoritativeLeaveExecutor({
    env: {},
    klog: (kind, data) => logs.push({ kind, data }),
    beginSql: async (fn) => fn({}),
    loadAuthoritativeLeaveModule: async () => ({
      executePokerLeave: async () => {
        throw new Error("unknown");
      }
    })
  });

  const result = await execute({ tableId: "table_no_code", userId: "user_no_code", requestId: "req_no_code" });
  assert.deepEqual(result, { ok: false, code: "authoritative_leave_failed" });
  assert.equal(logs.some((entry) => entry.kind === "ws_leave_authoritative_failed"), true);
});

test("authoritative adapter taxonomy: execute failure with explicit code propagates that code", async () => {
  const execute = createAuthoritativeLeaveExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({}),
    loadAuthoritativeLeaveModule: async () => ({
      executePokerLeave: async () => {
        throw Object.assign(new Error("conflict"), { code: "state_conflict" });
      }
    })
  });

  const result = await execute({ tableId: "table_code", userId: "user_code", requestId: "req_code" });
  assert.deepEqual(result, { ok: false, code: "state_conflict" });
});
