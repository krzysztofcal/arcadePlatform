#!/usr/bin/node

// Root helper for Production WS restarts. "check" prints RESTART_SAFE[...] or RESTART_BLOCKED <reasons>;
// "restart" re-runs the same gate and only then restarts ws-server.service.
// Release runs own their hold through a marker: "prepare <runId>" refuses any hold it does not own, holds new
// hands, waits for running hands, drains and waits for RESTART_SAFE, and removes its own hold on any other
// outcome. "resume <runId> <sha>" lifts it only after a restart into exactly that release; "abort <runId>" only
// while the prepared process still runs unchanged. Only counts and flags are printed; the internal token and
// the database URL never leave this process.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = "/etc/arcadeplatform/ws-server.env";
// Delivered by the ws-server.service drop-in; the attested env file must not define it.
export const HOLD_FILE = "/etc/arcadeplatform/ws-hold/new-hands";
const HOLD_VARIABLE = "WS_POKER_NEW_HANDS_HOLD_FILE";
const STATUS_URL = "http://127.0.0.1:3000/internal/admin/poker-maintenance";
const HEALTHZ_URL = "http://127.0.0.1:3000/healthz";
const CURRENT_LINK = "/opt/ws-server/current";
const PSQL_BIN = "/usr/bin/psql";
const SAFE_STOP_FILE = "safe-stop";
const SAFE_STOP_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const COUNT_KEYS = ["loadedHandsInProgress", "tableCommandsInFlight", "stateWritesInFlight", "dbHandsInProgress", "dbVersionMismatches"];
const FINANCIAL_KEYS = ["missingState", "missingEscrow", "invalidAmounts", "balanceMismatches", "unresolvedRequests"];
const DB_QUIET_KEYS = ["handsInProgress", ...FINANCIAL_KEYS];
const PRESENCE_KEYS = ["humanSeatsOpen", "closedWithEscrow"];

// Seated humans on OPEN tables and escrow left on CLOSED tables block every restart path.
export const PRESENCE_SQL = `select concat_ws('|',
  (select count(*) from public.poker_seats s join public.poker_tables t on t.id = s.table_id
    where t.status = 'OPEN' and s.status = 'ACTIVE' and not s.is_bot),
  (select count(*) from public.poker_tables t
    join public.chips_accounts a on a.account_type = 'ESCROW' and a.system_key = 'POKER_TABLE:' || t.id::text
    where t.status = 'CLOSED' and a.balance <> 0));`;

// Same rule as the runtime preflight, for a stopped service: aggregates only, read-only transaction.
export const DB_QUIET_SQL = `select concat_ws('|',
  count(*) filter (where c = 'live'), count(*) filter (where c = 'missing_state'), count(*) filter (where c = 'missing_escrow'),
  count(*) filter (where c = 'invalid_amounts'), count(*) filter (where c = 'balance_mismatch'),
  (select count(*) from public.poker_requests where result_json is null))
from (
  select case
    when not m.has_state then 'missing_state'
    when m.phase in ('PREFLOP','FLOP','TURN','RIVER','SHOWDOWN') then 'live'
    when m.stacks_type is distinct from 'object' or m.stacks_valid is false
      or coalesce(m.pot, '0') <> '0' or coalesce(m.pot_total, '0') <> '0' then 'invalid_amounts'
    when m.escrow_status is null and coalesce(m.stack_total, 0) > 0 then 'missing_escrow'
    when m.escrow_status is null then 'ok'
    when m.escrow_status <> 'active' then 'missing_escrow'
    when m.escrow_balance < 0 then 'invalid_amounts'
    when m.escrow_balance <> coalesce(m.stack_total, 0) then 'balance_mismatch'
    else 'ok' end as c
  from (
    select ps.table_id is not null as has_state, ps.state->>'phase' as phase, jsonb_typeof(ps.state->'stacks') as stacks_type,
      ps.state->>'pot' as pot, ps.state->>'potTotal' as pot_total, a.status as escrow_status, a.balance as escrow_balance,
      st.stacks_valid, st.stack_total
    from public.poker_tables t
    left join public.poker_state ps on ps.table_id = t.id
    left join public.chips_accounts a on a.account_type = 'ESCROW' and a.system_key = 'POKER_TABLE:' || t.id::text
    left join lateral (
      select bool_and(jsonb_typeof(e.value) = 'number' and (e.value::text)::numeric >= 0
               and (e.value::text)::numeric = trunc((e.value::text)::numeric)) as stacks_valid,
             sum(case when jsonb_typeof(e.value) = 'number' then (e.value::text)::numeric end) as stack_total
      from jsonb_each(case when jsonb_typeof(ps.state->'stacks') = 'object' then ps.state->'stacks' else '{}'::jsonb end) e
    ) st on true
    where t.status = 'OPEN'
  ) m
) x;`;

