import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const getTableSrc = read("netlify/functions/poker-get-table.mjs");
const sweepSrc = read("netlify/functions/poker-sweep.mjs");
const joinSrc = read("netlify/functions/poker-join.mjs");
const wsClientSrc = read("poker/poker-ws-client.js");
const leaveSrc = read("netlify/functions/poker-leave.mjs");
const leaveDomainSrc = read("shared/poker-domain/leave.mjs");
const requestIdHelperSrc = read("netlify/functions/_shared/poker-request-id.mjs");
const idempotencyHelperSrc = read("netlify/functions/_shared/poker-idempotency.mjs");
const startHandSrc = read("netlify/functions/poker-start-hand.mjs");
const startHandCoreSrc = read("netlify/functions/_shared/poker-start-hand-core.mjs");
const pokerUiSrc = read("poker/poker.js");
const phase1MigrationSrc = read("supabase/migrations/20260117090000_poker_phase1_authoritative_seats.sql");
const idempotencyMigrationSrc = read("supabase/migrations/20260118000000_poker_requests_idempotency_scope.sql");
const ciWorkflowSrc = read(".github/workflows/ci.yml");
const testsWorkflowSrc = read(".github/workflows/tests.yml");
const matrixWorkflowSrc = read(".github/workflows/playwright-matrix.yml");

// ---- request-id helper protections (non-heartbeat) ----
assert.ok(/trimmed\s*===\s*"\[object PointerEvent\]"/.test(requestIdHelperSrc), "requestId helper should reject pointer event string");
assert.ok(/trimmed\.length\s*>\s*maxLen/.test(requestIdHelperSrc), "requestId helper should enforce max length");
assert.ok(/typeof\s+\w+\s*===\s*"number"[\s\S]*?Number\.isFinite/.test(requestIdHelperSrc), "requestId helper should coerce numeric requestId values");

// ---- idempotency scope protections (non-heartbeat) ----
assert.ok(/table_id = \$1 and user_id = \$2 and request_id = \$3 and kind = \$4/.test(idempotencyHelperSrc), "idempotency helper should scope queries by table/user/request/kind");
assert.ok(/on conflict \(table_id, kind, request_id, user_id\)/.test(idempotencyHelperSrc), "idempotency helper upsert should use table/kind/request/user scope");
assert.ok(!/on conflict \(table_id, request_id\)/.test(idempotencyHelperSrc), "idempotency helper should not use legacy table/request scope");
assert.ok(idempotencyMigrationSrc.includes("poker_requests_table_kind_request_id_user_id_key"), "idempotency migration should add scoped unique key");

