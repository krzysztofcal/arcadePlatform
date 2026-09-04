import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-scheduled-automation.yml", "utf8");

const RETAINED_MODES = [
  "existing-30d",
  "existing-30d-recovery-diagnostic",
  "existing-30d-recovery-repair",
  "bot-only-7d-summary-diagnostic",
  "bot-only-7d-automatic",
  "escrow-retention-audit",
  "escrow-retention-verify",
  "external-scheduled-automatic",
];

const RETIRED_MODES = [
  "bot-only-7d-repair-recovery-batch-15",
  "bot-only-7d-prepare-only",
  "bot-only-7d-execute",
  "legacy-stage-allowlist-prepare-only",
  "legacy-stage-allowlist-orchestrate",
  "audit-batch-13",
  "execute-batch-13",
  "escrow-retention-prepare-only",
  "escrow-retention-authorize-canary",
  "escrow-retention-execute",
  "escrow-retention-activate",
];

const RETIRED_INPUTS = [
  "approved_batch_id",
  "approved_batch_confirmation",
  "escrow_retention_batch_id",
  "escrow_retention_account_ids_sha256",
  "escrow_retention_confirmation",
];

const RETAINED_STEPS = [
  "Run existing 30-day Stage automation",
  "Diagnose existing 30-day durable recovery",
  "Repair exact existing 30-day durable recovery",
  "Run bot-only 7-day summary diagnostic",
  "Run activated bot-only 7-day Stage automation",
  "Run Stage escrow account retention",
  "Audit Stage escrow account retention",
  "Verify Stage escrow account-retention recovery",
];

const modeOptionsBlock = workflow.slice(workflow.indexOf("type: choice"), workflow.indexOf("schedule:"));
const modeOptions = [...modeOptionsBlock.matchAll(/^\s+- ([a-z0-9-]+)$/gm)].map((match) => match[1]);

const inputsBlock = workflow.slice(workflow.indexOf("workflow_dispatch:"), workflow.indexOf("schedule:"));
const inputNames = [...inputsBlock.matchAll(/^ {6}([a-z0-9_]+):$/gm)].map((match) => match[1]);

const stepNames = [...workflow.matchAll(/^\s+- name: (.+)$/gm)].map((match) => match[1]);

assert.deepEqual([...modeOptions].sort(), [...RETAINED_MODES].sort(), "exact retained dispatch mode set");
assert.equal(modeOptions.length, RETAINED_MODES.length);

for (const retired of RETIRED_MODES) {
  assert.equal(modeOptions.includes(retired), false, `retired mode must be absent: ${retired}`);
  assert.equal(stepNames.some((name) => name.includes(retired.replace(/-/g, " ")) || name.includes(retired)), false);
}

assert.deepEqual([...inputNames].sort(), [
  "escrow_retention_recovery_confirmation",
  "escrow_retention_recovery_object_path",
  "mode",
  "stage_30d_recovery_batch_id",
].sort(), "exact retained dispatch inputs");

for (const retired of RETIRED_INPUTS) {
  assert.equal(inputNames.includes(retired), false, `retired input must be absent: ${retired}`);
  assert.doesNotMatch(workflow, new RegExp(`^ {6}${retired}:$`, "m"));
}

for (const step of RETAINED_STEPS) {
  assert.equal(stepNames.includes(step), true, `retained step must exist: ${step}`);
}