function countReason(key, value) {
  return value === 0 ? null : `${key}=${Number.isSafeInteger(value) ? value : "unknown"}`;
}

function blocked(reasons) {
  return { safe: false, line: `RESTART_BLOCKED ${[].concat(reasons).join(",")}` };
}

function presenceReasons(presence) {
  if (!presence || typeof presence !== "object") return ["presence_unverified"];
  return PRESENCE_KEYS.map((key) => countReason(key, presence[key])).filter(Boolean);
}

// A stopped service needs root's one-time safe-stop evidence and a quiet database; a running one must
// answer 200 and report every condition itself. Both need zero seated humans and no escrow on CLOSED tables.
export function evaluateRestartGate({ serviceState, holdPathIssue = null, httpStatus = null, holdStatus = null, safeStop = null, holdDrain = false, dbQuiet = null, presence = null }) {
  if (holdPathIssue) return blocked(`hold_path_${holdPathIssue}`);
  if (serviceState === "inactive" || serviceState === "failed") {
    if (safeStop?.valid !== true) return blocked(`service_${serviceState}_without_safe_stop_evidence`);
    // The started process must come up drained, so the protected hold file has to say exactly "drain".
    if (holdDrain !== true) return blocked("hold_file_not_drain");
    if (!dbQuiet || typeof dbQuiet !== "object") return blocked("db_unverified");
    const reasons = [...DB_QUIET_KEYS.map((key) => countReason(key, dbQuiet[key])).filter(Boolean), ...presenceReasons(presence)];
    return reasons.length ? blocked(reasons) : { safe: true, line: "RESTART_SAFE safe_stop_evidence", usesSafeStop: true };
  }
  if (serviceState !== "active") return blocked(`service_${/^[a-z-]{1,32}$/.test(serviceState) ? serviceState : "unknown"}`);
  if (httpStatus !== 200) return blocked(`http_${Number.isInteger(httpStatus) ? httpStatus : "unknown"}`);
  if (!holdStatus || typeof holdStatus !== "object" || Array.isArray(holdStatus)) return blocked("runtime_without_restart_preflight");
  const reasons = [];
  if (holdStatus.active !== true) reasons.push("hold_inactive");
  if (holdStatus.drain !== true) reasons.push("drain_inactive");
  for (const key of COUNT_KEYS) reasons.push(countReason(key, holdStatus[key]));
  if (holdStatus.supervisorSweepInProgress !== false) reasons.push("supervisor_sweep");
  const financial = holdStatus.dbFinancialIssues;
  if (!financial || typeof financial !== "object") reasons.push("financial_unverified");
  else for (const key of FINANCIAL_KEYS) reasons.push(countReason(key, financial[key]));
  reasons.push(...presenceReasons(presence));
  if (holdStatus.restartSafe !== true) reasons.push("restart_not_safe");
  const blocking = reasons.filter(Boolean);
  return blocking.length === 0 ? { safe: true, line: "RESTART_SAFE" } : blocked(blocking);
}

function protectedEntry(entry, expectedUid) {
  return entry.uid === expectedUid && (expectedUid !== 0 || entry.gid === 0) && (entry.mode & 0o022) === 0;
}

// The hold file and the safe-stop evidence live in a root-only directory chain the deploy account cannot change.
export function holdPathIssue(holdFile, { expectedUid = 0, boundary = "/" } = {}) {
  if (typeof holdFile !== "string" || !path.isAbsolute(holdFile) || path.normalize(holdFile) !== holdFile) return "unset";
  try {
    for (let dir = path.dirname(holdFile); ; dir = path.dirname(dir)) {
      if (dir !== boundary && !dir.startsWith(boundary === "/" ? "/" : `${boundary}/`)) return "unprotected";
      const entry = fs.lstatSync(dir);
      if (!entry.isDirectory() || !protectedEntry(entry, expectedUid)) return "unprotected";
      if (dir === boundary) break;
    }
    const entry = fs.lstatSync(holdFile);
    if (!entry.isFile() || !protectedEntry(entry, expectedUid)) return "unprotected";
  } catch (error) {
    if (error?.code !== "ENOENT" || !fs.existsSync(path.dirname(holdFile))) return "unprotected";
  }
  return null;
}

