import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";
const CADDYFILE_PATH = "infra/vps/Caddyfile";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function heredocEndOffset(text) {
  const start = text.indexOf("bash <<'BASH'");
  if (start === -1) return -1;

  const lines = text.split("\n");
  let offset = 0;
  let startLine = -1;
  let endLine = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = lineStart + line.length;

    if (startLine === -1 && start >= lineStart && start <= lineEnd) {
      startLine = i;
    } else if (startLine !== -1 && i > startLine && line.trim() === "BASH") {
      endLine = i;
      return lineEnd;
    }

    offset = lineEnd + 1;
  }

  if (startLine !== -1 && endLine <= startLine) return -1;
  return -1;
}

test("infra VPS workflow exists and is scoped to infra/vps path filters", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), `${WORKFLOW_PATH} should exist`);

  const text = read(WORKFLOW_PATH);
  assert.ok(text.includes("pull_request:"));
  assert.ok(text.includes("push:"));
  assert.ok(text.includes('"infra/vps/**"'));
});



test("infra VPS workflow validate job declares least-privilege contents read permissions", () => {
  const text = read(WORKFLOW_PATH);
  const validateIndex = text.indexOf("  validate:");
  const applyIndex = text.indexOf("  apply:", validateIndex);

  assert.notEqual(validateIndex, -1);
  assert.notEqual(applyIndex, -1);

  const validateBlock = text.slice(validateIndex, applyIndex);
  const permissionsIndex = validateBlock.indexOf("permissions:");
  const contentsReadIndex = validateBlock.indexOf("contents: read", permissionsIndex);

  assert.notEqual(permissionsIndex, -1);
  assert.notEqual(contentsReadIndex, -1);
  assert.equal(permissionsIndex < contentsReadIndex, true);
});
test("infra VPS Caddyfile preserves explicit /healthz, /ws*, and root OK routing", () => {
  const text = read(CADDYFILE_PATH);
  assert.match(text, /path\s+\/healthz/);
  assert.match(text, /path\s+\/ws\*/);
  assert.match(text, /reverse_proxy\s+127\.0\.0\.1:3000/);
  assert.match(text, /respond\s+"OK"\s+200/);
});

test("infra VPS workflow uses trap-based rollback after overwrite", () => {
  const text = read(WORKFLOW_PATH);
  assert.ok(text.includes("trap 'on_error' ERR"));
  assert.ok(text.includes("HAVE_BACKUP=0"));
  assert.ok(text.includes("HAVE_BACKUP=1"));
  assert.ok(text.includes("APPLIED=1"));
  assert.ok(text.includes("ROLLED_BACK=0"));
});



test("infra VPS workflow captures heredoc boundary with whitespace-robust scan", () => {
  const text = read(WORKFLOW_PATH);
  const bashStartIndex = text.indexOf("bash <<'BASH'");
  const bashEndOffset = heredocEndOffset(text);

  assert.notEqual(bashStartIndex, -1);
  assert.notEqual(bashEndOffset, -1);
  assert.equal(bashStartIndex < bashEndOffset, true);
  const afterTerminator = text.slice(bashEndOffset, bashEndOffset + 200);
  const rcIndex = afterTerminator.indexOf("rc=$?");
  const exitIndex = afterTerminator.indexOf('exit "$rc"');
  assert.notEqual(rcIndex, -1);
  assert.notEqual(exitIndex, -1);
  assert.equal(rcIndex < exitIndex, true);
});




test("infra VPS workflow defines infra deploy concurrency guard", () => {
  const text = read(WORKFLOW_PATH);
  const concurrencyIndex = text.indexOf("concurrency:");
  const groupIndex = text.indexOf("group:", concurrencyIndex);
  const cancelIndex = text.indexOf("cancel-in-progress: false", concurrencyIndex);
  const jobsIndex = text.indexOf("jobs:");

  assert.notEqual(concurrencyIndex, -1);
  assert.notEqual(groupIndex, -1);
  assert.notEqual(cancelIndex, -1);
  assert.notEqual(jobsIndex, -1);
  assert.equal(concurrencyIndex < jobsIndex, true);
});


test("infra VPS workflow POSIX outer fail-fast is set -eu before bash invocation", () => {
  const text = read(WORKFLOW_PATH);
  const outerSetIndex = text.indexOf("set -eu");
  const bashCheckIndex = text.indexOf("command -v bash >/dev/null 2>&1");

  assert.notEqual(outerSetIndex, -1);
  assert.notEqual(bashCheckIndex, -1);
  assert.equal(outerSetIndex < bashCheckIndex, true);
});

test("infra VPS workflow explicitly executes remote script with bash", () => {
  const text = read(WORKFLOW_PATH);
  const bashCheckIndex = text.indexOf("command -v bash >/dev/null 2>&1");
  const bashInvokeIndex = text.indexOf("bash <<'BASH'", bashCheckIndex);
  const overwriteIndex = text.indexOf('sudo -n cp "$TMP_PATH" "$CADDY_PATH"', bashInvokeIndex);

  assert.notEqual(bashCheckIndex, -1);
  assert.notEqual(bashInvokeIndex, -1);
  assert.notEqual(overwriteIndex, -1);
  assert.equal(bashCheckIndex < bashInvokeIndex, true);
  assert.equal(bashInvokeIndex < overwriteIndex, true);
});

