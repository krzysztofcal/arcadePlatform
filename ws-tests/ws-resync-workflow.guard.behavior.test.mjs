import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText(path) {
  return fs.readFileSync(path, "utf8");
}

const RESYNC_TEST_COMMAND = "node --test ws-server/poker/reconnect/resync.behavior.test.mjs";
const RESYNC_STEP_NAME = "WS reconnect/resync regression tests";
const SERVER_TEST_COMMAND = "node --test ws-server/server.behavior.test.mjs";
const DEPLOY_WORKFLOW_GUARD_COMMAND = "node --test ws-tests/ws-server-deploy.workflow.guard.test.mjs";

test("PR workflow includes PR4 resync behavior test command", () => {
  const text = workflowText(".github/workflows/ws-pr-checks.yml");
  assert.ok(text.includes(RESYNC_TEST_COMMAND));
});

test("deploy workflow includes PR4 resync behavior test command", () => {
  const text = workflowText(".github/workflows/ws-deploy.yml");
  assert.ok(text.includes(RESYNC_TEST_COMMAND));
});

test("PR and deploy workflows keep the explicit reconnect/resync regression step name", () => {
  const prText = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployText = workflowText(".github/workflows/ws-deploy.yml");
  assert.ok(prText.includes(RESYNC_STEP_NAME));
  assert.ok(deployText.includes(RESYNC_STEP_NAME));
});

test("workflow ordering runs server behavior, then PR4 resync behavior, before deploy workflow guards", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const text of [prWorkflow, deployWorkflow]) {
    const serverIndex = text.indexOf(SERVER_TEST_COMMAND);
    const resyncIndex = text.indexOf(RESYNC_TEST_COMMAND);
    const deployGuardIndex = text.indexOf(DEPLOY_WORKFLOW_GUARD_COMMAND);

    assert.notEqual(serverIndex, -1);
    assert.notEqual(resyncIndex, -1);
    assert.notEqual(deployGuardIndex, -1);
    assert.equal(serverIndex < resyncIndex, true);
    assert.equal(resyncIndex < deployGuardIndex, true);
  }
});
