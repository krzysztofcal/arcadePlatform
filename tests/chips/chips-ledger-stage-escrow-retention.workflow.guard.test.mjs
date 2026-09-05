import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-scheduled-automation.yml", "utf8");
const moduleSource = fs.readFileSync("scripts/ops/chips-ledger-stage-escrow-retention.mjs", "utf8");
const storageSource = fs.readFileSync("scripts/ops/chips-ledger-archive-store.mjs", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260902100000_chips_ledger_escrow_account_retirement.sql", "utf8");
const canaryMigration = fs.readFileSync("supabase/migrations/20260902110000_chips_ledger_escrow_account_retention_canary_revalidation.sql", "utf8");

test("scheduled and external fallback invoke escrow retention without rollout inputs", () => {
  const step = workflow.match(/- name: Run Stage escrow account retention[\s\S]*?(?=\n\s+- name:)/)?.[0] || "";
  assert.match(step, /github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/);
  assert.match(step, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'external-scheduled-automatic'/);
  assert.match(step, /node scripts\/ops\/chips-ledger-stage-escrow-retention\.mjs --automatic/);
  assert.doesNotMatch(step, /workflow_dispatch:\s*inputs|--execute|--batch-id|GO|inputs\.escrow_retention_|inputs\.approved_/);
  assert.equal((workflow.match(/chips-ledger-stage-escrow-retention\.mjs/g) || []).length, 2);
});

test("manual escrow retention modes are audit/verify only with retained recovery inputs", () => {
  for (const mode of [
    "escrow-retention-audit",
    "escrow-retention-verify",
  ]) {
    assert.match(workflow, new RegExp(`- ${mode}`));
    assert.match(workflow, new RegExp(`inputs\\.mode == '${mode}'`));
  }
  for (const retired of [
    "escrow-retention-prepare-only",
    "escrow-retention-authorize-canary",
    "escrow-retention-execute",
    "escrow-retention-activate",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(`- ${retired}`));
    assert.doesNotMatch(workflow, new RegExp(`inputs\\.mode == '${retired}'`));
  }
  assert.match(workflow, /escrow_retention_recovery_object_path:[\s\S]*?type: string/);
  assert.match(workflow, /escrow_retention_recovery_confirmation:[\s\S]*?type: string/);
  assert.doesNotMatch(workflow, /escrow_retention_batch_id:|escrow_retention_account_ids_sha256:|escrow_retention_confirmation:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'krzysztofcal\/arcadePlatform'/);
  assert.match(workflow, /github\.event\.repository\.fork != true/);
  assert.match(workflow, /github\.actor == github\.repository_owner/);
  assert.doesNotMatch(workflow, /CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_(AUTHORIZE_CANARY|EXECUTE|ACTIVATE): "1"/);
  assert.doesNotMatch(workflow, /--authorize-canary|--account-ids-sha256/);
  for (const escrowStep of [
    "Audit Stage escrow account retention",
    "Verify Stage escrow account-retention recovery",
  ]) {
    const step = workflow.match(new RegExp(`- name: ${escrowStep}[\\s\\S]*?(?=\\n\\s+- name:|\\s*$)`))?.[0] || "";
    assert.doesNotMatch(step, /--activate/);
  }
  assert.match(workflow, /chips-ledger-stage-escrow-account-recovery\.mjs[\s\S]*?--object-path/);
  assert.match(workflow, /VERIFY \$ESCROW_RETENTION_RECOVERY_OBJECT_PATH/);
  assert.doesNotMatch(workflow, /ACTIVATE.*stage-ledger-escrow-account-retention-v1/);
  assert.doesNotMatch(workflow.match(/- name: Run Stage escrow account retention[\s\S]*?(?=\n\s+- name:)/)?.[0] || "", /inputs\.(?:escrow_retention_|approved_)/);
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

test("retention archive batch reads keep microsecond timestamp text precision", () => {
  // The prune store projects archive rows with ::text so timestamps survive the
  // postgres.js Date round-trip (which truncates to milliseconds).  Retention
  // must do the same: ms-truncated bot_only_newest_created_at makes the
  // schema-v2 artifact table summary check fail semantically (run 33735273784).
  const batchesSql = moduleSource.match(/export const RETENTION_BATCHES_SQL = `[\s\S]*?`;/)?.[0] || "";
  assert.doesNotMatch(batchesSql, /batches\.\*/);
  assert.match(batchesSql, /cutoff::text as cutoff/);
  assert.match(batchesSql, /first_created_at::text as first_created_at/);
  assert.match(batchesSql, /last_created_at::text as last_created_at/);
  assert.match(batchesSql, /bot_only_newest_created_at::text as bot_only_newest_created_at/);
  assert.match(batchesSql, /transaction_count::text as transaction_count/);
  // The projection must also keep the full account retirement receipt so that
  // already-retired batches still read as "complete" after the first execute.
  assert.match(batchesSql, /account_retirement_at::text as account_retirement_at/);
  assert.match(batchesSql, /account_retirement_account_count::text as account_retirement_account_count/);
  assert.match(batchesSql, /account_retirement_account_ids_sha256/);
  assert.match(batchesSql, /account_retirement_recovery_object_path/);
  assert.match(batchesSql, /account_retirement_recovery_object_sha256/);
  assert.match(batchesSql, /account_retirement_snapshot_sha256/);
  assert.match(moduleSource, /row = parseManifestRow\(row\);/);
});
