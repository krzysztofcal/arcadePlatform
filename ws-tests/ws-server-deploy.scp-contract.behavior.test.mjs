import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy scp contract maps workspace artifact to expected remote archive path", () => {
  const text = workflowText();

  assert.match(text, /source: \.artifacts\/ws-server\/ws-server-dist\.tgz/);
  assert.match(text, /target: \/tmp\/arcadeplatform-ws/);
  assert.match(text, /TMP_ARCHIVE="\/tmp\/arcadeplatform-ws\/\.artifacts\/ws-server\/ws-server-dist\.tgz"/);
  assert.doesNotMatch(text, /strip_components:\s*3/);
});
