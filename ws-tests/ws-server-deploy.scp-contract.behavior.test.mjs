import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  assert.match(
    text,
    /if \[\[ ! "\$WS_REMOTE_TMP_DIR" =~ \^\/tmp\/arcadeplatform-ws-\[0-9\]\+-\[0-9\]\+\$ \]\]; then[\s\S]*invalid run-scoped production temp dir/
  );
  assert.match(text, /TMP_ARCHIVE="\$WS_REMOTE_TMP_DIR\/\.artifacts\/ws-server\/ws-server-dist\.tgz"/);
  assert.match(text, /rm -rf -- "\$WS_REMOTE_TMP_DIR"/);
  assert.match(text, /trap cleanup EXIT/);
  assert.doesNotMatch(text, /\/tmp\/arcadeplatform-ws(?:[\/"'\s])/);
  assert.doesNotMatch(text, /strip_components:\s*3/);

  const guardSource = text.match(/if \[\[ ! "\$WS_REMOTE_TMP_DIR" =~ [^\n]+[\s\S]*?\n            fi/)?.[0];
  assert.ok(guardSource, "workflow should contain the run-scoped temp path guard");

  for (const value of [
    "/tmp/arcadeplatform-ws-35125205604-1",
    "/tmp/arcadeplatform-ws-1-2"
  ]) {
    const result = spawnSync("bash", ["-c", guardSource], {
      env: { ...process.env, WS_REMOTE_TMP_DIR: value },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `expected valid temp path: ${value}`);
  }

  for (const value of [
    "/tmp/arcadeplatform-ws-1x-2",
    "/tmp/arcadeplatform-ws-1-2/../../outside",
    "/tmp/arcadeplatform-ws-1-"
  ]) {
    const result = spawnSync("bash", ["-c", guardSource], {
      env: { ...process.env, WS_REMOTE_TMP_DIR: value },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0, `expected rejected temp path: ${value}`);
  }
});
