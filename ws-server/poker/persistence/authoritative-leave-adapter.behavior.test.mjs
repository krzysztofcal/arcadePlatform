import test from "node:test";
import assert from "node:assert/strict";
import { createAuthoritativeLeaveExecutor } from "./authoritative-leave-adapter.mjs";

test("default loader uses single explicit artifact-relative path", () => {
  const source = createAuthoritativeLeaveExecutor.toString();
  assert.match(source, /\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs/);
  assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs/);
});

test("missing authoritative module returns temporarily_unavailable and logs unavailable event", async () => {
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

test("authoritative execution failure returns explicit code or authoritative_leave_failed", async () => {
  const logs = [];
  const makeExecute = (errorToThrow) => createAuthoritativeLeaveExecutor({
    env: {},
    klog: (kind, data) => logs.push({ kind, data }),
    beginSql: async (fn) => fn({}),
    loadAuthoritativeLeaveModule: async () => ({
      executePokerLeave: async () => {
        throw errorToThrow;
      }
    })
  });

  const withCode = await makeExecute(Object.assign(new Error("conflict"), { code: "state_conflict" }))({
    tableId: "table_code",
    userId: "user_code",
    requestId: "req_code"
  });
  assert.deepEqual(withCode, { ok: false, code: "state_conflict" });

  const withoutCode = await makeExecute(new Error("unknown"))({
    tableId: "table_no_code",
    userId: "user_no_code",
    requestId: "req_no_code"
  });
  assert.deepEqual(withoutCode, { ok: false, code: "authoritative_leave_failed" });
  assert.equal(logs.some((entry) => entry.kind === "ws_leave_authoritative_failed"), true);
});
