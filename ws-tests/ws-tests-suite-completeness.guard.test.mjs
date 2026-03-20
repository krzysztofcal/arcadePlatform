import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const WS_TESTS_DIR = "ws-tests";

const REQUIRED_PR8_WS_SERVER_BEHAVIOR_TESTS = [
  "ws-server/poker/read-model/room-core-snapshot.behavior.test.mjs",
  "ws-server/poker/read-model/state-snapshot.behavior.test.mjs",
  "ws-server/poker/shared/poker-primitives.behavior.test.mjs"
];

const REQUIRED_PR9_WS_SERVER_BEHAVIOR_TESTS = [
  "ws-server/server.behavior.test.mjs",
  "ws-server/poker/table/table-manager.behavior.test.mjs",
  "ws-server/poker/table/table-snapshot.behavior.test.mjs",
  "ws-server/poker/shared/poker-action-reducer.behavior.test.mjs",
  "ws-server/poker/read-model/state-snapshot.behavior.test.mjs"
];

const REQUIRED_PR16_WS_SERVER_BEHAVIOR_TESTS = [
  "ws-server/poker/engine/engine-bootstrap.behavior.test.mjs",
  "ws-server/poker/engine/engine-act.behavior.test.mjs",
  "ws-server/poker/engine/engine-rollover.behavior.test.mjs",
  "ws-server/poker/engine/engine-timeout.behavior.test.mjs"
];


const REQUIRED_AUTHORITATIVE_HANDLER_BEHAVIOR_TESTS = [
  "ws-server/poker/handlers/join.behavior.test.mjs",
  "ws-server/poker/handlers/start-hand.behavior.test.mjs",
  "ws-server/poker/handlers/act.behavior.test.mjs"
];


const REQUIRED_CLIENT_AUTHORITATIVE_BEHAVIOR_TESTS = [
  "tests/poker-ws-client.test.mjs",
  "tests/poker-ui-ws-join-smoke.behavior.test.mjs",
  "tests/poker-ui-ws-act-smoke.behavior.test.mjs",
  "tests/poker-ui-ws-write-path.guard.test.mjs",
  "ws-tests/ws-lobby-join-public-snapshot.behavior.test.mjs"
];

const REQUIRED_PERSISTED_BOOTSTRAP_BEHAVIOR_TESTS = [
  "ws-server/poker/bootstrap/persisted-bootstrap-adapter.behavior.test.mjs",
  "ws-server/poker/bootstrap/persisted-bootstrap-repository.behavior.test.mjs"
];
const EXCLUDED_FROM_PR = new Set([
  "ws-tests/ws-deploy-workflow.test.mjs",
  "ws-tests/ws-lockfile-integrity.test.mjs",
  "ws-tests/ws-smoke-check-script.behavior.test.mjs"
]);

const EXCLUDED_FROM_DEPLOY = new Set([
  "ws-tests/ws-pr-workflow.test.mjs",
  "ws-tests/ws-preview-deploy.remote-shape.guard.test.mjs",
  "ws-tests/ws-preview-deploy.workflow.guard.test.mjs"
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
    const command = `node --test ${file}`;

    if (mustRunInPr(file)) {
      assert.ok(prWorkflow.includes(command), `Missing in PR workflow: ${file}`);
    }

    if (mustRunInDeploy(file)) {
      assert.ok(deployWorkflow.includes(command), `Missing in deploy workflow: ${file}`);
    }
  }
});


const REQUIRED_WS_TRIGGER_PATHS = [
  "ws-server/**",
  "ws-tests/**",
  "shared/**",
  "poker/**",
  "tests/**",
  "netlify/functions/_shared/**",
  "docs/ws-poker-protocol.md",
  "scripts/test-all.mjs",
  "tests/test-all.runner-registration.guard.test.mjs"
];

test("WS PR/deploy workflows include required literal trigger paths", () => {
  const workflows = [
    ".github/workflows/ws-pr-checks.yml",
    ".github/workflows/ws-deploy.yml"
  ];

  for (const workflow of workflows) {
    const text = workflowText(workflow);
    for (const triggerPath of REQUIRED_WS_TRIGGER_PATHS) {
      assert.ok(
        text.includes(`- "${triggerPath}"`),
        `Missing trigger path in ${workflow}: ${triggerPath}`
      );
    }
  }
});


test("PR workflow must self-trigger and trigger on deploy workflow changes", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  assert.ok(
    prWorkflow.includes('- ".github/workflows/ws-pr-checks.yml"'),
    'Missing trigger path in .github/workflows/ws-pr-checks.yml: .github/workflows/ws-pr-checks.yml'
  );
  assert.ok(
    prWorkflow.includes('- ".github/workflows/ws-deploy.yml"'),
    'Missing trigger path in .github/workflows/ws-pr-checks.yml: .github/workflows/ws-deploy.yml'
  );
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");
  assert.ok(
    deployWorkflow.includes('- ".github/workflows/ws-pr-checks.yml"'),
    "Missing trigger path in .github/workflows/ws-deploy.yml: .github/workflows/ws-pr-checks.yml"
  );

});

