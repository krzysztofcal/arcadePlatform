import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

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

test("infra VPS path filters keep PR validation broad and production apply narrow", () => {
  const text = workflowText();
  const prStart = text.indexOf("  pull_request:");
  const pushStart = text.indexOf("  push:");
  const dispatchStart = text.indexOf("  workflow_dispatch:");

  assert.notEqual(prStart, -1);
  assert.notEqual(pushStart, -1);
  assert.notEqual(dispatchStart, -1);

  const prPaths = text.slice(prStart, pushStart);
  const pushPaths = text.slice(pushStart, dispatchStart);

  assert.ok(prPaths.includes('"infra/vps/**"'));
  assert.match(pushPaths, /paths:\n\s+- "infra\/vps\/Caddyfile"\n\s+- "\.github\/workflows\/infra-vps\.yml"/);
  assert.doesNotMatch(pushPaths, /"infra\/vps\/\*\*"/);
});

test("infra VPS guard coverage includes the unified Caddy contract test", () => {
  const prWorkflow = fs.readFileSync(".github/workflows/ws-pr-checks.yml", "utf8");
  assert.ok(prWorkflow.includes('"infra/vps/**"'));
  assert.ok(prWorkflow.includes('"docs/poker-deployment.md"'));
  assert.ok(prWorkflow.includes('".github/workflows/infra-vps.yml"'));
  assert.ok(prWorkflow.includes("node --test ws-tests/infra-vps-caddy.guard.test.mjs"));
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
  assert.ok(remote.includes("sudo -n cp \"$BACKUP_PATH\" \"$CADDY_PATH\" || true"));
  assert.ok(remote.includes("sudo -n systemctl reload caddy || true"));
  assert.ok(remote.includes("sudo -n caddy validate --config /etc/caddy/Caddyfile"));
  assert.ok(remote.includes("sudo -n systemctl reload caddy"));
  assert.equal(remote.includes("sudo caddy validate"), false);
  assert.equal(remote.includes("sudo systemctl reload caddy"), false);
});

test("infra VPS remote bash verifies backup before overwrite and validates before reload", () => {
  const remote = remoteBash(workflowText());

  const backupCopyIndex = remote.indexOf('sudo -n cp "$CADDY_PATH" "$BACKUP_PATH"');
  const backupExistsIndex = remote.indexOf('sudo -n test -f "$BACKUP_PATH"', backupCopyIndex);
  const applyIndex = remote.indexOf('sudo -n cp "$TMP_PATH" "$CADDY_PATH"', backupExistsIndex);
  const validateIndex = remote.indexOf("sudo -n caddy validate", applyIndex);
  const reloadIndex = remote.indexOf("sudo -n systemctl reload caddy", validateIndex);

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
  assert.match(override, /^EnvironmentFile=-\/etc\/arcadeplatform\/ws-server\.env$/m);

  const schedulerService = fileText("infra/vps/arcade-chips-ledger-dispatch.service");
  for (const line of [
    "Type=oneshot",
    "User=copilot",
    "Environment=HOME=/home/copilot",
    "Environment=GH_CONFIG_DIR=/home/copilot/.config/gh",
    "Environment=PATH=/home/copilot/.local/bin:/usr/local/bin:/usr/bin:/bin",
    "ExecStart=/usr/local/bin/arcade-chips-ledger-dispatch.sh",
    "NoNewPrivileges=true",
    "PrivateTmp=true"
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
  }
});

test("infra VPS bootstrap is shell-valid, fresh-VPS guarded, and cannot dispatch or clean up", () => {
  const path = "infra/vps/bootstrap.sh";
  const syntax = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  const text = fileText(path);
  assert.match(text, /ARCADEPLATFORM_BOOTSTRAP_TARGET.*fresh-vps/);
  assert.match(text, /existing runtime marker/);
  assert.match(text, /\/etc\/arcadeplatform\/ws-server\.env/);
  assert.match(text, /\/opt\/ws-server\/current/);
  assert.match(text, /postgresql-client/);
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