// `systemctl show -p Environment --value` must carry exactly one hold assignment with the protected path.
export function unitHoldIssue(unitEnvironment, envValues = {}) {
  if (Object.hasOwn(envValues, HOLD_VARIABLE)) return "conflict";
  const values = [...String(unitEnvironment || "").matchAll(/(?:^|\s)"?WS_POKER_NEW_HANDS_HOLD_FILE=([^\s"]*)"?/g)].map((match) => match[1]);
  if (values.length === 0) return "unset";
  if (values.length > 1) return "duplicate";
  return values[0] === HOLD_FILE ? null : "mismatch";
}

export function readSafeStopEvidence(holdFile, { expectedUid = 0, nowMs = Date.now() } = {}) {
  const evidenceFile = path.join(path.dirname(holdFile), SAFE_STOP_FILE);
  let entry;
  try {
    entry = fs.lstatSync(evidenceFile);
  } catch {
    return { valid: false, file: evidenceFile };
  }
  if (!entry.isFile() || !protectedEntry(entry, expectedUid) || entry.size > 256) return { valid: false, file: evidenceFile };
  const match = fs.readFileSync(evidenceFile, "utf8").trim().match(/^safe-stop (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/);
  const stoppedAtMs = match ? Date.parse(match[1]) : NaN;
  const fresh = Number.isFinite(stoppedAtMs) && stoppedAtMs <= nowMs && nowMs - stoppedAtMs <= SAFE_STOP_MAX_AGE_MS;
  return { valid: fresh, file: evidenceFile };
}

export function readHoldDrain(holdFile, { expectedUid = 0 } = {}) {
  try {
    const entry = fs.lstatSync(holdFile);
    return entry.isFile() && protectedEntry(entry, expectedUid) && /^drain\n?$/.test(fs.readFileSync(holdFile, "utf8"));
  } catch {
    return false;
  }
}

function parseCounts(output, keys) {
  const values = String(output || "").trim().split("|");
  if (values.length !== keys.length || !values.every((value) => /^[0-9]+$/.test(value))) return null;
  return Object.fromEntries(keys.map((key, index) => [key, Number(values[index])]));
}

export function parseDbQuiet(output) {
  return parseCounts(output, DB_QUIET_KEYS);
}

export function parsePresence(output) {
  return parseCounts(output, PRESENCE_KEYS);
}

export function readEnvValues(envFile = DEFAULT_ENV_FILE, { allowTestUid = false } = {}) {
  const fd = fs.openSync(envFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const metadata = fs.fstatSync(fd);
    const owned = allowTestUid ? metadata.uid === process.getuid() : metadata.uid === 0 && metadata.gid === 0;
    if (!metadata.isFile() || metadata.nlink !== 1 || !owned || (metadata.mode & 0o7777) !== 0o600 || metadata.size > 1048576) {
      throw new Error("env_file_untrusted");
    }
    const values = {};
    for (const rawLine of fs.readFileSync(fd, "utf8").split(/\r?\n/)) {
      const match = rawLine.trim().match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
    return values;
  } finally {
    fs.closeSync(fd);
  }
}

function queryCounts(dbUrl, sql, parse) {
  if (!dbUrl) return null;
  const url = new URL(dbUrl);
  const result = spawnSync(PSQL_BIN, [
    "-h", url.hostname, "-p", url.port || "5432", "-U", decodeURIComponent(url.username),
    "-d", url.pathname.replace(/^\//, "") || "postgres", "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", sql
  ], {
    env: {
      PATH: "/usr/bin:/bin",
      PGPASSWORD: decodeURIComponent(url.password),
      PGOPTIONS: "-c default_transaction_read_only=on",
      ...(url.searchParams.get("sslmode") ? { PGSSLMODE: url.searchParams.get("sslmode") } : {})
    },
    timeout: 15000,
    encoding: "utf8"
  });
  return result.status === 0 ? parse(result.stdout) : null;
}

function readServiceState() {
  const service = spawnSync("/usr/bin/systemctl", ["is-active", "ws-server.service"], { encoding: "utf8", timeout: 5000 });
  return String(service.stdout || "").trim() || "unknown";
}

async function runGate(values = readEnvValues()) {
  const unit = spawnSync("/usr/bin/systemctl", ["show", "ws-server.service", "-p", "Environment", "--value"], { encoding: "utf8", timeout: 5000 });
  const unitIssue = unit.status === 0 ? unitHoldIssue(unit.stdout, values) : "unset";
  if (unitIssue) return evaluateRestartGate({ serviceState: "unknown", holdPathIssue: unitIssue });
  const holdFile = HOLD_FILE;
  const pathIssue = holdPathIssue(holdFile);
  if (pathIssue) return evaluateRestartGate({ serviceState: "unknown", holdPathIssue: pathIssue });
  const serviceState = readServiceState();
  if (serviceState === "inactive" || serviceState === "failed") {
    const safeStop = readSafeStopEvidence(holdFile);
    const holdDrain = readHoldDrain(holdFile);
    const ready = safeStop.valid && holdDrain;
    const dbQuiet = ready ? queryCounts(values.SUPABASE_DB_URL, DB_QUIET_SQL, parseDbQuiet) : null;
    const presence = ready ? queryCounts(values.SUPABASE_DB_URL, PRESENCE_SQL, parsePresence) : null;
    return { ...evaluateRestartGate({ serviceState, safeStop, holdDrain, dbQuiet, presence }), safeStopFile: safeStop.file };
  }
  if (serviceState !== "active") return evaluateRestartGate({ serviceState });
  if (!values.POKER_WS_INTERNAL_TOKEN) return blocked("internal_token_missing");
  const response = await fetch(STATUS_URL, {
    headers: { authorization: `Bearer ${values.POKER_WS_INTERNAL_TOKEN}` },
    signal: AbortSignal.timeout(5000)
  });
  const body = response.status === 200 ? await response.json() : null;
  const presence = queryCounts(values.SUPABASE_DB_URL, PRESENCE_SQL, parsePresence);
  return evaluateRestartGate({ serviceState, httpStatus: response.status, holdStatus: body?.newHandsHold, presence });
}

// Under hold, wait only for running hands and transient runtime work; under drain, only for transient work.
// Every presence, integrity or unverifiable reason stops at once.
const TRANSIENT = /^(tableCommandsInFlight|stateWritesInFlight)=[0-9]+$|^(supervisor_sweep|restart_not_safe)$/;
const HAND = /^(loadedHandsInProgress|dbHandsInProgress)=([0-9]+)$/;
const POTS = /^invalidAmounts=([0-9]+)$/;

export function prepareStep(phase, gate) {
  if (gate.safe) return phase === "drain" ? "ready" : "drain";
  const reasons = gate.line.replace(/^RESTART_BLOCKED /, "").split(",");
  if (phase === "drain") return reasons.every((reason) => TRANSIENT.test(reason)) ? "wait" : "stop";
  if (!reasons.every((reason) => reason === "drain_inactive" || TRANSIENT.test(reason) || HAND.test(reason) || POTS.test(reason))) return "stop";
  // A running hand has a pot, which the money check reports as invalidAmounts: at most one per running hand.
  const hands = Math.max(0, ...reasons.map((reason) => Number(reason.match(HAND)?.[2] ?? 0)));
  const pots = Number(reasons.map((reason) => reason.match(POTS)?.[1]).find(Boolean) ?? 0);
  if (pots > hands) return "stop";
  return hands > 0 ? "wait" : "drain";
}

function readHoldContent(holdFile) {
  try {
    return fs.readFileSync(holdFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o644 });
  fs.chmodSync(tmp, 0o644);
  fs.renameSync(tmp, file);
}

// The marker next to the hold file ties the hold to one release run and to the process it prepared.
const OP_ID = /^[1-9][0-9]{0,19}$/;
const RELEASE_SHA = /^[0-9a-f]{40}$/;

function markerFile(holdFile) {
  return path.join(path.dirname(holdFile), "release-op");
}

export function readOperation(holdFile) {
  const content = readHoldContent(markerFile(holdFile));
  if (content === null) return null;
  const match = content.match(/^op=([1-9][0-9]{0,19}) pid=([1-9][0-9]*)\n?$/);
  return match ? { op: match[1], pid: match[2] } : { op: null, pid: null };
}

function clearOperation(holdFile) {
  fs.rmSync(holdFile, { force: true });
  fs.rmSync(markerFile(holdFile), { force: true });
}

function realDir(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function readMainPid() {
  const pid = spawnSync("/usr/bin/systemctl", ["show", "ws-server.service", "-p", "MainPID", "--value"], { encoding: "utf8", timeout: 5000 });
  const value = String(pid.stdout || "").trim();
  return /^[1-9][0-9]*$/.test(value) ? value : null;
}

const HOST = {
  holdFile: HOLD_FILE,
  holdPath: {},
  releasesDir: "/opt/ws-server/releases",
  gate: () => runGate(),
  serviceState: readServiceState,
  mainPid: readMainPid,
  runningDir: (pid) => realDir(`/proc/${pid}/cwd`),
  currentDir: () => realDir(CURRENT_LINK),
  releaseSha: (dir) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "release-metadata.json"), "utf8")).releaseSha;
    } catch {
      return null;
    }
  },
  healthz: () => fetch(HEALTHZ_URL, { signal: AbortSignal.timeout(5000) }).then((response) => (response.ok ? response.text() : "")).catch(() => ""),
  holdMs: 600000,
  drainMs: 120000,
  pollMs: 5000,
  nowMs: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

