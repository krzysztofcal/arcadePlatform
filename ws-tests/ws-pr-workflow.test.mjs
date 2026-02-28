import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-pr-checks.yml", "utf8");
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function leadingSpaces(line) {
  const match = line.match(/^\s*/);
  return match ? match[0].length : 0;
}

function stepsBlock(text) {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n");

  const stepsLineIndex = lines.findIndex((line) => /^\s*steps:\s*(#.*)?$/.test(line));
  assert.notEqual(stepsLineIndex, -1, "workflow must contain a steps: block");

  const stepsIndent = leadingSpaces(lines[stepsLineIndex]);
  const blockLines = [lines[stepsLineIndex]];

  for (let i = stepsLineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line.trim()) {
      blockLines.push(line);
      continue;
    }

    if (/^\s*#/.test(line)) {
      blockLines.push(line);
      continue;
    }

    const indent = leadingSpaces(line);
    if (indent <= stepsIndent) {
      break;
    }

    blockLines.push(line);
  }

  return blockLines.join("\n");
}

function assertRequiredOrder(text) {
  const block = stepsBlock(text);

  const install = block.indexOf("npm ci --prefix ws-server");
  const behavior = block.indexOf("node --test ws-server/server.behavior.test.mjs");
  const locationGuard = block.indexOf("node --test ws-tests/ws-tests-location.guard.test.mjs");
  const suiteGuard = block.indexOf("node --test ws-tests/ws-tests-suite-completeness.guard.test.mjs");
  const protocolDoc = block.indexOf("node --test ws-tests/ws-poker-protocol-doc.test.mjs");
  const imageCheck = block.indexOf("node --test ws-tests/ws-image-contains-protocol.behavior.test.mjs");
  const containerCheck = block.indexOf("node --test ws-tests/ws-container-starts.behavior.test.mjs");

  assert.notEqual(install, -1);
  assert.notEqual(behavior, -1);
  assert.notEqual(locationGuard, -1);
  assert.notEqual(suiteGuard, -1);
  assert.notEqual(protocolDoc, -1);
  assert.notEqual(imageCheck, -1);
  assert.notEqual(containerCheck, -1);
  assert.equal(install < behavior, true);
  assert.equal(behavior < locationGuard, true);
  assert.equal(locationGuard < suiteGuard, true);
  assert.equal(suiteGuard < protocolDoc, true);
  assert.equal(protocolDoc < imageCheck, true);
  assert.equal(imageCheck < containerCheck, true);
}

test("ws pr workflow is pull_request-only with ws-related path filters", () => {
  const text = workflowText();
  assert.match(text, /on:\s*\n\s*pull_request:/);
  assert.match(text, /paths:\s*\n\s*-\s*"ws-server\/\*\*"/);
  assert.match(text, /"ws-tests\/\*\*"/);
  assert.doesNotMatch(text, /push:/);
});

test("ws pr workflow runs required harness checks in expected order", () => {
  assertRequiredOrder(workflowText());
});

test("ws pr workflow order check tolerates different indentation", () => {
  const text = workflowText();
  const textIndented = text.replace(/\n {4}/g, "\n  ");
  assertRequiredOrder(textIndented);
});

test("ws pr workflow order check tolerates CRLF", () => {
  const text = workflowText();
  const textCrlf = text.replace(/\n/g, "\r\n");
  assertRequiredOrder(textCrlf);
});

test("ws pr workflow order check is resilient to non-step occurrences", () => {
  const text = workflowText();
  const textWithNoise = `${text}\n# harmless note: node --test ws-tests/ws-container-starts.behavior.test.mjs`;
  assertRequiredOrder(textWithNoise);
});

test("ws pr workflow does not deploy or use secrets", () => {
  const text = workflowText();
  assert.doesNotMatch(text, /appleboy\/ssh-action/);
  assert.doesNotMatch(text, /docker\/login-action/);
  assert.doesNotMatch(text, /docker\/build-push-action/);
  assert.doesNotMatch(text, /docker compose/);
  assert.doesNotMatch(text, /ghcr\.io/);
  assert.doesNotMatch(text, /\$\{\{\s*secrets\./);
});

test("ws pr workflow uses read-only token permissions", () => {
  const text = workflowText();
  assert.match(text, /permissions:\s*\n\s*contents:\s*read/);
});
