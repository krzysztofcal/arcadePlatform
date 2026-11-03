#!/usr/bin/node

// Root helper for Production WS restarts. "check" prints RESTART_SAFE[...] or RESTART_BLOCKED <reasons>;
// "restart" re-runs the same gate and only then restarts ws-server.service. "prepare" holds new hands, waits
// for the running hands to settle, drains and waits for RESTART_SAFE; on any other outcome it puts the hold
// file back as it found it. "resume" lifts the hold only when the running process is the current release,
// healthy and the gate is safe. Only counts and flags are printed; the internal token and the database URL
// never leave this process.
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

// Waits for settled hands under hold, then for an idle runtime under drain. Any other blocker stops.
const HOLD_STOP = /^(humanSeatsOpen|closedWithEscrow)=|=unknown$|^(hold_path_|service_|http_|runtime_without_restart_preflight|internal_token_missing|presence_unverified|financial_unverified|hold_inactive|gate_error)/;
const HOLD_WAIT = /^(loadedHandsInProgress|dbHandsInProgress)=[0-9]+$/;
const DRAIN_WAIT = /^(tableCommandsInFlight|stateWritesInFlight)=[0-9]+$|^(supervisor_sweep|restart_not_safe)$/;

export function prepareStep(phase, gate) {
  if (gate.safe) return phase === "drain" ? "ready" : "drain";
  const reasons = gate.line.replace(/^RESTART_BLOCKED /, "").split(",");
  if (phase === "hold") {
    if (reasons.some((reason) => HOLD_STOP.test(reason))) return "stop";
    return reasons.some((reason) => HOLD_WAIT.test(reason)) ? "wait" : "drain";
  }
  return reasons.every((reason) => DRAIN_WAIT.test(reason)) ? "wait" : "stop";
}

function readHoldContent(holdFile) {
  try {
    return fs.readFileSync(holdFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function writeHold(holdFile, content) {
  const tmp = `${holdFile}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o644 });
  fs.chmodSync(tmp, 0o644);
  fs.renameSync(tmp, holdFile);
}

export async function prepare({ holdMs = 600000, drainMs = 120000, pollMs = 5000, holdFile = HOLD_FILE, holdPath = {}, gate = runGate, nowMs = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const pathIssue = holdPathIssue(holdFile, holdPath);
  if (pathIssue) return blocked(`hold_path_${pathIssue}`);
  const before = readHoldContent(holdFile);
  let phase = before !== null && /^drain\n?$/.test(before) ? "drain" : "hold";
  if (before === null) writeHold(holdFile, "");
  let deadline = nowMs() + (phase === "hold" ? holdMs : drainMs);
  for (;;) {
    const result = await gate().catch(() => blocked("gate_error"));
    const step = prepareStep(phase, result);
    if (step === "ready") return { safe: true, line: "PREPARED" };
    if (step === "drain") {
      writeHold(holdFile, "drain\n");
      phase = "drain";
      deadline = nowMs() + drainMs;
      continue;
    }
    if (step === "stop" || nowMs() >= deadline) {
      // Nothing was restarted, so the running process may go back to the hold state it had before.
      if (before === null) fs.rmSync(holdFile, { force: true });
      else writeHold(holdFile, before);
      return blocked([`prepare_${phase}_${step === "stop" ? "stopped" : "timeout"}`, ...result.line.replace(/^RESTART_BLOCKED /, "").split(",")]);
    }
    await sleep(pollMs);
  }
}

export function resumeIssue({ serviceState, healthz, runningDir, currentDir, gate }) {
  if (serviceState !== "active") return `service_${/^[a-z-]{1,32}$/.test(serviceState) ? serviceState : "unknown"}`;
  if (healthz !== "ok") return "healthz";
  if (!runningDir || runningDir !== currentDir) return "release_not_running";
  return gate.safe ? null : gate.line.replace(/^RESTART_BLOCKED /, "");
}

function realDir(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

async function resume() {
  if (readHoldContent(HOLD_FILE) === null) return { safe: true, line: "RESUMED not_held" };
  const serviceState = readServiceState();
  const pid = spawnSync("/usr/bin/systemctl", ["show", "ws-server.service", "-p", "MainPID", "--value"], { encoding: "utf8", timeout: 5000 });
  const mainPid = String(pid.stdout || "").trim();
  const healthz = await fetch(HEALTHZ_URL, { signal: AbortSignal.timeout(5000) }).then((response) => response.ok ? response.text() : "").catch(() => "");
  const issue = resumeIssue({
    serviceState,
    healthz: healthz.trim(),
    runningDir: /^[1-9][0-9]*$/.test(mainPid) ? realDir(`/proc/${mainPid}/cwd`) : null,
    currentDir: realDir(CURRENT_LINK),
    gate: await runGate().catch(() => blocked("gate_error"))
  });
  if (issue) return { safe: false, line: `RESUME_BLOCKED ${issue}` };
  fs.rmSync(HOLD_FILE, { force: true });
  return { safe: true, line: "RESUMED" };
}

async function main(mode) {
  if (mode === "prepare") return prepare();
  if (mode === "resume") return resume();
  const gate = await runGate();
  if (mode === "check" || !gate.safe) return gate;
  // The evidence is single-use: it is removed before the restart is attempted.
  if (gate.usesSafeStop) fs.unlinkSync(gate.safeStopFile);
  const restart = spawnSync("/usr/bin/systemctl", ["restart", "ws-server.service"], { encoding: "utf8", timeout: 120000 });
  return restart.status === 0
    ? { safe: true, line: `RESTARTED ${gate.line.replace(/^RESTART_SAFE ?/, "") || "preflight"}` }
    : { safe: false, line: "RESTART_FAILED systemctl" };
}

const MODES = new Set(["check", "restart", "prepare", "resume"]);
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMainModule) {
  const mode = process.argv.length === 3 ? process.argv[2] : "";
  (MODES.has(mode) ? main(mode) : Promise.resolve(blocked("unexpected_arguments")))
    .catch(() => blocked("gate_error"))
    .then((result) => {
      process.stdout.write(`${result.line}\n`);
      process.exitCode = result.safe ? 0 : 1;
    });
}
