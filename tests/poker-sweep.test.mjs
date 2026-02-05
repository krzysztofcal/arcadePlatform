import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const sweepSrc = read("netlify/functions/poker-sweep.mjs");

assert.ok(
  /select seat_no, status, stack, last_seen_at from public\.poker_seats[\s\S]*?for update;/.test(sweepSrc),
  "sweep should lock seat rows before timeout cash-out"
);
assert.ok(sweepSrc.includes("EXPIRED_SEATS_LIMIT"), "sweep should define EXPIRED_SEATS_LIMIT");
assert.ok(
  /order by last_seen_at asc[\s\S]*limit \$2/.test(sweepSrc),
  "sweep should cap expired seat scan"
);
assert.ok(
  sweepSrc.includes("const normalizeNonNegativeInt ="),
  "sweep should define non-negative integer normalization helper"
);
assert.ok(
  /select state from public\.poker_state where table_id = \$1 for update;/.test(sweepSrc),
  "sweep should lock poker_state during auto-cashout"
);
assert.ok(
  /const currentState = normalizeState\(stateRow\?\.state\);/.test(sweepSrc),
  "sweep should normalize poker_state payload"
);
assert.ok(
  /const stateStack = normalizeNonNegativeInt\(Number\(currentState\?\.stacks\?\.\[userId\]\)\);/.test(sweepSrc),
  "sweep should prefer authoritative state stack"
);
assert.ok(
  /const seatStack = normalizeNonNegativeInt\(Number\(locked\.stack\)\);/.test(sweepSrc),
  "sweep should normalize seat fallback stack"
);
assert.ok(
  /const amount = stateStack \?\? seatStack \?\? 0;/.test(sweepSrc),
  "sweep should choose state stack first, then seat stack, then zero"
);
assert.ok(
  /delete nextStacks\[userId\]/.test(sweepSrc),
  "sweep should clear authoritative stack entry for removed users"
);
assert.ok(
  /JSON\.stringify\(nextState\)/.test(sweepSrc),
  "sweep should serialize poker_state updates as JSON"
);
assert.ok(
  /if \(amount > 0\)[\s\S]*?TABLE_CASH_OUT/.test(sweepSrc),
  "sweep should cash out only when stack is positive"
);
assert.ok(
  /normalizedStack\s*>\s*0[\s\S]*?TABLE_CASH_OUT/.test(sweepSrc),
  "sweep should cash out close settlements only when stack is positive"
);
assert.ok(
  sweepSrc.includes("poker:timeout_cashout:${tableId}:${userId}:${locked.seat_no}:v1"),
  "sweep should use table/user/seat-scoped idempotency key"
);
assert.ok(
  /update public\.poker_seats set status = 'INACTIVE', stack = 0/.test(sweepSrc),
  "sweep should inactivate seats and zero stack"
);
assert.ok(
  sweepSrc.includes("poker_timeout_cashout_ok") &&
    sweepSrc.includes("poker_timeout_cashout_skip") &&
    sweepSrc.includes("poker_timeout_cashout_fail"),
  "sweep should log timeout cash-out outcomes"
);
assert.ok(sweepSrc.includes("poker_sweep_timeout_summary"), "sweep should log timeout summary");
assert.ok(
  sweepSrc.includes("delete from public.poker_hole_cards"),
  "sweep should delete hole cards for closed tables"
);
assert.ok(
  sweepSrc.includes("poker:close_cashout:${tableId}:${userId}:${seatNo}:v1"),
  "sweep should use close cashout idempotency key"
);
assert.ok(
  sweepSrc.includes("poker_close_cashout_ok") &&
    sweepSrc.includes("poker_close_cashout_skip") &&
    sweepSrc.includes("poker_close_cashout_fail"),
  "sweep should log close cash-out outcomes"
);
assert.ok(
  /poker_close_cashout[\s\S]*?update public\.poker_seats set status = 'INACTIVE', stack = 0/.test(sweepSrc),
  "sweep should zero stacks after close cash-out settlement"
);
assert.ok(sweepSrc.includes("poker_sweep_close_cashout_summary"), "sweep should log close cash-out summary");
