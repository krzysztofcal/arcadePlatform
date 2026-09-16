import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKFLOW_PATH = ".github/workflows/ws-preview-deploy.yml";
const HELPER_PATH = "infra/vps/ws-preview-env-preflight.mjs";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function helperText() {
  return fs.readFileSync(HELPER_PATH, "utf8");
}

function metadataVerifierSource(text) {
  const match = text.match(
    /verify_release_metadata\(\) \{[\s\S]*?node -e '\n([\s\S]*?)\n\s+' "\$metadata_file"/
  );
  assert.ok(match, "missing executable release metadata verifier");
  return match[1];
}

test("ws preview deploy keeps deploy-group file operations and exact root operations", () => {
  const text = workflowText();

  assert.match(text, /PREVIEW_BASE_DIR: \/opt\/arcade-ws-preview/);
  assert.match(text, /PREVIEW_APP_DIR: \/opt\/arcade-ws-preview\/ws-server/);
  assert.match(text, /test -d "\$PREVIEW_APP_DIR"/);
  assert.match(text, /sudo -n \/usr\/local\/sbin\/arcade-ws-preview-env-preflight/);
  assert.match(text, /sudo -n \/usr\/bin\/systemctl restart ws-server-preview\.service/);
  assert.doesNotMatch(text, /sudo -n (?:bash|node|rsync|mkdir|rm|test|tar)\b/);
  assert.doesNotMatch(text, /sudo -n systemctl restart "\$PREVIEW_SERVICE_NAME"/);

  for (const expression of [
    /test -f "\$TMP_EXTRACT_DIR\/ws-server\/server\.mjs"/,
    /test -f "\$TMP_EXTRACT_DIR\/ws-server\/observability\/vps-metrics\.mjs"/,
    /test -f "\$TMP_EXTRACT_DIR\/shared\/poker-domain\/join\.mjs"/,
    /test -f "\$TMP_EXTRACT_DIR\/ws-server\/shared\/poker-domain\/inactive-cleanup-deps\.mjs"/,
    /test -f "\$TMP_EXTRACT_DIR\/netlify\/functions\/_shared\/chips-ledger\.mjs"/,
    /test -f "\$TMP_EXTRACT_DIR\/netlify\/functions\/_generated\/deploy-context\.mjs"/,
    /test -d "\$TMP_EXTRACT_DIR\/node_modules\/postgres"/,
    /rsync -a --no-owner --no-group --checksum --delete "\$TMP_EXTRACT_DIR\/ws-server\/" "\$PREVIEW_APP_DIR"\//,
    /mkdir -p "\$PREVIEW_BASE_DIR\/shared"/,
    /rsync -a --no-owner --no-group --checksum --delete "\$TMP_EXTRACT_DIR\/shared\/" "\$PREVIEW_BASE_DIR\/shared"\//,
    /mkdir -p "\$PREVIEW_BASE_DIR\/netlify\/functions\/_shared"/,
    /rsync -a --no-owner --no-group --checksum --delete "\$TMP_EXTRACT_DIR\/netlify\/functions\/_shared\/" "\$PREVIEW_BASE_DIR\/netlify\/functions\/_shared"\//,
    /mkdir -p "\$PREVIEW_BASE_DIR\/netlify\/functions\/_generated"/,
    /rsync -a --no-owner --no-group --checksum --delete "\$TMP_EXTRACT_DIR\/netlify\/functions\/_generated\/" "\$PREVIEW_BASE_DIR\/netlify\/functions\/_generated"\//,
    /test -f "\$PREVIEW_BASE_DIR\/netlify\/functions\/_generated\/deploy-context\.mjs"/,
    /node --input-type=module -e "await import\('\.\/ws-server\/shared\/poker-domain\/inactive-cleanup-deps\.mjs'\)"/,
    /mkdir -p "\$PREVIEW_BASE_DIR\/node_modules"/,
    /rsync -a --no-owner --no-group --checksum --delete "\$TMP_EXTRACT_DIR\/node_modules\/" "\$PREVIEW_BASE_DIR\/node_modules"\//
  ]) {
    assert.match(text, expression);
  }

  const rsyncCommands = text.match(/^\s+rsync -a [^\n]+$/gm) ?? [];
  assert.equal(rsyncCommands.length, 5, "Preview deploy must keep exactly five scoped rsync operations");
  for (const command of rsyncCommands) {
    assert.match(command, /--no-owner --no-group/);
  }

  assert.doesNotMatch(text, /rsync -a --delete "\$TMP_EXTRACT_DIR"\/ "\$PREVIEW_BASE_DIR"\//);
  assert.doesNotMatch(text, /rsync -a --delete "\$TMP_EXTRACT_DIR\/node_modules"\/ "\$PREVIEW_BASE_DIR\/node_modules"\//);
  assert.doesNotMatch(text, /rsync -a --delete "\$TMP_EXTRACT_DIR\/ws-server"\/ "\$PREVIEW_APP_DIR"\//);
  assert.doesNotMatch(text, /rsync -a --delete "\$TMP_EXTRACT_DIR\/shared"\/ "\$PREVIEW_BASE_DIR\/shared"\//);
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

test("ws preview deploy delegates stage env validation to the fixed helper", () => {
  const text = workflowText();
  const helper = helperText();

  assert.match(text, /\/usr\/local\/sbin\/arcade-ws-preview-env-preflight/);
  assert.match(helper, /SUPABASE_STAGE_PROJECT_REF/);
  assert.match(helper, /SUPABASE_DB_URL/);
  assert.match(helper, /POKER_WS_INTERNAL_TOKEN/);
  assert.match(helper, /WS_BOT_REACTION_MIN_MS/);
  assert.match(helper, /WS_BOT_REACTION_MAX_MS/);
  assert.match(helper, /SUPABASE_URL_V2/);
  assert.match(helper, /target SUPABASE_STAGE_PROJECT_REF/);
});

test("ws preview env helper validates descriptor metadata before parsing contents", () => {
  const text = helperText();
  const descriptorOpen = text.indexOf("fd = fs.openSync(");
  const descriptorMetadata = text.indexOf("const metadata = fs.fstatSync(fd)", descriptorOpen);
  const descriptorRead = text.indexOf('fs.readFileSync(fd, "utf8")', descriptorMetadata);
  const firstContentCheck = text.indexOf("PORT", descriptorRead);
  const parser = text.indexOf("const values = parseEnv");

  assert.match(text, /const ENV_FILE = "\/opt\/arcade-ws-preview\/\.env\.preview"/);
  assert.match(text, /process\.argv\.length !== 2/);
  assert.match(text, /unexpected arguments/);
  assert.ok(descriptorOpen >= 0, "preview env must be opened without following symlinks");
  assert.match(
    text,
    /fs\.openSync\(\s*ENV_FILE,\s*fs\.constants\.O_RDONLY \| fs\.constants\.O_NOFOLLOW \| fs\.constants\.O_NONBLOCK\s*\)/
  );
  assert.ok(descriptorMetadata > descriptorOpen, "opened preview env metadata must be checked");
  assert.ok(descriptorRead > descriptorMetadata, "preview env contents must be read after metadata");
  assert.ok(firstContentCheck > descriptorRead, "content checks must follow the permission preflight");
  assert.ok(parser >= 0 && parser < descriptorRead, "env parsing must consume the descriptor contents");
  assert.match(text, /typeof fs\.constants\.O_NOFOLLOW !== "number"/);
  assert.match(text, /typeof fs\.constants\.O_NONBLOCK !== "number"/);
  assert.match(text, /metadata\.isFile\(\)/);
  assert.match(text, /metadata\.uid !== 0/);
  assert.match(text, /metadata\.gid !== 0/);
  assert.match(text, /metadata\.mode & 0o7777/);
  assert.match(text, /!== 0o600/);
  assert.match(text, /regular file owned by root:root with mode 0600/);
  assert.match(text, /must not be a symlink/);
  assert.doesNotMatch(text, /fs\.readFileSync\(envFile/);
  assert.doesNotMatch(text, /process\.argv\[1\]/);
  assert.doesNotMatch(text, /console\.log/);
  assert.doesNotMatch(text, /\b(?:chmod|chown)\b/);
});

test("ws preview deploy verifies release identity before and after rsync and after restart", () => {
  const text = workflowText();
  const beforeRsync = text.indexOf('verify_release_metadata "$TMP_EXTRACT_DIR/ws-server/release-metadata.json"');
  const firstRsync = text.indexOf('rsync -a --no-owner --no-group --checksum --delete "$TMP_EXTRACT_DIR/ws-server/" "$PREVIEW_APP_DIR"/');
  const afterRsync = text.indexOf('verify_release_metadata "$PREVIEW_APP_DIR/release-metadata.json"');
  const restart = text.indexOf("sudo -n /usr/bin/systemctl restart ws-server-preview.service");
  const finalMetadataCheck = text.lastIndexOf('verify_release_metadata "$PREVIEW_APP_DIR/release-metadata.json"');

  assert.ok(beforeRsync > 0 && beforeRsync < firstRsync, "archive metadata must be verified before rsync");
  assert.ok(afterRsync > firstRsync && afterRsync < restart, "installed metadata must be verified before restart");
  assert.ok(finalMetadataCheck > restart, "installed metadata must be verified again after runtime restart");
  assert.match(text, /metadata\?\.releaseSha !== expectedSha/);
  assert.match(text, /metadata\?\.deployRef !== expectedRef/);
  assert.match(text, /metadata\?\.environment !== expectedEnvironment/);
  assert.doesNotMatch(text, /journalctl -u "\$PREVIEW_SERVICE_NAME"/);
});

test("ws preview deploy metadata verifier fails closed on a mismatched SHA", () => {
  const source = metadataVerifierSource(workflowText());
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-preview-metadata-"));
  const metadataPath = path.join(tempDir, "release-metadata.json");
  try {
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ releaseSha: "sha-a", deployRef: "branch-a", environment: "preview" })
    );
    const matching = spawnSync(process.execPath, [
      "-e",
      source,
      metadataPath,
      "sha-a",
      "branch-a",
      "preview"
    ]);
    assert.equal(matching.status, 0);

    const mismatched = spawnSync(process.execPath, [
      "-e",
      source,
      metadataPath,
      "sha-b",
      "branch-a",
      "preview"
    ]);
    assert.notEqual(mismatched.status, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ws preview deploy cleanup is scoped to the current run temp directory and keeps health gates", () => {
  const text = workflowText();

  assert.match(text, /trap cleanup EXIT/);
  assert.match(text, /rm -rf -- "\$PREVIEW_REMOTE_TMP_DIR"/);
  assert.doesNotMatch(text, /rm -rf --? "\/tmp\/arcadeplatform-ws-preview"/);
  assert.match(text, /curl -fsS "\$PREVIEW_LOCAL_HEALTHZ_URL"/);
  assert.match(text, /curl -fsS "\$PREVIEW_PUBLIC_HEALTHZ_URL"/);
});
