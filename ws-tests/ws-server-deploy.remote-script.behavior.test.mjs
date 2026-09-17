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
  assert.match(text, /systemctl cat ws-server\.service/);
  assert.match(text, /provision deploy group paths first/);
  assert.match(text, /install nodejs/);
  assert.match(text, /provision unit first/);
  assert.doesNotMatch(text, /provision \/opt\/ws-server\/releases first/);

  assert.match(text, /rm -rf "\$NEW_RELEASE_DIR"/);
  assert.match(text, /tar -xzf "\$TMP_ARCHIVE" -C "\$NEW_RELEASE_DIR"/);
  assert.match(text, /mv -Tf "\$CURRENT_LINK\.tmp" "\$CURRENT_LINK"/);

  assert.match(text, /systemctl restart ws-server\.service/);
  assert.match(text, /sudo -n \/usr\/bin\/systemctl restart ws-server\.service/);
  assert.doesNotMatch(text, /sudo -n (?:cat|test|rm|mkdir|tar|ln|mv|node|bash|rsync)\b/);
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
  assert.match(text, /sudo -n \/usr\/bin\/systemctl restart ws-server\.service \|\| true/);
});

test("remote deploy script coordinates release mutations and records canonical deployment time", () => {
  const text = workflowText();

  assert.match(text, /DEPLOY_MAINTENANCE_LOCK="\/opt\/ws-server\/\.deploy-maintenance\.lock"/);
  assert.match(text, /\[\[ -f "\$DEPLOY_MAINTENANCE_LOCK" && ! -L "\$DEPLOY_MAINTENANCE_LOCK" \]\]/);
  assert.match(text, /exec 9<> "\$DEPLOY_MAINTENANCE_LOCK"/);
  assert.match(text, /flock -n 9/);

  const lockIdx = text.indexOf('flock -n 9');
  const removeReleaseIdx = text.indexOf('rm -rf "$NEW_RELEASE_DIR"');
  const switchLinkIdx = text.indexOf('ln -sfn "$NEW_RELEASE_APP_DIR" "$CURRENT_LINK.tmp"');
  assert.notEqual(lockIdx, -1);
  assert.notEqual(removeReleaseIdx, -1);
  assert.notEqual(switchLinkIdx, -1);
  assert.ok(lockIdx < removeReleaseIdx, "lock must be acquired before release removal");
  assert.ok(lockIdx < switchLinkIdx, "lock must be acquired before current symlink switching");

  assert.match(text, /DEPLOYED_AT="\$\(date -u '\+%Y-%m-%dT%H:%M:%SZ'\)"/);
  assert.match(text, /\[\[ ! "\$DEPLOYED_AT" =~ \^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T\[0-9\]\{2\}:\[0-9\]\{2\}:\[0-9\]\{2\}Z\$ \]\]/);
  assert.match(text, /\[\[ \$\(date -u -d "\$DEPLOYED_AT" '\+%Y-%m-%dT%H:%M:%SZ'\) != "\$DEPLOYED_AT" \]\]/);
  assert.match(text, /printf '%s\\n' "\$DEPLOYED_AT" > "\$NEW_RELEASE_DIR\/\.deployed-at"/);
  assert.match(text, /chmod 0644 "\$NEW_RELEASE_DIR\/\.deployed-at"/);
  assert.match(text, /\[\[ \$\(cat "\$NEW_RELEASE_DIR\/\.deployed-at"\) != "\$DEPLOYED_AT" \]\]/);

  const postgresValidationIdx = text.indexOf('test -d "$NEW_RELEASE_DIR/node_modules/postgres"');
  const markerWriteIdx = text.indexOf('printf \'%s\\n\' "$DEPLOYED_AT" > "$NEW_RELEASE_DIR/.deployed-at"');
  const temporaryLinkIdx = text.indexOf('ln -sfn "$NEW_RELEASE_APP_DIR" "$CURRENT_LINK.tmp"');
  assert.notEqual(postgresValidationIdx, -1);
  assert.notEqual(markerWriteIdx, -1);
  assert.notEqual(temporaryLinkIdx, -1);
  assert.ok(postgresValidationIdx < markerWriteIdx, "marker must follow extracted release validation");
  assert.ok(markerWriteIdx < temporaryLinkIdx, "marker must precede temporary current symlink installation");
});
