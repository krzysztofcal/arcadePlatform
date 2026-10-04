import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy job is gated by validate completion before mutation steps", () => {
  const text = workflowText();

  assert.match(text, /validate:[\s\S]*?runs-on: ubuntu-latest/);
  assert.doesNotMatch(text, /validate:\n\s+if: github\.event_name == 'pull_request'/);
  assert.match(text, /deploy:\n\s+needs: \[impact, validate\]/);

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

test('main validation contains the retained runtime/build and unique deploy safety contracts exactly once', () => {
  const text = workflowText();
  const validate = text.slice(text.indexOf('  validate:'), text.indexOf('  deploy:'));
  const commands = [...validate.matchAll(/node --test ([\w./-]+)/g)].map(m => m[1]);
  assert.equal(commands.length, new Set(commands).size, 'no repeated main test command');
  for (const file of [
    'ws-server/server.behavior.test.mjs',
    'shared/poker-domain/join.behavior.test.mjs',
    'ws-server/poker/engine/engine-rollover.behavior.test.mjs',
    'ws-server/poker/reconnect/resync.behavior.test.mjs',
    'ws-tests/ws-lockfile-integrity.test.mjs',
    'ws-tests/ws-smoke-check-script.behavior.test.mjs',
    'ws-tests/ws-server-deploy.remote-script.behavior.test.mjs',
    'ws-tests/ws-server-deploy.runner-smoke.behavior.test.mjs',
    'ws-tests/ws-deploy-workflow.test.mjs',
  ]) assert.ok(commands.includes(file), file);
  assert.match(validate, /docker build[^\n]*-f "\$WS_DOCKERFILE_PATH" "\$WS_DOCKER_BUILD_CONTEXT"/);
  assert.doesNotMatch(validate, /if:.*workflow_dispatch|if:.*== 'pull_request'/);
});
