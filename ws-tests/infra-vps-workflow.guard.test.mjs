import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKFLOW_PATH = ".github/workflows/infra-vps.yml";

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

function fileText(path) {
  return fs.readFileSync(path, "utf8");
}

function remoteBash(text) {
  const start = text.indexOf("bash <<'BASH'");
  const end = text.indexOf("\n            BASH", start);
  assert.notEqual(start, -1, "remote bash heredoc must exist");
  assert.notEqual(end, -1, "remote bash heredoc terminator must exist");
  return text.slice(start, end);
}

test("infra routes validation conservatively while retaining the Caddy-only push apply surface", () => {
  const text = workflowText();
  assert.match(text, /needs\.impact\.outputs\.infra == 'true'/);
  assert.match(text, /git diff --name-only "\$BEFORE_SHA" "\$GITHUB_SHA" -- infra\/vps\/Caddyfile/);
  assert.match(text, /apply:\n    needs: validate/);
  assert.match(text, /needs\.validate\.outputs\.caddy == 'true'/);
});

test("infra VPS owns the unified Caddy contract test", () => {
  assert.ok(workflowText().includes("node --test ws-tests/infra-vps-caddy.guard.test.mjs"));
});

test("infra VPS workflow keeps contents: read permissions", () => {
  const text = workflowText();
  const validateBlock = text.slice(text.indexOf("  validate:"), text.indexOf("  apply:"));
  assert.ok(validateBlock.includes("permissions:"));
  assert.ok(validateBlock.includes("contents: read"));
  const applyBlock = text.slice(text.indexOf("  apply:"));
  assert.ok(applyBlock.includes("permissions:"));
  assert.ok(applyBlock.includes("contents: read"));
});

test("infra VPS workflow uses WS_* secrets and avoids VPS_* secrets", () => {
  const text = workflowText();
  assert.ok(text.includes("secrets.WS_HOST"));
  assert.ok(text.includes("secrets.WS_USER"));
  assert.ok(text.includes("secrets.WS_SSH_KEY"));
  assert.equal(text.includes("secrets.VPS_HOST"), false);
  assert.equal(text.includes("secrets.VPS_USER"), false);
  assert.equal(text.includes("secrets.VPS_SSH_KEY"), false);
});

