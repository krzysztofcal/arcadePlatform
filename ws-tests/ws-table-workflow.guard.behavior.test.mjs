import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText(path) {
  return fs.readFileSync(path, "utf8");
}

const TABLE_TEST_COMMAND = "node --test ws-server/poker/table/table.behavior.test.mjs";
const SERVER_TEST_COMMAND = "node --test ws-server/server.behavior.test.mjs";
const SUITE_GUARD_COMMAND = "node --test ws-tests/ws-tests-suite-completeness.guard.test.mjs";

test("PR workflow includes PR3 table behavior test command", () => {
  const text = workflowText(".github/workflows/ws-pr-checks.yml");
  assert.ok(text.includes(TABLE_TEST_COMMAND));
});

test("deploy workflow includes PR3 table behavior test command", () => {
  const text = workflowText(".github/workflows/ws-deploy.yml");
  assert.ok(text.includes(TABLE_TEST_COMMAND));
});

test("workflow ordering runs server behavior, then PR3 table behavior, then suite completeness guard", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const text of [prWorkflow, deployWorkflow]) {
    const serverIndex = text.indexOf(SERVER_TEST_COMMAND);
    const tableIndex = text.indexOf(TABLE_TEST_COMMAND);
    const suiteGuardIndex = text.indexOf(SUITE_GUARD_COMMAND);

    assert.notEqual(serverIndex, -1);
    assert.notEqual(tableIndex, -1);
    assert.notEqual(suiteGuardIndex, -1);
    assert.equal(serverIndex < tableIndex, true);
    assert.equal(tableIndex < suiteGuardIndex, true);
  }
});