test("infra VPS workflow uses non-interactive sudo", () => {
  const text = read(WORKFLOW_PATH);
  assert.ok(text.includes("sudo -n caddy validate"));
  assert.ok(text.includes("sudo -n systemctl reload caddy"));
  assert.equal(text.includes("sudo caddy validate"), false);
  assert.equal(text.includes("sudo systemctl reload caddy"), false);
});

test("infra VPS workflow verifies backup exists before proceeding", () => {
  const text = read(WORKFLOW_PATH);
  const backupCopyIndex = text.indexOf('sudo -n cp "$CADDY_PATH" "$BACKUP_PATH"');
  const backupExistsIndex = text.indexOf('sudo -n test -f "$BACKUP_PATH"');
  const overwriteIndex = text.indexOf('sudo -n cp "$TMP_PATH" "$CADDY_PATH"');

  assert.notEqual(backupCopyIndex, -1);
  assert.notEqual(backupExistsIndex, -1);
  assert.notEqual(overwriteIndex, -1);
  assert.equal(backupCopyIndex < backupExistsIndex, true);
  assert.equal(backupExistsIndex < overwriteIndex, true);
});

test("infra VPS workflow validates Caddy config before reloading Caddy", () => {
  const text = read(WORKFLOW_PATH);
  const validateIndex = text.indexOf("sudo -n caddy validate");
  const reloadIndex = text.indexOf("sudo -n systemctl reload caddy", validateIndex);
  const healthzIndex = text.indexOf("HEALTHZ_BODY=", reloadIndex);

  assert.notEqual(validateIndex, -1, "Workflow must run caddy validate");
  assert.notEqual(reloadIndex, -1, "Workflow must reload caddy");
  assert.notEqual(healthzIndex, -1, "Workflow must define healthz smoke check");
  assert.equal(validateIndex < reloadIndex, true, "caddy validate must run before reload");
  assert.equal(reloadIndex < healthzIndex, true, "reload must run before healthz smoke check");
});

test("infra VPS workflow ordering assertions use stable tokens (whitespace-robust)", () => {
  const text = read(WORKFLOW_PATH);
  const validateIndex = text.indexOf("sudo -n caddy validate");
  const reloadIndex = text.indexOf("sudo -n systemctl reload caddy", validateIndex);
  const healthzIndex = text.indexOf("HEALTHZ_BODY=", reloadIndex);

  assert.notEqual(validateIndex, -1);
  assert.notEqual(reloadIndex, -1);
  assert.notEqual(healthzIndex, -1);
  assert.equal(validateIndex < reloadIndex, true);
  assert.equal(reloadIndex < healthzIndex, true);
});

test("infra VPS workflow uses errtrace for trap-based rollback", () => {
  const text = read(WORKFLOW_PATH);
  assert.ok(text.includes("set -Eeuo pipefail"));
  assert.ok(text.includes("trap 'on_error' ERR"));
});

test("infra VPS workflow WS smoke-check uses node built-ins and curl fallback", () => {
  const text = read(WORKFLOW_PATH);
  assert.ok(text.includes("if command -v node >/dev/null 2>&1; then"));
  assert.ok(text.includes("timeout 12s node <<'NODE'"));
  assert.ok(text.includes("require('tls')"));
  assert.ok(text.includes("require('crypto')"));
  assert.ok(text.includes("Sec-WebSocket-Key"));
  assert.ok(text.includes("sec-websocket-accept"));
  assert.ok(text.includes("helloAck"));
  assert.ok(text.includes("--http1.1 https://ws.kcswh.pl/ws"));
  assert.ok(text.includes("Connection: Upgrade"));
  assert.ok(text.includes("Upgrade: websocket"));
  assert.ok(text.includes("grep -q ' 101 '"));
  assert.equal(text.includes("require('ws')"), false);
});

test("infra VPS workflow healthz check is tolerant to newline/CRLF", () => {
  const text = read(WORKFLOW_PATH);
  assert.ok(text.includes("tr -d '\\r\\n'"));
  assert.ok(text.includes('test "$HEALTHZ_BODY" = "ok"'));
});

test("heredocEndOffset advances offsets and finds terminator after start", () => {
  const synthetic = [
    "prelude",
    "  bash <<'BASH'",
    "    line-1",
    "      line-2",
    "   BASH   ",
    "POST"
  ].join("\n");

  const offset1 = heredocEndOffset(synthetic);
  const postIndex1 = synthetic.indexOf("\nPOST");

  assert.notEqual(offset1, -1);
  assert.equal(offset1 <= postIndex1, true);

  const syntheticWithExtraBody = synthetic.replace("    line-1", "    line-1\n    extra-line");
  const offset2 = heredocEndOffset(syntheticWithExtraBody);

  assert.notEqual(offset2, -1);
  assert.equal(offset2 > offset1, true);
});