test("infra VPS upload uses a strict run-scoped temp path and cleans it after rollback", () => {
  const text = workflowText();
  const remote = remoteBash(text);

  assert.match(
    text,
    /INFRA_REMOTE_TMP_DIR: \/tmp\/arcadeplatform-infra-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/
  );
  assert.match(text, /target: \$\{\{ env\.INFRA_REMOTE_TMP_DIR \}\}/);
  assert.match(text, /INFRA_REMOTE_TMP_DIR: \$\{\{ env\.INFRA_REMOTE_TMP_DIR \}\}/);
  assert.match(text, /envs: INFRA_REMOTE_TMP_DIR/);
  assert.match(
    remote,
    /if \[\[ ! "\$INFRA_REMOTE_TMP_DIR" =~ \^\/tmp\/arcadeplatform-infra-\[0-9\]\+-\[0-9\]\+\$ \]\]; then[\s\S]*invalid run-scoped infra temp dir/
  );
  assert.match(remote, /TMP_PATH="\$INFRA_REMOTE_TMP_DIR\/Caddyfile"/);
  assert.match(remote, /BACKUP_PATH="\$\{TMP_PATH\}\.bak\.\$\(date/);
  assert.match(remote, /rm -rf -- "\$INFRA_REMOTE_TMP_DIR"/);
  assert.match(remote, /trap cleanup EXIT/);
  assert.equal(text.includes("overwrite: true"), false);
  assert.doesNotMatch(text, /\/tmp\/arcadeplatform-infra(?:[\/"'\s])/);

  const guardSource = text.match(
    /if \[\[ ! "\$INFRA_REMOTE_TMP_DIR" =~ [^\n]+[\s\S]*?\n            fi/
  )?.[0];
  assert.ok(guardSource, "workflow should contain the run-scoped infra temp path guard");

  for (const value of [
    "/tmp/arcadeplatform-infra-35129337352-1",
    "/tmp/arcadeplatform-infra-1-2"
  ]) {
    const result = spawnSync("bash", ["-c", guardSource], {
      env: { ...process.env, INFRA_REMOTE_TMP_DIR: value },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `expected valid temp path: ${value}`);
  }

  for (const value of [
    "/tmp/arcadeplatform-infra-1x-2",
    "/tmp/arcadeplatform-infra-1-2/../../outside",
    "/tmp/arcadeplatform-infra-1-"
  ]) {
    const result = spawnSync("bash", ["-c", guardSource], {
      env: { ...process.env, INFRA_REMOTE_TMP_DIR: value },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0, `expected rejected temp path: ${value}`);
  }

  const onErrorIndex = remote.indexOf("on_error() {");
  const rollbackCallIndex = remote.indexOf("  rollback", onErrorIndex);
  const exitIndex = remote.indexOf('  exit "$rc"', onErrorIndex);
  const cleanupTrapIndex = remote.indexOf("trap cleanup EXIT");
  assert.notEqual(onErrorIndex, -1);
  assert.notEqual(rollbackCallIndex, -1);
  assert.notEqual(exitIndex, -1);
  assert.notEqual(cleanupTrapIndex, -1);
  assert.equal(rollbackCallIndex < exitIndex, true);
  assert.equal(exitIndex < cleanupTrapIndex, true);
});

test("infra VPS workflow keeps concurrency guard", () => {
  const text = workflowText();
  assert.ok(text.includes("concurrency:"));
  assert.ok(text.includes("group: infra-vps-${{ github.ref }}"));
  assert.ok(text.includes("cancel-in-progress: false"));
});

test("infra VPS remote bash keeps rollback safety and non-interactive sudo", () => {
  const remote = remoteBash(workflowText());
  assert.ok(remote.includes("set -Eeuo pipefail"));
  assert.ok(remote.includes("trap 'on_error' ERR"));
  assert.ok(remote.includes("rollback()"));
  assert.ok(remote.includes("cp \"$BACKUP_PATH\" \"$CADDY_PATH\" || true"));
  assert.ok(remote.includes("sudo -n /usr/bin/systemctl reload caddy.service || true"));
  assert.ok(remote.includes("caddy validate --config /etc/caddy/Caddyfile"));
  assert.ok(remote.includes("sudo -n /usr/bin/systemctl reload caddy.service"));
  assert.equal(remote.includes("sudo caddy validate"), false);
  assert.equal(remote.includes("sudo systemctl reload caddy"), false);
  assert.equal(remote.match(/sudo -n /g)?.length, 2);
  assert.equal(remote.includes("sudo -n cp"), false);
  assert.equal(remote.includes("sudo -n caddy"), false);
});

test("infra VPS remote bash verifies backup before overwrite and validates before reload", () => {
  const remote = remoteBash(workflowText());

  const backupCopyIndex = remote.indexOf('cp "$CADDY_PATH" "$BACKUP_PATH"');
  const backupExistsIndex = remote.indexOf('test -f "$BACKUP_PATH"', backupCopyIndex);
  const applyIndex = remote.indexOf('cp "$TMP_PATH" "$CADDY_PATH"', backupExistsIndex);
  const validateIndex = remote.indexOf("caddy validate --config /etc/caddy/Caddyfile", applyIndex);
  const reloadIndex = remote.indexOf("sudo -n /usr/bin/systemctl reload caddy.service", validateIndex);

  assert.notEqual(backupCopyIndex, -1);
  assert.notEqual(backupExistsIndex, -1);
  assert.notEqual(applyIndex, -1);
  assert.notEqual(validateIndex, -1);
  assert.notEqual(reloadIndex, -1);
  assert.equal(backupCopyIndex < backupExistsIndex, true);
  assert.equal(backupExistsIndex < applyIndex, true);
  assert.equal(applyIndex < validateIndex, true);
  assert.equal(validateIndex < reloadIndex, true);
});

test("infra VPS bootstrap publishes the deploy group, helper and exact sudoers contract", () => {
  const bootstrap = fileText("infra/vps/bootstrap.sh");
  const sudoers = fileText("infra/vps/arcade-deploy.sudoers");
  const helper = fileText("infra/vps/ws-preview-env-preflight.mjs");

  assert.match(bootstrap, /getent group arcade-deploy/);
  assert.match(bootstrap, /usermod --append --groups arcade-deploy copilot/);
  assert.match(bootstrap, /gpasswd --delete arcade arcade-deploy/);
  assert.doesNotMatch(bootstrap, /usermod --append --groups (?:sudo|docker|arcade-deploy) arcade/);
  assert.doesNotMatch(bootstrap, /arcade ALL=/);
  // #1159 T004: the Production release tree belongs to arcade-release; copilot is never in its group.
  assert.match(bootstrap, /install -d -o root -g arcade-release -m 2775 \/opt\/ws-server \/opt\/ws-server\/releases/);
  assert.match(bootstrap, /gpasswd --delete copilot arcade-release/);
  assert.doesNotMatch(bootstrap, /usermod --append --groups [^\n]*arcade-release/);
  assert.match(bootstrap, /install -d -o arcade -g arcade -m 0755 \/opt\/arcade-ws-preview/);
  assert.match(bootstrap, /\/opt\/arcade-ws-preview\/(?:ws-server|shared|netlify|node_modules)/);
  assert.match(bootstrap, /-g arcade-deploy -m 2775/);
  assert.match(bootstrap, /install -o root -g arcade-deploy -m 0664 "\$REPO_ROOT\/infra\/vps\/Caddyfile" \/etc\/caddy\/Caddyfile/);
  assert.match(bootstrap, /ws-preview-env-preflight\.mjs/);
  assert.match(bootstrap, /ws-production-env-preflight\.mjs/);
  assert.match(bootstrap, /\[\[ ! -x \/usr\/bin\/node \]\]/);
  assert.match(bootstrap, /\/usr\/bin\/node --version/);
  assert.match(bootstrap, /visudo -cf/);
  assert.match(bootstrap, /arcade-deploy\.sudoers/);
  assert.match(sudoers, /copilot ALL=\(root\) NOPASSWD:/);
  assert.doesNotMatch(sudoers, /systemctl restart ws-server\.service/);
  assert.match(sudoers, /arcade-release ALL=\(root\) NOPASSWD: ARCADE_RELEASE_COMMANDS/);
  assert.match(sudoers, /\/usr\/local\/sbin\/arcade-ws-restart-gate restart, \\\n/);
  assert.match(sudoers, /restart ws-server-preview\.service/);
  assert.match(sudoers, /reload caddy\.service/);
  assert.match(sudoers, /arcade-ws-preview-env-preflight ""/);
  assert.match(sudoers, /arcade-ws-production-env-preflight ""/);
  assert.doesNotMatch(sudoers, /arcade ALL=/);
  const sudoersCommands = sudoers.replace(/^#.*$/gm, "");
  assert.doesNotMatch(sudoersCommands, /(?:^|[ /])(bash|sh|node|python|tar|rsync|cp|mv|rm|install)(?:["\s]|$)/m);
  assert.doesNotMatch(sudoersCommands, /ALL\s*$/m);
  assert.match(helper, /\/opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(helper, /O_NOFOLLOW/);
  assert.match(helper, /uid !== 0/);
  assert.match(helper, /gid !== 0/);
  assert.match(helper, /0o600/);
});

test("infra VPS workflow removes remote websocket curl upgrade and adds runner node smoke-check", () => {
  const text = workflowText();
  const remote = remoteBash(text);

  assert.equal(remote.includes("Upgrade: websocket"), false);
  assert.equal(remote.includes("Sec-WebSocket-Key"), false);
  assert.equal(remote.includes("--http1.1"), false);
  assert.doesNotMatch(remote, /\/ws(?:[/?\\s'\"]|$)/);

  assert.ok(text.includes("- name: Smoke-check ws.kcswh.pl from runner"));
  assert.ok(text.includes("timeout 15s node <<'NODE'"));
  assert.ok(text.includes('"type":"helloAck"'));
});

test("infra VPS repository versions the audited production WS and Stage scheduler contracts", () => {
  const production = fileText("infra/vps/ws-server.service");
  for (const line of [
    "User=arcade",
    "Group=arcade",
    "WorkingDirectory=/opt/ws-server/current",
    "ExecStart=/usr/bin/env node /opt/ws-server/current/server.mjs",
    "Restart=always",
    "RestartSec=2",
    "Environment=NODE_ENV=production",
    "Environment=PORT=3000",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    "ReadWritePaths=/opt/ws-server"
  ]) {
    assert.match(production, new RegExp(`^${line.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "m"));
  }

  const override = fileText("infra/vps/ws-server.service.d/override.conf");
  assert.match(override, /^EnvironmentFile=\/etc\/arcadeplatform\/ws-server\.env$/m);
  assert.equal(
    fileText("infra/vps/ws-server.service.d/50-new-hands-hold.conf"),
    "[Service]\nEnvironment=WS_POKER_NEW_HANDS_HOLD_FILE=/etc/arcadeplatform/ws-hold/new-hands\n"
  );

  const schedulerService = fileText("infra/vps/arcade-chips-ledger-dispatch.service");
  for (const line of [
    "Type=oneshot",
    "User=arcade-dispatch",
    "Group=arcade-dispatch",
    "EnvironmentFile=/etc/arcadeplatform/stage-retention-dispatch.env",
    "Environment=HOME=/run/arcade-chips-ledger-dispatch",
    "Environment=PATH=/usr/local/bin:/usr/bin:/bin",
    "RuntimeDirectoryMode=0700",
    "ExecStart=/usr/local/bin/arcade-chips-ledger-dispatch.sh",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectHome=true"
  ]) {
    assert.match(schedulerService, new RegExp(`^${line.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "m"));
  }

  const schedulerTimer = fileText("infra/vps/arcade-chips-ledger-dispatch.timer");
  assert.match(schedulerTimer, /^OnCalendar=\*-\*-\* \*:2,17,32,47:00$/m);
  assert.match(schedulerTimer, /^OnCalendar=\*-\*-\* \*:3,18,33,48:00$/m);
  assert.match(schedulerTimer, /^OnCalendar=\*-\*-\* 02:04:00$/m);
  assert.match(schedulerTimer, /^AccuracySec=1s$/m);

  const dispatcher = fileText("infra/vps/arcade-chips-ledger-dispatch.sh");
  assert.match(dispatcher, /^REPO="krzysztofcal\/arcadePlatform"$/m);
  assert.match(dispatcher, /^WORKFLOW_ID="349412824"$/m);
  assert.match(dispatcher, /^RESOURCE_WORKFLOW_ID="353254812"$/m);
  assert.match(dispatcher, /^DAILY_MODE="external-existing-30d"$/m);
  assert.match(dispatcher, /^MODE="external-scheduled-automatic"$/m);
  assert.match(dispatcher, /^WORKFLOW_FILE="\.github\/workflows\/chips-ledger-stage-scheduled-automation\.yml"$/m);
  assert.doesNotMatch(dispatcher, /SUPABASE_(DB_URL|SERVICE_ROLE_KEY|ACCESS_TOKEN|JWT_SECRET)|gh auth login|--token/i);
});

test("retired poker refill scheduler is absent and chips cleanup credentials stay unchanged", () => {
  const retiredArtifacts = [
    "infra/vps/arcade-poker-pool-dispatch.sh",
    "infra/vps/arcade-poker-pool-dispatch.service",
    "infra/vps/arcade-poker-pool-dispatch.timer",
    ".github/workflows/poker-bot-pool-refill.yml",
    "scripts/ops/poker-bot-pool-refill.mjs",
    "scripts/ops/poker-bot-pool-refill.behavior.test.mjs",
  ];
  for (const artifact of retiredArtifacts) assert.equal(fs.existsSync(artifact), false, `${artifact} must be removed`);
  const bootstrap = fileText("infra/vps/bootstrap.sh");
  assert.doesNotMatch(bootstrap, /arcade-poker-pool-dispatch|poker-bot-pool-refill|arcade-poker-refill/i);

  const chipsService = fileText("infra/vps/arcade-chips-ledger-dispatch.service");
  assert.match(chipsService, /^User=arcade-dispatch$/m);
  assert.doesNotMatch(chipsService, /poker-refill|arcade-poker/);
  const dispatcher = fileText("infra/vps/arcade-chips-ledger-dispatch.sh");
  assert.match(dispatcher, /^REPO="krzysztofcal\/arcadePlatform"$/m);
  assert.doesNotMatch(dispatcher, /poker-bot-pool-refill|poker-pool-refill/);
});

test("infra VPS environment examples expose only the audited variable names without live secrets", () => {
  const expectedProductionKeys = [
    "WS_AUTH_HS256_SECRET",
    "SUPABASE_DB_URL",
    "WS_AUTHORITATIVE_JOIN_ENABLED",
    "POKER_BOTS_ENABLED",
    "POKER_BOTS_MAX_PER_TABLE",
    "POKER_BOT_BUYIN_BB",
    "POKER_BOT_PROFILE_DEFAULT",
    "SUPABASE_URL",
    "POKER_WS_INTERNAL_TOKEN",
    "WS_POKER_BOT_ACTION_RETENTION_MS",
    "WS_POKER_BOT_SETTLED_RETENTION_MS",
    "WS_POKER_HUMAN_ACTION_RETENTION_MS",
    "WS_POKER_HUMAN_SETTLED_RETENTION_MS",
    "WS_POKER_ACTION_HISTORY_SWEEP_MS",
    "WS_POKER_ACTION_HISTORY_BATCH_SIZE",
    "WS_POKER_CLOSED_TABLE_RETENTION_MS"
  ];
  const expectedPreviewKeys = [
    "NODE_ENV",
    "HOST",
    "PORT",
    "SUPABASE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WS_AUTH_HS256_SECRET",
    "WS_AUTHORITATIVE_JOIN_ENABLED",
    "SUPABASE_JWT_SECRET",
    "POKER_BOTS_ENABLED",
    "SUPABASE_STAGE_PROJECT_REF",
    "POKER_WS_INTERNAL_TOKEN",
    "WS_POKER_BOT_ACTION_RETENTION_MS",
    "WS_POKER_BOT_SETTLED_RETENTION_MS",
    "WS_POKER_HUMAN_ACTION_RETENTION_MS",
    "WS_POKER_HUMAN_SETTLED_RETENTION_MS",
    "WS_POKER_ACTION_HISTORY_SWEEP_MS",
    "WS_POKER_ACTION_HISTORY_BATCH_SIZE"
  ];

  for (const [path, expectedKeys] of [
    ["infra/vps/ws-production.env.example", expectedProductionKeys],
    ["infra/vps/ws-preview.env.example", expectedPreviewKeys]
  ]) {
    const text = fileText(path);
    const actualKeys = text
      .split("\n")
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean);
    assert.deepEqual(actualKeys, expectedKeys, `${path} must match the audited env key order`);
    for (const key of expectedKeys.filter((name) => /SECRET|TOKEN|KEY|DB_URL|SUPABASE_URL/.test(name))) {
      assert.match(
        text,
        new RegExp(`^${key}=(?:replace-with-|https?:\\/\\/replace-with-|postgres(?:ql)?:\\/\\/replace-with-)`, "m"),
        `${path} must use a placeholder for ${key}`
      );
    }
    assert.doesNotMatch(text, /ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|-----BEGIN|eyJ[A-Za-z0-9_-]{20,}/);
    if (path === "infra/vps/ws-production.env.example") {
      assert.match(text, /^WS_POKER_CLOSED_TABLE_RETENTION_MS=0$/m);
      // The attested env never carries the hold path; the ws-server.service drop-in does.
      assert.doesNotMatch(text, /WS_POKER_NEW_HANDS_HOLD_FILE/);
    }
  }
});

test("infra VPS secret backup is a two-file streaming age artifact with a non-secret manifest", () => {
  const backupPath = "infra/vps/vps-secrets-backup.sh";
  const restorePath = "infra/vps/vps-secrets-restore.sh";
  assert.equal(fs.existsSync(backupPath), true, `${backupPath} must exist`);
  assert.equal(fs.existsSync(restorePath), true, `${restorePath} must exist`);

  const backup = fileText(backupPath);
  const restore = fileText(restorePath);
  const backupContract = backup.replace(/\\\n\s*/g, " ");
  const restoreContract = restore.replace(/\\\n\s*/g, " ");

  for (const path of [backupPath, restorePath]) {
    const syntax = spawnSync("bash", ["-n", path], { encoding: "utf8" });
    assert.equal(syntax.status, 0, `${path}: ${syntax.stderr}`);
  }

  for (const sourcePath of [
    "/etc/arcadeplatform/ws-server.env",
    "/opt/arcade-ws-preview/.env.preview"
  ]) {
    assert.ok(backup.includes(sourcePath), `backup must include ${sourcePath}`);
  }
  assert.deepEqual(
    [...backup.matchAll(/^readonly SOURCE_[A-Z]+="([^"]+)"$/gm)].map((match) => match[1]),
    ["/etc/arcadeplatform/ws-server.env", "/opt/arcade-ws-preview/.env.preview"]
  );
  assert.match(backupContract, /tar\b[^\n]*--directory=\/[^\n]*--[^\n]*etc\/arcadeplatform\/ws-server\.env/);
  assert.match(backupContract, /tar\b[^\n]*\|\s*age\b[^\n]*--encrypt/);
  assert.match(backup, /readonly ENCRYPTED_OBJECT=\"vps-secrets\.tar\.age\"/);
  assert.match(backupContract, /--output\s+\"\$encrypted_path\"/);
  assert.match(backup, /set -o pipefail|set -Eeuo pipefail/);
  assert.match(backup, /mktemp -d/);
  assert.match(backup, /trap .*cleanup|trap cleanup/);
  assert.match(backup, /rmdir/);
  const outputGuardIndex = backup.indexOf('case "$OUTPUT_ROOT"');
  const outputCreateIndex = backup.indexOf('mkdir -p -- "$OUTPUT_ROOT"');
  assert.ok(outputGuardIndex >= 0 && outputGuardIndex < outputCreateIndex);
  assert.match(backupContract, /--file=-/);
  assert.match(backup, /mv -T -- \"\$ARTIFACT_STAGE\" \"\$artifact_dir\"/);
  assert.match(backup, /for attempt in 1 2 3/);
  assert.match(backup, /source changed during attempt/);
  assert.doesNotMatch(backupContract, /tar\b[^\n]*(?:-f|--file=)\s*\"\$[^\"]*(?:\.tar|archive)/i);
  assert.doesNotMatch(backup, /\b(?:cp|install)\b[^\n]*(?:ws-server\.env|\.env\.preview)/);
  assert.doesNotMatch(backup, /\.credentials|node_modules|journald|supabase|\/tmp/i);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /wc -c/);
  for (const manifestField of [
    '"format"',
    '"version"',
    '"timestamp"',
    '"source_path"',
    '"filename"',
    '"encrypted_object"',
    '"plaintext_byte_size"',
    '"plaintext_sha256"',
    '"encrypted_sha256"'
  ]) {
    assert.ok(backup.includes(manifestField), `backup manifest must include ${manifestField}`);
  }
  assert.match(backup, /age recipient|recipient/i);
  assert.doesNotMatch(backup, /--identity|-i\s+[^-\s]/);

  assert.match(restore, /--artifact-dir/);
  assert.match(restore, /--restore-dir/);
  assert.match(restore, /--identity-stdin/);
  assert.match(restoreContract, /--identity\s+-|-i\s+-/);
  assert.match(restoreContract, /tar\b[^\n]*(?:--list|-t)/);
  assert.match(restoreContract, /tar\b[^\n]*(?:--extract|-x)/);
  assert.match(restore, /etc\/arcadeplatform\/ws-server\.env/);
  assert.match(restore, /opt\/arcade-ws-preview\/\.env\.preview/);
  assert.match(restore, /sha256sum/);
  assert.match(restore, /wc -c/);
  assert.match(restore, /live restore is disabled|live restore.*disabled/i);
  assert.match(restore, /mktemp -d/);
  assert.match(restore, /rm -f/);
  assert.match(restore, /rmdir/);
  const restoreTrapIndex = restore.indexOf("trap cleanup EXIT");
  const restoreCreateIndex = restore.indexOf('mkdir -p -- "$RESTORE_DIR"');
  const restoreOwnershipIndex = restore.indexOf("RESTORE_DIR_CREATED=1");
  assert.ok(restoreTrapIndex >= 0 && restoreTrapIndex < restoreCreateIndex);
  assert.ok(restoreOwnershipIndex >= 0 && restoreOwnershipIndex < restoreCreateIndex);
  assert.match(restore, /Number\.isSafeInteger/);
  assert.match(restore, /expected_members/);
  assert.match(restore, /actual_members/);
  assert.doesNotMatch(restore, /systemctl|journalctl|gh workflow run|supabase/i);
  assert.doesNotMatch(restore, /\.credentials|node_modules|\/tmp/i);
  assert.doesNotMatch(restore, /cat\s+[^\n]*(?:ws-server\.env|\.env\.preview)/);

  for (const [path, text] of [[backupPath, backup], [restorePath, restore]]) {
    assert.match(text, /local operation_status=\$\?/,
      `${path} must preserve the main operation status before cleanup`);
    assert.match(text, /local cleanup_failed=0/,
      `${path} must track cleanup failure separately`);
    assert.doesNotMatch(text, /local status=\$\?/,
      `${path} must not reuse the operation status as cleanup status`);
    assert.match(text, /if \(\( cleanup_failed != 0 \)\); then/,
      `${path} must report cleanup failure only when cleanup_failed is set`);
    assert.match(text, /operation_status=1/,
      `${path} must return non-zero when cleanup fails`);
    assert.match(text, /exit "\$operation_status"/,
      `${path} must retain the original operation result when cleanup succeeds`);
  }
});

test("infra VPS bootstrap is shell-valid, fresh-VPS guarded, and cannot dispatch or clean up", () => {
  const path = "infra/vps/bootstrap.sh";
  const syntax = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  const text = fileText(path);
  assert.match(text, /ARCADEPLATFORM_BOOTSTRAP_TARGET.*fresh-vps/);
  assert.match(text, /existing runtime marker/);
  const guardStart = text.indexOf("for existing_marker in");
  const guardEnd = text.indexOf("\ndone", guardStart);
  assert.notEqual(guardStart, -1);
  assert.notEqual(guardEnd, -1);
  const guard = text.slice(guardStart, guardEnd);
  for (const marker of [
    "/etc/arcadeplatform/ws-server.env",
    "/opt/ws-server/current",
    "/opt/arcade-ws-preview/.env.preview"
  ]) {
    assert.ok(guard.includes(marker), `bootstrap guard must protect ${marker}`);
  }
  assert.doesNotMatch(guard, /\/etc\/caddy\/Caddyfile|\/etc\/systemd\/system\/|arcade-chips-ledger-dispatch\.timer/);
  assert.match(text, /postgresql-client/);
  assert.match(text, /\bage\b/);
  const caddyMaskIndex = text.indexOf("systemctl mask --runtime caddy.service");
  const caddyInstallIndex = text.indexOf("apt-get install -y");
  const caddyUnmaskIndex = text.lastIndexOf("systemctl unmask caddy.service");
  assert.ok(caddyMaskIndex >= 0 && caddyMaskIndex < caddyInstallIndex);
  assert.ok(caddyUnmaskIndex > caddyInstallIndex);
  assert.match(text, /systemctl disable caddy.service/);
  assert.doesNotMatch(text, /systemctl\s+(enable|start|restart|reload).*caddy\.service/);
  assert.match(text, /systemctl daemon-reload/);
  assert.doesNotMatch(text, /gh workflow run|workflow_dispatch/);
  assert.doesNotMatch(text, /supabase/i);
  assert.doesNotMatch(text, /\brm\s+-rf\b/);
  assert.doesNotMatch(text, /systemctl\s+(enable|start|restart|reload).*arcade-chips-ledger-dispatch/);
});

test("infra VPS recovery docs retain the mutation boundaries and runner contract", () => {
  const runbook = fileText("docs/vps-disaster-recovery.md");
  for (const label of ["READ-ONLY", "FRESH-VPS MUTATION", "PRODUCTION MUTATION"]) {
    assert.ok(runbook.includes(label), `runbook must include ${label} boundaries`);
  }
  for (const phrase of [
    "WS Server Deploy",
    "WS Preview Deploy",
    "self-hosted",
    "Linux",
    "X64",
    "stage-db-ipv6",
    "Do not restore runner .credentials",
    "Every `PRODUCTION MUTATION` requires separate owner approval"
  ]) {
    assert.ok(runbook.includes(phrase), `runbook must include ${phrase}`);
  }

  for (const phrase of [
    "vps-secrets-backup.sh",
    "vps-secrets-restore.sh",
    "--identity-stdin",
    "timestamp",
    "encrypted_sha256",
    "full fresh-VPS rehearsal was not performed",
    "retention",
    "private identity key"
  ]) {
    assert.ok(runbook.includes(phrase), `runbook must include ${phrase}`);
  }

  const inventory = fileText("docs/vps-disaster-recovery-inventory.md");
  for (const phrase of [
    "Component",
    "Path",
    "Classification",
    "Source of truth",
    "Recovery action",
    "/etc/arcadeplatform/ws-server.env",
    "/var/lib/arcade-stage-runner/actions-runner/.credentials",
    "disposable"
  ]) {
    assert.ok(inventory.includes(phrase), `inventory must include ${phrase}`);
  }
});

test("VPS SSH apply runs only for an owner main dispatch or an owner Caddy push, never a foreign re-run (#1159 T004-3)", () => {
  const condition = workflowText().match(/\n  apply:\n    needs: validate\n    if: (.+)\n/)[1];
  const evaluate = ({ event = "workflow_dispatch", ref = "refs/heads/main", actor = "krzysztofcal", triggeringActor = actor, caddy = "true" } = {}) => {
    const js = condition
      .replaceAll("needs.validate.outputs.caddy", JSON.stringify(caddy))
      .replaceAll("github.event_name", JSON.stringify(event))
      .replaceAll("github.ref", JSON.stringify(ref))
      .replaceAll("github.triggering_actor", JSON.stringify(triggeringActor))
      .replaceAll("github.actor", JSON.stringify(actor))
      .replaceAll("github.repository_owner", JSON.stringify("krzysztofcal"))
      .replaceAll("'", "\"")
      .replaceAll(" == ", " === ")
      .replaceAll(" != ", " !== ");
    assert.match(js, /^[\s"a-z0-9_\-/[\].()|&=!]+$/i, js);
    return Function(`return (${js});`)();
  };
  assert.equal(evaluate(), true, "owner main dispatch");
  assert.equal(evaluate({ ref: "refs/heads/feature" }), false, "dispatch from another branch");
  assert.equal(evaluate({ triggeringActor: "release-agent[bot]" }), false, "foreign re-run of an owner dispatch");
  assert.equal(evaluate({ actor: "release-agent[bot]" }), false, "foreign dispatch");
  assert.equal(evaluate({ event: "push" }), true, "owner Caddy push to main");
  assert.equal(evaluate({ event: "push", caddy: "false" }), false, "push without Caddy change");
  assert.equal(evaluate({ event: "push", triggeringActor: "release-agent[bot]" }), false, "foreign re-run of a Caddy push");
  assert.equal(evaluate({ event: "push", actor: "release-agent[bot]", triggeringActor: "krzysztofcal" }), false, "owner re-run of a foreign push");
  assert.equal(evaluate({ event: "pull_request" }), false, "pull requests never reach the VPS");
});

test("ledger dispatchers never use copilot's home, gh or token and fail closed without their own token (#1159 T004-3)", () => {
  for (const [unit, script] of [
    ["infra/vps/arcade-chips-ledger-dispatch.service", "infra/vps/arcade-chips-ledger-dispatch.sh"],
    ["infra/vps/production-retention/arcade-chips-ledger-production-dispatch.service", "infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh"],
  ]) {
    const unitText = fileText(unit);
    assert.match(unitText, /^User=arcade-dispatch$/m, unit);
    assert.match(unitText, /^ProtectHome=true$/m, unit);
    assert.match(unitText, /^EnvironmentFile=-?\/etc\/arcadeplatform\/(?:stage|production)-retention-dispatch\.env$/m, unit);
    assert.doesNotMatch(unitText, /copilot|GH_CONFIG_DIR|GH_TOKEN/, unit);
    assert.match(fileText(script), /^GH_BIN="\$\{GH_BIN:-\/usr\/bin\/gh\}"$/m, script);
    assert.doesNotMatch(fileText(script), /copilot/, script);
  }
  const bootstrap = fileText("infra/vps/bootstrap.sh");
  assert.match(bootstrap, /useradd --system --no-create-home --home-dir \/nonexistent --shell \/usr\/sbin\/nologin --gid arcade-dispatch arcade-dispatch/);
  assert.match(bootstrap, /gpasswd --delete copilot arcade-dispatch/);

  // An ambient gh login must never authenticate the Stage dispatcher.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "stage-dispatch-test-"));
  try {
    const gh = path.join(fixture, "gh");
    const log = path.join(fixture, "calls");
    fs.writeFileSync(gh, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${log}"\necho '[]'\n`, { mode: 0o700 });
    fs.writeFileSync(path.join(fixture, "date"), "#!/bin/bash\necho 10\n", { mode: 0o700 });
    const run = (extra) => {
      fs.writeFileSync(log, "");
      const result = spawnSync("bash", ["infra/vps/arcade-chips-ledger-dispatch.sh"], { encoding: "utf8",
        env: { PATH: `${fixture}:${process.env.PATH}`, GH_BIN: gh, RUNTIME_DIRECTORY: fixture, ...extra } });
      return { ...result, calls: fs.readFileSync(log, "utf8") };
    };
    const missing = run({});
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /dedicated Stage GH_TOKEN is required/);
    assert.equal(missing.calls, "", "no GitHub call without the dedicated token");
    const withToken = run({ GH_TOKEN: "fake-test-only" });
    assert.equal(withToken.status, 0, withToken.stderr);
    assert.match(withToken.stdout, /skip: outside dispatch schedule/);
    assert.equal(fs.statSync(path.join(fixture, "gh-stage")).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

// #1159 root on demand: a fake host records every command; nothing touches systemd or the journal. The lock is real
// flock(1) on a temporary file.
function fakeAdminHost(state = {}, extra = {}) {
  const lockFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vps-admin-")), "lock");
  const calls = [];
  const audits = [];
  const loggerStatus = [...(extra.loggerStatus || [])];
  const clock = { t: 0 };
  const host = {
    lockFile, requester: "arcade-admin", now: () => clock.t, sleep: (ms) => { clock.t += ms; },
    run(argv) {
      clock.t += extra.callMs || 0;
      if (argv[0] === "/usr/bin/logger") {
        audits.push(argv.at(-1));
        return { status: loggerStatus.length ? loggerStatus.shift() : 0, stdout: "" };
      }
      calls.push(argv.slice(1).join(" "));
      if (argv[1] === "show") {
        const key = `${argv[4]}:${argv[3]}`;
        if (state[`fail:${key}`]) return { status: 1, stdout: "" };
        const value = state[key];
        const out = typeof value === "function" ? value(clock.t) : Array.isArray(value) ? (value.length > 1 ? value.shift() : value[0]) : value;
        return { status: 0, stdout: out ?? ({ User: "arcade-dispatch", ActiveState: "inactive", NeedDaemonReload: "no" })[argv[3]] };
      }
      if (extra.onRun) extra.onRun(argv);
      return { status: state[`exit:${argv.slice(1).join(" ")}`] ?? 0, stdout: "" };
    },
  };
  return { host, calls, audits, clock };
}

test("VPS admin helper runs only its catalog, refuses unverifiable reads and unaudited work, and serializes requests", async () => {
  const { runOperation } = await import("../infra/vps/vps-admin.mjs");
  for (const [operation, runId] of [["rm -rf /", "1"], ["bash", "1"], ["ledger-dispatchers-pause", "0"], ["ledger-dispatchers-pause", "1;id"], ["toString", "1"]]) {
    const { host, calls, audits } = fakeAdminHost();
    const result = runOperation(operation, runId, host);
    assert.equal(result.ok, false);
    assert.match(result.line, /^ADMIN_BLOCKED [a-z0-9-]+ unexpected_arguments$/);
    assert.deepEqual(calls, [], "a refused request runs no command");
    assert.match(audits[0], /result=blocked reason=unexpected_arguments/);
  }

  const status = fakeAdminHost();
  assert.equal(runOperation("ledger-dispatchers-status", "7", status.host).line, "ADMIN_OK ledger-dispatchers-status arcade-chips-ledger-dispatch=arcade-dispatch/inactive/timer:inactive/reload:no arcade-chips-ledger-production-dispatch=arcade-dispatch/inactive/timer:inactive/reload:no");
  for (const state of [{ "fail:arcade-chips-ledger-production-dispatch.timer:ActiveState": true }, { "arcade-chips-ledger-dispatch.service:User": "" }, { "arcade-chips-ledger-dispatch.service:NeedDaemonReload": "maybe" }]) {
    const bad = fakeAdminHost(state);
    const result = runOperation("ledger-dispatchers-status", "8", bad.host);
    assert.match(result.line, /^ADMIN_BLOCKED ledger-dispatchers-status unverifiable_arcade-chips-ledger-[a-z-]+\.(service|timer)_[A-Za-z]+$/, "a failed or unexpected read is never a status");
    assert.match(bad.audits[1], /result=blocked/);
  }

  const idle = { "arcade-chips-ledger-dispatch.service:ActiveState": ["activating", "activating", "inactive"] };
  const pause = fakeAdminHost(idle);
  const paused = runOperation("ledger-dispatchers-pause", "41700000001", pause.host);
  assert.equal(paused.line, "ADMIN_OK ledger-dispatchers-pause timers_stopped dispatchers_idle");
  assert.deepEqual(pause.calls.filter((c) => !c.startsWith("show")), ["stop arcade-chips-ledger-dispatch.timer", "stop arcade-chips-ledger-production-dispatch.timer"]);
  assert.match(pause.audits[0], /^op=ledger-dispatchers-pause run=41700000001 by=arcade-admin phase=start$/);
  assert.match(pause.audits[1], /result=ok/);

  // One 5-minute deadline for both dispatchers, including systemctl time; on timeout the timers stay stopped.
  const busyUntil = (ms) => (t) => (t < ms ? "activating" : "inactive");
  const sequential = fakeAdminHost({ "arcade-chips-ledger-dispatch.service:ActiveState": busyUntil(200000),
    "arcade-chips-ledger-production-dispatch.service:ActiveState": (t) => (t < 200000 ? "inactive" : t < 400000 ? "activating" : "inactive") });
  assert.equal(runOperation("ledger-dispatchers-pause", "2", sequential.host).line,
    "ADMIN_BLOCKED ledger-dispatchers-pause timeout_timers_left_stopped arcade-chips-ledger-dispatch.service=inactive arcade-chips-ledger-production-dispatch.service=activating");
  assert.ok(sequential.clock.t <= 300000 + 2 * 30000, "the deadline is shared, not 5 minutes per dispatcher");
  assert.equal(sequential.calls.some((c) => c.startsWith("start")), false, "no timer is resumed automatically");
  // Slow systemctl calls (100 s each) use up the deadline: one status round, no waiting, then STOP.
  const slowCalls = fakeAdminHost({ "arcade-chips-ledger-dispatch.service:ActiveState": "activating" }, { callMs: 100000 });
  assert.match(runOperation("ledger-dispatchers-pause", "14", slowCalls.host).line, /^ADMIN_BLOCKED ledger-dispatchers-pause timeout_timers_left_stopped /);
  assert.equal(slowCalls.calls.filter((c) => c.startsWith("show")).length, 2, "systemctl time counts against the deadline");

  // Idle dispatchers read only after the deadline (slow systemctl) are still a timeout, never ADMIN_OK.
  const lateIdle = fakeAdminHost({}, { callMs: 160000 });
  assert.equal(runOperation("ledger-dispatchers-pause", "15", lateIdle.host).line,
    "ADMIN_BLOCKED ledger-dispatchers-pause timeout_timers_left_stopped arcade-chips-ledger-dispatch.service=inactive arcade-chips-ledger-production-dispatch.service=inactive");

  for (const unit of ["arcade-chips-ledger-dispatch.service", "arcade-chips-ledger-production-dispatch.timer"]) {
    const reload = fakeAdminHost({ [`${unit}:NeedDaemonReload`]: "yes" });
    assert.equal(runOperation("ledger-dispatchers-resume", "3", reload.host).line, `ADMIN_BLOCKED ledger-dispatchers-resume ${unit}_needs_daemon_reload`);
    assert.equal(reload.calls.some((c) => c.startsWith("start")), false, "no timer starts before daemon-reload");
  }

  const failed = fakeAdminHost({ "exit:daemon-reload": 1 });
  assert.equal(runOperation("systemd-daemon-reload", "4", failed.host).line, "ADMIN_FAILED systemd-daemon-reload daemon-reload");
  assert.match(failed.audits[1], /result=failed detail=daemon-reload/);

  // Audit: no start entry, no work; no end entry, no success (and no retry).
  const noStart = fakeAdminHost({}, { loggerStatus: [1] });
  assert.equal(runOperation("ledger-dispatchers-pause", "9", noStart.host).line, "ADMIN_BLOCKED ledger-dispatchers-pause audit_unavailable");
  assert.deepEqual(noStart.calls, [], "nothing runs without a recorded start");
  const noEnd = fakeAdminHost({}, { loggerStatus: [0, 1] });
  assert.equal(runOperation("systemd-daemon-reload", "10", noEnd.host).line, "ADMIN_FAILED systemd-daemon-reload audit_end_after_ok");
  assert.deepEqual(noEnd.calls, ["daemon-reload"], "the operation ran exactly once");

  // Lock: a second request while one runs is busy; the lock is released afterwards.
  let nested;
  const outer = fakeAdminHost({}, { onRun: () => { nested = runOperation("ledger-dispatchers-status", "12", { ...outer.host, run: fakeAdminHost().host.run }); } });
  assert.equal(runOperation("systemd-daemon-reload", "11", outer.host).line, "ADMIN_OK systemd-daemon-reload reloaded");
  assert.equal(nested.line, "ADMIN_BLOCKED ledger-dispatchers-status busy");
  assert.equal(runOperation("ledger-dispatchers-status", "13", { ...outer.host, run: fakeAdminHost().host.run }).ok, true, "the lock is released");
  const helper = fileText("infra/vps/vps-admin.mjs");
  assert.match(helper, /spawnSync\("\/usr\/bin\/flock", \["-n", "3"\]/);
  assert.doesNotMatch(helper, /mkdirSync|process\.pid|isAlive/, "no PID-file lock to go stale");

  const cli = spawnSync(process.execPath, ["infra/vps/vps-admin.mjs", "ledger-dispatchers-status"], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, "ADMIN_BLOCKED invalid unexpected_arguments\n");
});

// Real temporary directories and the real install(1); the current user stands for both copilot and root, and a fake
// /proc tree lists the processes. Nothing outside the fixture is touched.
function quarantineFixture() {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "vps-quarantine-"));
  const home = path.join(top, "home");
  const files = [".config/netlify/config.json", ".config/arcadeplatform/window/env.json"];
  for (const [i, rel] of files.entries()) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), `SECRET-MARKER-${i}`, { mode: 0o600 });
  }
  fs.writeFileSync(path.join(home, ".config/arcadeplatform/window/browser-profile"), "kept"); // not in the list
  const proc = path.join(top, "proc");
  const addProcess = (pid, fd, maps = "") => {
    fs.mkdirSync(path.join(proc, pid, "fd"), { recursive: true });
    for (const link of ["cwd", "root"]) fs.symlinkSync("/", path.join(proc, pid, link));
    if (fd) fs.symlinkSync(fd, path.join(proc, pid, "fd", "3"));
    fs.writeFileSync(path.join(proc, pid, "maps"), maps);
  };
  addProcess("1");
  const base = path.join(top, "var/arcade-admin/quarantine");
  const admin = fakeAdminHost();
  const host = {
    ...admin.host,
    rename: (from, to) => fs.renameSync(from, to),
    quarantine: { user: "copilot", home, base, proc, files, rootUid: process.getuid(), rootGid: process.getgid() },
    run(argv) {
      if (argv[0] === "/usr/bin/logger") return admin.host.run(argv);
      if (argv[0] === "/usr/bin/id") return { status: 0, stdout: String(process.getuid()) };
      if (argv[0] === "/usr/bin/install") return { status: spawnSync(argv[0], argv.slice(1)).status, stdout: "" };
      return { status: 1, stdout: "" };
    },
  };
  return { top, home, proc, base, host, admin, files, addProcess };
}

test("VPS admin quarantine keeps listed credential files in root-only custody and never reports partial custody as success", async () => {
  const { runOperation } = await import("../infra/vps/vps-admin.mjs");
  const op = "copilot-secret-snapshots-quarantine";
  const fixtures = [];
  const fixture = () => { const fx = quarantineFixture(); fixtures.push(fx); return fx; };
  try {
    const fx = fixture();
    const inode = fs.statSync(path.join(fx.home, fx.files[0])).ino;
    const ok = runOperation(op, "41700000002", fx.host);
    const runDir = path.join(fx.base, "41700000002");
    assert.equal(ok.line, `ADMIN_OK ${op} custody=complete moved=2 quarantine=${runDir}`);
    assert.doesNotMatch(ok.line + fx.admin.audits.join("\n"), /SECRET-MARKER/, "no content reaches the result or the journal");
    for (const dir of [path.dirname(fx.base), fx.base, runDir]) assert.equal(fs.statSync(dir).mode & 0o7777, 0o700, dir);
    assert.equal(fs.statSync(path.join(runDir, "0-config.json")).ino, inode, "rename keeps the inode");
    assert.equal(fs.readFileSync(path.join(runDir, "1-env.json"), "utf8"), "SECRET-MARKER-1", "kept for recovery");
    assert.equal(fs.existsSync(path.join(fx.home, fx.files[0])), false);
    assert.equal(fs.readFileSync(path.join(fx.home, ".config/arcadeplatform/window/browser-profile"), "utf8"), "kept", "unlisted files stay");
    assert.match(fs.readFileSync(path.join(runDir, "MANIFEST"), "utf8"),
      /^planned 2 .*\nfile 0 \.config\/netlify\/config\.json -> 0-config\.json dev=\d+ ino=\d+ size=\d+\nfile 1 .*\nmoving 0\nmoved 0\nmoving 1\nmoved 1\ncomplete 2\n$/);

    // A missing file is never success, also after a complete earlier run; the run directory is not created.
    assert.equal(runOperation(op, "41700000003", fx.host).line, `ADMIN_BLOCKED ${op} file_0_missing`);
    assert.equal(fs.existsSync(path.join(fx.base, "41700000003")), false);

    const open = fixture();
    open.addProcess("42", path.join(open.home, open.files[1]));
    assert.equal(runOperation(op, "5", open.host).line, `ADMIN_BLOCKED ${op} file_in_use`);
    assert.equal(fs.existsSync(open.base), false, "nothing is created or moved while a file is open");

    // A memory mapping keeps the content readable after the descriptor is closed.
    const mapped = fixture();
    const target = fs.statSync(path.join(mapped.home, mapped.files[0]));
    const dev = (d) => `${(((d >> 8) & 0xfff)).toString(16).padStart(2, "0")}:${((d & 0xff) | ((d >> 12) & ~0xff)).toString(16).padStart(2, "0")}`;
    mapped.addProcess("43", undefined, `7f00-7f01 r--s 00000000 ${dev(target.dev)} ${target.ino}    /gone\n`);
    assert.equal(runOperation(op, "10", mapped.host).line, `ADMIN_BLOCKED ${op} file_in_use`);

    // Swapping a parent directory for a symlink after the check does not redirect the move: the pinned
    // directory's own file moves, the decoy stays.
    const swapped = fixture();
    const decoy = path.join(swapped.top, "decoy");
    fs.mkdirSync(decoy);
    fs.writeFileSync(path.join(decoy, "config.json"), "decoy");
    swapped.host.rename = (from, to) => {
      if (from.endsWith("/config.json")) {
        fs.renameSync(path.join(swapped.home, ".config/netlify"), path.join(swapped.home, ".config/moved"));
        fs.symlinkSync(decoy, path.join(swapped.home, ".config/netlify"));
      }
      fs.renameSync(from, to);
    };
    assert.match(runOperation(op, "11", swapped.host).line, /^ADMIN_OK /);
    assert.equal(fs.readFileSync(path.join(swapped.base, "11", "0-config.json"), "utf8"), "SECRET-MARKER-0");
    assert.equal(fs.readFileSync(path.join(decoy, "config.json"), "utf8"), "decoy");

    const linked = fixture();
    fs.linkSync(path.join(linked.home, linked.files[0]), path.join(linked.home, "copy"));
    assert.equal(runOperation(op, "6", linked.host).line, `ADMIN_BLOCKED ${op} file_0_not_owned_single_link_file`);

    const symlinked = fixture();
    fs.renameSync(path.join(symlinked.home, ".config/netlify"), path.join(symlinked.top, "elsewhere"));
    fs.symlinkSync(path.join(symlinked.top, "elsewhere"), path.join(symlinked.home, ".config/netlify"));
    assert.equal(runOperation(op, "7", symlinked.host).line, `ADMIN_BLOCKED ${op} file_0_parent_not_owned_directory`);

    // An existing quarantine directory is verified, never re-moded by install(1).
    const loose = fixture();
    fs.mkdirSync(loose.base, { recursive: true, mode: 0o755 });
    fs.chmodSync(loose.base, 0o755);
    assert.equal(runOperation(op, "8", loose.host).line, `ADMIN_BLOCKED ${op} quarantine_dir_unsafe`);
    assert.equal(fs.statSync(loose.base).mode & 0o7777, 0o755);

    // A file changed between the check and its move, or a failed move: partial custody, recorded, not success.
    const changed = fixture();
    changed.host.rename = (from, to) => {
      if (from.endsWith("env.json")) throw new Error("EIO");
      fs.writeFileSync(path.join(changed.home, changed.files[1]), "SECRET-MARKER-x");
      fs.renameSync(from, to);
    };
    const partial = runOperation(op, "9", changed.host);
    assert.match(partial.line, new RegExp(`^ADMIN_FAILED ${op} file_1_changed custody=partial moved=1/2 manifest=`));
    assert.match(fs.readFileSync(path.join(changed.base, "9", "MANIFEST"), "utf8"), /moving 0\nmoved 0\n$/, "no complete line");

    // A failed rename leaves the state uncertain: the intent line exists without its moved line.
    const failing = fixture();
    failing.host.rename = () => { throw new Error("EIO"); };
    assert.match(runOperation(op, "12", failing.host).line, new RegExp(`^ADMIN_FAILED ${op} file_0_move custody=uncertain moved=0/2 `));
    assert.match(fs.readFileSync(path.join(failing.base, "12", "MANIFEST"), "utf8"), /moving 0\n$/);

    // An error after a move (here the final /proc scan) still reports the custody state, never a bare exception.
    const late = fixture();
    late.host.rename = (from, to) => {
      fs.renameSync(from, to);
      if (to.endsWith("1-env.json")) { fs.rmSync(path.join(late.proc, "1", "maps")); fs.mkdirSync(path.join(late.proc, "1", "maps")); }
    };
    assert.match(runOperation(op, "13", late.host).line, new RegExp(`^ADMIN_FAILED ${op} error_during_move custody=uncertain moved=2/2 `));
    assert.match(changed.admin.audits[1], /result=failed/);
  } finally {
    for (const fx of fixtures) fs.rmSync(fx.top, { recursive: true, force: true });
  }
});

// GitHub answers come from a fake curl; the script is written to a temporary destination owned by the current user.
const NEW_SCRIPT = "#!/usr/bin/env bash\nset -euo pipefail\necho new\n";
function dispatcherInstallFixture({ run = {}, main, script = NEW_SCRIPT, published = NEW_SCRIPT, downloadExit = 0, state = {}, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vps-dispatcher-"));
  const dest = path.join(dir, "arcade-chips-ledger-production-dispatch.sh");
  fs.writeFileSync(dest, "#!/usr/bin/env bash\necho old\n", { mode: 0o755 });
  const commit = "a".repeat(40);
  const runJson = { id: 41700000020, path: ".github/workflows/vps-admin-operation.yml", event: "workflow_dispatch", head_branch: "main", status: "in_progress", head_sha: commit, ...run };
  const urls = [];
  const admin = fakeAdminHost(state, extra);
  const source = "infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh";
  const blob = crypto.createHash("sha1").update(`blob ${Buffer.byteLength(published)}\0`).update(published).digest("hex");
  const host = {
    ...admin.host,
    dispatcher: { source, dest, uid: process.getuid(), gid: process.getgid() },
    run(argv) {
      if (argv[0] !== "/usr/bin/curl") return admin.host.run(argv);
      const url = argv.at(-1);
      urls.push(url);
      if (url.endsWith("/actions/runs/41700000020")) return { status: 0, stdout: JSON.stringify(runJson) };
      if (url.endsWith("/commits/main")) return { status: 0, stdout: main ?? commit };
      if (url.endsWith(`/contents/${source}?ref=${commit}`)) return { status: 0, stdout: JSON.stringify({ type: "file", path: source, sha: blob }) };
      if (url.startsWith(`https://raw.githubusercontent.com/krzysztofcal/arcadePlatform/${commit}/`)) {
        if (downloadExit === 0) fs.writeFileSync(argv[argv.indexOf("-o") + 1], script);
        return { status: downloadExit, stdout: "" };
      }
      return { status: 22, stdout: "" };
    },
  };
  return { dir, dest, commit, host, urls, admin };
}

test("VPS admin installs the Production dispatcher only from the approved run's current main commit and leaves the timers stopped", async () => {
  const { runOperation } = await import("../infra/vps/vps-admin.mjs");
  const op = "ledger-production-dispatcher-install";
  const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
  const stopped = (fx) => fx.admin.calls.filter((c) => c.startsWith("stop") || c.startsWith("start"));
  const ok = dispatcherInstallFixture();
  try {
    const result = runOperation(op, "41700000020", ok.host);
    const installed = fs.readFileSync(ok.dest, "utf8");
    assert.equal(installed, "#!/usr/bin/env bash\nset -euo pipefail\necho new\n");
    assert.equal(result.line, `ADMIN_OK ${op} installed commit=${ok.commit} sha256=${hash(installed)} previous=${hash("#!/usr/bin/env bash\necho old\n")} timers_stopped reload:no`);
    assert.equal(fs.statSync(ok.dest).mode & 0o777, 0o755);
    assert.deepEqual(stopped(ok), ["stop arcade-chips-ledger-dispatch.timer", "stop arcade-chips-ledger-production-dispatch.timer"], "paused, never resumed");
    assert.deepEqual(fs.readdirSync(ok.dir), [path.basename(ok.dest)], "no temporary file is left");
    assert.match(ok.admin.audits[1], new RegExp(`result=ok detail=installed commit=${ok.commit} sha256=`));
  } finally {
    fs.rmSync(ok.dir, { recursive: true, force: true });
  }

  // Refused before anything changes: no timer stopped, no download, old script kept.
  for (const [label, options, line] of [
    ["main advanced", { main: "b".repeat(40) }, "main_advanced"],
    ["feature branch", { run: { head_branch: "feature" } }, "run_not_main_vps_admin_dispatch"],
    ["other workflow", { run: { path: ".github/workflows/infra-vps.yml" } }, "run_not_main_vps_admin_dispatch"],
    ["finished run", { run: { status: "completed" } }, "run_not_main_vps_admin_dispatch"],
    ["other run id", { run: { id: 1 } }, "run_not_main_vps_admin_dispatch"],
    ["unreadable main", { main: "not-a-sha" }, "unverifiable_github_main"],
  ]) {
    const fx = dispatcherInstallFixture(options);
    try {
      assert.equal(runOperation(op, "41700000020", fx.host).line, `ADMIN_BLOCKED ${op} ${line}`, label);
      assert.deepEqual(stopped(fx), [], label);
      assert.equal(fx.urls.some((u) => u.startsWith("https://raw.githubusercontent.com/")), false, label);
      assert.equal(fs.readFileSync(fx.dest, "utf8"), "#!/usr/bin/env bash\necho old\n", label);
    } finally {
      fs.rmSync(fx.dir, { recursive: true, force: true });
    }
  }
  const unknownRun = dispatcherInstallFixture();
  try {
    assert.equal(runOperation(op, "41700000021", unknownRun.host).line, `ADMIN_BLOCKED ${op} unverifiable_github_run`);
  } finally {
    fs.rmSync(unknownRun.dir, { recursive: true, force: true });
  }

  // After the pause: a failed or unexpected download keeps the old script and the timers stopped.
  for (const [options, line] of [[{ downloadExit: 22 }, `ADMIN_FAILED ${op} download timers_left_stopped`],
    [{ script: "<html>rate limited</html>" }, `ADMIN_BLOCKED ${op} unexpected_script timers_left_stopped`],
    [{ script: "#!/usr/bin/env bash\necho tampered\n" }, `ADMIN_BLOCKED ${op} content_mismatch timers_left_stopped`]]) {
    const fx = dispatcherInstallFixture(options);
    try {
      assert.equal(runOperation(op, "41700000020", fx.host).line, line);
      assert.equal(fs.readFileSync(fx.dest, "utf8"), "#!/usr/bin/env bash\necho old\n");
      assert.equal(stopped(fx).length, 2);
      assert.deepEqual(fs.readdirSync(fx.dir), [path.basename(fx.dest)]);
    } finally {
      fs.rmSync(fx.dir, { recursive: true, force: true });
    }
  }
  // An error after the rename is reported with the ids and the read-back state, never as a bare failure.
  const late = dispatcherInstallFixture();
  try {
    late.host.rename = (from, to) => { fs.renameSync(from, to); throw new Error("after rename"); };
    const line = runOperation(op, "41700000020", late.host).line;
    assert.equal(line, `ADMIN_FAILED ${op} install replaced=yes commit=${late.commit} sha256=${hash(NEW_SCRIPT)} previous=${hash("#!/usr/bin/env bash\necho old\n")} timers_left_stopped`);
    assert.match(late.admin.audits[1], /result=failed detail=install replaced=yes commit=/);
  } finally {
    fs.rmSync(late.dir, { recursive: true, force: true });
  }
  const early = dispatcherInstallFixture();
  try {
    early.host.rename = () => { throw new Error("rename failed"); };
    assert.match(runOperation(op, "41700000020", early.host).line, new RegExp(`^ADMIN_FAILED ${op} install replaced=no commit=${early.commit} sha256=`));
    assert.equal(fs.readFileSync(early.dest, "utf8"), "#!/usr/bin/env bash\necho old\n");
  } finally {
    fs.rmSync(early.dir, { recursive: true, force: true });
  }
  // A failed stop of the first timer still stops the second, and nothing is installed.
  const stopFails = dispatcherInstallFixture({ state: { "exit:stop arcade-chips-ledger-dispatch.timer": 1 } });
  try {
    assert.equal(runOperation(op, "41700000020", stopFails.host).line, `ADMIN_FAILED ${op} stop_arcade-chips-ledger-dispatch.timer`);
    assert.deepEqual(stopped(stopFails), ["stop arcade-chips-ledger-dispatch.timer", "stop arcade-chips-ledger-production-dispatch.timer"]);
    assert.equal(fs.readFileSync(stopFails.dest, "utf8"), "#!/usr/bin/env bash\necho old\n");
  } finally {
    fs.rmSync(stopFails.dir, { recursive: true, force: true });
  }
  const busy = dispatcherInstallFixture({ state: { "arcade-chips-ledger-production-dispatch.service:ActiveState": "activating" } });
  try {
    assert.match(runOperation(op, "41700000020", busy.host).line, new RegExp(`^ADMIN_BLOCKED ${op} timeout_timers_left_stopped `));
    assert.equal(fs.readFileSync(busy.dest, "utf8"), "#!/usr/bin/env bash\necho old\n", "a running dispatcher is never replaced");
  } finally {
    fs.rmSync(busy.dir, { recursive: true, force: true });
  }
});

test("VPS admin approval summary describes every catalog operation from reviewed code, never from the reason", async () => {
  const { OPERATIONS } = await import("../infra/vps/vps-admin.mjs");
  const { APPROVAL, checkCatalog, approvalSummary } = await import("../infra/vps/vps-admin-approval.mjs");
  checkCatalog();
  assert.deepEqual(Object.keys(APPROVAL), Object.keys(OPERATIONS), "one description per helper operation, same order");
  assert.throws(() => checkCatalog({ ...OPERATIONS, "new-operation": () => ({}) }), /approval_catalog_mismatch/);
  const { "ledger-dispatchers-status": _status, ...missing } = APPROVAL;
  assert.throws(() => checkCatalog(OPERATIONS, missing), /approval_catalog_mismatch/);
  assert.throws(() => checkCatalog(OPERATIONS, { ...APPROVAL, "systemd-daemon-reload": { ...APPROVAL["systemd-daemon-reload"], risk: "see `x`" } }), /approval_description_invalid/);
  assert.deepEqual(Object.keys(APPROVAL).filter((name) => APPROVAL[name].readOnly), ["ledger-dispatchers-status"], "only the status read is read-only");
  assert.match(APPROVAL["ledger-production-dispatcher-install"].risk, /stay stopped/);
  assert.match(APPROVAL["ledger-dispatchers-pause"].risk, /not replayed/);

  const request = { operation: "ledger-dispatchers-pause", reason: "Pause dispatchers for the T004-3 cutover (step 4)", sha: "a".repeat(40),
    actor: "arcade-code-agent[bot]", triggeringActor: "arcade-code-agent[bot]", runId: "42223180928", attempt: "1" };
  const text = approvalSummary(request);
  for (const part of ["## Approve only if expected: ledger-dispatchers-pause", "CHANGES THE VPS", `| Revision | \`${"a".repeat(40)}\` (main) |`,
    "| Requested by | `arcade-code-agent[bot]`, triggered by `arcade-code-agent[bot]` |", APPROVAL["ledger-dispatchers-pause"].risk,
    APPROVAL["ledger-dispatchers-pause"].rollback, "environment vps-admin", "Nothing has run on the VPS yet"]) assert.ok(text.includes(part), part);
  assert.match(text, /Requester's reason \(free text, not part of the reviewed description\): `Pause dispatchers/);
  assert.doesNotMatch(text, /ADMIN_OK ledger|PASS/);
  for (const [field, value] of [["operation", "rm-rf"], ["reason", "ok\n## Approved"], ["reason", "see `x` now ok"], ["sha", "abc"], ["actor", "a b"], ["runId", "0"]]) {
    assert.throws(() => approvalSummary({ ...request, [field]: value }), Error, field);
  }
});

test("VPS admin workflow shows the request before approval and reaches arcade-admin only after vps-admin approval", async () => {
  const { OPERATIONS } = await import("../infra/vps/vps-admin.mjs");
  const catalog = Object.keys(OPERATIONS);
  const workflow = fileText(".github/workflows/vps-admin-operation.yml");
  const choices = workflow.match(/options:\n((?:\s+- [a-z0-9-]+\n)+)/)[1].trim().split(/\n\s*/).map((line) => line.replace("- ", ""));
  assert.deepEqual(choices, catalog, "workflow choices equal the helper catalog");
  const sudoers = fileText("infra/vps/arcade-admin.sudoers");
  assert.deepEqual([...sudoers.matchAll(/\/usr\/local\/sbin\/arcade-vps-admin ([a-z0-9-]+) \*/g)].map((m) => m[1]), catalog, "sudoers grants exactly the catalog");
  assert.match(sudoers, /^arcade-admin ALL=\(root\) NOPASSWD: ARCADE_ADMIN_COMMANDS$/m);
  // No rule for or as copilot (the quarantine operation only names copilot's directories).
  assert.doesNotMatch(sudoers.replaceAll("arcade-vps-admin copilot-secret-snapshots-quarantine *", ""), /copilot|ALL$|\/bin\/(ba)?sh|node |systemctl/m);
  assert.doesNotMatch(fileText("infra/vps/arcade-deploy.sudoers"), /arcade-vps-admin|arcade-admin/);
  assert.doesNotMatch(fileText("infra/vps/vps-admin.mjs"), /shell: *true|execSync|exec\(|"\/bin\/(ba)?sh"|bash -c|eval\(/);

  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|pull_request_target|schedule|workflow_run):/m);
  assert.match(workflow, /group: vps-admin\n  cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /always\(\)|continue-on-error/);
  const request = workflow.slice(workflow.indexOf("\n  request:\n"), workflow.indexOf("\n  operate:\n"));
  const operate = workflow.slice(workflow.indexOf("\n  operate:\n"));
  assert.doesNotMatch(request, /environment:|secrets\./, "the summary job has no environment and no secret");
  // The reviewed description is rendered only after the inputs passed the bash checks, from main's own code.
  assert.ok(request.indexOf("[[ \"$REASON\" =~ $REASON_RE ]]") < request.indexOf("node infra/vps/vps-admin-approval.mjs"));
  assert.match(request, /uses: actions\/checkout@v4\n        with:\n          persist-credentials: false\n/);
  assert.match(workflow, /^run-name: "VPS Admin: \$\{\{ inputs\.operation \}\} \(requested by \$\{\{ github\.triggering_actor \}\}\)"$/m);
  assert.match(request, /\n    name: "1\. Review request: \$\{\{ inputs\.operation \}\}"\n/);
  assert.match(operate, /\n    name: "2\. Run on the VPS after approval: \$\{\{ inputs\.operation \}\}"\n/);
  assert.match(operate, /\n    needs: request\n/);
  assert.match(operate, /\n    environment: vps-admin\n/);
  assert.doesNotMatch(operate, /GITHUB_STEP_SUMMARY/);
  assert.equal((operate.match(/secrets\./g) || []).length, 3, "only the three vps-admin secrets");
  assert.match(operate, /\[ "\$\(id -un\)" = "arcade-admin" \]/);
  assert.match(operate, /"ADMIN_OK \$OPERATION "\*\) ;;/);
  assert.match(request, /\[\[ "\$CONFIRMATION" == "RUN \$OPERATION" \]\]/);

  const reasonPattern = request.match(/REASON_RE='([^']+)'/)[1];
  const accepts = (reason) => spawnSync("bash", ["-c", 're="$1"; [[ "$2" =~ $re ]]', "_", reasonPattern, reason]).status === 0;
  assert.equal(accepts("Pause dispatchers for the T004-3 cutover (step 4)"), true);
  for (const forged of ["ok line\n### Approved by owner", "see `ADMIN_OK`", "<b>approved</b>", "| fake | table |", "short", "x".repeat(201)]) {
    assert.equal(accepts(forged), false, `reason must stay one plain line: ${JSON.stringify(forged.slice(0, 30))}`);
  }

  const conditions = [request, operate].map((job) => job.match(/\n    if: \$\{\{ (.+) \}\}\n/)[1]);
  assert.equal(conditions[0], conditions[1], "both jobs use the same identity condition");
  const evaluate = ({ actor, triggeringActor = actor, agent = "release-agent[bot]", event = "workflow_dispatch", ref = "refs/heads/main" }) => {
    const js = conditions[1]
      .replaceAll("github.event_name", JSON.stringify(event))
      .replaceAll("github.ref", JSON.stringify(ref))
      .replaceAll("github.triggering_actor", JSON.stringify(triggeringActor))
      .replaceAll("github.actor", JSON.stringify(actor))
      .replaceAll("github.repository_owner", JSON.stringify("krzysztofcal"))
      .replaceAll("vars.WS_RELEASE_AGENT", JSON.stringify(agent))
      .replaceAll("'", "\"").replaceAll(" == ", " === ").replaceAll(" != ", " !== ");
    assert.match(js, /^[\s"a-z0-9_\-/[\].()|&=!]+$/i, js);
    return Function(`return (${js});`)();
  };
  assert.equal(evaluate({ actor: "krzysztofcal" }), true);
  assert.equal(evaluate({ actor: "release-agent[bot]" }), true);
  assert.equal(evaluate({ actor: "krzysztofcal", triggeringActor: "release-agent[bot]" }), false, "agent re-run of an owner run");
  assert.equal(evaluate({ actor: "release-agent[bot]", triggeringActor: "krzysztofcal" }), false, "owner re-run of an agent run");
  assert.equal(evaluate({ actor: "", agent: "" }), false, "an unset agent variable never matches");
  assert.equal(evaluate({ actor: "someone" }), false);
  assert.equal(evaluate({ actor: "krzysztofcal", ref: "refs/heads/feature" }), false);
  assert.equal(evaluate({ actor: "krzysztofcal", event: "push" }), false);

  // The staging script checks the existing account itself, not only copilot's groups.
  const stage = fileText("infra/vps/stage-vps-admin.sh");
  for (const check of ['[[ "$(id -nG arcade-admin)" == "arcade-admin" ]]', '(( "$(id -u arcade-admin)" < 1000 ))', 'getent group arcade-admin | cut -d: -f4', "/home/arcade-admin/.ssh/authorized_keys", "verify_admin_sudo || refuse"]) {
    assert.ok(stage.includes(check), check);
  }
  assert.doesNotMatch(stage, /EXTRA_SUDO|sudo -l -U arcade-admin \|/, "no fail-open sudo -l pipeline");

  // verify_admin_sudo: the real function from the script against a fake sudo. Errors and unknown output are STOP.
  const verify = stage.match(/\nverify_admin_sudo\(\) \{\n[\s\S]*?\n\}\n/)[0];
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-sudo-"));
  fs.writeFileSync(path.join(bin, "sudo"), '#!/bin/bash\nprintf "%s" "$FAKE_SUDO_OUT"\nexit "${FAKE_SUDO_EXIT:-0}"\n', { mode: 0o700 });
  const header = "Matching Defaults entries for arcade-admin on h:\n    env_reset, secure_path=/usr/local/sbin\\:/usr/bin\n\nUser arcade-admin may run the following commands on h:\n";
  const helperLine = (ops) => `    (root) NOPASSWD: ${ops.map((op) => `/usr/local/sbin/arcade-vps-admin ${op} *`).join(", ")}\n`;
  const verifies = (out, exit = 0) => spawnSync("bash", ["-c", `${verify}verify_admin_sudo`], { env: { PATH: `${bin}:${process.env.PATH}`, FAKE_SUDO_OUT: out, FAKE_SUDO_EXIT: String(exit) } }).status === 0;
  assert.equal(verifies(header + helperLine(["ledger-dispatchers-status", "ledger-dispatchers-pause"]) + "        /usr/local/sbin/arcade-vps-admin systemd-daemon-reload *\n"), true);
  for (const [label, out, exit] of [
    ["sudo read error", header + helperLine(["ledger-dispatchers-status"]), 1],
    ["empty output", "", 0],
    ["no may-run section", "Sorry, user arcade-admin may not run sudo on h.\n", 0],
    ["section without entries", header, 0],
    ["second section", header + helperLine(["ledger-dispatchers-status"]) + "User arcade-admin may run the following commands on h:\n" + helperLine(["x"]), 0],
    ["ALL rule", header + helperLine(["ledger-dispatchers-status"]) + "    (ALL : ALL) ALL\n", 0],
    ["extra command", header + "    (root) NOPASSWD: /usr/local/sbin/arcade-vps-admin ledger-dispatchers-status *, /usr/bin/systemctl\n", 0],
    ["helper wildcard", header + "    (root) NOPASSWD: /usr/local/sbin/arcade-vps-admin *\n", 0],
    ["password rule", header + "    (root) /usr/local/sbin/arcade-vps-admin ledger-dispatchers-status *\n", 0],
    ["other run-as user", header + "    (arcade-release) NOPASSWD: /usr/local/sbin/arcade-vps-admin ledger-dispatchers-status *\n", 0],
    ["unindented garbage", header + helperLine(["ledger-dispatchers-status"]) + "unexpected\n", 0],
  ]) assert.equal(verifies(out, exit), false, label);
  fs.rmSync(bin, { recursive: true, force: true });
});


test("Preview isolation catalog uses fixed actions and unprivileged fundamental fixtures", async () => {
  const { runOperation } = await import("../infra/vps/vps-admin.mjs");
  for (const action of ["preflight", "provision", "rollback"]) {
    const fx = fakeAdminHost();
    const originalRun = fx.host.run;
    fx.host.run = (argv, ...args) => {
      if (argv[0] === "/usr/bin/python3") {
        assert.deepEqual(argv, ["/usr/bin/python3", "-I", "-B", "/usr/local/libexec/arcade-vps-admin/ws-preview-isolation.py", action, "123"]);
        return { status: 1, stdout: "PREVIEW_BLOCKED owner_public_key_missing_or_invalid" };
      }
      return originalRun(argv, ...args);
    };
    assert.match(runOperation(`ws-preview-isolation-${action}`, "123", fx.host).line, /ADMIN_BLOCKED .* owner_public_key_missing_or_invalid$/);
  }
  const result = spawnSync("python3", ["tests/ws-preview-config.test.py", "PreviewIsolation"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
