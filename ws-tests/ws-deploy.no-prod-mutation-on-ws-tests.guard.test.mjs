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

test("ws-deploy never contains production mutation steps", () => {
  const text = workflowText();
  const push = pushBlock(text);

  assert.match(push, /"ws-tests\/\*\*"/);
  assert.doesNotMatch(push, /"ws-server\/\*\*"/);

  assert.doesNotMatch(text, /docker\/login-action@/);
  assert.doesNotMatch(text, /docker\/build-push-action@/);
  assert.doesNotMatch(text, /appleboy\/ssh-action@/);
  assert.doesNotMatch(text, /appleboy\/scp-action@/);
});
