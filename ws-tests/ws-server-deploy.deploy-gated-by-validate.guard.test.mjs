import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy job is gated by validate completion before mutation steps", () => {
  const text = workflowText();

  assert.match(text, /validate:\n\s+runs-on: ubuntu-latest/);
  assert.doesNotMatch(text, /validate:\n\s+if: github\.event_name == 'pull_request'/);
  assert.match(text, /deploy:\n\s+needs: validate/);

  const deployStart = text.indexOf("deploy:");
  assert.notEqual(deployStart, -1);
  const deployBlock = text.slice(deployStart);

  const guardStep = deployBlock.indexOf("node --test ws-tests/ws-server-deploy.workflow.guard.test.mjs");
  const scpStep = deployBlock.indexOf("uses: appleboy/scp-action@v0.1.7");
  const sshStep = deployBlock.indexOf("uses: appleboy/ssh-action@v1.0.3");

  assert.equal(guardStep, -1, "deploy job should not duplicate guard tests; it must rely on validate via needs");
  assert.notEqual(scpStep, -1);
  assert.notEqual(sshStep, -1);
});
