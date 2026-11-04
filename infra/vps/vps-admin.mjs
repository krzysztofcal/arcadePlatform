#!/usr/bin/node

// Root helper for owner-approved VPS administration (#1159 root on demand). It runs only operations from the fixed
// catalog below, each with fixed argv and no shell: "<operation> <runId>", where runId is the numeric GitHub run id
// of the approved "VPS Admin Operation" workflow. Requests are serialized with flock, recorded in the journal (tag
// arcade-vps-admin) before and after they run, never retried, and answered with one line:
// ADMIN_OK <operation> <details> | ADMIN_BLOCKED <operation> <reason> | ADMIN_FAILED <operation> <step>.
// Nothing runs without a successful start entry, and a missing end entry is never reported as success.
// A new operation is a reviewed code change here, in the workflow choice list and in arcade-admin.sudoers.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUN_ID = /^[1-9][0-9]{0,19}$/;
const LEDGER = ["arcade-chips-ledger-dispatch", "arcade-chips-ledger-production-dispatch"];
const IDLE = new Set(["inactive", "failed"]);
const UNITS = LEDGER.flatMap((u) => [`${u}.service`, `${u}.timer`]);
const PAUSE_DEADLINE_MS = 300000;
// Only values systemd documents for these properties are accepted; anything else is unverifiable.
const EXPECTED = {
  User: /^[a-z_][a-z0-9_-]{0,31}$/,
  ActiveState: /^(active|reloading|inactive|failed|activating|deactivating)$/,
  NeedDaemonReload: /^(yes|no)$/,
};

const HOST = {
  run(argv, timeout = 30000) {
    const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout });
    return { status: result.status, stdout: (result.stdout || "").trim() };
  },
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now: () => Date.now(),
  lockFile: "/run/arcade-vps-admin.lock",
  requester: process.env.SUDO_USER || "root",
  // The agent account's local operator snapshots (Netlify CLI state, exported configuration) move as whole
  // directories into a root-only quarantine kept for recovery; the agent account cannot read them afterwards.
  quarantine: {
    user: "copilot", home: "/home/copilot", sources: [".config/netlify", ".config/arcadeplatform"],
    base: "/var/lib/arcade-admin/quarantine", proc: "/proc", rootUid: 0, rootGid: 0, maxEntries: 200000,
  },
};

class Unverifiable extends Error {}

function read(host, unit, property) {
  const result = host.run(["/usr/bin/systemctl", "show", "-P", property, unit]);
  if (result.status !== 0 || !EXPECTED[property].test(result.stdout)) throw new Unverifiable(`${unit}_${property}`);
  return result.stdout;
}

function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Unverifiable("stat");
  }
}

// Every entry must belong to the agent account; a regular file with another hard link would stay readable.
function treeProblem(root, uid, maxEntries) {
  const stack = [root];
  let entries = 0;
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const entry = path.join(dir, name);
      const s = fs.lstatSync(entry);
      if (++entries > maxEntries) return "tree_too_large";
      if (s.uid !== uid) return "foreign_owned_entry";
      if (s.isFile() && s.nlink !== 1) return "hardlinked_file";
      if (s.isDirectory()) stack.push(entry);
    }
  }
  return null;
}

// A process whose cwd, root, executable or open file is inside a source would keep access after the move.
function sourcesInUse(procRoot, sources) {
  const inside = (target) => sources.some((src) => target === src || target.startsWith(`${src}/`));
  for (const pid of fs.readdirSync(procRoot).filter((name) => /^[0-9]+$/.test(name))) {
    const links = ["cwd", "root", "exe"].map((link) => path.join(procRoot, pid, link));
    try {
      links.push(...fs.readdirSync(path.join(procRoot, pid, "fd")).map((fd) => path.join(procRoot, pid, "fd", fd)));
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") continue; // the process ended meanwhile
      throw new Unverifiable("proc");
    }
    for (const link of links) {
      let target;
      try {
        target = fs.readlinkSync(link);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ESRCH") continue;
        throw new Unverifiable("proc");
      }
      if (inside(target.replace(/ \(deleted\)$/, ""))) return true;
    }
  }
  return false;
}

