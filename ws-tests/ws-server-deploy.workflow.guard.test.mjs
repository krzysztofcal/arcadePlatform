import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy workflow has guarded triggers, secrets and concurrency", () => {
  const text = workflowText();

  assert.match(text, /"ws-server\/\*\*"/);
  assert.match(text, /concurrency:\n\s+group: ws-server-\$\{\{ github\.ref \}\}/);
  assert.match(text, /permissions:\n\s+contents: read/);

  assert.match(text, /host: \$\{\{ secrets\.WS_HOST \}\}/);
  assert.match(text, /username: \$\{\{ secrets\.WS_USER \}\}/);
  assert.match(text, /key: \$\{\{ secrets\.WS_SSH_KEY \}\}/);
});

test("workflow separates validate and deploy with dependency gating", () => {
  const text = workflowText();

  assert.match(text, /validate:/);
  assert.match(text, /deploy:/);
  assert.doesNotMatch(text, /validate:\n\s+if: github\.event_name == 'pull_request'/);
  assert.match(text, /deploy:\n\s+needs: validate/);
  assert.match(text, /if: github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
});

test("workflow includes rollback discipline and atomic current switch markers", () => {
  const text = workflowText();

  assert.match(text, /trap 'on_error' ERR/);
  assert.match(text, /rollback\(\)/);
  assert.match(text, /ln -sfn "\$NEW_RELEASE_DIR" "\$CURRENT_LINK\.tmp"/);
  assert.match(text, /mv -Tf "\$CURRENT_LINK\.tmp" "\$CURRENT_LINK"/);
});
