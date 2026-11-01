#!/usr/bin/node

// Root helper for the WS deploy restart gate. Prints one line: RESTART_SAFE[...] or RESTART_BLOCKED <reasons>.
// Only counts and flags from the runtime preflight are printed; the internal token never leaves this process.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = "/etc/arcadeplatform/ws-server.env";
const STATUS_URL = "http://127.0.0.1:3000/internal/admin/poker-maintenance";
const COUNT_KEYS = ["loadedHandsInProgress", "tableCommandsInFlight", "stateWritesInFlight", "dbHandsInProgress", "dbVersionMismatches"];
const FINANCIAL_KEYS = ["missingState", "missingEscrow", "invalidAmounts", "balanceMismatches", "unresolvedRequests"];

function countReason(key, value) {
  return value === 0 ? null : `${key}=${Number.isSafeInteger(value) ? value : "unknown"}`;
}

// A stopped service has nothing in flight; a running one must report every condition itself.
export function evaluateRestartGate({ serviceState, holdStatus }) {
  if (serviceState === "inactive" || serviceState === "failed") return { safe: true, line: "RESTART_SAFE service_inactive" };
  if (serviceState !== "active") {
    return { safe: false, line: `RESTART_BLOCKED service_${/^[a-z-]{1,32}$/.test(serviceState) ? serviceState : "unknown"}` };
  }
  if (!holdStatus || typeof holdStatus !== "object" || Array.isArray(holdStatus)) {
    return { safe: false, line: "RESTART_BLOCKED runtime_without_restart_preflight" };
  }
  const reasons = [];
  if (holdStatus.active !== true) reasons.push("hold_inactive");
  if (holdStatus.drain !== true) reasons.push("drain_inactive");
  for (const key of COUNT_KEYS) reasons.push(countReason(key, holdStatus[key]));
  if (holdStatus.supervisorSweepInProgress !== false) reasons.push("supervisor_sweep");
  const financial = holdStatus.dbFinancialIssues;
  if (!financial || typeof financial !== "object") reasons.push("financial_unverified");
  else for (const key of FINANCIAL_KEYS) reasons.push(countReason(key, financial[key]));
  if (holdStatus.restartSafe !== true) reasons.push("restart_not_safe");
  const blocking = reasons.filter(Boolean);
  return blocking.length === 0
    ? { safe: true, line: "RESTART_SAFE" }
    : { safe: false, line: `RESTART_BLOCKED ${blocking.join(",")}` };
}

export function readInternalToken(envFile = DEFAULT_ENV_FILE, { allowTestUid = false } = {}) {
  const fd = fs.openSync(envFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const metadata = fs.fstatSync(fd);
    const owned = allowTestUid ? metadata.uid === process.getuid() : metadata.uid === 0 && metadata.gid === 0;
    if (!metadata.isFile() || metadata.nlink !== 1 || !owned || (metadata.mode & 0o7777) !== 0o600 || metadata.size > 1048576) {
      throw new Error("env_file_untrusted");
    }
    for (const rawLine of fs.readFileSync(fd, "utf8").split(/\r?\n/)) {
      const match = rawLine.trim().match(/^POKER_WS_INTERNAL_TOKEN=(.*)$/);
      if (!match) continue;
      const value = match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
      if (value) return value;
    }
    throw new Error("internal_token_missing");
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  if (process.argv.length !== 2) return { safe: false, line: "RESTART_BLOCKED unexpected_arguments" };
  const service = spawnSync("/usr/bin/systemctl", ["is-active", "ws-server.service"], { encoding: "utf8", timeout: 5000 });
  const serviceState = String(service.stdout || "").trim() || "unknown";
  if (serviceState !== "active") return evaluateRestartGate({ serviceState, holdStatus: null });
  const response = await fetch(STATUS_URL, {
    headers: { authorization: `Bearer ${readInternalToken()}` },
    signal: AbortSignal.timeout(5000)
  });
  const body = await response.json();
  return evaluateRestartGate({ serviceState, holdStatus: body?.newHandsHold });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMainModule) {
  main()
    .catch(() => ({ safe: false, line: "RESTART_BLOCKED gate_error" }))
    .then((result) => {
      process.stdout.write(`${result.line}\n`);
      process.exitCode = result.safe ? 0 : 1;
    });
}
