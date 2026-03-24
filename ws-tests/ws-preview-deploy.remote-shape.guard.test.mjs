import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const WORKFLOW_PATH = ".github/workflows/ws-preview-deploy.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("ws preview deploy remote script matches fixed preview app-dir contract", () => {
  const text = workflowText();

  assert.match(text, /PREVIEW_BASE_DIR: \/opt\/arcade-ws-preview/);
  assert.match(text, /PREVIEW_APP_DIR: \/opt\/arcade-ws-preview\/ws-server/);
  assert.match(text, /sudo -n test -d "\$PREVIEW_APP_DIR"/);
  assert.match(text, /sudo -n test -f "\$TMP_EXTRACT_DIR\/ws-server\/server\.mjs"/);
  assert.match(text, /sudo -n test -f "\$TMP_EXTRACT_DIR\/shared\/poker-domain\/join\.mjs"/);
  assert.match(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR\/ws-server\/" "\$PREVIEW_APP_DIR"\//);
  assert.match(text, /sudo -n mkdir -p "\$PREVIEW_BASE_DIR\/shared"/);
  assert.match(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR\/shared\/" "\$PREVIEW_BASE_DIR\/shared"\//);
  assert.doesNotMatch(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR"\/ "\$PREVIEW_BASE_DIR"\//);
  assert.doesNotMatch(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR\/ws-server"\/ "\$PREVIEW_APP_DIR"\//);
  assert.doesNotMatch(text, /sudo -n rsync -a --delete "\$TMP_EXTRACT_DIR\/shared"\/ "\$PREVIEW_BASE_DIR\/shared"\//);
  assert.match(text, /sudo -n systemctl restart "\$PREVIEW_SERVICE_NAME"/);
  assert.match(text, /curl -fsS "\$PREVIEW_LOCAL_HEALTHZ_URL"/);
  assert.match(text, /curl -fsS "\$PREVIEW_PUBLIC_HEALTHZ_URL"/);
  assert.doesNotMatch(text, /node --test tests\/ws-preview-deploy/);

  assert.doesNotMatch(text, /PREVIEW_RELEASES_DIR/);
  assert.doesNotMatch(text, /NEW_RELEASE_DIR/);
  assert.doesNotMatch(text, /PREVIOUS_TARGET/);
  assert.doesNotMatch(text, /ln -sfn/);
  assert.doesNotMatch(text, /readlink -f/);
  assert.doesNotMatch(text, /\/current/);
});
