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
  assert.doesNotMatch(text, /sudo -n true/);
  assert.match(text, /configure \/etc\/sudoers\.d\/ws-server-deploy/);
  assert.match(text, /sudo -n systemctl cat ws-server\.service/);
  assert.match(text, /install nodejs/);
  assert.match(text, /provision unit first/);
  assert.match(text, /provision \/opt\/ws-server\/releases first/);

  assert.match(text, /rm -rf "\$NEW_RELEASE_DIR"/);
  assert.match(text, /tar -xzf "\$TMP_ARCHIVE" -C "\$NEW_RELEASE_DIR"/);
  assert.match(text, /mv -Tf "\$CURRENT_LINK\.tmp" "\$CURRENT_LINK"/);

  assert.match(text, /systemctl restart ws-server\.service/);
  assert.match(text, /curl -fsS http:\/\/127\.0\.0\.1:3000/);
  assert.match(text, /curl -fsS https:\/\/ws\.kcswh\.pl/);
  assert.match(text, /for i in \$\(seq 1 "\$HEALTH_RETRIES"\); do/);
  assert.match(text, /\/healthz/);
  assert.doesNotMatch(
    text,
    /HEALTHZ_BODY="\$\(curl -fsS https:\/\/ws\.kcswh\.pl[^"\n]* \| tr -d '\\r\\n'\)"\s*test "\$HEALTHZ_BODY" = "ok"/
  );

  const localHealthIdx = text.indexOf("curl -fsS http://127.0.0.1:3000");
  const publicHealthIdx = text.indexOf("curl -fsS https://ws.kcswh.pl");
  assert.notEqual(localHealthIdx, -1);
  assert.notEqual(publicHealthIdx, -1);
  assert.ok(localHealthIdx < publicHealthIdx, "local health check should run before public health check");

  assert.doesNotMatch(text, /local healthz failed after retries[\s\S]*exit 1/);
  assert.doesNotMatch(text, /public healthz failed after retries[\s\S]*exit 1/);
  assert.match(text, /local healthz failed after retries[\s\S]*false/);
  assert.match(text, /public healthz failed after retries[\s\S]*false/);

  assert.match(text, /rollback\(\)/);
  assert.match(text, /on_error\(\)/);
  assert.match(text, /systemctl restart ws-server\.service \|\| true/);
});
