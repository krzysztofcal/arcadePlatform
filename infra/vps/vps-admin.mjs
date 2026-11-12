#!/usr/bin/node

// Root helper for owner-approved VPS administration (#1159 root on demand). It runs only operations from the fixed
// catalog below, each with fixed argv and no shell: "<operation> <runId>", where runId is the numeric GitHub run id
// of the approved "VPS Admin Operation" workflow. Requests are serialized with flock, recorded in the journal (tag
// arcade-vps-admin) before and after they run, never retried, and answered with one line:
// ADMIN_OK <operation> <details> | ADMIN_BLOCKED <operation> <reason> | ADMIN_FAILED <operation> <step>.
// Nothing runs without a successful start entry, and a missing end entry is never reported as success.
// A new operation is a reviewed code change here, in the workflow choice list and in arcade-admin.sudoers.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUN_ID = /^[1-9][0-9]{0,19}$/;
const LEDGER = ["arcade-chips-ledger-dispatch", "arcade-chips-ledger-production-dispatch"];
const IDLE = new Set(["inactive", "failed"]);
const UNITS = LEDGER.flatMap((u) => [`${u}.service`, `${u}.timer`]);
const PAUSE_DEADLINE_MS = 300000;
const REPO = "krzysztofcal/arcadePlatform";
const COMMIT = /^[0-9a-f]{40}$/;
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
  // The reviewed Production dispatcher script; it is installed only from the exact main commit of the approved run.
  dispatcher: {
    source: "infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh",
    dest: "/usr/local/bin/arcade-chips-ledger-production-dispatch.sh",
    uid: 0, gid: 0,
  },
  // The reviewed Production WS restart gate; installed only from the exact main commit of the approved run.
  restartGate: {
    source: "infra/vps/ws-restart-gate.mjs",
    dest: "/usr/local/sbin/arcade-ws-restart-gate",
    uid: 0, gid: 0,
  },
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

const O_DIR = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
const at = (fd, name) => `/proc/self/fd/${fd}/${name}`;
const sameFile = (a, b) => a && b && a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeMs === b.mtimeMs && b.nlink === 1;
// st_dev as "major:minor" in hex, the form /proc/<pid>/maps uses.
const devText = (dev) => {
  const d = BigInt(dev);
  const major = ((d >> 8n) & 0xfffn) | ((d >> 32n) & ~0xfffn);
  const minor = (d & 0xffn) | ((d >> 12n) & ~0xffn);
  return `${major.toString(16).padStart(2, "0")}:${minor.toString(16).padStart(2, "0")}`;
};

// Opens the home and every parent directory of rel with O_NOFOLLOW, each relative to the previous descriptor,
// so a later symlink or rename in copilot's tree cannot redirect the move. Every directory belongs to the agent
// account. The descriptors are pushed to fds (closed by the caller); returns the parent descriptor or a reason.
function pinParent(home, rel, uid, fds) {
  let fd;
  for (const part of [home, ...path.dirname(rel).split("/").filter((x) => x && x !== ".")]) {
    try {
      fd = fs.openSync(fd === undefined ? part : at(fd, part), O_DIR);
    } catch (error) {
      if (["ENOENT", "ELOOP", "ENOTDIR"].includes(error.code)) return "parent_not_owned_directory";
      throw new Unverifiable("open_parent");
    }
    fds.push(fd);
    const s = fs.fstatSync(fd);
    if (!s.isDirectory() || s.uid !== uid) return "parent_not_owned_directory";
  }
  return fd;
}

function ownedFile(parentFd, name, uid) {
  const s = lstatOrNull(at(parentFd, name));
  if (!s) return "missing";
  if (!s.isFile() || s.uid !== uid || s.nlink !== 1) return "not_owned_single_link_file";
  return s;
}

