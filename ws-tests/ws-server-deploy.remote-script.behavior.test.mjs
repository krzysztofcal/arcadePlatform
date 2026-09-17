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
  assert.match(text, /\[\[ ! "\$RELEASE_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.doesNotMatch(text, /sudo -n true/);
  assert.match(text, /systemctl cat ws-server\.service/);
  assert.match(text, /provision deploy group paths first/);
  assert.match(text, /\[\[ "\$\(id -un\)" != "copilot" \]\]/);
  assert.match(text, /test -L "\$BASE_DIR"/);
  assert.match(text, /test -L "\$RELEASES_DIR"/);
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
  assert.match(text, /stat -c '%d:%i:%h' -- "\$DEPLOY_MAINTENANCE_LOCK"/);
  assert.match(text, /stat -Lc '%d:%i:%h' -- "\/proc\/\$\$\/fd\/9"/);
  assert.match(text, /stat -Lc '%h' -- "\/proc\/\$\$\/fd\/9"/);
  assert.match(text, /flock -w 300 9/);
  assert.doesNotMatch(text, /flock -n 9/);

  const atomicStepIdx = text.indexOf('- name: Atomic release switch + restart + health gate on VPS');
  const deployScript = text.slice(atomicStepIdx);
  const lockIdx = deployScript.indexOf('flock -w 300 9');
  const removeReleaseIdx = deployScript.indexOf('rm -rf "$NEW_RELEASE_DIR"');
  const switchLinkIdx = deployScript.indexOf('ln -sfn "$NEW_RELEASE_APP_DIR" "$CURRENT_LINK.tmp"');
  assert.notEqual(atomicStepIdx, -1);
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

test("Production deploy pre-stages a missing shared lock before any artifact transaction", () => {
  const text = workflowText();
  const preStageIdx = text.indexOf('- name: Pre-stage shared deploy/maintenance lock on VPS');
  const uploadIdx = text.indexOf('- name: Upload ws-server artifact to VPS');
  const atomicStepIdx = text.indexOf('- name: Atomic release switch + restart + health gate on VPS');

  assert.notEqual(preStageIdx, -1);
  assert.notEqual(uploadIdx, -1);
  assert.notEqual(atomicStepIdx, -1);
  assert.ok(preStageIdx < uploadIdx, 'lock pre-stage must precede artifact upload');
  assert.ok(preStageIdx < atomicStepIdx, 'lock pre-stage must precede the deploy transaction');

  const preStage = text.slice(preStageIdx, atomicStepIdx);
  assert.match(preStage, /BASE_DIR="\/opt\/ws-server"/);
  assert.match(preStage, /LOCK_FILE="\$BASE_DIR\/\.deploy-maintenance\.lock"/);
  assert.match(preStage, /test -d "\$BASE_DIR"/);
  assert.match(preStage, /test -L "\$BASE_DIR"/);
  assert.match(preStage, /test -w "\$BASE_DIR"/);
  assert.match(preStage, /test -x "\$BASE_DIR"/);
  assert.match(preStage, /test -L "\$RELEASES_DIR"/);
  assert.match(preStage, /\[\[ ! -e "\$LOCK_FILE" \]\]/);
  assert.match(preStage, /set -o noclobber/);
  assert.match(preStage, /: > "\$LOCK_FILE"/);
  assert.match(preStage, /\[\[ -f "\$LOCK_FILE" && ! -L "\$LOCK_FILE" \]\]/);
  assert.match(preStage, /stat -c '%d:%i:%h' -- "\$LOCK_FILE"/);
  assert.match(preStage, /stat -Lc '%d:%i:%h' -- "\/proc\/\$\$\/fd\/9"/);
  assert.match(preStage, /stat -Lc '%h' -- "\/proc\/\$\$\/fd\/9"/);
  assert.match(preStage, /exec 9<> "\$LOCK_FILE"/);
  assert.match(preStage, /flock -w 300 9/);
  assert.match(preStage, /DEPLOY_GROUP="arcade-deploy"/);
  assert.match(preStage, /chgrp "\$DEPLOY_GROUP" "\/proc\/\$\$\/fd\/9"/);
  assert.match(preStage, /chmod 0660 "\/proc\/\$\$\/fd\/9"/);
  assert.doesNotMatch(preStage, /\b(?:sudo|systemctl|docker|kill|pkill)\b/i);
});
