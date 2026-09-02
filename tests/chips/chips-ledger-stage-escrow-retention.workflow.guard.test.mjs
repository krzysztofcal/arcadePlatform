import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-automation.yml", "utf8");
const moduleSource = fs.readFileSync("scripts/ops/chips-ledger-stage-escrow-retention.mjs", "utf8");
const storageSource = fs.readFileSync("scripts/ops/chips-ledger-archive-store.mjs", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260902100000_chips_ledger_escrow_account_retirement.sql", "utf8");
const canaryMigration = fs.readFileSync("supabase/migrations/20260902110000_chips_ledger_escrow_account_retention_canary_revalidation.sql", "utf8");

test("scheduled automation invokes escrow retention without a new scheduler or input", () => {
  const step = workflow.match(/- name: Run Stage escrow account retention[\s\S]*?(?=\n\s+- name:)/)?.[0] || "";
  assert.match(step, /github\.event_name == 'schedule' && github\.event\.schedule == '\*\/15 \* \* \* \*'/);
  assert.doesNotMatch(step, /inputs\.mode|workflow_dispatch/);
  assert.match(step, /node scripts\/ops\/chips-ledger-stage-escrow-retention\.mjs --automatic/);
  assert.doesNotMatch(step, /workflow_dispatch:\s*inputs|--execute|--batch-id|GO/);
  assert.equal((workflow.match(/chips-ledger-stage-escrow-retention\.mjs/g) || []).length, 6);
});

test("manual escrow retention rollout has exact, main-only workflow modes", () => {
  for (const mode of [
    "escrow-retention-audit",
    "escrow-retention-prepare-only",
    "escrow-retention-authorize-canary",
    "escrow-retention-execute",
    "escrow-retention-verify",
    "escrow-retention-activate",
  ]) {
    assert.match(workflow, new RegExp(`- ${mode}`));
    assert.match(workflow, new RegExp(`inputs\\.mode == '${mode}'`));
  }
  assert.match(workflow, /escrow_retention_batch_id:[\s\S]*?type: string/);
  assert.match(workflow, /escrow_retention_account_ids_sha256:[\s\S]*?type: string/);
  assert.match(workflow, /escrow_retention_confirmation:[\s\S]*?type: string/);
  assert.match(workflow, /escrow_retention_recovery_object_path:[\s\S]*?type: string/);
  assert.match(workflow, /escrow_retention_recovery_confirmation:[\s\S]*?type: string/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'krzysztofcal\/arcadePlatform'/);
  assert.match(workflow, /github\.event\.repository\.fork != true/);
  assert.match(workflow, /github\.actor == github\.repository_owner/);
  for (const [stepName, ownerMessage] of [
    ["Authorize exact Stage escrow account-retention canary", "canary authorization requires the repository owner"],
    ["Execute exact Stage escrow account-retention canary", "execute requires the repository owner"],
    ["Activate Stage escrow account-retention automation", "activation requires the repository owner"],
  ]) {
    const step = workflow.match(new RegExp(`- name: ${stepName}[\\s\\S]*?(?=\\n\\s+- name:|\\s*$)`))?.[0] || "";
    assert.match(step, /GITHUB_ACTOR/);
    assert.match(step, /GITHUB_REPOSITORY_OWNER/);
    assert.match(step, new RegExp(ownerMessage));
  }
  assert.match(workflow, /CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_AUTHORIZE_CANARY: "1"/);
  assert.match(workflow, /CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_EXECUTE: "1"/);
  assert.match(workflow, /CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_ACTIVATE: "1"/);
  assert.match(workflow, /--authorize-canary[\s\S]*?--account-ids-sha256/);
  assert.match(workflow, /--execute[\s\S]*?--account-ids-sha256/);
  assert.match(workflow, /--activate[\s\S]*?--confirmation/);
  assert.match(workflow, /chips-ledger-stage-escrow-account-recovery\.mjs[\s\S]*?--object-path/);
  assert.match(workflow, /VERIFY \$ESCROW_RETENTION_RECOVERY_OBJECT_PATH/);
  assert.match(workflow, /ACTIVATE.*stage-ledger-escrow-account-retention-v1/);
  assert.doesNotMatch(workflow.match(/- name: Run Stage escrow account retention[\s\S]*?(?=\n\s+- name:)/)?.[0] || "", /inputs\./);
});

test("retirement is Stage-only and disabled by default", () => {
  assert.match(moduleSource, /validateStageEnvironment\(env, \{ requireCommitSha: true \}\)/);
  assert.match(moduleSource, /resolveStorageTarget\("stage"/);
  assert.match(moduleSource, /idle_timeout: 0/);
  assert.match(moduleSource, /statement_timeout = '30s'/);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /chips_assert_archive_prune_stage/);
  assert.match(migration, /Direct chips_accounts DELETE is forbidden/);
  assert.match(migration, /chips_retire_stage_escrow_accounts/);
  assert.match(migration, /revoke chips_ledger_archive_pruner from postgres/);
  assert.match(canaryMigration, /current_account_ids_sha256/);
  assert.match(canaryMigration, /chips_archive_uuid_ids_sha256\(current_account_ids\)/);
  assert.match(canaryMigration, /Canary account ID SHA-256 does not match current candidate/);
  assert.match(canaryMigration, /account_retirement_snapshot_sha256/);
});

test("scheduled module does not contain archive export, proof registration or overwrite calls", () => {
  assert.doesNotMatch(moduleSource, /runExport\(/);
  assert.doesNotMatch(moduleSource, /registerProof|registerBotOnlyProof|registerLegacyStageAllowlistProof/);
  assert.doesNotMatch(moduleSource, /ensureArchiveBucket|replaceVerifiedPrivateObject/);
  assert.match(moduleSource, /uploadOrVerifyPrivateObject/);
  assert.match(storageSource, /x-upsert.*false/);
});
