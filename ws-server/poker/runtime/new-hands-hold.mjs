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
