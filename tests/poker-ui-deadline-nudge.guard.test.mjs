import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("poker/poker.js", "utf8");

function extractFunctionBlock(code, functionName){
  const marker = `function ${functionName}`;
  const start = code.indexOf(marker);
  assert.ok(start >= 0, `Expected ${functionName}() in poker/poker.js`);
  const open = code.indexOf("{", start);
  assert.ok(open >= 0, `Expected opening brace for ${functionName}()`);
  let depth = 0;
  for (let i = open; i < code.length; i++){
    const ch = code[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0){
      return code.slice(start, i + 1);
    }
  }
  assert.fail(`Could not extract ${functionName}() block`);
}

const scheduleBlock = extractFunctionBlock(source, "scheduleDeadlineNudge");

assert.match(scheduleBlock, /setTimeout\s*\(/, "Expected deadline nudge to use setTimeout");
assert.match(scheduleBlock, /sendHeartbeat\s*\(/, "Expected deadline nudge callback to trigger sendHeartbeat()");
assert.ok(
  /clearDeadlineNudge\s*\(/.test(scheduleBlock) || /clearTimeout\s*\(\s*deadlineNudgeTimer\s*\)/.test(scheduleBlock),
  "Expected deadline nudge scheduling path to include timer cleanup"
);
assert.match(scheduleBlock, /isPageActive\s*\(\s*\)/, "Expected deadline nudge callback to guard on page activity");
assert.match(
  scheduleBlock,
  /(joinPending|leavePending|startHandPending|actPending)/,
  "Expected deadline nudge callback to guard when a mutation request is pending"
);
assert.match(scheduleBlock, /heartbeatInFlight/, "Expected deadline nudge callback to guard heartbeat in-flight state");
