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

const stopPollingBlock = extractFunctionBlock(source, "stopPolling");
assert.match(stopPollingBlock, /clearDeadlineNudge\s*\(/, "Expected stopPolling() to clear deadline nudge timer");
