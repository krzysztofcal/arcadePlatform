import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy artifact is produced in workspace and uploaded from workspace path", () => {
  const text = workflowText();

  assert.doesNotMatch(text, /source:\s*\/tmp\//);
  assert.match(text, /ARTIFACT_DIR="\$GITHUB_WORKSPACE\/\.artifacts\/ws-server"/);
  assert.match(text, /ARTIFACT_FILE="\$ARTIFACT_DIR\/ws-server-dist\.tgz"/);
  assert.match(text, /-czf "\$ARTIFACT_FILE"/);
  assert.match(text, /source: \.artifacts\/ws-server\/ws-server-dist\.tgz/);
  assert.doesNotMatch(text, /strip_components:\s*3/);
  assert.match(text, /TMP_ARCHIVE="\/tmp\/arcadeplatform-ws\/ws-server-dist\.tgz"/);
  assert.match(text, /test -f "\$TMP_ARCHIVE"/);
});
