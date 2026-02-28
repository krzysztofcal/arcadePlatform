import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WS_TESTS_DIR = "ws-tests";

const EXCLUDED_FROM_PR = new Set([
  "ws-tests/ws-deploy-workflow.test.mjs",
  "ws-tests/ws-lockfile-integrity.test.mjs",
  "ws-tests/ws-smoke-check-script.behavior.test.mjs"
]);

const EXCLUDED_FROM_DEPLOY = new Set([
  "ws-tests/ws-pr-workflow.test.mjs"
]);

const EXCLUDED_FROM_BOTH = new Set([
  "ws-tests/ws-tests-suite-completeness.guard.test.mjs"
]);

function workflowText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function wsTestFiles() {
  return fs
    .readdirSync(WS_TESTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^ws-.*\.test\.mjs$/.test(entry.name))
    .map((entry) => path.posix.join(WS_TESTS_DIR, entry.name))
    .sort();
}

function mustRunInPr(file) {
  return !EXCLUDED_FROM_BOTH.has(file) && !EXCLUDED_FROM_PR.has(file);
}

function mustRunInDeploy(file) {
  return !EXCLUDED_FROM_BOTH.has(file) && !EXCLUDED_FROM_DEPLOY.has(file);
}

test("ws test suite has explicit PR/deploy coverage mapping", () => {
  const files = wsTestFiles();
  for (const file of files) {
    const mapped = EXCLUDED_FROM_BOTH.has(file) || mustRunInPr(file) || mustRunInDeploy(file);
    assert.equal(mapped, true, `Unmapped ws test file: ${file}`);
  }
});

test("required ws tests are wired into PR and deploy workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const file of wsTestFiles()) {
    if (mustRunInPr(file)) {
      assert.match(prWorkflow, new RegExp(`node --test ${file.replace(/\./g, "\\.")}`), `Missing in PR workflow: ${file}`);
    }

    if (mustRunInDeploy(file)) {
      assert.match(deployWorkflow, new RegExp(`node --test ${file.replace(/\./g, "\\.")}`), `Missing in deploy workflow: ${file}`);
    }
  }
});

test("protocol doc gate is present in both workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  assert.match(prWorkflow, /node --test ws-tests\/ws-poker-protocol-doc\.test\.mjs/);
  assert.match(deployWorkflow, /node --test ws-tests\/ws-poker-protocol-doc\.test\.mjs/);
});

test("no workflow references legacy tests/ws-* harness paths", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  assert.doesNotMatch(prWorkflow, /node --test tests\/ws-/);
  assert.doesNotMatch(deployWorkflow, /node --test tests\/ws-/);
});