test("workflow wiring check uses literal matching (no dynamic RegExp)", () => {
  const text = workflowText("ws-tests/ws-tests-suite-completeness.guard.test.mjs");
  assert.doesNotMatch(text, /\bnew RegExp\b/);
  assert.doesNotMatch(text, /\bRegExp\s*\(/);
  assert.match(text, /\.includes\(/);
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

test("legacy poker UI ws harness tests are absent from workflows and required client authoritative list", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");
  const legacyUiTests = [
    "tests/poker-ui-ws-health-fallback.behavior.test.mjs",
    "tests/poker-ui-ws-startup-order.behavior.test.mjs",
    "tests/poker-ui-ws-snapshot-equal-version.behavior.test.mjs",
    "tests/poker-ui-ws-auth-watch-order.behavior.test.mjs",
    "tests/poker-ui-ws-visibility.behavior.test.mjs",
    "tests/poker-ui-ws-join-authoritative.behavior.test.mjs"
  ];

  for (const file of legacyUiTests) {
    const command = `node --test ${file}`;
    assert.equal(REQUIRED_CLIENT_AUTHORITATIVE_BEHAVIOR_TESTS.includes(file), false, `Legacy UI smoke entry still required: ${file}`);
    assert.equal(prWorkflow.includes(command), false, `Legacy UI harness test still wired in PR workflow: ${file}`);
    assert.equal(deployWorkflow.includes(command), false, `Legacy UI harness test still wired in deploy workflow: ${file}`);
  }
});


test("PR8 WS-server behavior tests are wired in both PR and deploy workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const file of REQUIRED_PR8_WS_SERVER_BEHAVIOR_TESTS) {
    const command = `node --test ${file}`;
    assert.ok(prWorkflow.includes(command), `Missing PR8 WS-server test in PR workflow: ${file}`);
    assert.ok(deployWorkflow.includes(command), `Missing PR8 WS-server test in deploy workflow: ${file}`);
  }
});

test("PR9 WS-server behavior tests are wired in both PR and deploy workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const file of REQUIRED_PR9_WS_SERVER_BEHAVIOR_TESTS) {
    const command = `node --test ${file}`;
    assert.ok(prWorkflow.includes(command), `Missing PR9 WS-server test in PR workflow: ${file}`);
    assert.ok(deployWorkflow.includes(command), `Missing PR9 WS-server test in deploy workflow: ${file}`);
  }
});


test("PR16 WS-engine behavior tests are wired in both PR and deploy workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const file of REQUIRED_PR16_WS_SERVER_BEHAVIOR_TESTS) {
    const command = `node --test ${file}`;
    assert.ok(prWorkflow.includes(command), `Missing PR16 WS-engine test in PR workflow: ${file}`);
    assert.ok(deployWorkflow.includes(command), `Missing PR16 WS-engine test in deploy workflow: ${file}`);
  }
});


test("persisted bootstrap behavior tests are wired in both PR and deploy workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const file of REQUIRED_PERSISTED_BOOTSTRAP_BEHAVIOR_TESTS) {
    const command = `node --test ${file}`;
    assert.ok(prWorkflow.includes(command), `Missing persisted bootstrap test in PR workflow: ${file}`);
    assert.ok(deployWorkflow.includes(command), `Missing persisted bootstrap test in deploy workflow: ${file}`);
  }
});


test("authoritative handler behavior tests are wired in both PR and deploy workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const file of REQUIRED_AUTHORITATIVE_HANDLER_BEHAVIOR_TESTS) {
    const command = `node --test ${file}`;
    assert.ok(prWorkflow.includes(command), `Missing authoritative handler test in PR workflow: ${file}`);
    assert.ok(deployWorkflow.includes(command), `Missing authoritative handler test in deploy workflow: ${file}`);
  }
});


test("client authoritative behavior tests are wired in both PR and deploy workflows", () => {
  const prWorkflow = workflowText(".github/workflows/ws-pr-checks.yml");
  const deployWorkflow = workflowText(".github/workflows/ws-deploy.yml");

  for (const file of REQUIRED_CLIENT_AUTHORITATIVE_BEHAVIOR_TESTS) {
    const command = `node --test ${file}`;
    assert.ok(prWorkflow.includes(command), `Missing client authoritative test in PR workflow: ${file}`);
    assert.ok(deployWorkflow.includes(command), `Missing client authoritative test in deploy workflow: ${file}`);
  }
});
