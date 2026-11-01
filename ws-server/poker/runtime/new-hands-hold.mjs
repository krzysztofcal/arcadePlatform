import fs from "node:fs";

// Operator hold for controlled WS switches: while the configured file exists, no new hand starts.
// Live hands, settlement, leaves and cash-outs continue. The file content "drain" also rejects every
// queued table command so a restart can wait for a quiet point. An unreadable path counts as held and draining.
function holdFilePath(env) {
  return typeof env?.WS_POKER_NEW_HANDS_HOLD_FILE === "string" ? env.WS_POKER_NEW_HANDS_HOLD_FILE.trim() : "";
}

function readHoldFile(env) {
  const holdFile = holdFilePath(env);
  if (!holdFile) return { active: false, drain: false };
  try {
    return { active: true, drain: fs.readFileSync(holdFile, "utf8").trim() === "drain" };
  } catch (error) {
    const failClosed = error?.code !== "ENOENT";
    return { active: failClosed, drain: failClosed };
  }
}

export function isNewHandsHoldActive(env = process.env) {
  return readHoldFile(env).active;
}

export function isWsDrainActive(env = process.env) {
  return readHoldFile(env).drain;
}

export function newHandsHoldStatus(env = process.env) {
  return { configured: holdFilePath(env) !== "", ...readHoldFile(env) };
}

function chipAmount(value) {
  const amount = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

// Outside a hand the terminal-close conservation rule applies: no pot and escrow equal to the stacks.
// Rows stay inside the process; only these counts are reported.
export function summarizeRestartFinancials(rows, unresolvedRequests) {
  const issues = { missingState: 0, missingEscrow: 0, invalidAmounts: 0, balanceMismatches: 0, unresolvedRequests: chipAmount(unresolvedRequests) };
  if (issues.unresolvedRequests === null) issues.invalidAmounts += 1;
  for (const row of rows) {
    if (!row?.has_state) {
      issues.missingState += 1;
      continue;
    }
    const stacks = row.stacks && typeof row.stacks === "object" && !Array.isArray(row.stacks) ? Object.values(row.stacks).map(chipAmount) : null;
    const pots = [row.pot, row.pot_total].filter((value) => value !== null && value !== undefined).map(chipAmount);
    const stackTotal = stacks ? stacks.reduce((total, amount) => total + (amount ?? 0), 0) : null;
    if (!stacks || stacks.includes(null) || pots.some((pot) => pot !== 0) || !Number.isSafeInteger(stackTotal)) {
      issues.invalidAmounts += 1;
      continue;
    }
    if (row.escrow_status === null || row.escrow_status === undefined) {
      if (stackTotal > 0) issues.missingEscrow += 1;
      continue;
    }
    if (row.escrow_status !== "active") {
      issues.missingEscrow += 1;
      continue;
    }
    const escrow = chipAmount(row.escrow_balance);
    if (escrow === null) issues.invalidAmounts += 1;
    else if (escrow !== stackTotal) issues.balanceMismatches += 1;
  }
  return issues;
}
