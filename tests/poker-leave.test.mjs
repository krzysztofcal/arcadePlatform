import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const leaveSrc = read("netlify/functions/poker-leave.mjs");

assert.ok(
  /select seat_no, status, stack from public\.poker_seats[\s\S]*?for update;/.test(leaveSrc),
  "leave should lock seat row FOR UPDATE and load stack"
);
assert.ok(
  /const rawSeatStack = seatRow \? seatRow\.stack : null;/.test(leaveSrc),
  "leave should read raw seat stack for missing-stack detection"
);
assert.ok(
  /const stackValue = normalizeSeatStack\(rawSeatStack\);/.test(leaveSrc),
  "leave should normalize stack from seat row"
);
assert.ok(
  /const stateStackRaw = currentState\?\.stacks\?\.\[auth\.userId\];/.test(leaveSrc),
  "leave should read authoritative stack from poker_state"
);
assert.ok(
  /const stateStack = normalizeNonNegativeInt\(Number\(stateStackRaw\)\);/.test(leaveSrc),
  "leave should normalize authoritative stack to a non-negative integer"
);
assert.ok(
  /const seatStack = normalizeNonNegativeInt\(Number\(rawSeatStack\)\);/.test(leaveSrc),
  "leave should normalize seat stack as fallback"
);
assert.ok(
  /const cashOutAmount = stateStack \?\? seatStack \?\? 0;/.test(leaveSrc),
  "leave should initialize cashOutAmount from authoritative state/seat stack"
);
assert.ok(
  /const isStackMissing = rawSeatStack == null;/.test(leaveSrc),
  "leave should treat null/undefined stack as missing"
);
assert.ok(
  /if \(isStackMissing\) \{\s*klog\("poker_leave_stack_missing"/.test(leaveSrc),
  "leave should only log missing stack when raw stack is null"
);
assert.ok(
  /if \(cashOutAmount > 0\) \{[\s\S]*?TABLE_CASH_OUT/.test(leaveSrc),
  "leave should cash out only when positive amount exists"
);
assert.ok(
  /poker:leave:\$\{tableId\}:\$\{auth\.userId\}:\$\{normalizedRequestId\}/.test(leaveSrc),
  "leave should scope requestId idempotency by tableId and userId"
);

assert.ok(!/POKER_SYSTEM_ACTOR_USER_ID/.test(leaveSrc), "leave should not depend on system actor env var");
assert.ok(!/cashoutBotSeatIfNeeded/.test(leaveSrc), "leave should not use bot cashout helper");
assert.ok(!/ensureBotSeatInactiveForCashout/.test(leaveSrc), "leave should not use bot inactive helper");
assert.ok(!/getBotConfig/.test(leaveSrc), "leave should not read bot config");
assert.ok(!/is_bot/.test(leaveSrc), "leave should not branch on is_bot");
