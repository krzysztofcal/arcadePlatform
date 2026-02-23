import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = fs.readFileSync(path.join(root, "netlify/functions/poker-leave.mjs"), "utf8");

assert.doesNotMatch(src, /\bcoalesce\(is_bot\b/i);
assert.doesNotMatch(src, /\bbuildSeatBotMap\s*\(/);

console.log("poker-leave contract does not query is_bot behavior test passed");
