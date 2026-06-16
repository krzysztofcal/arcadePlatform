import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function remoteBash(text) {
  const start = text.indexOf("bash <<'BASH'");
  const end = text.indexOf("\n            BASH", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return text.slice(start, end);
}

test("infra VPS remote bash keeps backup -> apply -> validate -> reload ordering", () => {
  const remote = remoteBash(workflowText());
  const backupIndex = remote.indexOf('sudo -n cp "$CADDY_PATH" "$BACKUP_PATH"');
  const applyIndex = remote.indexOf('sudo -n cp "$TMP_PATH" "$CADDY_PATH"', backupIndex);
  const validateIndex = remote.indexOf("sudo -n caddy validate", applyIndex);
  const reloadIndex = remote.indexOf("sudo -n systemctl reload caddy", validateIndex);

  assert.notEqual(backupIndex, -1);
  assert.notEqual(applyIndex, -1);
  assert.notEqual(validateIndex, -1);
  assert.notEqual(reloadIndex, -1);
  assert.equal(backupIndex < applyIndex, true);
  assert.equal(applyIndex < validateIndex, true);
  assert.equal(validateIndex < reloadIndex, true);
  assert.equal(remote.includes("curl -sS -o /dev/null -D"), false);
  assert.doesNotMatch(remote, /\/ws(?:[/?\\s'\"]|$)/);
});

test("infra VPS runner smoke-check runs after ssh-action step", () => {
  const text = workflowText();
  const sshStepIndex = text.indexOf("uses: appleboy/ssh-action@v1.0.3");
  const runnerSmokeIndex = text.indexOf("- name: Smoke-check ws.kcswh.pl from runner", sshStepIndex);

  assert.notEqual(sshStepIndex, -1);
  assert.notEqual(runnerSmokeIndex, -1);
  assert.equal(sshStepIndex < runnerSmokeIndex, true);
});
