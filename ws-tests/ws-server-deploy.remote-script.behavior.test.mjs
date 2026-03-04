import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("remote deploy script is strict, rollback-capable and health-gated", () => {
  const text = workflowText();

  assert.match(text, /set -Eeuo pipefail/);
  assert.match(text, /trap 'on_error' ERR/);
  assert.match(text, /RELEASES_DIR="\$BASE_DIR\/releases"/);
  assert.match(text, /NEW_RELEASE_DIR="\$RELEASES_DIR\/\$RELEASE_ID"/);
  assert.match(text, /configure \/etc\/sudoers\.d\/ws-server-deploy/);
  assert.match(text, /install nodejs/);
  assert.match(text, /provision unit first/);
  assert.match(text, /provision \/opt\/ws-server\/releases first/);

  assert.match(text, /rm -rf "\$NEW_RELEASE_DIR"/);
  assert.match(text, /tar -xzf "\$TMP_ARCHIVE" -C "\$NEW_RELEASE_DIR"/);
  assert.match(text, /mv -Tf "\$CURRENT_LINK\.tmp" "\$CURRENT_LINK"/);

  assert.match(text, /systemctl restart ws-server\.service/);
  assert.match(text, /curl -fsS/);
  assert.match(text, /https:\/\//);
  assert.match(text, /ws\.kcswh\.pl/);
  assert.match(text, /\/healthz/);
  assert.match(text, /test "\$HEALTHZ_BODY" = "ok"/);

  assert.match(text, /rollback\(\)/);
  assert.match(text, /on_error\(\)/);
  assert.match(text, /systemctl restart ws-server\.service \|\| true/);
});
