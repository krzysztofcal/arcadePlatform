import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const getTableSrc = read("netlify/functions/poker-get-table.mjs");
const sweepSrc = read("netlify/functions/poker-sweep.mjs");
const joinSrc = read("netlify/functions/poker-join.mjs");
const leaveSrc = read("netlify/functions/poker-leave.mjs");
const heartbeatSrc = read("netlify/functions/poker-heartbeat.mjs");

const intervalInterpolation = "interval '${";
assert.ok(!getTableSrc.includes(intervalInterpolation), "get-table should not interpolate interval strings");
assert.ok(!sweepSrc.includes(intervalInterpolation), "sweep should not interpolate interval strings");

const requestIdRegex = /return \{ ok: true, value: null \}/;
assert.ok(requestIdRegex.test(joinSrc), "join should allow missing requestId");
assert.ok(requestIdRegex.test(leaveSrc), "leave should allow missing requestId");

assert.ok(sweepSrc.includes("POKER_SWEEP_SECRET"), "sweep must require POKER_SWEEP_SECRET");
assert.ok(sweepSrc.includes("x-sweep-secret"), "sweep must check x-sweep-secret header");

assert.ok(/isValidUuid/.test(heartbeatSrc), "heartbeat should validate tableId with UUID check");
assert.ok(!sweepSrc.includes("forbidden_origin"), "sweep should not reject missing origin");
assert.ok(joinSrc.includes("table_not_open"), "join should return table_not_open when table is not OPEN");
assert.ok(/table\.status\s*!==?\s*['"]OPEN['"]/.test(joinSrc), "join should guard new seats behind OPEN status");
