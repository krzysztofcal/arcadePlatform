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
  assert.match(text, /STAGE_ROOT="\$ARTIFACT_DIR\/stage"/);
  assert.match(text, /STAGE_WS_DIR="\$STAGE_ROOT\/ws-server"/);
  assert.match(text, /ARTIFACT_FILE="\$ARTIFACT_DIR\/ws-server-dist\.tgz"/);
  assert.match(text, /ln -s ws-server\/node_modules "\$STAGE_ROOT\/node_modules"/);
  assert.match(text, /cp -R ws-server\/shared "\$STAGE_WS_DIR"\/shared/);
  assert.match(text, /cp -R shared "\$STAGE_ROOT"\/shared/);
  assert.match(text, /test -f "\$STAGE_ROOT\/shared\/profile-avatar-projection\.mjs"/);
  assert.match(text, /await import\('\.\/ws-server\/poker\/read-model\/public-poker-identity\.mjs'\)/);
  assert.match(text, /await import\('\.\/ws-server\/shared\/poker-domain\/inactive-cleanup-deps\.mjs'\)/);
  assert.match(text, /-czf "\$ARTIFACT_FILE"/);
  assert.match(text, /-C "\$STAGE_ROOT"/);
  assert.match(text, /source: \.artifacts\/ws-server\/ws-server-dist\.tgz/);
  assert.doesNotMatch(text, /strip_components:\s*3/);
  assert.match(text, /TMP_ARCHIVE="\/tmp\/arcadeplatform-ws\/\.artifacts\/ws-server\/ws-server-dist\.tgz"/);
  assert.match(text, /test -f "\$TMP_ARCHIVE"/);
});
