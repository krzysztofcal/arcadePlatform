import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function heredocBounds(text) {
  const bashStartIndex = text.indexOf("bash <<'BASH'");
  assert.notEqual(bashStartIndex, -1);

  const lines = text.split("\n");
  let offset = 0;
  let startLine = -1;
  let endLineStart = -1;
  let endLineEnd = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineStart = offset;
    const lineEnd = lineStart + line.length;

    if (startLine === -1 && bashStartIndex >= lineStart && bashStartIndex <= lineEnd) {
      startLine = i;
    } else if (startLine !== -1 && i > startLine && line.trim() === "BASH") {
      endLineStart = lineStart;
      endLineEnd = lineEnd;
      break;
    }

    offset = lineEnd + 1;
  }

  assert.notEqual(startLine, -1);
  assert.notEqual(endLineStart, -1);
  assert.equal(endLineStart > bashStartIndex, true);

  return {
    bashStartIndex,
    heredocEndLineStart: endLineStart,
    heredocEndOffset: endLineEnd
  };
}

test("infra VPS workflow POSIX outer fail-fast is set -eu and precedes bash heredoc", () => {
  const text = workflowText();
  const outerSetIndex = text.indexOf("set -eu");
  const bashCheckIndex = text.indexOf("command -v bash >/dev/null 2>&1", outerSetIndex);
  const bashStartIndex = text.indexOf("bash <<'BASH'", bashCheckIndex);

  assert.notEqual(outerSetIndex, -1);
  assert.notEqual(bashCheckIndex, -1);
  assert.notEqual(bashStartIndex, -1);
  assert.equal(outerSetIndex < bashCheckIndex, true);
  assert.equal(bashCheckIndex < bashStartIndex, true);
});

test("infra VPS workflow heredoc boundary is robust and post-heredoc content is outside body", () => {
  const text = workflowText();
  const { bashStartIndex, heredocEndLineStart, heredocEndOffset } = heredocBounds(text);

  const overwriteIndex = text.indexOf('sudo -n cp "$TMP_PATH" "$CADDY_PATH"', bashStartIndex);
  const trapClearIndex = text.indexOf("trap - ERR", bashStartIndex);

  assert.notEqual(overwriteIndex, -1);
  assert.notEqual(trapClearIndex, -1);
  assert.equal(overwriteIndex > bashStartIndex, true);
  assert.equal(overwriteIndex < heredocEndLineStart, true);
  assert.equal(trapClearIndex > bashStartIndex, true);
  assert.equal(trapClearIndex < heredocEndLineStart, true);

  const afterTerminator = text.slice(heredocEndOffset, heredocEndOffset + 200);
  const rcIndex = afterTerminator.indexOf("rc=$?");
  const exitIndex = afterTerminator.indexOf('exit "$rc"');
  assert.notEqual(rcIndex, -1);
  assert.notEqual(exitIndex, -1);
  assert.equal(rcIndex < exitIndex, true);
});

test("heredoc bounds ignore incidental BASH token before terminator", () => {
  const text = workflowText();
  const marker = "            HAVE_BACKUP=0";
  const idx = text.indexOf(marker);
  assert.notEqual(idx, -1);

  const injected = `${text.slice(0, idx)}            console.log("BASH");\n${text.slice(idx)}`;
  const { bashStartIndex, heredocEndLineStart, heredocEndOffset } = heredocBounds(injected);
  const injectedIndex = injected.indexOf('console.log("BASH")');

  assert.notEqual(injectedIndex, -1);
  assert.equal(bashStartIndex < injectedIndex, true);
  assert.equal(injectedIndex < heredocEndLineStart, true);
  assert.equal(heredocEndOffset > heredocEndLineStart, true);
});
