import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const sweepSrc = read("netlify/functions/poker-sweep.mjs");

assert.ok(
  sweepSrc.includes("poker_escrow_orphan_detected"),
  "sweep should log poker_escrow_orphan_detected for non-zero escrow with no active seats"
);
assert.ok(
  /from public\.chips_accounts a[\s\S]*?account_type = 'ESCROW'[\s\S]*?system_key like 'POKER_TABLE:%'/.test(sweepSrc),
  "sweep should query for orphaned poker escrow balances"
);
