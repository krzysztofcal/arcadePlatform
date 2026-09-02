import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-automation.yml", "utf8");
const moduleSource = fs.readFileSync("scripts/ops/chips-ledger-stage-escrow-retention.mjs", "utf8");
const storageSource = fs.readFileSync("scripts/ops/chips-ledger-archive-store.mjs", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260902100000_chips_ledger_escrow_account_retirement.sql", "utf8");

test("scheduled automation invokes escrow retention without a new scheduler or input", () => {
  const step = workflow.match(/- name: Run Stage escrow account retention[\s\S]*?(?=\n\s+- name:)/)?.[0] || "";
  assert.match(step, /github\.event_name == 'schedule' && github\.event\.schedule == '\*\/15 \* \* \* \*'/);
  assert.doesNotMatch(step, /inputs\.mode|workflow_dispatch/);
  assert.match(step, /node scripts\/ops\/chips-ledger-stage-escrow-retention\.mjs --automatic/);
  assert.doesNotMatch(step, /workflow_dispatch:\s*inputs|--execute|--batch-id|GO/);
  assert.equal((workflow.match(/chips-ledger-stage-escrow-retention\.mjs/g) || []).length, 1);
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
});

test("scheduled module does not contain archive export, proof registration or overwrite calls", () => {
  assert.doesNotMatch(moduleSource, /runExport\(/);
  assert.doesNotMatch(moduleSource, /registerProof|registerBotOnlyProof|registerLegacyStageAllowlistProof/);
  assert.doesNotMatch(moduleSource, /ensureArchiveBucket|replaceVerifiedPrivateObject/);
  assert.match(moduleSource, /uploadOrVerifyPrivateObject/);
  assert.match(storageSource, /x-upsert.*false/);
});
