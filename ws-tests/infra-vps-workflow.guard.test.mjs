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
  assert.notEqual(start, -1, "remote bash heredoc must exist");
  assert.notEqual(end, -1, "remote bash heredoc terminator must exist");
  return text.slice(start, end);
}

test("infra VPS workflow keeps infra/vps path filters", () => {
  const text = workflowText();
  assert.ok(text.includes("pull_request:"));
  assert.ok(text.includes("push:"));
  assert.ok(text.includes('"infra/vps/**"'));
});

test("infra VPS workflow keeps contents: read permissions", () => {
  const text = workflowText();
  const validateBlock = text.slice(text.indexOf("  validate:"), text.indexOf("  apply:"));
  assert.ok(validateBlock.includes("permissions:"));
  assert.ok(validateBlock.includes("contents: read"));
  const applyBlock = text.slice(text.indexOf("  apply:"));
  assert.ok(applyBlock.includes("permissions:"));
  assert.ok(applyBlock.includes("contents: read"));
});

test("infra VPS workflow uses WS_* secrets and avoids VPS_* secrets", () => {
  const text = workflowText();
  assert.ok(text.includes("secrets.WS_HOST"));
  assert.ok(text.includes("secrets.WS_USER"));
  assert.ok(text.includes("secrets.WS_SSH_KEY"));
  assert.equal(text.includes("secrets.VPS_HOST"), false);
  assert.equal(text.includes("secrets.VPS_USER"), false);
  assert.equal(text.includes("secrets.VPS_SSH_KEY"), false);
});

test("infra VPS workflow keeps concurrency guard", () => {
  const text = workflowText();
  assert.ok(text.includes("concurrency:"));
  assert.ok(text.includes("group: infra-vps-${{ github.ref }}"));
  assert.ok(text.includes("cancel-in-progress: false"));
});

test("infra VPS remote bash keeps rollback safety and non-interactive sudo", () => {
  const remote = remoteBash(workflowText());
  assert.ok(remote.includes("set -Eeuo pipefail"));
  assert.ok(remote.includes("trap 'on_error' ERR"));
  assert.ok(remote.includes("rollback()"));
  assert.ok(remote.includes("sudo -n cp \"$BACKUP_PATH\" \"$CADDY_PATH\" || true"));
  assert.ok(remote.includes("sudo -n systemctl reload caddy || true"));
  assert.ok(remote.includes("sudo -n caddy validate --config /etc/caddy/Caddyfile"));
  assert.ok(remote.includes("sudo -n systemctl reload caddy"));
  assert.equal(remote.includes("sudo caddy validate"), false);
  assert.equal(remote.includes("sudo systemctl reload caddy"), false);
});

test("infra VPS remote bash verifies backup before overwrite and validates before reload", () => {
  const remote = remoteBash(workflowText());

  const backupCopyIndex = remote.indexOf('sudo -n cp "$CADDY_PATH" "$BACKUP_PATH"');
  const backupExistsIndex = remote.indexOf('sudo -n test -f "$BACKUP_PATH"', backupCopyIndex);
  const applyIndex = remote.indexOf('sudo -n cp "$TMP_PATH" "$CADDY_PATH"', backupExistsIndex);
  const validateIndex = remote.indexOf("sudo -n caddy validate", applyIndex);
  const reloadIndex = remote.indexOf("sudo -n systemctl reload caddy", validateIndex);

  assert.notEqual(backupCopyIndex, -1);
  assert.notEqual(backupExistsIndex, -1);
  assert.notEqual(applyIndex, -1);
  assert.notEqual(validateIndex, -1);
  assert.notEqual(reloadIndex, -1);
  assert.equal(backupCopyIndex < backupExistsIndex, true);
  assert.equal(backupExistsIndex < applyIndex, true);
  assert.equal(applyIndex < validateIndex, true);
  assert.equal(validateIndex < reloadIndex, true);
});

test("infra VPS workflow removes remote websocket curl upgrade and adds runner node smoke-check", () => {
  const text = workflowText();
  const remote = remoteBash(text);

  assert.equal(remote.includes("Upgrade: websocket"), false);
  assert.equal(remote.includes("Sec-WebSocket-Key"), false);
  assert.equal(remote.includes("https://ws.kcswh.pl/ws"), false);
  assert.equal(remote.includes("--http1.1"), false);

  assert.ok(text.includes("- name: Smoke-check ws.kcswh.pl from runner"));
  assert.ok(text.includes("timeout 15s node <<'NODE'"));
  assert.ok(text.includes('"type":"helloAck"'));
});
