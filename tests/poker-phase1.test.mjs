import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const getTableSrc = read("netlify/functions/poker-get-table.mjs");
const startHandSrc = read("netlify/functions/poker-start-hand.mjs");

assert.ok(!/update\s+public\\.poker_seats/i.test(getTableSrc), "get-table should not update seats");
assert.ok(!/update\s+public\\.poker_tables/i.test(getTableSrc), "get-table should not update tables");

assert.ok(/status = 'ACTIVE'/.test(startHandSrc), "start-hand should select ACTIVE seats");
assert.ok(startHandSrc.includes("nextStacks"), "start-hand should filter stacks to ACTIVE seats");
