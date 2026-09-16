import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy scp contract maps workspace artifact to expected remote archive path", () => {
  const text = workflowText();

  assert.match(
    text,
    /WS_REMOTE_TMP_DIR: \/tmp\/arcadeplatform-ws-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/
  );
  assert.match(text, /source: \.artifacts\/ws-server\/ws-server-dist\.tgz/);
  assert.match(text, /target: \$\{\{ env\.WS_REMOTE_TMP_DIR \}\}/);
  assert.match(text, /WS_REMOTE_TMP_DIR: \$\{\{ env\.WS_REMOTE_TMP_DIR \}\}/);
  assert.match(text, /envs: RELEASE_SHA,WS_REMOTE_TMP_DIR/);
  assert.match(text, /case "\$WS_REMOTE_TMP_DIR" in[\s\S]*\/tmp\/arcadeplatform-ws-\[0-9\]\*-\[0-9\]\*\) ;;[\s\S]*invalid run-scoped production temp dir/);
  assert.match(text, /TMP_ARCHIVE="\$WS_REMOTE_TMP_DIR\/\.artifacts\/ws-server\/ws-server-dist\.tgz"/);
  assert.match(text, /rm -rf -- "\$WS_REMOTE_TMP_DIR"/);
  assert.match(text, /trap cleanup EXIT/);
  assert.doesNotMatch(text, /\/tmp\/arcadeplatform-ws(?:[\/"'\s])/);
  assert.doesNotMatch(text, /strip_components:\s*3/);
});
