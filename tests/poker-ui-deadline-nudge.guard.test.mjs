import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("poker/poker.js", "utf8");

assert.match(source, /scheduleDeadlineNudge\s*\(\s*turnDeadlineAt\s*\)/, "Expected scheduleDeadlineNudge(turnDeadlineAt) helper");
assert.match(source, /setTimeout\s*\(/, "Expected deadline nudge to use setTimeout");
assert.match(source, /scheduleDeadlineNudge\s*\([\s\S]*?sendHeartbeat\s*\(/, "Expected deadline nudge to trigger sendHeartbeat()");
assert.match(source, /clearTimeout\s*\(\s*deadlineNudgeTimer\s*\)/, "Expected deadline nudge timer cleanup");
