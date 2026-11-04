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
  rename: (from, to) => fs.renameSync(from, to),
  // Verified files of the agent account that hold credentials or their recovery copies. They move into a root-only
  // quarantine kept for recovery; copilot cannot read them afterwards. Nothing else in copilot's home is touched.
  quarantine: {
    user: "copilot", home: "/home/copilot", base: "/var/lib/arcade-admin/quarantine", proc: "/proc", rootUid: 0, rootGid: 0,
    files: [
      ".config/netlify/config.json",
      ".config/netlify/pr2-custody-I0a9U7/original-contexts.json",
      ".config/netlify/pr2-empty-deal-47rEGR/original.json",
      ".config/netlify/pr2-parent-env-npz5ZX/before.json",
      ".config/netlify/pr2-redis-parent-nOIRKu/before.json",
      ".config/netlify/pr2-stage-final-flags-119pOR/original.json",
      ".config/netlify/pr2-stage-operational-kV5AtM/chips-before.json",
      ".config/netlify/pr2-stage-operational-kV5AtM/custody.json",
      ".config/netlify/pr2-stage-operational-kV5AtM/deal-candidate.json",
      ".config/arcadeplatform/google-production-1100/netlify-env-before-rollout.json",
    ],
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

const sameFile = (a, b) => a && b && a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeMs === b.mtimeMs && b.nlink === 1;

// Every directory from the home down to the file is a real directory of the agent account (no symlink), and the
// file is its own regular file with no other hard link. Returns the file's lstat or a reason.
function ownedFile(home, rel, uid) {
  let dir = home;
  for (const part of ["", ...path.dirname(rel).split("/").filter((x) => x && x !== ".")]) {
    dir = path.join(dir, part);
    const s = lstatOrNull(dir);
    if (!s || !s.isDirectory() || s.uid !== uid) return "parent_not_owned_directory";
  }
  const s = lstatOrNull(path.join(home, rel));
  if (!s) return "missing";
  if (!s.isFile() || s.uid !== uid || s.nlink !== 1) return "not_owned_single_link_file";
  return s;
}

// True when any process has one of the files as its cwd, root, executable or an open descriptor.
function inUse(procRoot, files) {
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
      if (files.includes(target.replace(/ \(deleted\)$/, ""))) return true;
    }
  }
  return false;
}

function fsyncPath(file) {
  const fd = fs.openSync(file, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// An existing quarantine directory is only verified, never changed; a missing one is created root:root 0700.
function quarantineDir(host, dir, mustBeNew) {
  const q = host.quarantine;
  const safe = (s) => s && s.isDirectory() && s.uid === q.rootUid && s.gid === q.rootGid && (s.mode & 0o7777) === 0o700;
  const existing = lstatOrNull(dir);
  if (existing) return mustBeNew ? "quarantine_run_exists" : safe(existing) ? null : "quarantine_dir_unsafe";
  if (host.run(["/usr/bin/install", "-d", "-o", String(q.rootUid), "-g", String(q.rootGid), "-m", "0700", dir]).status !== 0) return "quarantine_dir_create";
  return safe(lstatOrNull(dir)) ? null : "quarantine_dir_unsafe";
}

// Moves the fixed list of files into quarantine/<runId>/ with rename(2) on the same filesystem (bytes and inode
// kept for recovery). Everything is checked before the first move; each file is re-checked right before and after
// its move, and MANIFEST records the plan and every completed move, so a partial result is visible and is never
// reported as success. A missing file blocks the operation. Nothing is retried.
function quarantineSnapshots(host, runId) {
  const q = host.quarantine;
  const id = host.run(["/usr/bin/id", "-u", q.user]);
  if (id.status !== 0 || !/^[1-9][0-9]{0,9}$/.test(id.stdout)) throw new Unverifiable("owner_uid");
  const uid = Number(id.stdout);
  const files = [];
  for (const [index, rel] of q.files.entries()) {
    const s = ownedFile(q.home, rel, uid);
    if (typeof s === "string") return { ok: false, blocked: `file_${index}_${s}` };
    files.push({ index, rel, src: path.join(q.home, rel), stat: s });
  }
  if (inUse(q.proc, files.map((f) => f.src))) return { ok: false, blocked: "file_in_use" };
  const runDir = path.join(q.base, String(runId));
  for (const [dir, mustBeNew] of [[path.dirname(q.base), false], [q.base, false], [runDir, true]]) {
    const problem = quarantineDir(host, dir, mustBeNew);
    if (problem) return { ok: false, blocked: problem };
  }
  if (files.some((f) => f.stat.dev !== fs.lstatSync(runDir).dev)) return { ok: false, blocked: "cross_device" };

  const manifest = path.join(runDir, "MANIFEST");
  const record = (line) => { fs.appendFileSync(manifest, `${line}\n`, { mode: 0o600 }); fsyncPath(manifest); };
  record(`planned ${files.length} home=${q.home}`);
  for (const f of files) record(`file ${f.index} ${f.rel} -> ${f.index}-${path.basename(f.rel)}`);
  fsyncPath(runDir);
  const partial = (step, moved) => ({ ok: false, failed: `${step} custody=partial moved=${moved}/${files.length} manifest=${manifest}` });
  let moved = 0;
  for (const f of files) {
    const now = ownedFile(q.home, f.rel, uid);
    if (typeof now === "string" || !sameFile(f.stat, now)) return partial(`file_${f.index}_changed`, moved);
    const dest = path.join(runDir, `${f.index}-${path.basename(f.rel)}`);
    try {
      host.rename(f.src, dest);
    } catch {
      return partial(`file_${f.index}_move`, moved);
    }
    if (!sameFile(f.stat, lstatOrNull(dest)) || lstatOrNull(f.src)) return partial(`file_${f.index}_identity`, moved);
    record(`moved ${f.index}`);
    moved += 1;
  }
  for (const dir of new Set([runDir, ...files.map((f) => path.dirname(f.src))])) fsyncPath(dir);
  // A descriptor opened between the check and the move would keep access: custody is then not complete.
  if (inUse(q.proc, files.map((f) => path.join(runDir, `${f.index}-${path.basename(f.rel)}`)))) {
    return { ok: false, failed: `open_after_move custody=moved_but_open moved=${moved}/${files.length} manifest=${manifest}` };
  }
  record(`complete ${moved}`);
  return { ok: true, details: `custody=complete moved=${moved} quarantine=${runDir}` };
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
