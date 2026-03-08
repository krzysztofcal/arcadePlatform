import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");
}

test("ws-deploy keeps ws-tests trigger surface and runs harness checks", () => {
  const text = workflowText();

  assert.match(text, /"ws-tests\/\*\*"/);
  assert.match(text, /"\.github\/workflows\/ws-deploy\.yml"/);

  const pushBlockMatch = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\njobs:/);
  const pushBlock = pushBlockMatch ? pushBlockMatch[1] : "";
  assert.doesNotMatch(pushBlock, /"ws-server\/\*\*"/);

  assert.match(text, /node --test ws-tests\/ws-deploy-workflow\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-tests-suite-completeness\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-production-deploy-collision\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-deploy\.no-prod-mutation-on-ws-tests\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-server-deploy-artifact-path\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-server-deploy-rollout\.test\.mjs/);
  assert.match(text, /Run state-patch behavior test/);
  assert.match(text, /node --test ws-server\/poker\/read-model\/state-patch\.behavior\.test\.mjs/);
  assert.match(text, /Run stream-log behavior test/);
  assert.match(text, /node --test ws-server\/poker\/runtime\/stream-log\.behavior\.test\.mjs/);
});

test("ws-deploy is non-mutating for production", () => {
  const text = workflowText();

  assert.doesNotMatch(text, /docker\/login-action@/);
  assert.doesNotMatch(text, /docker\/build-push-action@/);
  assert.doesNotMatch(text, /appleboy\/ssh-action@/);
  assert.doesNotMatch(text, /appleboy\/scp-action@/);
  assert.doesNotMatch(text, /dorny\/paths-filter@/);
});