// ---- WS-only join/leave contract guards ----
assert.ok(joinSrc.includes("join_http_retired"), "join endpoint should remain explicit retired path");
assert.ok(joinSrc.includes("WS-only"), "join endpoint should explain WS-only gameplay join");
assert.ok(!/apiPost\(\s*LEAVE_URL/.test(pokerUiSrc), "UI leave should not use HTTP fallback");
assert.ok(wsClientSrc.includes("sendJoin"), "WS client should expose sendJoin");
assert.ok(wsClientSrc.includes("sendLeave"), "WS client should expose sendLeave");
assert.ok(wsClientSrc.includes("sendAct"), "WS client should expose sendAct");

// ---- get-table non-mutation / payload-shape guards ----
assert.ok(!getTableSrc.includes("set last_activity_at"), "get-table should not bump table activity timestamps");
assert.ok(!/update public\.poker_seats set status = 'INACTIVE'/.test(getTableSrc), "get-table should not inactivate seats");
assert.ok(!/max_players\s*:/.test(getTableSrc), "get-table should avoid duplicate max_players payload shape");
assert.ok(!/last_activity_at\s*:/.test(getTableSrc), "get-table should avoid duplicate last_activity_at payload shape");

// ---- leave/start-hand/storage invariants ----
assert.ok(!leaveSrc.includes("not_seated"), "leave should stay idempotent when user is not seated");
assert.ok(!leaveSrc.includes("nothing_to_cash_out"), "leave should not fail when stack is missing");
assert.ok(leaveSrc.includes("poker_leave_error"), "leave should keep error logging");
assert.ok(leaveDomainSrc.includes("REQUEST_PENDING_STALE_SEC"), "leave domain should guard stale pending requests");
assert.ok(startHandSrc.includes("status = 'ACTIVE'"), "start-hand should select ACTIVE seats");
assert.ok(startHandCoreSrc.includes("nextStacks"), "start-hand core should rebuild stacks from active seats");
assert.ok(startHandCoreSrc.includes("derivedSeats"), "start-hand core should derive seats from active rows");

// ---- sweep/security and SQL guards ----
assert.ok(sweepSrc.includes("POKER_SWEEP_SECRET"), "sweep should require sweep secret");
assert.ok(sweepSrc.includes("x-sweep-secret"), "sweep should validate x-sweep-secret");
assert.ok(/event\.httpMethod\s*!==\s*"POST"/.test(sweepSrc), "sweep should enforce POST-only");
assert.ok(sweepSrc.includes("delete from public.poker_requests"), "sweep should clean old poker_requests");

// ---- workflow/toolchain guards ----
assert.ok(ciWorkflowSrc.includes("playwright install --with-deps"), "ci workflow should install Playwright with deps");
assert.ok(testsWorkflowSrc.includes("playwright install --with-deps"), "tests workflow should install Playwright with deps");
assert.ok(matrixWorkflowSrc.includes("playwright install --with-deps"), "matrix workflow should install Playwright with deps");
assert.ok(phase1MigrationSrc.includes("poker_requests_created_at_idx"), "phase1 migration should keep created_at index");



// ---- UI requestId + retry contracts (non-heartbeat) ----
assert.ok(/function\s+resolveRequestId\s*\(/.test(pokerUiSrc), "UI should define resolveRequestId helper");
assert.ok(/if\s*\(\s*pending\s*\)\s*return\s*\{[\s\S]*?requestId\s*:\s*pending[\s\S]*?nextPending\s*:\s*pending[\s\S]*?\}/.test(pokerUiSrc), "UI should retain pending requestId during retry flow");
assert.ok(/async function retryJoin\([\s\S]*?joinTable\(pendingJoinRequestId\)/.test(pokerUiSrc), "retryJoin should call joinTable with pendingJoinRequestId");
assert.ok(/async function retryLeave\([\s\S]*?leaveTable\(pendingLeaveRequestId\)/.test(pokerUiSrc), "retryLeave should call leaveTable with pendingLeaveRequestId");
assert.ok(/resolveRequestId\(\s*pendingJoinRequestId\s*,\s*requestIdOverride\s*\)/.test(pokerUiSrc), "join flow should resolve requestId from pendingJoinRequestId");
assert.ok(/resolveRequestId\(\s*pendingLeaveRequestId\s*,\s*requestIdOverride\s*\)/.test(pokerUiSrc), "leave flow should resolve requestId from pendingLeaveRequestId");
assert.ok(/var\s+joinPayload\s*=\s*\{[\s\S]*?requestId\s*:\s*joinRequestId[\s\S]*?\}\s*;/.test(pokerUiSrc), "join WS payload should send requestId");
assert.ok(/leaveSender\(\{ tableId: tableId, requestId: leaveRequestId \}, leaveRequestId\)/.test(pokerUiSrc), "leave WS send should pass leave requestId");
assert.ok(!/String\(\s*joinRequestId\s*\)/.test(pokerUiSrc), "join requestId must not be stringified");
assert.ok(!/String\(\s*leaveRequestId\s*\)/.test(pokerUiSrc), "leave requestId must not be stringified");
assert.ok(/var\s+pendingJoinAutoSeat\s*=\s*false;/.test(pokerUiSrc), "pendingJoinAutoSeat contract should remain declared");
assert.ok(/requestIdOverride\s*===\s*pendingJoinRequestId[\s\S]*?wantAutoSeat\s*=\s*!!pendingJoinAutoSeat/.test(pokerUiSrc), "join retry should preserve pendingJoinAutoSeat behavior");

// ---- idempotency helper behavior + leave-domain helper usage ----
assert.ok(/select result_json, created_at from public\.poker_requests/.test(idempotencyHelperSrc), "idempotency helper should read created_at for pending checks");
assert.ok(leaveDomainSrc.includes("ensurePokerRequest") && leaveDomainSrc.includes("storePokerRequestResult"), "leave domain should use shared idempotency helpers");

// ---- heartbeat retirement scope note ----
// We intentionally keep heartbeat-specific assertions out of this file. Heartbeat removal is guarded by
// dedicated tests (e.g. tests/poker-ui-no-heartbeat.guard.test.mjs) so non-heartbeat contracts stay covered here.
assert.ok(!pokerUiSrc.includes("poker-heartbeat"), "UI should not reference retired heartbeat endpoint");
