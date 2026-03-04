import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");
}

function pushBlock(text) {
  const match = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\n\w/);
  return match ? match[1] : "";
}

test("ws-deploy push trigger surface keeps ws-tests coverage and avoids ws-server ownership", () => {
  const text = workflowText();
  const push = pushBlock(text);

  assert.match(push, /paths:[\s\S]*-\s*"ws-tests\/\*\*"/);
  assert.match(push, /paths:[\s\S]*-\s*"\.github\/workflows\/ws-deploy\.yml"/);
  assert.doesNotMatch(push, /"ws-server\/\*\*"/);
});
