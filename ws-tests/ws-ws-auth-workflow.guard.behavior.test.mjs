import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText(path) {
  return fs.readFileSync(path, "utf8");
}

test("PR workflow runs ws-server behavior test before ws harness guards", () => {
  const text = workflowText(".github/workflows/ws-pr-checks.yml");
  const behaviorIndex = text.indexOf("node --test ws-server/server.behavior.test.mjs");
  const locationGuardIndex = text.indexOf("node --test ws-tests/ws-tests-location.guard.test.mjs");
  const suiteGuardIndex = text.indexOf("node --test ws-tests/ws-tests-suite-completeness.guard.test.mjs");

  assert.notEqual(behaviorIndex, -1);
  assert.notEqual(locationGuardIndex, -1);
  assert.notEqual(suiteGuardIndex, -1);
  assert.equal(behaviorIndex < locationGuardIndex, true);
  assert.equal(behaviorIndex < suiteGuardIndex, true);
});

test("deploy workflow runs ws-server behavior test before ws guard checks", () => {
  const text = workflowText(".github/workflows/ws-deploy.yml");
  const behaviorIndex = text.indexOf("node --test ws-server/server.behavior.test.mjs");
  const locationGuardIndex = text.indexOf("node --test ws-tests/ws-tests-location.guard.test.mjs");
  const suiteGuardIndex = text.indexOf("node --test ws-tests/ws-tests-suite-completeness.guard.test.mjs");

  assert.notEqual(behaviorIndex, -1);
  assert.notEqual(locationGuardIndex, -1);
  assert.notEqual(suiteGuardIndex, -1);
  assert.equal(behaviorIndex < locationGuardIndex, true);
  assert.equal(behaviorIndex < suiteGuardIndex, true);
});
