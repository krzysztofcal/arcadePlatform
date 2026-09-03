import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-scheduled-automation.yml", "utf8");
const stageOrchestrator = fs.readFileSync("scripts/ops/chips-ledger-stage-automation.mjs", "utf8");
const summaryDiagnostic = fs.readFileSync("scripts/ops/chips-ledger-stage-timeout-diagnostic.mjs", "utf8");
const pruneAdapter = fs.readFileSync("scripts/ops/chips-ledger-archive-prune.mjs", "utf8");
const executeRunner = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist-execute.mjs", "utf8");
const registrySelector = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist-registry.mjs", "utf8");

assert.match(
  workflow,
  /workflow_dispatch:\n\s+inputs:\n\s+mode:\n\s+description: Stage automation mode\n\s+required: true\n\s+default: existing-30d\n\s+type: choice\n\s+options:\n\s+- existing-30d\n\s+- bot-only-7d-summary-diagnostic\n\s+- bot-only-7d-repair-recovery-batch-15\n\s+- bot-only-7d-prepare-only\n\s+- bot-only-7d-execute\n\s+- bot-only-7d-automatic\n\s+- legacy-stage-allowlist-prepare-only\n\s+- legacy-stage-allowlist-orchestrate\n\s+- audit-batch-13\n\s+- execute-batch-13/,
);
assert.match(workflow, /approved_batch_id:\n\s+description: Exact committed bot-only 7d batch_id prepared by a prior run[\s\S]*?required: false\n\s+type: string/);
assert.match(workflow, /approved_batch_confirmation:\n\s+description: Exact human confirmation GO <approved_batch_id> \(required for bot-only-7d-execute\)[\s\S]*?required: false\n\s+type: string/);
assert.equal((workflow.match(/^\s+- (?:existing-30d|bot-only-7d-prepare-only|legacy-stage-allowlist-prepare-only|audit-batch-13|execute-batch-13)$/gm) || []).length, 5);
assert.equal((workflow.match(/^\s+- (?:existing-30d|bot-only-7d-prepare-only|bot-only-7d-execute|legacy-stage-allowlist-prepare-only|audit-batch-13|execute-batch-13)$/gm) || []).length, 6);
assert.equal((workflow.match(/^\s+- (?:existing-30d|bot-only-7d-summary-diagnostic|bot-only-7d-repair-recovery-batch-15|bot-only-7d-prepare-only|bot-only-7d-execute|bot-only-7d-automatic|legacy-stage-allowlist-prepare-only|legacy-stage-allowlist-orchestrate|audit-batch-13|execute-batch-13|escrow-retention-audit|escrow-retention-prepare-only|escrow-retention-authorize-canary|escrow-retention-execute|escrow-retention-verify|escrow-retention-activate|external-scheduled-automatic)$/gm) || []).length, 17);
assert.equal((workflow.match(/- cron:/g) || []).length, 2);
assert.match(workflow, /- cron: "17 2 \* \* \*"/);
assert.match(workflow, /- cron: "7,22,37,52 \* \* \* \*"/);
assert.equal((workflow.match(/^\s+- cron: "7,22,37,52 \* \* \* \*"$/gm) || []).length, 1);
const concurrencyBlock = workflow.match(
  /^concurrency:\n(?:  [^\n]+\n)+(?=\n\S)/m,
)[0];
assert.equal((workflow.match(/^concurrency:$/gm) || []).length, 1);
assert.equal((concurrencyBlock.match(/^  group:/gm) || []).length, 1);
assert.match(concurrencyBlock, /^  group: chips-ledger-stage-automation$/m);
assert.match(concurrencyBlock, /^  cancel-in-progress: false$/m);
assert.match(concurrencyBlock, /^  queue: max$/m);
assert.doesNotMatch(concurrencyBlock, /github\.ref|github\.event|inputs\./);
assert.match(workflow, /CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED == '1'/);
assert.equal((workflow.match(/^    timeout-minutes: 60$/gm) || []).length, 1);
assert.equal((workflow.match(/^    timeout-minutes: 30$/gm) || []).length, 0);
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
  /if: \$\{\{ github\.event_name == 'workflow_dispatch' && \(inputs\.mode == 'bot-only-7d-summary-diagnostic' \|\| inputs\.mode == 'bot-only-7d-repair-recovery-batch-15' \|\| inputs\.mode == 'bot-only-7d-prepare-only' \|\| inputs\.mode == 'bot-only-7d-execute' \|\| inputs\.mode == 'bot-only-7d-automatic' \|\| inputs\.mode == 'escrow-retention-audit' \|\| inputs\.mode == 'escrow-retention-prepare-only' \|\| inputs\.mode == 'escrow-retention-authorize-canary' \|\| inputs\.mode == 'escrow-retention-execute' \|\| inputs\.mode == 'escrow-retention-verify' \|\| inputs\.mode == 'escrow-retention-activate'\) \}\}/,
);