function pathIssue(host) {
  return holdPathIssue(host.holdFile, host.holdPath) || holdPathIssue(markerFile(host.holdFile), host.holdPath);
}

// Refuses a hold it does not own. A rerun of the same run continues only while the prepared process still runs.
export async function prepare(opId, overrides = {}) {
  const host = { ...HOST, ...overrides };
  if (!OP_ID.test(String(opId))) return blocked("unexpected_arguments");
  const issue = pathIssue(host);
  if (issue) return blocked(`hold_path_${issue}`);
  const operation = readOperation(host.holdFile);
  const pid = host.mainPid();
  if (operation) {
    if (operation.op !== opId) return blocked("hold_owned_by_other_operation");
    if (operation.pid !== pid) return blocked("operation_process_changed");
  } else {
    if (readHoldContent(host.holdFile) !== null) return blocked("hold_owned_by_operator");
    if (!pid) return blocked("service_not_running");
    writeAtomic(markerFile(host.holdFile), `op=${opId} pid=${pid}\n`);
  }
  if (readHoldContent(host.holdFile) === null) writeAtomic(host.holdFile, "");
  let phase = /^drain\n?$/.test(readHoldContent(host.holdFile)) ? "drain" : "hold";
  let deadline = host.nowMs() + (phase === "hold" ? host.holdMs : host.drainMs);
  for (;;) {
    const result = await host.gate().catch(() => blocked("gate_error"));
    const step = prepareStep(phase, result);
    if (step === "ready") return { safe: true, line: "PREPARED" };
    if (step === "drain") {
      writeAtomic(host.holdFile, "drain\n");
      phase = "drain";
      deadline = host.nowMs() + host.drainMs;
      continue;
    }
    if (step === "stop" || host.nowMs() >= deadline) {
      // Nothing was switched or restarted: the release keeps running without this run's hold.
      clearOperation(host.holdFile);
      return blocked([`prepare_${phase}_${step === "stop" ? "stopped" : "timeout"}`, ...result.line.replace(/^RESTART_BLOCKED /, "").split(",")]);
    }
    await host.sleep(host.pollMs);
  }
}