// Checks everything before moving anything; rename(2) on the same filesystem keeps every byte and inode. An absent
// source counts as already moved, so the operation can be requested again after a partial result.
function quarantineSnapshots(host, runId) {
  const q = host.quarantine;
  const id = host.run(["/usr/bin/id", "-u", q.user]);
  if (id.status !== 0 || !/^[1-9][0-9]{0,9}$/.test(id.stdout)) throw new Unverifiable("owner_uid");
  const uid = Number(id.stdout);
  for (const dir of [q.home, path.join(q.home, ".config")]) {
    const s = lstatOrNull(dir);
    if (!s || !s.isDirectory() || s.uid !== uid) return { ok: false, blocked: "home_not_owned_directory" };
  }
  const present = [];
  for (const [index, rel] of q.sources.entries()) {
    const src = path.join(q.home, rel);
    const s = lstatOrNull(src);
    if (!s) continue;
    if (!s.isDirectory() || s.uid !== uid) return { ok: false, blocked: `source_${index}_not_owned_directory` };
    let problem;
    try {
      problem = treeProblem(src, uid, q.maxEntries);
    } catch {
      throw new Unverifiable(`source_${index}_tree`);
    }
    if (problem) return { ok: false, blocked: `source_${index}_${problem}` };
    present.push({ src, dev: s.dev, ino: s.ino });
  }
  const absent = q.sources.length - present.length;
  if (!present.length) return { ok: true, details: `moved=0 absent=${absent}` };
  if (sourcesInUse(q.proc, present.map((p) => p.src))) return { ok: false, blocked: "source_in_use" };

  const runDir = path.join(q.base, String(runId));
  if (lstatOrNull(runDir)) return { ok: false, blocked: "quarantine_run_exists" };
  for (const dir of [path.dirname(q.base), q.base, runDir]) {
    if (host.run(["/usr/bin/install", "-d", "-o", String(q.rootUid), "-g", String(q.rootGid), "-m", "0700", dir]).status !== 0) {
      return { ok: false, failed: "quarantine_dir" };
    }
    const s = lstatOrNull(dir);
    if (!s || !s.isDirectory() || s.uid !== q.rootUid || s.gid !== q.rootGid || (s.mode & 0o7777) !== 0o700) {
      return { ok: false, failed: "quarantine_dir_unsafe" };
    }
  }
  if (present.some((p) => p.dev !== fs.lstatSync(runDir).dev)) return { ok: false, blocked: "cross_device" };

  let moved = 0;
  for (const p of present) {
    const dest = path.join(runDir, path.basename(p.src));
    try {
      fs.renameSync(p.src, dest);
    } catch {
      return { ok: false, failed: `move_after_${moved}` };
    }
    const d = lstatOrNull(dest);
    if (!d || d.dev !== p.dev || d.ino !== p.ino) return { ok: false, failed: `moved_identity_after_${moved}` };
    moved += 1;
  }
  return { ok: true, details: `moved=${moved} absent=${absent} quarantine=${runDir}` };
}