// True when any process refers to one of the files (by device and inode) as cwd, root, executable, open
// descriptor or memory mapping.
function inUse(procRoot, stats) {
  const hit = (s) => stats.some((f) => f.dev === s.dev && f.ino === s.ino);
  const mapped = new Set(stats.map((f) => `${devText(f.dev)} ${f.ino}`));
  const gone = (error) => ["ENOENT", "ESRCH"].includes(error.code);
  for (const pid of fs.readdirSync(procRoot).filter((name) => /^[0-9]+$/.test(name))) {
    const dir = path.join(procRoot, pid);
    let links;
    let maps;
    try {
      links = ["cwd", "root", "exe", ...fs.readdirSync(path.join(dir, "fd")).map((fd) => `fd/${fd}`)];
      maps = fs.readFileSync(path.join(dir, "maps"), "utf8");
    } catch (error) {
      if (gone(error)) continue; // the process ended meanwhile, or (fixture) has no mappings
      throw new Unverifiable("proc");
    }
    for (const line of maps.split("\n")) {
      const f = line.trim().split(/\s+/);
      if (f.length >= 6 && mapped.has(`${f[3]} ${f[4]}`)) return true;
    }
    for (const link of links) {
      let s;
      try {
        s = fs.statSync(path.join(dir, link));
      } catch (error) {
        if (gone(error)) continue;
        throw new Unverifiable("proc");
      }
      if (hit(s)) return true;
    }
  }
  return false;
}

// An existing quarantine directory is only verified, never changed; a missing one is created root:root 0700 and
// its parent entry is made durable.
function quarantineDir(host, dir, mustBeNew) {
  const q = host.quarantine;
  const safe = (s) => s && s.isDirectory() && s.uid === q.rootUid && s.gid === q.rootGid && (s.mode & 0o7777) === 0o700;
  const existing = lstatOrNull(dir);
  if (existing) return mustBeNew ? "quarantine_run_exists" : safe(existing) ? null : "quarantine_dir_unsafe";
  if (host.run(["/usr/bin/install", "-d", "-o", String(q.rootUid), "-g", String(q.rootGid), "-m", "0700", dir]).status !== 0) return "quarantine_dir_create";
  if (!safe(lstatOrNull(dir))) return "quarantine_dir_unsafe";
  fsyncFd(fs.openSync(path.dirname(dir), O_DIR), true);
  return null;
}

function fsyncFd(fd, close = false) {
  try { fs.fsyncSync(fd); } finally { if (close) fs.closeSync(fd); }
}

