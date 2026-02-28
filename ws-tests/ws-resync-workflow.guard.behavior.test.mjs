import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText(path) {
  return fs.readFileSync(path, "utf8");
}

const RESYNC_TEST_COMMAND = "node --test ws-server/poker/reconnect/resync.behavior.test.mjs";
const SERVER_TEST_COMMAND = "node --test ws-server/server.behavior.test.mjs";
const SUITE_GUARD_COMMAND = "node --test ws-tests/ws-tests-suite-completeness.guard.test.mjs";

test("PR workflow includes PR4 resync behavior test command", () => {
  const text = workflowText(".github/workflows/ws-pr-checks.yml");
  assert.ok(text.includes(RESYNC_TEST_COMMAND));
});

test("deploy workflow includes PR4 resync behavior test command", () => {
  const text = workflowText(".github/workflows/ws-deploy.yml");
  assert.ok(text.includes(RESYNC_TEST_COMMAND));
});

test("workflow ordering runs server behavior, then PR4 resync behavior, then suite completeness guard", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const text of [prWorkflow, deployWorkflow]) {
    const serverIndex = text.indexOf(SERVER_TEST_COMMAND);
    const resyncIndex = text.indexOf(RESYNC_TEST_COMMAND);
    const suiteGuardIndex = text.indexOf(SUITE_GUARD_COMMAND);

    assert.notEqual(serverIndex, -1);
    assert.notEqual(resyncIndex, -1);
    assert.notEqual(suiteGuardIndex, -1);
    assert.equal(serverIndex < resyncIndex, true);
    assert.equal(resyncIndex < suiteGuardIndex, true);
  }
});
