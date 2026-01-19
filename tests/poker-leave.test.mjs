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
  /const cashOutAmount = stackValue \?\? 0;/.test(leaveSrc),
  "leave should default cashOutAmount to 0"
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
  /if \(cashOutAmount > 0\)[\s\S]*?TABLE_CASH_OUT/.test(leaveSrc),
  "leave should cash out only when cashOutAmount > 0"
);
assert.ok(
  /poker:leave:\$\{tableId\}:\$\{auth\.userId\}:\$\{requestId\}/.test(leaveSrc),
  "leave should scope requestId idempotency by tableId and userId"
);
