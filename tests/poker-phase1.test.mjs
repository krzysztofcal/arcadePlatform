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
const pokerUiSrc = read("poker/poker.js");

const intervalInterpolation = "interval '${";
assert.ok(!getTableSrc.includes(intervalInterpolation), "get-table should not interpolate interval strings");
assert.ok(!sweepSrc.includes(intervalInterpolation), "sweep should not interpolate interval strings");

const requestIdRegex = /return\s*\{\s*ok\s*:\s*true\s*,\s*value\s*:\s*null\s*\}/;
assert.ok(requestIdRegex.test(joinSrc), "join should allow missing requestId");
assert.ok(requestIdRegex.test(leaveSrc), "leave should allow missing requestId");

assert.ok(sweepSrc.includes("POKER_SWEEP_SECRET"), "sweep must require POKER_SWEEP_SECRET");
assert.ok(sweepSrc.includes("x-sweep-secret"), "sweep must check x-sweep-secret header");
assert.ok(!sweepSrc.includes("corsHeaders"), "sweep should not use corsHeaders");
assert.ok(/event\.httpMethod\s*!==\s*\"POST\"/.test(sweepSrc), "sweep should enforce POST-only");

assert.ok(/isValidUuid/.test(heartbeatSrc), "heartbeat should validate tableId with UUID check");
assert.ok(!sweepSrc.includes("forbidden_origin"), "sweep should not reject missing origin");
assert.ok(joinSrc.includes("table_not_open"), "join should return table_not_open when table is not OPEN");
assert.ok(/table\.status\s*!==?\s*['"]OPEN['"]/.test(joinSrc), "join should guard new seats behind OPEN status");
assert.ok(leaveSrc.includes("not_seated"), "leave should return not_seated when user is not seated");
assert.ok(leaveSrc.includes("nothing_to_cash_out"), "leave should return nothing_to_cash_out when no stack");
assert.ok(!getTableSrc.includes("set last_activity_at"), "get-table should not update last_activity_at");
assert.ok(pokerUiSrc.includes("pendingJoinRequestId"), "poker UI should store pending join requestId");
assert.ok(pokerUiSrc.includes("pendingLeaveRequestId"), "poker UI should store pending leave requestId");
assert.ok(pokerUiSrc.includes("apiPost(JOIN_URL"), "poker UI should retry join via apiPost");
assert.ok(pokerUiSrc.includes("apiPost(LEAVE_URL"), "poker UI should retry leave via apiPost");
assert.ok(!joinSrc.includes("RUNNING"), "join should not set status to RUNNING");
assert.ok(!leaveSrc.includes("RUNNING"), "leave should not set status to RUNNING");
