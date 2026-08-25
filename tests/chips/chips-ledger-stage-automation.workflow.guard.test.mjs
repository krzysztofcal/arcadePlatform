import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-automation.yml", "utf8");
const executeRunner = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist-execute.mjs", "utf8");
const registrySelector = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist-registry.mjs", "utf8");

assert.match(
  workflow,
  /workflow_dispatch:\n\s+inputs:\n\s+mode:\n\s+description: Stage automation mode\n\s+required: true\n\s+default: existing-30d\n\s+type: choice\n\s+options:\n\s+- existing-30d\n\s+- bot-only-7d-prepare-only\n\s+- legacy-stage-allowlist-prepare-only\n\s+- audit-batch-13\n\s+- execute-batch-13/,
);
assert.equal((workflow.match(/^\s+- (?:existing-30d|bot-only-7d-prepare-only|legacy-stage-allowlist-prepare-only|audit-batch-13|execute-batch-13)$/gm) || []).length, 5);
assert.equal((workflow.match(/- cron:/g) || []).length, 1);
assert.match(workflow, /cancel-in-progress:\s*false/);
assert.match(workflow, /CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED == '1'/);
assert.match(workflow, /SUPABASE_STAGE_DB_URL: \$\{\{ secrets\.SUPABASE_STAGE_DB_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_URL: \$\{\{ secrets\.SUPABASE_STAGE_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_STAGE_SERVICE_ROLE_KEY \}\}/);
assert.doesNotMatch(workflow, /SUPABASE_PROD_|PRODUCTION|--target/);
assert.match(workflow, /git rev-parse HEAD/);
assert.match(workflow, /test \"\$checked_out_sha\" = \"\$GITHUB_SHA\"/);
assert.match(workflow, /DEPLOYED_COMMIT_SHA: \$\{\{ steps\.checkout-sha\.outputs\.sha \}\}/);
assert.match(workflow, /set transaction read only/);
assert.match(workflow, /pg_control_system/);
assert.match(workflow, /chips_table_fence_is_active/);
assert.match(workflow, /chips_table_fence_control/);
assert.match(workflow, /enforcement_active/);

const preflightStep = workflow.match(
  /- name: Read-only Stage fence preflight[\s\S]*?(?=\n\s+- name:)/,
)[0];
assert.match(
  preflightStep,
  /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode == 'bot-only-7d-prepare-only' \}\}/,
);

const existingRun = workflow.match(
  /- name: Run existing 30-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(existingRun, /github\.event_name == 'schedule'/);
assert.match(existingRun, /inputs\.mode == 'existing-30d'/);
assert.match(existingRun, /run: node scripts\/ops\/chips-ledger-stage-automation\.mjs\s*$/m);
assert.doesNotMatch(existingRun, /--policy|--prepare-only|--execute/);
assert.doesNotMatch(existingRun, /Read-only Stage fence preflight|chips_table_fence|enforcement_active/);
assert.doesNotMatch(
  workflow.slice(0, workflow.indexOf("- name: Read-only Stage fence preflight")),
  /chips_table_fence|enforcement_active/,
);
assert.doesNotMatch(preflightStep, /legacy-stage-allowlist/);

const botOnlyRun = workflow.match(
  /- name: Run bot-only 7-day prepare-only Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(botOnlyRun, /github\.event_name == 'workflow_dispatch'/);
assert.match(botOnlyRun, /inputs\.mode == 'bot-only-7d-prepare-only'/);
assert.match(
  botOnlyRun,
  /node scripts\/ops\/chips-ledger-stage-automation\.mjs \\\n+\s+--policy bot-only-7d \\\n+\s+--prepare-only/,
);
assert.doesNotMatch(workflow, /CHIPS_LEDGER_BOT_ONLY_EXECUTE/);

const legacyRun = workflow.match(
  /- name: Run legacy Stage allowlist prepare-only[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(legacyRun, /github\.event_name == 'workflow_dispatch'/);
assert.match(legacyRun, /inputs\.mode == 'legacy-stage-allowlist-prepare-only'/);
assert.match(legacyRun, /run: node scripts\/ops\/chips-ledger-legacy-stage-allowlist\.mjs\s*$/m);
assert.doesNotMatch(legacyRun, /\\|--|stage-automation|execute/i);
assert.equal((workflow.match(/node scripts\/ops\/chips-ledger-legacy-stage-allowlist\.mjs/g) || []).length, 1);
assert.doesNotMatch(existingRun, /legacy-stage-allowlist/);
assert.doesNotMatch(botOnlyRun, /legacy-stage-allowlist/);
assert.doesNotMatch(workflow.match(/- cron:[\s\S]*?(?=\n\s*concurrency:)/)[0], /legacy-stage-allowlist/);
assert.doesNotMatch(workflow.match(/- cron:[\s\S]*?(?=\n\s*concurrency:)/)[0], /audit-batch-13/);

const auditRun = workflow.match(
  /- name: Audit legacy Stage allowlist batch 13[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(auditRun, /github\.event_name == 'workflow_dispatch'/);
assert.match(auditRun, /inputs\.mode == 'audit-batch-13'/);
assert.match(auditRun, /run: node scripts\/ops\/chips-ledger-legacy-stage-allowlist-audit\.mjs\s*$/m);
assert.doesNotMatch(auditRun, /--|execute|freeze|prepare-only/i);
assert.doesNotMatch(auditRun, /inputs\.[a-z-]+.*\$\{|github\.event\.inputs/);
assert.equal((workflow.match(/node scripts\/ops\/chips-ledger-legacy-stage-allowlist-audit\.mjs/g) || []).length, 1);
assert.doesNotMatch(existingRun, /audit-batch-13/);
assert.doesNotMatch(botOnlyRun, /audit-batch-13/);
assert.doesNotMatch(legacyRun, /audit-batch-13/);

const executeRun = workflow.match(
  /- name: Execute approved legacy Stage batch 13[\s\S]*$/,
)[0];
assert.match(executeRun, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode == 'execute-batch-13' \}\}/);
assert.match(executeRun, /CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE: "1"/);
assert.match(executeRun, /DEPLOYED_COMMIT_SHA: \$\{\{ steps\.checkout-sha\.outputs\.sha \}\}/);
assert.match(executeRun, /test "\$DEPLOYED_COMMIT_SHA" = "\$GITHUB_SHA"/);
assert.match(executeRun, /set transaction isolation level repeatable read, read only/);
assert.match(executeRun, /7656985631720456337/);
assert.match(executeRun, /krydukthwdvccggbyjfw/);
assert.match(executeRun, /chips_table_fence_is_active/);
assert.match(executeRun, /enforcement_active/);
assert.match(executeRun, /batch_id = 13/);
assert.match(executeRun, /--batch-id 13/);
assert.match(executeRun, /--object-path v1\/sha256\/a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60\.jsonl\.gz/);
assert.match(executeRun, /--confirm-sha a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60/);
assert.match(executeRun, /611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05/);
assert.match(executeRun, /ded0a77efe84f56d2f4a9706f9d454a09179f6328098ad60ecf45639b4b75895/);
assert.match(executeRun, /23572e092abe6dee44e3537b8552cab3eb663e69370435c6205864c62f2bf9da/);
assert.match(executeRun, /793e1993e45c198c476e1b5926c252542219c1cb7038e09ae96d440600d29a79/);
assert.match(executeRun, /621e2d102ee65813e9554cbd3e2c4c79cc5ad1cbcc71c0c10cb8e948182ee81b/);
assert.match(executeRun, /pruned_at/);
assert.match(executeRun, /registry_cleaned_at/);
assert.match(executeRun, /destructive_go_batch_id/);
assert.match(executeRun, /public\.chips_legacy_stage_allowlist_proofs/);
assert.match(executeRun, /public\.chips_transaction_idempotency/);
assert.match(executeRun, /legacyStageAllowlistRegistryPredicate/);
assert.match(executeRun, /assertLegacyStageAllowlistRegistryRows/);
assert.match(registrySelector, /TABLE_BUY_IN.*TABLE_CASH_OUT/s);
assert.match(registrySelector, /archive_batch_id !== null/);
assert.match(registrySelector, /expectedCount/);
assert.match(registrySelector, /expectedKeysSha256/);
assert.match(executeRun, /archive_proof_verified_at/);
assert.match(executeRun, /destructive_go_at !== null/);
assert.match(executeRun, /destructive_go_batch_id === null/);
assert.match(executeRun, /const noGo = batch\.destructive_go_at === null && batch\.destructive_go_batch_id === null/);
assert.match(executeRun, /const exactGo = batch\.destructive_go_at !== null/);
assert.match(executeRun, /\(!noGo && !exactGo\)/);
assert.match(executeRun, /const unpruned = batch\.pruned_at === null && batch\.registry_cleaned_at === null/);
assert.match(executeRun, /const pruned = batch\.pruned_at !== null && batch\.registry_cleaned_at !== null/);
assert.match(executeRun, /complete pruned batch is missing exact batch 13 GO/);
assert.match(executeRun, /complete pruned batch still has registry rows/);
assert.match(executeRun, /node scripts\/ops\/chips-ledger-legacy-stage-allowlist-execute\.mjs/);
assert.match(executeRun, /--recovery-dir "\$recovery_dir"/);
assert.doesNotMatch(executeRun, /github\.event\.inputs|inputs\.(?!mode)[a-zA-Z0-9_-]+/);
assert.doesNotMatch(executeRun, /SUPABASE_PROD_|PRODUCTION|--target\s+prod/i);
assert.doesNotMatch(executeRun, /CHIPS_LEDGER_BOT_ONLY_EXECUTE/);
assert.equal((workflow.match(/--execute/g) || []).length, 0);
assert.equal((workflow.match(/CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE/g) || []).length, 1);
assert.doesNotMatch(existingRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(botOnlyRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(legacyRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(auditRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(workflow.match(/- cron:[\s\S]*?(?=\n\s*concurrency:)/)[0], /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);

assert.match(executeRunner, /chips_authorize_legacy_stage_allowlist_batch\(13, 'GO 13', '611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05'\)/);
assert.match(executeRunner, /readOnlyBatch13Preflight/);
assert.match(executeRunner, /beforeExecuteSnapshot/);
assert.match(executeRunner, /verifyBatch13PostExecute/);
assert.match(executeRunner, /already_pruned/);
assert.match(executeRunner, /replayOldRegistryKey/);
assert.match(executeRunner, /P8903/);
assert.match(executeRunner, /remaining_registry_count/);
assert.match(executeRunner, /REPLAY_TRANSACTION_ID/);
assert.match(executeRunner, /replayPair/);
assert.match(executeRunner, /replay transaction ID collision/);
assert.match(executeRunner, /accountIds/);
assert.match(executeRunner, /where id = any\(\$1::uuid\[\]\)/);
assert.match(executeRunner, /existingBatchAuthorization/);
assert.match(executeRunner, /batchState/);
assert.match(executeRunner, /preflight pruned batch still has hot rows/);
assert.match(executeRunner, /prunedReceipt/);
assert.match(executeRunner, /beforeCleanup/);
assert.match(executeRunner, /accountScope: "ESCROW_TABLES"/);
assert.match(executeRunner, /account_type::text = 'ESCROW'/);
assert.match(executeRunner, /POKER_TABLE:/);
assert.match(executeRunner, /set transaction isolation level repeatable read, read only/);
assert.match(executeRunner, /set transaction isolation level repeatable read;/);
assert.match(executeRunner, /EXECUTE_BATCH_13/);

process.stdout.write("chips-ledger-stage-automation workflow guard passed\n");
