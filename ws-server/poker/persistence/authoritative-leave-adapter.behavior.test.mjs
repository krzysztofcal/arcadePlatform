import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAuthoritativeLeaveExecutor } from "./authoritative-leave-adapter.mjs";

test("default loader uses module-relative shared contract path", () => {
  const source = String.raw`${createAuthoritativeLeaveExecutor}`;
  assert.match(source, /configuredPath\s*\|\|\s*DEFAULT_AUTHORITATIVE_LEAVE_MODULE_URL/);
});

test("ws-local authoritative leave module bridges to repo-root authoritative contract", async () => {
  const source = await fs.readFile("ws-server/shared/poker-domain/leave.mjs", "utf8");
  assert.match(source, /export\s*\{\s*executePokerLeave\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs"\s*;/);
  assert.doesNotMatch(source, /currentMembers/);
  assert.doesNotMatch(source, /seats\s*:\s*\[/);
});


test("default loader resolves in artifact-shaped layout without loader-unavailable taxonomy", async () => {
  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-adapter-default-loader-"));
  try {
    const stagedAdapter = path.join(stageDir, "ws-server/poker/persistence/authoritative-leave-adapter.mjs");
    const stagedBootstrap = path.join(stageDir, "ws-server/poker/bootstrap/persisted-bootstrap-db.mjs");
    const stagedLeave = path.join(stageDir, "shared/poker-domain/leave.mjs");

    await fs.mkdir(path.dirname(stagedAdapter), { recursive: true });
    await fs.mkdir(path.dirname(stagedBootstrap), { recursive: true });
    await fs.mkdir(path.dirname(stagedLeave), { recursive: true });

    await fs.copyFile("ws-server/poker/persistence/authoritative-leave-adapter.mjs", stagedAdapter);
    await fs.writeFile(stagedBootstrap, "export async function beginSqlWs(fn) { return fn({}); }\n", "utf8");
    await fs.writeFile(stagedLeave, "export async function executePokerLeave(){ throw Object.assign(new Error('state_invalid'), { code: 'state_invalid' }); }\n", "utf8");

    const adapterModule = await import(pathToFileURL(stagedAdapter).href);
    const execute = adapterModule.createAuthoritativeLeaveExecutor({ env: {}, klog: () => {} });
    const result = await execute({ tableId: "t1", userId: "u1", requestId: "r1" });
    assert.notEqual(result.code, "temporarily_unavailable");
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
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




test("authoritative success payload with post-leave seats excluding leaver remains accepted", async () => {
  const execute = createAuthoritativeLeaveExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({}),
    loadAuthoritativeLeaveModule: async () => ({
      executePokerLeave: async () => ({
        ok: true,
        tableId: "t1",
        state: {
          version: 2,
          state: {
            tableId: "t1",
            seats: [{ seatNo: 2, userId: "u2" }]
          }
        }
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "req-valid-post-leave" });
  assert.equal(result.ok, true);
  assert.equal(result.code, undefined);
  assert.equal(result.state.state.seats.some((seat) => seat.userId === "u1"), false);
});
test("authoritative success payload with mismatched tableId downgrades to authoritative_state_invalid", async () => {
  const logs = [];
  const execute = createAuthoritativeLeaveExecutor({
    env: {},
    klog: (kind, data) => logs.push({ kind, data }),
    beginSql: async (fn) => fn({}),
    loadAuthoritativeLeaveModule: async () => ({
      executePokerLeave: async () => ({
        ok: true,
        tableId: "t1",
        state: { version: 1, state: { tableId: "other", seats: [{ seatNo: 1, userId: "u1" }] } }
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "req-mismatch" });
  assert.deepEqual(result, { ok: false, code: "authoritative_state_invalid" });
  assert.equal(logs.some((entry) => entry.kind === "ws_leave_authoritative_failed"), true);
});

test("authoritative success payload with malformed seats downgrades to authoritative_state_invalid", async () => {
  const execute = createAuthoritativeLeaveExecutor({
    env: {},
    klog: () => {},
    beginSql: async (fn) => fn({}),
    loadAuthoritativeLeaveModule: async () => ({
      executePokerLeave: async () => ({
        ok: true,
        tableId: "t1",
        state: { version: 1, state: { tableId: "t1", seats: null } }
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "req-bad-seats" });
  assert.deepEqual(result, { ok: false, code: "authoritative_state_invalid" });
});

test("authoritative success payload that still contains leaving user downgrades to authoritative_state_invalid", async () => {
  const logs = [];
  const execute = createAuthoritativeLeaveExecutor({
    env: {},
    klog: (kind, data) => logs.push({ kind, data }),
    beginSql: async (fn) => fn({}),
    loadAuthoritativeLeaveModule: async () => ({
      executePokerLeave: async () => ({
        ok: true,
        tableId: "t1",
        state: {
          version: 1,
          state: {
            tableId: "t1",
            seats: [
              { seatNo: 1, userId: "u1" },
              { seatNo: 2, userId: "u2" }
            ]
          }
        }
      })
    })
  });

  const result = await execute({ tableId: "t1", userId: "u1", requestId: "req-still-present" });
  assert.deepEqual(result, { ok: false, code: "authoritative_state_invalid" });
  assert.equal(logs.some((entry) => entry.kind === "ws_leave_authoritative_failed"), true);
});