const existingRun = workflow.match(
  /- name: Run existing 30-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(existingRun, /github\.event_name == 'schedule' && github\.event\.schedule == '17 2 \* \* \*'/);
assert.match(existingRun, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'existing-30d'/);
assert.match(existingRun, /inputs\.mode == 'existing-30d'/);
assert.doesNotMatch(existingRun, /inputs\.mode == ''/);
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
assert.match(workflow, /CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1"/);

const summaryDiagnosticRun = workflow.match(
  /- name: Run bot-only 7-day summary diagnostic[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(summaryDiagnosticRun, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode == 'bot-only-7d-summary-diagnostic' \}\}/);
assert.match(summaryDiagnosticRun, /DEPLOYED_COMMIT_SHA: \$\{\{ steps\.checkout-sha\.outputs\.sha \}\}/);
assert.match(summaryDiagnosticRun, /test "\$DEPLOYED_COMMIT_SHA" = "\$GITHUB_SHA"/);
assert.match(summaryDiagnosticRun, /node scripts\/ops\/chips-ledger-stage-timeout-diagnostic\.mjs --summary-only/);
assert.match(summaryDiagnosticRun, /CHIPS_LEDGER_BOT_ONLY_EXECUTE/);
assert.match(summaryDiagnosticRun, /CHIPS_LEDGER_BOT_ONLY_AUTOMATIC/);
assert.doesNotMatch(summaryDiagnosticRun, /--policy|--prepare-only|--execute|storeArchive|ensureArchiveBucket|uploadOrVerify|SUPABASE_PROD_|PRODUCTION|--target\s+prod/i);
const recoveryRepairRun = workflow.match(
  /- name: Repair exact bot-only 7-day recovery for batch 15[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(recoveryRepairRun, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode == 'bot-only-7d-repair-recovery-batch-15' \}\}/);
assert.match(recoveryRepairRun, /DEPLOYED_COMMIT_SHA: \$\{\{ steps\.checkout-sha\.outputs\.sha \}\}/);
assert.match(recoveryRepairRun, /test "\$DEPLOYED_COMMIT_SHA" = "\$GITHUB_SHA"/);
assert.match(recoveryRepairRun, /--policy bot-only-7d \\\n+\s+--repair-recovery \\\n+\s+--batch-id 15/);
assert.match(recoveryRepairRun, /CHIPS_LEDGER_BOT_ONLY_EXECUTE/);
assert.match(recoveryRepairRun, /CHIPS_LEDGER_BOT_ONLY_AUTOMATIC/);
assert.doesNotMatch(recoveryRepairRun, /--prepare-only|--execute|--automatic|--register-proof|--approved-batch|storeArchive|ensureArchiveBucket|Production|SUPABASE_PROD_/i);
assert.match(summaryDiagnostic, /runBotOnlyTableIdentitySummaryDiagnostic/);
assert.match(summaryDiagnostic, /transaction: "repeatable read, read only"/);
assert.match(summaryDiagnostic, /storage_access: false/);
assert.match(summaryDiagnostic, /argv\[0\] === "--summary-only"/);
assert.doesNotMatch(summaryDiagnostic, /storeArchive|ensureArchiveBucket|uploadOrVerifyObject|createManifestStore/);
assert.doesNotMatch(summaryDiagnostic, /\b(?:insert|update|delete|truncate|alter|drop)\s+(?:into\s+)?public\./i);

const canaryRun = workflow.match(
  /- name: Execute approved bot-only 7-day Stage canary[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(canaryRun, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode == 'bot-only-7d-execute' \}\}/);
assert.match(canaryRun, /APPROVED_BATCH_ID: \$\{\{ inputs\.approved_batch_id \}\}/);
assert.match(canaryRun, /APPROVED_BATCH_CONFIRMATION: \$\{\{ inputs\.approved_batch_confirmation \}\}/);
assert.match(canaryRun, /CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1"/);
assert.match(canaryRun, /approved_batch_id must be a positive integer/);
assert.match(canaryRun, /approved_batch_confirmation must be exactly GO <approved_batch_id>/);
assert.match(canaryRun, /--execute \\\n+\s+--approved-batch-id "\$APPROVED_BATCH_ID" \\\n+\s+--approved-batch-confirmation "\$APPROVED_BATCH_CONFIRMATION"/);
assert.doesNotMatch(botOnlyRun, /CHIPS_LEDGER_BOT_ONLY_EXECUTE|--execute/);
assert.match(stageOrchestrator, /STAGE_EXACT_BATCH_SQL/);
assert.match(stageOrchestrator, /set transaction isolation level repeatable read, read only/);
assert.match(stageOrchestrator, /assertBotOnlyActiveManifestMatch/);
assert.match(stageOrchestrator, /authorizeBotOnlyBatch/);
assert.match(stageOrchestrator, /destructive_go_at/);
assert.match(stageOrchestrator, /destructive_go_batch_id/);
assert.match(pruneAdapter, /public\.chips_authorize_bot_only_archive_batch/);
assert.match(pruneAdapter, /set transaction isolation level serializable/);

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
assert.match(executeRun, /mkdir -m 0700 -- "\$recovery_dir"/);
assert.match(executeRun, /test "\$\(stat -c '%a' "\$recovery_dir"\)" = "700"/);
assert.doesNotMatch(executeRun, /mkdir -p "\$recovery_dir"/);
assert.doesNotMatch(executeRun, /\bchmod\b/);
assert.doesNotMatch(executeRun, /github\.event\.inputs|inputs\.(?!mode)[a-zA-Z0-9_-]+/);
assert.doesNotMatch(executeRun, /SUPABASE_PROD_|PRODUCTION|--target\s+prod/i);
assert.doesNotMatch(executeRun, /CHIPS_LEDGER_BOT_ONLY_EXECUTE/);
assert.equal((workflow.match(/--execute/g) || []).length, 2);
assert.equal((workflow.match(/CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE/g) || []).length, 1);
assert.doesNotMatch(existingRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(botOnlyRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(canaryRun, /execute-batch-13|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(legacyRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(auditRun, /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.doesNotMatch(workflow.match(/- cron:[\s\S]*?(?=\n\s*concurrency:)/)[0], /execute-batch-13|--execute|LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.match(workflow, /github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/);
assert.match(workflow, /inputs\.mode == 'bot-only-7d-automatic'/);
assert.match(workflow, /CHIPS_LEDGER_BOT_ONLY_AUTOMATIC: "1"/);
assert.match(workflow, /node scripts\/ops\/chips-ledger-legacy-stage-allowlist-orchestrator\.mjs/);
const automaticRun = workflow.match(
  /- name: Run activated bot-only 7-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(automaticRun, /github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/);
assert.match(automaticRun, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'bot-only-7d-automatic'/);
assert.match(automaticRun, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'external-scheduled-automatic'/);
assert.match(automaticRun, /node scripts\/ops\/chips-ledger-stage-automation\.mjs --policy bot-only-7d --automatic/);
assert.doesNotMatch(automaticRun, /legacy-stage-allowlist|SUPABASE_PROD_|PRODUCTION|--target\s+prod/i);

assert.match(executeRunner, /chips_authorize_legacy_stage_allowlist_batch\(13, 'GO 13', '611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05'\)/);
assert.match(executeRunner, /readOnlyBatch13Preflight/);
assert.match(executeRunner, /beforeExecuteSnapshot/);
assert.match(executeRunner, /verifyBatch13PostExecute/);
assert.match(executeRunner, /already_pruned/);
assert.match(executeRunner, /replayOldRegistryKey/);
assert.match(executeRunner, /P8903/);
assert.match(executeRunner, /remaining_registry_count/);
assert.match(
  executeRunner,
  /const registryScope = batchState === "pruned"[\s\S]*?legacyStageAllowlistRegistryPredicate\("\$1"\)/,
);
assert.match(
  executeRunner,
  /const registryParameters = batchState === "pruned"\s+\? \[\]\s+: \[plan\.batchTableIds\]/,
);
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

const recoveryModeRegression = spawnSync(
  "bash",
  ["-c", String.raw`
set -eu
umask 0022
test "$(umask)" = "0022"
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
good="$root/good"
bad="$root/bad"
mkdir -m 0700 -- "$good"
test "$(stat -c '%a' "$good")" = "700"
mkdir -m 0755 -- "$bad"
test "$(stat -c '%a' "$bad")" = "755"
GOOD_DIR="$good" BAD_DIR="$bad" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";
import { ensurePrivateDirectory } from "./scripts/ops/_shared/chips-ledger-archive-files.mjs";

const mode = (directory) => fs.statSync(directory).mode & 0o777;
assert.equal(mode(process.env.GOOD_DIR), 0o700);
assert.equal(ensurePrivateDirectory(process.env.GOOD_DIR), process.env.GOOD_DIR);
assert.equal(mode(process.env.BAD_DIR), 0o755);
assert.throws(
  () => ensurePrivateDirectory(process.env.BAD_DIR),
  /recovery directory permissions must be 0700/,
);
NODE
`],
  { cwd: process.cwd(), encoding: "utf8" },
);
assert.equal(
  recoveryModeRegression.status,
  0,
  `recovery mode regression failed:\n${recoveryModeRegression.stderr || recoveryModeRegression.stdout}`,
);

process.stdout.write("chips-ledger-stage-automation workflow guard passed\n");
