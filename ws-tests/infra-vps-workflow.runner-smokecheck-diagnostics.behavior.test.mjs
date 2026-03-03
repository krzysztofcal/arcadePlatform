import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("infra VPS runner ws smoke-check logs stage/status diagnostics on failure", () => {
  const text = workflowText();

  assert.ok(text.includes("- name: Smoke-check ws.kcswh.pl from runner"));
  assert.ok(text.includes("timeout 15s node <<'NODE'"));
  assert.ok(text.includes("let stage = 'connect';"));
  assert.ok(text.includes("let statusLine = '';"));
  assert.ok(text.includes("let wsAccept = '';"));
  assert.ok(text.includes("ws-smoke fail stage=${stage}"));
  assert.ok(text.includes("reason=${reason}"));
  assert.ok(text.includes("status=${statusLine || 'n/a'}"));
  assert.ok(text.includes("accept=${wsAccept || 'n/a'}"));
  assert.ok(text.includes("unexpected-status"));
  assert.ok(text.includes("invalid-accept-header"));
});