// Moves the fixed list of files into quarantine/<runId>/ with rename(2) through pinned directory descriptors on the
// same filesystem (bytes and inode kept for recovery). Everything is checked before the first move. MANIFEST
// records each file's identity, then "moving <i>" before and "moved <i>" after its rename (both directories
// fsynced in between), and "complete <n>" only for full custody. Any other end is ADMIN_FAILED with custody
// partial or uncertain. A missing file blocks. Nothing is retried.
function quarantineSnapshots(host, runId) {
  const q = host.quarantine;
  const id = host.run(["/usr/bin/id", "-u", q.user]);
  if (id.status !== 0 || !/^[1-9][0-9]{0,9}$/.test(id.stdout)) throw new Unverifiable("owner_uid");
  const uid = Number(id.stdout);
  const fds = [];
  try {
    const files = [];
    for (const [index, rel] of q.files.entries()) {
      const parent = pinParent(q.home, rel, uid, fds);
      if (typeof parent === "string") return { ok: false, blocked: `file_${index}_${parent}` };
      const name = path.basename(rel);
      const s = ownedFile(parent, name, uid);
      if (typeof s === "string") return { ok: false, blocked: `file_${index}_${s}` };
      files.push({ index, rel, name, parent, dest: `${index}-${name}`, stat: s });
    }
    if (inUse(q.proc, files.map((f) => f.stat))) return { ok: false, blocked: "file_in_use" };
    const runDir = path.join(q.base, String(runId));
    for (const [dir, mustBeNew] of [[path.dirname(q.base), false], [q.base, false], [runDir, true]]) {
      const problem = quarantineDir(host, dir, mustBeNew);
      if (problem) return { ok: false, blocked: problem };
    }
    const run = fs.openSync(runDir, O_DIR);
    fds.push(run);
    if (files.some((f) => f.stat.dev !== fs.fstatSync(run).dev)) return { ok: false, blocked: "cross_device" };

    const manifest = path.join(runDir, "MANIFEST");
    let moved = 0;
    const stop = (step, custody) => ({ ok: false, failed: `${step} custody=${custody} moved=${moved}/${files.length} manifest=${manifest}` });
    const record = (line) => {
      try {
        fs.appendFileSync(manifest, `${line}\n`, { mode: 0o600 });
        fsyncFd(fs.openSync(manifest, "r"), true);
        return true;
      } catch {
        return false;
      }
    };
    const planned = [`planned ${files.length} home=${q.home}`,
      ...files.map((f) => `file ${f.index} ${f.rel} -> ${f.dest} dev=${f.stat.dev} ino=${f.stat.ino} size=${f.stat.size}`)];
    if (!planned.every(record)) return stop("manifest_write", "none");
    fsyncFd(run);
    // From the first move on, every error is reported with the custody state, never as a bare exception.
    try {
      for (const f of files) {
        if (!sameFile(f.stat, lstatOrNull(at(f.parent, f.name)))) return stop(`file_${f.index}_changed`, moved ? "partial" : "none");
        if (!record(`moving ${f.index}`)) return stop("manifest_write", moved ? "partial" : "none");
        try {
          host.rename(at(f.parent, f.name), at(run, f.dest));
        } catch {
          return stop(`file_${f.index}_move`, "uncertain");
        }
        fsyncFd(f.parent);
        fsyncFd(run);
        // The file's own data is made durable too, through the pinned run directory.
        const fd = fs.openSync(at(run, f.dest), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        let same;
        try {
          same = sameFile(f.stat, fs.fstatSync(fd));
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        if (!same || lstatOrNull(at(f.parent, f.name))) return stop(`file_${f.index}_identity`, "uncertain");
        if (!record(`moved ${f.index}`)) return stop("manifest_write", "uncertain");
        moved += 1;
      }
      // A reference taken between the check and the move would keep access: custody is then not complete.
      if (inUse(q.proc, files.map((f) => f.stat))) return stop("open_after_move", "moved_but_open");
    } catch {
      return stop("error_during_move", "uncertain");
    }
    if (!record(`complete ${moved}`)) return stop("manifest_write", "uncertain");
    return { ok: true, details: `custody=complete moved=${moved} quarantine=${runDir}` };
  } finally {
    for (const fd of fds) fs.closeSync(fd);
  }
}

const curl = (host, url, extra = []) => host.run(["/usr/bin/curl", "-fsS", "--proto", "=https", "--max-time", "20", ...extra, url]);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const gitBlob = (bytes) => crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

// Installs the Production dispatcher script from GitHub at the commit of this run. The run must be the in-progress
// VPS Admin workflow_dispatch on main and main must still point at that commit, so only reviewed main code is
// installed. The downloaded bytes must match the file's git object id at that commit, read separately from the
// contents API, before they replace anything. Both timers are paused first and stay stopped: resuming is the
// separate ledger-dispatchers-resume. The result (and so the journal) records the commit and both SHA-256 values.
// Nothing is retried.
function installProductionDispatcher(host, runId) {
  const d = host.dispatcher;
  const api = (route, accept) => curl(host, `https://api.github.com/repos/${REPO}/${route}`, ["-H", `Accept: ${accept}`]);
  const response = api(`actions/runs/${runId}`, "application/vnd.github+json");
  let run;
  try {
    run = response.status === 0 ? JSON.parse(response.stdout) : null;
  } catch {
    run = null;
  }
  if (!run) throw new Unverifiable("github_run");
  if (String(run.id) !== String(runId) || run.path !== ".github/workflows/vps-admin-operation.yml" || run.event !== "workflow_dispatch"
    || run.head_branch !== "main" || run.status !== "in_progress" || !COMMIT.test(String(run.head_sha))) return { ok: false, blocked: "run_not_main_vps_admin_dispatch" };
  const main = api("commits/main", "application/vnd.github.sha");
  if (main.status !== 0 || !COMMIT.test(main.stdout)) throw new Unverifiable("github_main");
  if (main.stdout !== run.head_sha) return { ok: false, blocked: "main_advanced" };
  const entry = api(`contents/${d.source}?ref=${run.head_sha}`, "application/vnd.github.object+json");
  let blob;
  try {
    blob = entry.status === 0 ? JSON.parse(entry.stdout) : null;
  } catch {
    blob = null;
  }
  if (!blob || blob.type !== "file" || blob.path !== d.source || !/^[0-9a-f]{40}$/.test(String(blob.sha))) throw new Unverifiable("github_contents");
  const current = lstatOrNull(d.dest);
  if (current && !current.isFile()) return { ok: false, blocked: "dest_not_regular_file" };

  const paused = OPERATIONS["ledger-dispatchers-pause"](host);
  if (!paused.ok) return paused;
  const tmp = path.join(path.dirname(d.dest), `.${path.basename(d.dest)}.${runId}`);
  let ids = null;
  try {
    fs.rmSync(tmp, { force: true });
    if (curl(host, `https://raw.githubusercontent.com/${REPO}/${run.head_sha}/${d.source}`, ["-o", tmp]).status !== 0) {
      return { ok: false, failed: "download timers_left_stopped" };
    }
    const bytes = fs.readFileSync(tmp);
    if (bytes.length > 65536 || !bytes.toString("utf8", 0, 20).startsWith("#!/usr/bin/env bash\n")) {
      return { ok: false, blocked: "unexpected_script timers_left_stopped" };
    }
    if (gitBlob(bytes) !== blob.sha) return { ok: false, blocked: "content_mismatch timers_left_stopped" };
    ids = { sha: sha256(bytes), text: `commit=${run.head_sha} sha256=${sha256(bytes)} previous=${current ? sha256(fs.readFileSync(d.dest)) : "none"}` };
    const reload = read(host, "arcade-chips-ledger-production-dispatch.service", "NeedDaemonReload");
    fs.chownSync(tmp, d.uid, d.gid);
    fs.chmodSync(tmp, 0o755);
    fsyncFd(fs.openSync(tmp, "r"), true);
    host.rename(tmp, d.dest);
    fsyncFd(fs.openSync(path.dirname(d.dest), O_DIR), true);
    return { ok: true, details: `installed ${ids.text} timers_stopped reload:${reload}` };
  } catch {
    // The journal must say whether the script was already replaced: the destination is read back, not assumed.
    let replaced = "unknown";
    try {
      replaced = ids && sha256(fs.readFileSync(d.dest)) === ids.sha ? "yes" : "no";
    } catch {
      // stays unknown
    }
    return { ok: false, failed: `install replaced=${replaced}${ids ? ` ${ids.text}` : ""} timers_left_stopped` };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Installs the Production WS restart gate from GitHub at the commit of this run. Verifies the run is an
// in-progress VPS Admin workflow_dispatch on main, checks commit and blob SHA, validates syntax with node --check
// on a .mjs temporary file, verifies required modes statically, replaces atomically, and runs check.
// Accepts safe (exit 0) or blocked (exit 1), but refuses gate_error or unexpected exits. In case of verification
// failure, attempts atomic recovery from previous bytes. Never restarts ws-server.service.
function installWsRestartGate(host, runId) {
  const g = host.restartGate;
  const api = (route, accept) => curl(host, `https://api.github.com/repos/${REPO}/${route}`, ["-H", `Accept: ${accept}`]);
  const response = api(`actions/runs/${runId}`, "application/vnd.github+json");
  let run;
  try {
    run = response.status === 0 ? JSON.parse(response.stdout) : null;
  } catch {
    run = null;
  }
  if (!run) throw new Unverifiable("github_run");
  if (String(run.id) !== String(runId) || run.path !== ".github/workflows/vps-admin-operation.yml" || run.event !== "workflow_dispatch"
    || run.head_branch !== "main" || run.status !== "in_progress" || !COMMIT.test(String(run.head_sha))) return { ok: false, blocked: "run_not_main_vps_admin_dispatch" };
  const main = api("commits/main", "application/vnd.github.sha");
  if (main.status !== 0 || !COMMIT.test(main.stdout)) throw new Unverifiable("github_main");
  if (main.stdout !== run.head_sha) return { ok: false, blocked: "main_advanced" };
  const entry = api(`contents/${g.source}?ref=${run.head_sha}`, "application/vnd.github.object+json");
  let blob;
  try {
    blob = entry.status === 0 ? JSON.parse(entry.stdout) : null;
  } catch {
    blob = null;
  }
  if (!blob || blob.type !== "file" || blob.path !== g.source || !/^[0-9a-f]{40}$/.test(String(blob.sha))) throw new Unverifiable("github_contents");
  const current = lstatOrNull(g.dest);
  if (current && !current.isFile()) return { ok: false, blocked: "dest_not_regular_file" };

  const previousBytes = current ? fs.readFileSync(g.dest) : null;
  const previousSha = previousBytes ? sha256(previousBytes) : "none";
  // The temporary file must carry .mjs so node --check parses it as an ES module without ERR_UNKNOWN_FILE_EXTENSION.
  const tmp = path.join(path.dirname(g.dest), `.${path.basename(g.dest)}.${runId}.mjs`);
  let ids = null;
  try {
    fs.rmSync(tmp, { force: true });
    if (curl(host, `https://raw.githubusercontent.com/${REPO}/${run.head_sha}/${g.source}`, ["-o", tmp]).status !== 0) {
      return { ok: false, failed: "download" };
    }
    const bytes = fs.readFileSync(tmp);
    if (bytes.length > 65536 || !bytes.toString("utf8", 0, 16).startsWith("#!/usr/bin/node\n")) {
      return { ok: false, blocked: "unexpected_script" };
    }
    if (gitBlob(bytes) !== blob.sha) return { ok: false, blocked: "content_mismatch" };

    const syntax = host.run(["/usr/bin/node", "--check", tmp], 10000);
    if (syntax.status !== 0) return { ok: false, blocked: "syntax_error" };
    const src = bytes.toString("utf8");
    const requiredModes = ["check", "restart", "prepare", "switching", "resume", "abort"];
    if (requiredModes.some((m) => !src.includes(`"${m}"`))) {
      return { ok: false, blocked: "missing_modes" };
    }

    ids = { sha: sha256(bytes), text: `commit=${run.head_sha} sha256=${sha256(bytes)} previous=${previousSha}` };
    fs.chownSync(tmp, g.uid, g.gid);
    fs.chmodSync(tmp, 0o755);
    fsyncFd(fs.openSync(tmp, "r"), true);
    host.rename(tmp, g.dest);
    fsyncFd(fs.openSync(path.dirname(g.dest), O_DIR), true);

    const check = host.run([g.dest, "check"], 15000);
    const stdout = (check.stdout || "").trim();
    let gateDecision = null;
    if (check.status === 0 && stdout.startsWith("RESTART_SAFE")) {
      gateDecision = "safe";
    } else if (check.status === 1 && stdout.startsWith("RESTART_BLOCKED") && stdout !== "RESTART_BLOCKED gate_error") {
      gateDecision = "blocked";
    }

    if (!gateDecision) {
      let recovery = "none";
      if (previousBytes) {
        try {
          fs.writeFileSync(tmp, previousBytes);
          fs.chownSync(tmp, g.uid, g.gid);
          fs.chmodSync(tmp, 0o755);
          fsyncFd(fs.openSync(tmp, "r"), true);
          host.rename(tmp, g.dest);
          fsyncFd(fs.openSync(path.dirname(g.dest), O_DIR), true);
          const restored = lstatOrNull(g.dest);
          const restoredOk = restored
            && restored.isFile()
            && restored.uid === g.uid
            && restored.gid === g.gid
            && (restored.mode & 0o7777) === 0o755
            && sha256(fs.readFileSync(g.dest)) === previousSha;
          recovery = restoredOk ? "restored_previous" : "restore_failed";
        } catch {
          recovery = "restore_failed";
        }
      }
      const failReason = (stdout === "RESTART_BLOCKED gate_error") ? "gate_error" : `status_${check.status}`;
      return { ok: false, failed: `verification_failed reason:${failReason} recovery:${recovery}` };
    }

    return { ok: true, details: `installed ${ids.text} gate:${gateDecision}` };
  } catch {
    let replaced = "unknown";
    try {
      const destBytes = fs.readFileSync(g.dest);
      const destSha = sha256(destBytes);
      if (ids && destSha === ids.sha) replaced = "yes";
      else if (previousBytes && destSha === previousSha) replaced = "no";
      else replaced = "different";
    } catch {
      // stays unknown
    }
    return { ok: false, failed: `install replaced=${replaced}${ids ? ` ${ids.text}` : ""}` };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// #1240 one-time public npm tarball cache only. These SHA-512/size pairs were independently
// checked against https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/<version>.
// No metadata/index, installation, session, test directory or caller-selected path is eligible.
const NPM_CACHE_1240 = Object.freeze([
  { version: "2.1.318", size: 157335063, digest: "197fbb0949e0d91e5fed2b00db0d0b697947d9feb67d10850ff6764947b1a1e1f707429fba5290b790ed63d35e0f6629dd5101cfafe4ff15926c63d48ba355d8" },
  { version: "2.1.319", size: 158448451, digest: "14ee12776dc13b554240f8897b9bc6ddb367995e7e6224dabbba3596a2b716be55944e132dd2a2c98a70411c045cef75904da5d76129da2ec9d7d4fc31dda839" },
  { version: "2.1.322", size: 159262440, digest: "d03a1a3405cb58261820669c85604291352c4bc74e3a0be4e11d9f14a76b2de8cef579514f069650c0fd38d7439afd1cb1da70c63e2a2d437acd631a1b64b3ea" },
]);

function verifyNpmBlob(host, parent, name, blob, uid, rootDevice, deadline) {
  let fd;
  try { fd = fs.openSync(at(parent, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch { throw new Unverifiable("npm_blob_open"); }
  try {
    const s = fs.fstatSync(fd);
    const age = host.now() - s.mtimeMs;
    if (!s.isFile() || s.uid !== uid || s.nlink !== 1 || s.dev !== rootDevice || s.size !== blob.size
      || age < 48 * 3600000 || age > 365 * 86400000 || host.now() >= deadline) throw new Unverifiable("npm_blob_identity_or_age");
    const hash = crypto.createHash("sha512");
    const buffer = Buffer.alloc(1024 * 1024);
    for (let offset = 0; offset < blob.size;) {
      if (host.now() >= deadline) throw new Unverifiable("npm_blob_timeout");
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, blob.size - offset), offset);
      if (!count) throw new Unverifiable("npm_blob_short_read");
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
    if (hash.digest("hex") !== blob.digest || !sameFile(s, fs.fstatSync(fd))
      || !sameFile(s, lstatOrNull(at(parent, name)))) throw new Unverifiable("npm_blob_digest_or_change");
    return s;
  } finally { fs.closeSync(fd); }
}

function npmCache1240(host, runId, apply) {
  // Overrides exist only for the imported fundamental fixtures, never the two-argument CLI.
  const spec = host.npmCache1240 || { blobs: NPM_CACHE_1240, base: "/var/lib/arcade-admin/npm-cache-1240", rootDevice: fs.statSync("/").dev };
  const q = { ...host.quarantine, base: spec.base, files: spec.blobs.map((b) =>
    `.npm/_cacache/content-v2/sha512/${b.digest.slice(0, 2)}/${b.digest.slice(2, 4)}/${b.digest.slice(4)}`) };
  const id = host.run(["/usr/bin/id", "-u", q.user]);
  if (id.status !== 0 || !/^[1-9][0-9]{0,9}$/.test(id.stdout)) throw new Unverifiable("owner_uid");
  const uid = Number(id.stdout);
  const deadline = host.now() + 120000;
  const stats = [];
  const fds = [];
  try {
    if (spec.blobs.length !== 3 || spec.blobs.some((b) => !/^[0-9a-f]{128}$/.test(b.digest)
      || !Number.isSafeInteger(b.size) || b.size < 1) || spec.blobs.reduce((n, b) => n + b.size, 0) > 512 * 1024 * 1024) throw new Unverifiable("npm_manifest");
    for (const [i, rel] of q.files.entries()) {
      const parent = pinParent(q.home, rel, uid, fds);
      if (typeof parent === "string") throw new Unverifiable(`npm_${parent}`);
      stats.push(verifyNpmBlob(host, parent, path.basename(rel), spec.blobs[i], uid, spec.rootDevice, deadline));
    }
  } finally { for (const fd of fds) fs.closeSync(fd); }
  if (inUse(q.proc, stats)) return { ok: false, blocked: "npm_blob_in_use" };
  if (host.now() >= deadline) throw new Unverifiable("npm_blob_timeout");
  const allocated = stats.reduce((sum, s) => sum + s.blocks * 512, 0);
  if (!apply) return { ok: true, details: `dry_run=yes files=3 allocated_bytes=${allocated} deleted=0 execution_rechecks=required` };

  // Reuse the existing descriptor-pinned, all-target preflight, same-filesystem rename and
  // durable custody manifest. Never unlink from a copilot-writable directory: a pathname
  // could be exchanged after its last stat. Failed/partial custody never reaches deletion.
  const custody = quarantineSnapshots({ ...host, quarantine: q }, runId);
  if (!custody.ok) return custody;
  const runDir = path.join(q.base, String(runId));
  let deleted = 0, deletedBytes = 0, run, manifest;
  const failed = (step) => ({ ok: false, failed: `npm_${step} custody=protected deleted=${deleted}/3 deleted_allocated_bytes=${deletedBytes} inspect=${runDir}/MANIFEST no_retry=yes` });
  try {
    run = fs.openSync(runDir, O_DIR);
    const rs = fs.fstatSync(run);
    if (rs.uid !== q.rootUid || rs.gid !== q.rootGid || (rs.mode & 0o7777) !== 0o700) return failed("custody_directory");
    const names = q.files.map((rel, i) => `${i}-${path.basename(rel)}`);
    for (const [i, name] of names.entries()) {
      const s = verifyNpmBlob(host, run, name, spec.blobs[i], uid, spec.rootDevice, deadline);
      if (!sameFile(stats[i], s)) return failed("custody_identity");
    }
    if (inUse(q.proc, stats)) return failed("custody_in_use");
    manifest = fs.openSync(at(run, "MANIFEST"), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const ms = fs.fstatSync(manifest);
    if (!ms.isFile() || ms.uid !== q.rootUid || ms.gid !== q.rootGid || ms.nlink !== 1 || (ms.mode & 0o7777) !== 0o600) return failed("manifest_identity");
    const record = (line) => { fs.appendFileSync(manifest, `${line}\n`); fs.fsyncSync(manifest); };
    for (const [i, name] of names.entries()) {
      if (host.now() >= deadline || !sameFile(stats[i], lstatOrNull(at(run, name)))) return failed("changed_before_delete");
      record(`deleting ${i}`);
      // The only unlink sites are these three verified regular files inside root-only custody.
      (host.npmCacheUnlink || fs.unlinkSync)(at(run, name));
      deleted += 1;
      deletedBytes += stats[i].blocks * 512;
      fs.fsyncSync(run);
      record(`deleted ${i}`);
    }
    record(`delete_complete ${deleted}`);
    return { ok: true, details: `deleted=${deleted} deleted_allocated_bytes=${deletedBytes} df_verification=required manifest=${runDir}/MANIFEST` };
  } catch { return failed("deletion_or_verification_uncertain"); }
  finally { if (manifest !== undefined) fs.closeSync(manifest); if (run !== undefined) fs.closeSync(run); }
}

export const OPERATIONS = Object.freeze({
  "ledger-dispatchers-status": (host) => ({
    ok: true,
    details: LEDGER.map((u) => `${u}=${read(host, `${u}.service`, "User")}/${read(host, `${u}.service`, "ActiveState")}`
      + `/timer:${read(host, `${u}.timer`, "ActiveState")}/reload:${read(host, `${u}.service`, "NeedDaemonReload")}`).join(" "),
  }),
  "npm-cache-1240-check": (host, runId) => npmCache1240(host, runId, false),
  "npm-cache-1240-cleanup": (host, runId) => npmCache1240(host, runId, true),
  // Stop both timers first so no dispatcher starts, then wait until none runs. One 5-minute deadline covers both
  // dispatchers and every systemctl call. On timeout the timers stay stopped: the owner decides what comes next.
  "ledger-dispatchers-pause": (host) => {
    const deadline = host.now() + PAUSE_DEADLINE_MS;
    // Both stops are attempted even if one fails, so a failure never leaves the other timer running unnoticed.
    const notStopped = LEDGER.filter((u) => host.run(["/usr/bin/systemctl", "stop", `${u}.timer`]).status !== 0);
    if (notStopped.length) return { ok: false, failed: notStopped.map((u) => `stop_${u}.timer`).join(",") };
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
  "ledger-production-dispatcher-install": installProductionDispatcher,
  "ws-restart-gate-install": installWsRestartGate,
  "github-app-token-prepare": (host, runId) => {
    const result = host.run(["/usr/bin/python3", "-I", "-B", "/usr/local/libexec/arcade-vps-admin/github-app-token.py", "prepare", String(runId)], 180000);
    return result.status === 0 && result.stdout === "GITHUB_TOKEN_OK prepared_no_key_no_client_switch"
      ? { ok: true, details: "prepared_no_key_no_client_switch" }
      : { ok: false, failed: "github_token_inspect_protected_manifest_no_retry" };
  },
  "github-app-key-quarantine": (host, runId) => {
    // The fixed signer proves replacement custody/scope without disclosing its freshly issued token.
    const proof = host.run(["/usr/sbin/runuser", "-u", "arcade-github-token", "--", "/usr/local/sbin/arcade-github-app-token", "--info"], 30000);
    if (proof.status !== 0) return { ok: false, blocked: "replacement_signer_not_verified" };
    return quarantineSnapshots({ ...host, quarantine: { ...host.quarantine, files: [".arcade-code-agent/app.pem"] } }, runId);
  },
  ...Object.fromEntries(["provision", "rollback"].map((action) => [
    `ws-preview-isolation-${action}`, (host, runId) => {
      const result = host.run(["/usr/bin/python3", "-I", "-B", "/usr/local/libexec/arcade-vps-admin/ws-preview-isolation.py", action, String(runId)], 480000);
      if (result.status === 0 && /^PREVIEW_OK [a-z0-9_]+$/.test(result.stdout)) return { ok: true, details: result.stdout };
      if (/^PREVIEW_BLOCKED [a-z0-9_]+$/.test(result.stdout)) return { ok: false, blocked: result.stdout.slice(16) };
      return { ok: false, failed: "preview_isolation_inspect_protected_manifest" };
    },
  ])),
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