// Reopens play only for the exact release this run restarted into; otherwise the hold stays for the owner (C7).
export function resumeIssue({ serviceState, pid, preparedPid, runningDir, currentDir, expectedDir, metadataSha, sha, healthz, gate }) {
  if (serviceState !== "active") return `service_${/^[a-z-]{1,32}$/.test(serviceState) ? serviceState : "unknown"}`;
  if (!pid || pid === preparedPid) return "not_restarted";
  if (runningDir !== expectedDir || currentDir !== expectedDir) return "release_not_running";
  if (metadataSha !== sha) return "release_metadata_mismatch";
  if (healthz !== "ok") return "healthz";
  return gate.safe ? null : gate.line.replace(/^RESTART_BLOCKED /, "");
}

export async function resume(opId, sha, overrides = {}) {
  const host = { ...HOST, ...overrides };
  if (!OP_ID.test(String(opId)) || !RELEASE_SHA.test(String(sha))) return { safe: false, line: "RESUME_BLOCKED unexpected_arguments" };
  const issue = pathIssue(host);
  if (issue) return { safe: false, line: `RESUME_BLOCKED hold_path_${issue}` };
  const operation = readOperation(host.holdFile);
  const held = readHoldContent(host.holdFile) !== null;
  if (!operation) return held ? { safe: false, line: "RESUME_BLOCKED not_owned" } : { safe: true, line: "RESUMED not_held" };
  if (operation.op !== opId) return { safe: false, line: "RESUME_BLOCKED not_owned" };
  if (!held) {
    clearOperation(host.holdFile);
    return { safe: true, line: "RESUMED" };
  }
  const pid = host.mainPid();
  const expectedDir = path.join(host.releasesDir, sha, "ws-server");
  const reason = resumeIssue({
    serviceState: host.serviceState(),
    pid,
    preparedPid: operation.pid,
    runningDir: pid ? host.runningDir(pid) : null,
    currentDir: host.currentDir(),
    expectedDir,
    metadataSha: host.releaseSha(expectedDir),
    sha,
    healthz: String(await host.healthz()).trim(),
    gate: await host.gate().catch(() => blocked("gate_error"))
  });
  if (reason) return { safe: false, line: `RESUME_BLOCKED ${reason}` };
  clearOperation(host.holdFile);
  return { safe: true, line: "RESUMED" };
}

