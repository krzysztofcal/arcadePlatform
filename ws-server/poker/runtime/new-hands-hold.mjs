import fs from "node:fs";

// Operator hold for controlled WS switches: while the configured file exists, no new hand starts.
// Live hands, settlement, leaves and cash-outs continue. An unreadable path counts as held.
function holdFilePath(env) {
  return typeof env?.WS_POKER_NEW_HANDS_HOLD_FILE === "string" ? env.WS_POKER_NEW_HANDS_HOLD_FILE.trim() : "";
}

export function isNewHandsHoldActive(env = process.env) {
  const holdFile = holdFilePath(env);
  if (!holdFile) return false;
  try {
    fs.statSync(holdFile);
    return true;
  } catch (error) {
    return error?.code !== "ENOENT";
  }
}

export function newHandsHoldStatus(env = process.env) {
  return { configured: holdFilePath(env) !== "", active: isNewHandsHoldActive(env) };
}
