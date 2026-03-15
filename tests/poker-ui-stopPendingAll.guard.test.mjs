import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = await readFile(path.join(root, "poker", "poker.js"), "utf8");

const start = source.indexOf("function stopPendingAll(){");
assert.ok(start >= 0, "stopPendingAll function should exist");
const end = source.indexOf("function pauseJoinPending(){", start);
assert.ok(end > start, "stopPendingAll block should be bounded by next function");
const body = source.slice(start, end);

assert.match(body, /clearJoinPending\(\)/, "stopPendingAll should clear join pending");
assert.match(body, /clearLeavePending\(\)/, "stopPendingAll should clear leave pending");
assert.match(body, /clearStartHandPending\(\)/, "stopPendingAll should clear start-hand pending");
assert.match(body, /clearActPending\(\)/, "stopPendingAll should clear action pending");
assert.match(body, /clearCopyLogPending\(\)/, "stopPendingAll should clear copy-log pending");
assert.match(body, /clearDumpLogsPending\(\)/, "stopPendingAll should clear dump-logs pending");
