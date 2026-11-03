#!/usr/bin/node

// Root helper for owner-approved VPS administration (#1159 root on demand). It runs only operations from the fixed
// catalog below, each with fixed argv and no shell: "<operation> <runId>", where runId is the numeric GitHub run id
// of the approved "VPS Admin Operation" workflow. Requests are serialized, written to the journal (tag
// arcade-vps-admin) before and after they run, never retried, and answered with one line:
// ADMIN_OK <operation> <details> | ADMIN_BLOCKED <operation> <reason> | ADMIN_FAILED <operation> <step>.
// A new operation is a reviewed code change here, in the workflow choice list and in arcade-admin.sudoers.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUN_ID = /^[1-9][0-9]{0,19}$/;
const LEDGER = ["arcade-chips-ledger-dispatch", "arcade-chips-ledger-production-dispatch"];
const IDLE = new Set(["inactive", "failed"]);

const HOST = {
  run(argv, timeout = 30000) {
    const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout });
    return { status: result.status, stdout: (result.stdout || "").trim() };
  },
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  isAlive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
  },
  lockDir: "/run/arcade-vps-admin.lock",
  requester: process.env.SUDO_USER || "root",
};

const show = (host, unit, property) => host.run(["/usr/bin/systemctl", "show", "-P", property, unit]).stdout;

export const OPERATIONS = Object.freeze({
  "ledger-dispatchers-status": (host) => ({
    ok: true,
    details: LEDGER.map((u) => `${u}=${show(host, `${u}.service`, "User")}/${show(host, `${u}.service`, "ActiveState")}`
      + `/timer:${show(host, `${u}.timer`, "ActiveState")}/reload:${show(host, `${u}.service`, "NeedDaemonReload")}`).join(" "),
  }),
  // Stop both timers first so no dispatcher starts, then wait (at most 5 min) until none runs.
  "ledger-dispatchers-pause": (host) => {
    for (const u of LEDGER) {
      if (host.run(["/usr/bin/systemctl", "stop", `${u}.timer`]).status !== 0) return { ok: false, failed: `stop_${u}.timer` };
    }
    for (const u of LEDGER) {
      for (let polls = 0; !IDLE.has(show(host, `${u}.service`, "ActiveState")); polls += 1) {
        if (polls >= 60) return { ok: false, blocked: `${u}.service_still_running` };
        host.sleep(5000);
      }
    }
    return { ok: true, details: "timers_stopped dispatchers_idle" };
  },
  "ledger-dispatchers-resume": (host) => {
    for (const u of LEDGER) {
      if (show(host, `${u}.service`, "NeedDaemonReload") !== "no") return { ok: false, blocked: `${u}_needs_daemon_reload` };
    }
    for (const u of LEDGER) {
      if (host.run(["/usr/bin/systemctl", "start", `${u}.timer`]).status !== 0
        || show(host, `${u}.timer`, "ActiveState") !== "active") return { ok: false, failed: `start_${u}.timer` };
    }
    return { ok: true, details: "timers_active" };
  },
  "systemd-daemon-reload": (host) => (host.run(["/usr/bin/systemctl", "daemon-reload"], 60000).status === 0
    ? { ok: true, details: "reloaded" }
    : { ok: false, failed: "daemon-reload" }),
});

function audit(host, fields) {
  host.run(["/usr/bin/logger", "-t", "arcade-vps-admin", "-p", "auth.notice",
    Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" ")]);
}

// One request at a time; a lock left by a dead process is taken over, a live or unreadable one is never.
function acquireLock(host) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(host.lockDir, { mode: 0o700 });
      fs.writeFileSync(`${host.lockDir}/pid`, `${process.pid}\n`);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(fs.readFileSync(`${host.lockDir}/pid`, { encoding: "utf8", flag: "a+" }).trim());
      if (!Number.isSafeInteger(pid) || pid <= 0 || host.isAlive(pid)) return false;
      fs.rmSync(host.lockDir, { recursive: true, force: true });
    }
  }
  return false;
}

export function runOperation(operation, runId, overrides = {}) {
  const host = { ...HOST, ...overrides };
  const name = /^[a-z0-9-]{1,64}$/.test(String(operation)) ? operation : "invalid";
  const run = RUN_ID.test(String(runId)) ? runId : "invalid";
  if (!Object.hasOwn(OPERATIONS, operation) || run === "invalid") {
    audit(host, { op: name, run, by: host.requester, result: "blocked", reason: "unexpected_arguments" });
    return { ok: false, line: `ADMIN_BLOCKED ${name} unexpected_arguments` };
  }
  if (!acquireLock(host)) {
    audit(host, { op: name, run, by: host.requester, result: "blocked", reason: "busy" });
    return { ok: false, line: `ADMIN_BLOCKED ${name} busy` };
  }
  let result;
  try {
    audit(host, { op: name, run, by: host.requester, phase: "start" });
    try {
      result = OPERATIONS[operation](host);
    } catch {
      result = { ok: false, failed: "exception" };
    }
    const outcome = result.ok ? "ok" : result.blocked ? "blocked" : "failed";
    audit(host, { op: name, run, by: host.requester, result: outcome, detail: result.details || result.blocked || result.failed });
  } finally {
    fs.rmSync(host.lockDir, { recursive: true, force: true });
  }
  if (result.ok) return { ok: true, line: `ADMIN_OK ${name} ${result.details}` };
  return { ok: false, line: result.blocked ? `ADMIN_BLOCKED ${name} ${result.blocked}` : `ADMIN_FAILED ${name} ${result.failed}` };
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMainModule) {
  const args = process.argv.slice(2);
  let result;
  try {
    result = args.length === 2 ? runOperation(args[0], args[1]) : runOperation("invalid", "invalid");
  } catch {
    result = { ok: false, line: "ADMIN_FAILED invalid helper_error" };
  }
  process.stdout.write(`${result.line}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
