import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SERVER_TEST_COMMAND = "node --test ws-server/server.behavior.test.mjs";
const CORE_TEST_COMMAND = "node --test ws-server/poker/core/core.behavior.test.mjs";
const DEPLOY_WORKFLOW_GUARD_COMMAND = "node --test ws-tests/ws-server-deploy.workflow.guard.test.mjs";

function workflowText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("PR workflow includes WS core behavior test command", () => {
  const text = workflowText(".github/workflows/ws-pr-checks.yml");
  assert.ok(text.includes(CORE_TEST_COMMAND));
});

test("deploy workflow includes WS core behavior test command", () => {
  const text = workflowText(".github/workflows/ws-deploy.yml");
  assert.ok(text.includes(CORE_TEST_COMMAND));
});

test("workflow ordering runs server behavior, then core behavior, before deploy workflow guards", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const text of [prWorkflow, deployWorkflow]) {
    const serverIndex = text.indexOf(SERVER_TEST_COMMAND);
    const coreIndex = text.indexOf(CORE_TEST_COMMAND);
    const deployGuardIndex = text.indexOf(DEPLOY_WORKFLOW_GUARD_COMMAND);

    assert.notEqual(serverIndex, -1);
    assert.notEqual(coreIndex, -1);
    assert.notEqual(deployGuardIndex, -1);
    assert.equal(serverIndex < coreIndex, true);
    assert.equal(coreIndex < deployGuardIndex, true);
  }
});
