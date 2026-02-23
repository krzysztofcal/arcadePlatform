import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = fs.readFileSync(path.join(root, "netlify/functions/poker-act.mjs"), "utf8");

const calls = src.match(/runAdvanceLoop\([^\n]+\)/g) || [];
assert.ok(calls.length >= 2, "expected poker-act to call runAdvanceLoop in multiple branches");
for (const call of calls) {
  assert.match(call, /advanceIfNeeded\)/, `runAdvanceLoop call missing advanceIfNeeded: ${call}`);
}

console.log("poker-act runAdvanceLoop signature behavior test passed");
