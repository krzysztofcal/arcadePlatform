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
const requestIdHelperSrc = read("netlify/functions/_shared/poker-request-id.mjs");
const startHandSrc = read("netlify/functions/poker-start-hand.mjs");
const pokerUiSrc = read("poker/poker.js");
const phase1MigrationSrc = read("supabase/migrations/20260117090000_poker_phase1_authoritative_seats.sql");
const ciWorkflowSrc = read(".github/workflows/ci.yml");
const testsWorkflowSrc = read(".github/workflows/tests.yml");
const matrixWorkflowSrc = read(".github/workflows/playwright-matrix.yml");

const intervalInterpolation = "interval '${";
assert.ok(!getTableSrc.includes(intervalInterpolation), "get-table should not interpolate interval strings");
assert.ok(!sweepSrc.includes(intervalInterpolation), "sweep should not interpolate interval strings");

const requestIdRegex = /value\s*==\s*null\s*\|\|\s*value\s*===\s*\"\"\s*\)\s*return\s*\{\s*ok\s*:\s*true\s*,\s*value\s*:\s*null\s*\}/;
assert.ok(requestIdRegex.test(requestIdHelperSrc), "requestId helper should allow missing requestId");
assert.ok(/trimmed\s*===\s*\"\[object PointerEvent\]\"/.test(requestIdHelperSrc), "requestId helper should reject pointer event string");
assert.ok(/trimmed\.length\s*>\s*maxLen/.test(requestIdHelperSrc), "requestId helper should enforce max length");
const numericRequestIdRegex = /typeof\s+\w+\s*===\s*\"number\"[\s\S]*?Number\.isFinite/;
assert.ok(numericRequestIdRegex.test(requestIdHelperSrc), "requestId helper should coerce numeric requestId values");

const assertRequestIdNormalizerUsage = (label, src) => {
  assert.ok(
    src.includes("./_shared/poker-request-id.mjs") && /normalizeRequestId/.test(src),
    `${label} should import normalizeRequestId helper`
  );
  assert.ok(
    /normalizeRequestId\([\s\S]*?payload\s*\?\.\s*requestId[\s\S]*?\{\s*maxLen\s*:\s*200\s*\}[\s\S]*?\)/.test(src),
    `${label} should normalize requestId with maxLen 200`
  );
};

assertRequestIdNormalizerUsage("join", joinSrc);
assertRequestIdNormalizerUsage("leave", leaveSrc);
assertRequestIdNormalizerUsage("heartbeat", heartbeatSrc);

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
assert.ok(pokerUiSrc.includes("poker_leave_bind"), "poker UI should log leave bind state");
assert.ok(pokerUiSrc.includes("poker_leave_click"), "poker UI should log leave click");
const heartbeatCallRegex =
  /apiPost\(\s*HEARTBEAT_URL[\s\S]*?\{[\s\S]*?tableId\s*:\s*tableId[\s\S]*?requestId\s*:\s*(?:requestId|heartbeatRequestId|String\(\s*heartbeatRequestId\s*\))[\s\S]*?\}[\s\S]*?\)/;
assert.ok(heartbeatCallRegex.test(pokerUiSrc), "poker UI heartbeat should send requestId and tableId");
assert.ok(!/tbl\.max_players/.test(pokerUiSrc), "poker UI should not read tbl.max_players");
assert.ok(!/table\.max_players/.test(pokerUiSrc), "poker UI should not read table.max_players");
assert.ok(!/tbl\.seat_count/.test(pokerUiSrc), "poker UI should not read tbl.seat_count");
assert.ok(!/table\.seat_count/.test(pokerUiSrc), "poker UI should not read table.seat_count");
assert.ok(!joinSrc.includes("RUNNING"), "join should not set status to RUNNING");
assert.ok(!leaveSrc.includes("RUNNING"), "leave should not set status to RUNNING");
assert.ok(joinSrc.includes("REQUEST_PENDING_STALE_SEC"), "join should guard stale pending requests");
assert.ok(leaveSrc.includes("REQUEST_PENDING_STALE_SEC"), "leave should guard stale pending requests");
assert.ok(heartbeatSrc.includes("REQUEST_PENDING_STALE_SEC"), "heartbeat should guard stale pending requests");
assert.ok(leaveSrc.includes("poker_leave_start"), "leave should log poker_leave_start");
assert.ok(leaveSrc.includes("poker_leave_ok"), "leave should log poker_leave_ok");
assert.ok(leaveSrc.includes("poker_leave_error"), "leave should log poker_leave_error");
assert.ok(
  /select result_json, created_at from public\.poker_requests/.test(joinSrc),
  "join should query request created_at for pending checks"
);
assert.ok(
  /select result_json, created_at from public\.poker_requests/.test(leaveSrc),
  "leave should query request created_at for pending checks"
);
assert.ok(
  /select result_json, created_at from public\.poker_requests/.test(heartbeatSrc),
  "heartbeat should query request created_at for pending checks"
);
assert.ok(
  /table_id = \$1 and request_id = \$2/.test(joinSrc),
  "join should scope request queries by table_id and request_id"
);
assert.ok(
  /table_id = \$1 and request_id = \$2/.test(leaveSrc),
  "leave should scope request queries by table_id and request_id"
);
assert.ok(
  /table_id = \$1 and request_id = \$2/.test(heartbeatSrc),
  "heartbeat should scope request queries by table_id and request_id"
);
assert.ok(
  ciWorkflowSrc.includes("playwright install --with-deps"),
  "ci workflow should install Playwright with deps"
);
assert.ok(
  testsWorkflowSrc.includes("playwright install --with-deps"),
  "tests workflow should install Playwright with deps"
);
assert.ok(
  matrixWorkflowSrc.includes("playwright install --with-deps"),
  "matrix workflow should install Playwright with deps"
);
assert.ok(
  phase1MigrationSrc.includes("poker_requests_created_at_idx"),
  "migration should add poker_requests created_at index"
);
assert.ok(
  phase1MigrationSrc.includes("unique (table_id, request_id)"),
  "migration should scope poker_requests uniqueness to table_id + request_id"
);
assert.ok(
  phase1MigrationSrc.includes("poker_requests_table_id_request_id_key"),
  "migration should add poker_requests table_id/request_id unique index"
);
assert.ok(
  phase1MigrationSrc.includes("pg_constraint") && phase1MigrationSrc.includes("drop constraint %I"),
  "migration should dynamically drop legacy unique constraint"
);
assert.ok(
  sweepSrc.includes("delete from public.poker_requests"),
  "sweep should delete old poker_requests"
);