// After a failure before any restart: removes this run's hold only while the prepared process still runs
// from the current link. A changed process or link keeps the hold for the owner (C7).
export async function abort(opId, overrides = {}) {
  const host = { ...HOST, ...overrides };
  if (!OP_ID.test(String(opId))) return { safe: false, line: "ABORT_BLOCKED unexpected_arguments" };
  const issue = pathIssue(host);
  if (issue) return { safe: false, line: `ABORT_BLOCKED hold_path_${issue}` };
  const operation = readOperation(host.holdFile);
  const held = readHoldContent(host.holdFile) !== null;
  if (!operation) return held ? { safe: false, line: "ABORT_BLOCKED not_owned" } : { safe: true, line: "ABORTED not_held" };
  if (operation.op !== opId) return { safe: false, line: "ABORT_BLOCKED not_owned" };
  const pid = host.mainPid();
  if (host.serviceState() !== "active" || pid !== operation.pid) return { safe: false, line: "ABORT_BLOCKED process_changed" };
  if (host.runningDir(pid) !== host.currentDir()) return { safe: false, line: "ABORT_BLOCKED release_link_changed" };
  clearOperation(host.holdFile);
  return { safe: true, line: "ABORTED" };
}

async function main(mode, args) {
  if (mode === "prepare" && args.length === 1) return prepare(args[0]);
  if (mode === "abort" && args.length === 1) return abort(args[0]);
  if (mode === "resume" && args.length === 2) return resume(args[0], args[1]);
  if ((mode !== "check" && mode !== "restart") || args.length !== 0) return blocked("unexpected_arguments");
  const gate = await runGate();
  if (mode === "check" || !gate.safe) return gate;
  // The evidence is single-use: it is removed before the restart is attempted.
  if (gate.usesSafeStop) fs.unlinkSync(gate.safeStopFile);
  const restart = spawnSync("/usr/bin/systemctl", ["restart", "ws-server.service"], { encoding: "utf8", timeout: 120000 });
  return restart.status === 0
    ? { safe: true, line: `RESTARTED ${gate.line.replace(/^RESTART_SAFE ?/, "") || "preflight"}` }
    : { safe: false, line: "RESTART_FAILED systemctl" };
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMainModule) {
  main(process.argv[2] || "", process.argv.slice(3))
    .catch(() => blocked("gate_error"))
    .then((result) => {
      process.stdout.write(`${result.line}\n`);
      process.exitCode = result.safe ? 0 : 1;
    });
}