assert.doesNotMatch(workflow, /Repair exact bot-only 7-day recovery for batch 15/);
assert.doesNotMatch(workflow, /bot-only 7-day prepare-only Stage automation/);
assert.doesNotMatch(workflow, /Execute approved bot-only 7-day Stage canary/);
assert.doesNotMatch(workflow, /legacy Stage allowlist prepare-only|legacy Stage allowlist orchestrator|Audit legacy Stage allowlist batch 13|Execute approved legacy Stage batch 13/i);
assert.doesNotMatch(workflow, /Prepare exact Stage escrow account-retention batch/);
assert.doesNotMatch(workflow, /Authorize exact Stage escrow account-retention canary/);
assert.doesNotMatch(workflow, /Execute exact Stage escrow account-retention canary/);
assert.doesNotMatch(workflow, /Activate Stage escrow account-retention automation/);
assert.doesNotMatch(workflow, /CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1"|CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE|CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_(AUTHORIZE_CANARY|EXECUTE|ACTIVATE)/);
assert.doesNotMatch(workflow, /legacy-stage-allowlist|execute-batch-13|audit-batch-13/);

assert.equal((workflow.match(/- cron:/g) || []).length, 2);
assert.match(workflow, /- cron: "17 2 \* \* \*"/);
assert.match(workflow, /- cron: "7,22,37,52 \* \* \* \*"/);

const concurrencyBlock = workflow.match(
  /^concurrency:\n(?:  [^\n]+\n)+(?=\n\S)/m,
)[0];
assert.match(concurrencyBlock, /^  group: chips-ledger-stage-automation$/m);
assert.match(concurrencyBlock, /^  cancel-in-progress: false$/m);
assert.match(concurrencyBlock, /^  queue: max$/m);
assert.doesNotMatch(concurrencyBlock, /github\.ref|github\.event|inputs\./);

assert.match(workflow, /vars\.CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED == '1'/);
assert.equal((workflow.match(/^    timeout-minutes: 60$/gm) || []).length, 1);
assert.equal((workflow.match(/^    timeout-minutes: 30$/gm) || []).length, 0);
assert.match(workflow, /SUPABASE_STAGE_DB_URL: \${{ secrets\.SUPABASE_STAGE_DB_URL }}/);
assert.match(workflow, /SUPABASE_STAGE_URL: \${{ secrets\.SUPABASE_STAGE_URL }}/);
assert.match(workflow, /SUPABASE_STAGE_SERVICE_ROLE_KEY: \${{ secrets\.SUPABASE_STAGE_SERVICE_ROLE_KEY }}/);
assert.doesNotMatch(workflow, /SUPABASE_PROD_|PRODUCTION|--target\s+prod/i);

assert.match(workflow, /set transaction read only/);
assert.match(workflow, /pg_control_system/);
assert.match(workflow, /chips_table_fence_is_active/);
assert.match(workflow, /chips_table_fence_control/);
assert.match(workflow, /enforcement_active/);

const preflightStep = workflow.match(
  /- name: Read-only Stage fence preflight[\s\S]*?(?=\n\s+- name:)/,
)[0];
for (const mode of [
  "existing-30d-recovery-diagnostic",
  "existing-30d-recovery-repair",
  "bot-only-7d-summary-diagnostic",
  "bot-only-7d-automatic",
  "escrow-retention-audit",
  "escrow-retention-verify",
]) {
  assert.match(preflightStep, new RegExp(`inputs\\.mode == '${mode}'`));
}
for (const retired of RETIRED_MODES) {
  assert.doesNotMatch(preflightStep, new RegExp(`inputs\\.mode == '${retired}'`));
}

const stageJobIf = workflow.match(
  /^jobs:\n\s+stage-archive:\n\s+if: .*$/m,
)[0];
assert.match(stageJobIf, /inputs\.mode != 'escrow-retention-audit'/);
assert.match(stageJobIf, /inputs\.mode != 'escrow-retention-verify'/);
assert.match(stageJobIf, /inputs\.mode != 'existing-30d-recovery-repair'/);
assert.match(stageJobIf, /github\.ref == 'refs\/heads\/main'/);
assert.match(stageJobIf, /github\.repository == 'krzysztofcal\/arcadePlatform'/);
assert.match(stageJobIf, /github\.event\.repository\.fork != true/);
assert.match(stageJobIf, /github\.actor == github\.repository_owner/);

const existingRun = workflow.match(
  /- name: Run existing 30-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(existingRun, /github\.event_name == 'schedule' && github\.event\.schedule == '17 2 \* \* \*'/);
assert.match(existingRun, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'existing-30d'/);
assert.match(existingRun, /run: node scripts\/ops\/chips-ledger-stage-automation\.mjs\s*$/m);
assert.doesNotMatch(existingRun, /--policy|--prepare-only|--execute|--automatic/);

const botOnlyAutomaticRun = workflow.match(
  /- name: Run activated bot-only 7-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(botOnlyAutomaticRun, /github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/);
assert.match(botOnlyAutomaticRun, /inputs\.mode == 'bot-only-7d-automatic'/);
assert.match(botOnlyAutomaticRun, /inputs\.mode == 'external-scheduled-automatic'/);
assert.match(botOnlyAutomaticRun, /CHIPS_LEDGER_BOT_ONLY_AUTOMATIC: "1"/);
assert.match(botOnlyAutomaticRun, /node scripts\/ops\/chips-ledger-stage-automation\.mjs --policy bot-only-7d --automatic/);

const escrowAutomaticRun = workflow.match(
  /- name: Run Stage escrow account retention[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(escrowAutomaticRun, /github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/);
assert.match(escrowAutomaticRun, /inputs\.mode == 'external-scheduled-automatic'/);
assert.match(escrowAutomaticRun, /node scripts\/ops\/chips-ledger-stage-escrow-retention\.mjs --automatic/);

assert.equal((workflow.match(/github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/g) || []).length, 2);

const diagnosticRun = workflow.match(
  /- name: Diagnose existing 30-day durable recovery[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(diagnosticRun, /inputs\.mode == 'existing-30d-recovery-diagnostic'/);
assert.match(diagnosticRun, /--diagnose-recovery/);
assert.match(diagnosticRun, /stage_30d_recovery_batch_id/);
assert.doesNotMatch(diagnosticRun, /--repair-recovery|--execute|--automatic/);

const repairRun = workflow.match(
  /- name: Repair exact existing 30-day durable recovery[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(repairRun, /inputs\.mode == 'existing-30d-recovery-repair'/);
assert.match(repairRun, /test "\$DEPLOYED_COMMIT_SHA" = "\$GITHUB_SHA"/);
assert.match(repairRun, /test -z "\$\{CHIPS_LEDGER_BOT_ONLY_EXECUTE:-\}"/);
assert.match(repairRun, /test -z "\$\{CHIPS_LEDGER_BOT_ONLY_AUTOMATIC:-\}"/);
assert.match(repairRun, /GITHUB_ACTOR" != "\$GITHUB_REPOSITORY_OWNER"/);
assert.match(repairRun, /stage_30d_recovery_batch_id must be a positive integer/);
assert.match(repairRun, /--policy stage-ledger-auto-retention-30d-v1 \\\n\s+--repair-recovery \\\n\s+--batch-id "\$STAGE_30D_RECOVERY_BATCH_ID"/);
assert.doesNotMatch(repairRun, /--diagnose-recovery|--prepare-only|--execute|--automatic|--register-proof|storeArchive|ensureArchiveBucket/);

process.stdout.write("chips-ledger-stage-automation workflow guard passed\n");