export const OPERATIONS = Object.freeze({
  "ledger-dispatchers-status": (host) => ({
    ok: true,
    details: LEDGER.map((u) => `${u}=${read(host, `${u}.service`, "User")}/${read(host, `${u}.service`, "ActiveState")}`
      + `/timer:${read(host, `${u}.timer`, "ActiveState")}/reload:${read(host, `${u}.service`, "NeedDaemonReload")}`).join(" "),
  }),
  // Stop both timers first so no dispatcher starts, then wait until none runs. One 5-minute deadline covers both
  // dispatchers and every systemctl call. On timeout the timers stay stopped: the owner decides what comes next.
  "ledger-dispatchers-pause": (host) => {
    const deadline = host.now() + PAUSE_DEADLINE_MS;
    for (const u of LEDGER) {
      if (host.run(["/usr/bin/systemctl", "stop", `${u}.timer`]).status !== 0) return { ok: false, failed: `stop_${u}.timer` };
    }
    for (;;) {
      const states = LEDGER.map((u) => `${u}.service=${read(host, `${u}.service`, "ActiveState")}`);
      // The deadline is checked first: a result read after it is never a success.
      const left = deadline - host.now();
      if (left <= 0) return { ok: false, blocked: `timeout_timers_left_stopped ${states.join(" ")}` };
      if (states.every((state) => IDLE.has(state.split("=")[1]))) return { ok: true, details: "timers_stopped dispatchers_idle" };
      host.sleep(Math.min(5000, left));
    }
  },
  "ledger-dispatchers-resume": (host) => {
    for (const unit of UNITS) {
      if (read(host, unit, "NeedDaemonReload") !== "no") return { ok: false, blocked: `${unit}_needs_daemon_reload` };
    }
    for (const u of LEDGER) {
      if (host.run(["/usr/bin/systemctl", "start", `${u}.timer`]).status !== 0
        || read(host, `${u}.timer`, "ActiveState") !== "active") return { ok: false, failed: `start_${u}.timer` };
    }
    return { ok: true, details: "timers_active" };
  },
  "systemd-daemon-reload": (host) => (host.run(["/usr/bin/systemctl", "daemon-reload"], 60000).status === 0
    ? { ok: true, details: "reloaded" }
    : { ok: false, failed: "daemon-reload" }),
  "copilot-secret-snapshots-quarantine": quarantineSnapshots,
});

function audit(host, fields) {
  return host.run(["/usr/bin/logger", "-t", "arcade-vps-admin", "-p", "auth.notice",
    Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(" ")]).status === 0;
}

// flock(1) locks the open file description it inherits as fd 3, which this process keeps open: the lock lasts
// until the descriptor is closed and the kernel releases it if the process dies. There is no PID file to clean up.
function acquireLock(host) {
  const fd = fs.openSync(host.lockFile, "a", 0o600);
  const locked = spawnSync("/usr/bin/flock", ["-n", "3"], { stdio: ["ignore", "ignore", "ignore", fd] }).status === 0;
  if (locked) return fd;
  fs.closeSync(fd);
  return null;
}

export function runOperation(operation, runId, overrides = {}) {
  const host = { ...HOST, ...overrides };
  const name = /^[a-z0-9-]{1,64}$/.test(String(operation)) ? operation : "invalid";
  const run = RUN_ID.test(String(runId)) ? runId : "invalid";
  const entry = { op: name, run, by: host.requester };
  if (!Object.hasOwn(OPERATIONS, operation) || run === "invalid") {
    audit(host, { ...entry, result: "blocked", reason: "unexpected_arguments" });
    return { ok: false, line: `ADMIN_BLOCKED ${name} unexpected_arguments` };
  }
  const fd = acquireLock(host);
  if (fd === null) {
    audit(host, { ...entry, result: "blocked", reason: "busy" });
    return { ok: false, line: `ADMIN_BLOCKED ${name} busy` };
  }
  try {
    if (!audit(host, { ...entry, phase: "start" })) return { ok: false, line: `ADMIN_BLOCKED ${name} audit_unavailable` };
    let result;
    try {
      result = OPERATIONS[operation](host, run);
    } catch (error) {
      result = error instanceof Unverifiable ? { ok: false, blocked: `unverifiable_${error.message}` } : { ok: false, failed: "exception" };
    }
    const outcome = result.ok ? "ok" : result.blocked ? "blocked" : "failed";
    const recorded = audit(host, { ...entry, result: outcome, detail: result.details || result.blocked || result.failed });
    // The operation is not repeated; an unrecorded outcome is reported as a failure of the audit itself.
    if (!recorded) return { ok: false, line: `ADMIN_FAILED ${name} audit_end_after_${outcome}` };
    if (result.ok) return { ok: true, line: `ADMIN_OK ${name} ${result.details}` };
    return { ok: false, line: result.blocked ? `ADMIN_BLOCKED ${name} ${result.blocked}` : `ADMIN_FAILED ${name} ${result.failed}` };
  } finally {
    fs.closeSync(fd);
  }
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
