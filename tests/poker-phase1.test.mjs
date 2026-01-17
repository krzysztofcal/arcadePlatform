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
const startHandSrc = read("netlify/functions/poker-start-hand.mjs");
const pokerUiSrc = read("poker/poker.js");
const phase1MigrationSrc = read("supabase/migrations/20260117090000_poker_phase1_authoritative_seats.sql");

const intervalInterpolation = "interval '${";
assert.ok(!getTableSrc.includes(intervalInterpolation), "get-table should not interpolate interval strings");
assert.ok(!sweepSrc.includes(intervalInterpolation), "sweep should not interpolate interval strings");

const requestIdRegex = /return\s*\{\s*ok\s*:\s*true\s*,\s*value\s*:\s*null\s*\}/;
assert.ok(requestIdRegex.test(joinSrc), "join should allow missing requestId");
assert.ok(requestIdRegex.test(leaveSrc), "leave should allow missing requestId");
assert.ok(requestIdRegex.test(heartbeatSrc), "heartbeat should allow missing requestId");
assert.ok(/value\s*===\s*\"\"/.test(heartbeatSrc), "heartbeat should allow empty requestId string");

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
assert.ok(!/update public\\.poker_seats set status = 'INACTIVE'/.test(getTableSrc), "get-table should not mark seats inactive");
assert.ok(!/max_players\s*:/.test(getTableSrc), "get-table should not return max_players duplicate");
assert.ok(!/last_activity_at\s*:/.test(getTableSrc), "get-table should not return last_activity_at duplicate");
assert.ok(/status = 'ACTIVE'/.test(startHandSrc), "start-hand should select ACTIVE seats");
assert.ok(startHandSrc.includes("nextStacks"), "start-hand should filter stacks to ACTIVE seats");
assert.ok(startHandSrc.includes("derivedSeats"), "start-hand should re-derive seats from ACTIVE rows");
assert.ok(pokerUiSrc.includes("pendingJoinRequestId"), "poker UI should store pending join requestId");
assert.ok(pokerUiSrc.includes("pendingLeaveRequestId"), "poker UI should store pending leave requestId");
assert.ok(pokerUiSrc.includes("apiPost(JOIN_URL"), "poker UI should retry join via apiPost");
assert.ok(pokerUiSrc.includes("apiPost(LEAVE_URL"), "poker UI should retry leave via apiPost");
assert.ok(!/max_players/.test(pokerUiSrc), "poker UI should not read max_players");
assert.ok(!joinSrc.includes("RUNNING"), "join should not set status to RUNNING");
assert.ok(!leaveSrc.includes("RUNNING"), "leave should not set status to RUNNING");
assert.ok(
  phase1MigrationSrc.includes("poker_requests_created_at_idx"),
  "migration should add poker_requests created_at index"
);
assert.ok(
  sweepSrc.includes("delete from public.poker_requests"),
  "sweep should delete old poker_requests"
);
