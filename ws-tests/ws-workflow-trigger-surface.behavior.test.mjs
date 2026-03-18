import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const REQUIRED_TRIGGER_PATHS = [
  "ws-server/**",
  "ws-tests/**",
  "shared/**",
  "poker/**",
  "tests/**",
  "scripts/test-all.mjs",
  "tests/test-all.runner-registration.guard.test.mjs"
];

const REQUIRED_PR_WORKFLOW_FILE_TRIGGERS = [
  ".github/workflows/ws-pr-checks.yml",
  ".github/workflows/ws-deploy.yml",
  ".github/workflows/ws-preview-deploy.yml"
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function pullRequestPathsBlock(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/pull_request:\n[\s\S]*?paths:\n([\s\S]*?)(?:\n\s*[a-zA-Z_]+:|$)/);
  return match ? match[1] : "";
}

function pushPathsBlock(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/push:\n[\s\S]*?paths:\n([\s\S]*?)(?:\n\s*[a-zA-Z_]+:|$)/);
  return match ? match[1] : "";
}

test("ws-pr-checks pull_request trigger paths include required literal coverage", () => {
  const text = read(".github/workflows/ws-pr-checks.yml");
  const block = pullRequestPathsBlock(text);
  assert.notEqual(block, "", "Missing pull_request.paths block in .github/workflows/ws-pr-checks.yml");

  for (const triggerPath of REQUIRED_TRIGGER_PATHS) {
    assert.ok(
      block.includes(`- "${triggerPath}"`),
      `Missing trigger path in .github/workflows/ws-pr-checks.yml: ${triggerPath}`
    );
  }

  for (const workflowPath of REQUIRED_PR_WORKFLOW_FILE_TRIGGERS) {
    assert.ok(
      block.includes(`- "${workflowPath}"`),
      `Missing trigger path in .github/workflows/ws-pr-checks.yml: ${workflowPath}`
    );
  }
});

test("ws-deploy push trigger paths include required literal coverage", () => {
  const text = read(".github/workflows/ws-deploy.yml");
  const block = pushPathsBlock(text);
  assert.notEqual(block, "", "Missing push.paths block in .github/workflows/ws-deploy.yml");

  for (const triggerPath of REQUIRED_TRIGGER_PATHS) {
    assert.ok(
      block.includes(`- "${triggerPath}"`),
      `Missing trigger path in .github/workflows/ws-deploy.yml: ${triggerPath}`
    );
  }
});


test("literal shared/** trigger coverage in both ws workflows", () => {
  const pr = read(".github/workflows/ws-pr-checks.yml");
  const deploy = read(".github/workflows/ws-deploy.yml");
  const prBlock = pullRequestPathsBlock(pr);
  const deployBlock = pushPathsBlock(deploy);

  assert.ok(prBlock.includes(`- "shared/**"`), "PR workflow must include literal shared/** trigger");
  assert.ok(deployBlock.includes(`- "shared/**"`), "Deploy workflow must include literal shared/** trigger");
});
