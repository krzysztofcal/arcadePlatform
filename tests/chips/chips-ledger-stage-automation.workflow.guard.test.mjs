import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-scheduled-automation.yml", "utf8");
const parsedWorkflow = YAML.parse(workflow);
const stageJobIfExpression = parsedWorkflow.jobs?.["stage-archive"]?.if;
assert.equal(typeof stageJobIfExpression, "string", "stage-archive.if must be a YAML string");
let stageJobIfParenthesisBalance = 0;
for (const character of stageJobIfExpression) {
  if (character === "(") stageJobIfParenthesisBalance += 1;
  if (character === ")") stageJobIfParenthesisBalance -= 1;
  assert.ok(stageJobIfParenthesisBalance >= 0, "stage-archive.if has an unexpected closing parenthesis");
}
assert.equal(stageJobIfParenthesisBalance, 0, "stage-archive.if parentheses must balance");

const RETAINED_MODES = [
  "existing-30d",
  "existing-30d-recovery-diagnostic",
  "existing-30d-recovery-repair",
  "bot-only-7d-summary-diagnostic",
  "bot-only-7d-selector-diagnostic",
  "bot-only-7d-automatic",
  "closed-human-30d-recovery-diagnostic",
  "closed-human-30d-recovery-repair",
  "escrow-retention-audit",
  "escrow-retention-verify",
  "external-existing-30d",
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
  "closed-human-30d-prepare",
  "closed-human-30d-canary",
  "closed-human-policy-diagnostic",
  "closed-human-30d-lifecycle-completion",
  "closed-human-30d-activation",
];

const RETIRED_INPUTS = [
  "approved_batch_id",
  "approved_batch_confirmation",
  "escrow_retention_batch_id",
  "escrow_retention_account_ids_sha256",
  "escrow_retention_confirmation",
  "closed_human_canary_batch_id",
  "closed_human_canary_confirmation",
  "closed_human_lifecycle_batch_id",
  "closed_human_lifecycle_table_id",
  "closed_human_lifecycle_cutoff",
  "closed_human_activation_batch_id",
  "closed_human_activation_confirmation",
];

const RETAINED_STEPS = [
  "Run existing 30-day Stage automation",
  "Diagnose existing 30-day durable recovery",
  "Repair exact existing 30-day durable recovery",
  "Run bot-only 7-day summary diagnostic",
  "Run bot-only 7-day selector diagnostic",
  "Diagnose closed human-table 30-day durable recovery",
  "Repair exact closed human-table 30-day durable recovery",
  "Run activated bot-only 7-day Stage automation",
  "Run activated closed-human 30-day Stage automation",
  "Run Stage escrow account retention",
  "Audit Stage escrow account retention",
  "Verify Stage escrow account-retention recovery",
];

const RETIRED_STEPS = [
  "Prepare closed human-table 30-day Stage retention",
  "Execute exact closed human-table 30-day Stage canary",
  "Diagnose closed-human retention policy",
  "Complete exact closed-human table lifecycle",
  "Activate closed-human 30-day Stage automatic retention",
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

for (const step of RETIRED_STEPS) {
  assert.equal(stepNames.includes(step), false, `retired step must be absent: ${step}`);
}

for (const retired of RETIRED_MODES) {
  assert.doesNotMatch(workflow, new RegExp(`inputs\\.mode\\s*(?:==|!=)\\s*'${retired}'`));
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

assert.equal((workflow.match(/- cron:/g) || []).length, 1);
assert.doesNotMatch(workflow, /- cron: "17 2 \* \* \*"/);
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
  "bot-only-7d-selector-diagnostic",
  "bot-only-7d-automatic",
  "closed-human-30d-recovery-diagnostic",
  "closed-human-30d-recovery-repair",
  "escrow-retention-audit",
  "escrow-retention-verify",
]) {
  assert.match(preflightStep, new RegExp(`inputs\\.mode == '${mode}'`));
}
for (const retired of RETIRED_MODES) {
  assert.doesNotMatch(preflightStep, new RegExp(`inputs\\.mode == '${retired}'`));
}

const stageJobIf = workflow.match(
  /^    if: .*$/m,
)[0];
assert.match(stageJobIf, /inputs\.mode != 'escrow-retention-audit'/);
assert.match(stageJobIf, /inputs\.mode != 'escrow-retention-verify'/);
assert.match(stageJobIf, /inputs\.mode != 'existing-30d-recovery-repair'/);
assert.match(stageJobIf, /inputs\.mode != 'closed-human-30d-recovery-repair'/);
assert.match(stageJobIf, /inputs\.mode != 'external-existing-30d'/);
assert.match(stageJobIf, /inputs\.mode == 'closed-human-30d-recovery-repair'/);
assert.match(stageJobIf, /inputs\.mode == 'external-existing-30d'/);
assert.match(stageJobIf, /github\.ref == 'refs\/heads\/main'/);
assert.match(stageJobIf, /github\.repository == 'krzysztofcal\/arcadePlatform'/);
assert.match(
  stageJobIf,
  /if: \$\{\{ \(github\.event_name == 'workflow_dispatch' && inputs\.mode == 'bot-only-7d-selector-diagnostic' && github\.repository == 'krzysztofcal\/arcadePlatform' && github\.event\.repository\.fork != true && github\.actor == github\.repository_owner && github\.ref == 'refs\/heads\/main'\) \|\| \(vars\.CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED == '1' &&/,
);
assert.match(stageJobIf, /github\.event\.repository\.fork != true/);
assert.match(stageJobIf, /github\.actor == github\.repository_owner/);

assert.match(preflightStep, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/);
assert.match(preflightStep, /RETRYABLE_CONNECTION_CODES/);
assert.match(preflightStep, /CONNECT_TIMEOUT/);
assert.match(preflightStep, /CONNECT_RETRY_BACKOFF_MS/);
assert.match(preflightStep, /set transaction read only/);
assert.doesNotMatch(preflightStep, /set transaction read write|insert\s|update\s|delete\s/i);

const existingRun = workflow.match(
  /- name: Run existing 30-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(existingRun, /github\.event_name == 'workflow_dispatch'/);
assert.match(existingRun, /inputs\.mode == 'existing-30d'/);
assert.match(existingRun, /inputs\.mode == 'external-existing-30d'/);
assert.match(existingRun, /run: node scripts\/ops\/chips-ledger-stage-automation\.mjs\s*$/m);
assert.doesNotMatch(existingRun, /--policy|--prepare-only|--execute|--automatic/);
assert.doesNotMatch(existingRun, /github\.event_name == 'schedule'/);
assert.doesNotMatch(existingRun, /external-scheduled-automatic/);

const botOnlyAutomaticRun = workflow.match(
  /- name: Run activated bot-only 7-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.doesNotMatch(botOnlyAutomaticRun, /bot-only-7d-selector-diagnostic/);
assert.match(botOnlyAutomaticRun, /id: bot_only_automatic/);
assert.match(botOnlyAutomaticRun, /continue-on-error: \$\{\{ github\.event_name == 'schedule'/);
assert.match(botOnlyAutomaticRun, /github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/);
assert.match(botOnlyAutomaticRun, /inputs\.mode == 'bot-only-7d-automatic'/);
assert.match(botOnlyAutomaticRun, /inputs\.mode == 'external-scheduled-automatic'/);
assert.doesNotMatch(botOnlyAutomaticRun, /inputs\.mode == 'external-existing-30d'/);
assert.match(botOnlyAutomaticRun, /CHIPS_LEDGER_BOT_ONLY_AUTOMATIC: "1"/);
assert.match(botOnlyAutomaticRun, /node scripts\/ops\/chips-ledger-stage-automation\.mjs --policy bot-only-7d --automatic/);

const selectorDiagnosticRun = workflow.match(
  /- name: Run bot-only 7-day selector diagnostic[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(selectorDiagnosticRun, /inputs\.mode == 'bot-only-7d-selector-diagnostic'/);
assert.match(selectorDiagnosticRun, /node scripts\/ops\/chips-ledger-stage-timeout-diagnostic\.mjs --selector-diagnostic/);
assert.match(selectorDiagnosticRun, /test -z "\$\{CHIPS_LEDGER_BOT_ONLY_EXECUTE:-\}"/);
assert.match(selectorDiagnosticRun, /test -z "\$\{CHIPS_LEDGER_BOT_ONLY_AUTOMATIC:-\}"/);
assert.doesNotMatch(selectorDiagnosticRun, /CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED|--execute|--automatic|Storage|prune|archive upload/i);

const escrowAutomaticRun = workflow.match(
  /- name: Run Stage escrow account retention[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(escrowAutomaticRun, /id: escrow_automatic/);
assert.match(escrowAutomaticRun, /continue-on-error: \$\{\{ github\.event_name == 'schedule'/);
assert.match(escrowAutomaticRun, /github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/);
assert.match(escrowAutomaticRun, /inputs\.mode == 'external-scheduled-automatic'/);
assert.doesNotMatch(escrowAutomaticRun, /inputs\.mode == 'external-existing-30d'/);
assert.match(escrowAutomaticRun, /node scripts\/ops\/chips-ledger-stage-escrow-retention\.mjs --automatic/);

assert.equal((workflow.match(/github\.event_name == 'schedule' && github\.event\.schedule == '7,22,37,52 \* \* \* \*'/g) || []).length, 5);

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

const closedHumanDiagnosticRun = workflow.match(
  /- name: Diagnose closed human-table 30-day durable recovery[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(closedHumanDiagnosticRun, /inputs\.mode == 'closed-human-30d-recovery-diagnostic'/);
assert.match(closedHumanDiagnosticRun, /--policy stage-ledger-closed-human-table-retention-30d-v1/);
assert.match(closedHumanDiagnosticRun, /--diagnose-recovery/);
assert.match(closedHumanDiagnosticRun, /stage_30d_recovery_batch_id/);
assert.doesNotMatch(closedHumanDiagnosticRun, /--repair-recovery|--execute|--automatic/);

const closedHumanRepairRun = workflow.match(
  /- name: Repair exact closed human-table 30-day durable recovery[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(closedHumanRepairRun, /inputs\.mode == 'closed-human-30d-recovery-repair'/);
assert.match(closedHumanRepairRun, /test "\$DEPLOYED_COMMIT_SHA" = "\$GITHUB_SHA"/);
assert.match(closedHumanRepairRun, /test -z "\$\{CHIPS_LEDGER_BOT_ONLY_EXECUTE:-\}"/);
assert.match(closedHumanRepairRun, /test -z "\$\{CHIPS_LEDGER_BOT_ONLY_AUTOMATIC:-\}"/);
assert.match(closedHumanRepairRun, /GITHUB_ACTOR" != "\$GITHUB_REPOSITORY_OWNER"/);
assert.match(closedHumanRepairRun, /--policy stage-ledger-closed-human-table-retention-30d-v1 \\\n\s+--repair-recovery \\\n\s+--batch-id "\$STAGE_30D_RECOVERY_BATCH_ID"/);
assert.doesNotMatch(closedHumanRepairRun, /--diagnose-recovery|--prepare-only|--execute|--automatic|--register-proof|storeArchive|ensureArchiveBucket/);

const closedHumanAutomaticRun = workflow.match(
  /- name: Run activated closed-human 30-day Stage automation[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(closedHumanAutomaticRun, /id: closed_human_automatic/);
assert.equal(
  closedHumanAutomaticRun.match(/^        if: (.+)$/m)?.[1],
  "\${{ (github.event_name == 'schedule' && github.event.schedule == '7,22,37,52 * * * *') || (github.event_name == 'workflow_dispatch' && inputs.mode == 'external-scheduled-automatic') }}",
  "external dispatch must not skip the activated closed-human automatic step",
);
assert.equal(
  closedHumanAutomaticRun.match(/^        continue-on-error: (.+)$/m)?.[1],
  "\${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.mode == 'external-scheduled-automatic') }}",
  "external closed-human failures must remain independently aggregated",
);
assert.match(closedHumanAutomaticRun, /CHIPS_LEDGER_CLOSED_HUMAN_AUTOMATIC: "1"/);
assert.match(closedHumanAutomaticRun, /CHIPS_LEDGER_CLOSED_HUMAN_EXTERNAL_AUTOMATIC: "1"/);
assert.match(closedHumanAutomaticRun, /node scripts\/ops\/chips-ledger-stage-automation\.mjs --policy closed-human-table-30d --automatic/);
assert.doesNotMatch(closedHumanAutomaticRun, /--approved-batch-id|--execute(?:\s|$)|\bACTIVATE\b|GO 334|Production|SUPABASE_PROD_/i);

const closedHumanAutomaticRunStart = workflow.indexOf("- name: Run activated closed-human 30-day Stage automation");
const escrowAutomaticRunStart = workflow.indexOf("- name: Run Stage escrow account retention");
assert.ok(closedHumanAutomaticRunStart >= 0 && closedHumanAutomaticRunStart < escrowAutomaticRunStart);
assert.match(workflow.slice(closedHumanAutomaticRunStart, escrowAutomaticRunStart), /CHIPS_LEDGER_CLOSED_HUMAN_AUTOMATIC: "1"/);

const independentFailureAggregator = workflow.match(
  /- name: Fail scheduled retention run after independent path failures[\s\S]*?(?=\n\s+- name:|\s*$)/,
)[0];
assert.match(independentFailureAggregator, /always\(\)/);
assert.match(independentFailureAggregator, /steps\.bot_only_automatic\.outcome/);
assert.match(independentFailureAggregator, /steps\.closed_human_automatic\.outcome/);
assert.match(independentFailureAggregator, /steps\.escrow_automatic\.outcome/);
assert.match(independentFailureAggregator, /exit 1/);
assert.doesNotMatch(independentFailureAggregator, /--execute|--automatic|prune|Production|SUPABASE_PROD_/i);


// One fail-fast resource boundary covers all automatic retention entry points.
const stageJob = parsedWorkflow.jobs['stage-archive'];
const resourceSteps = stageJob.steps.filter((step) => step.name === 'Enforce Stage resource health before automatic retention');
assert.equal(resourceSteps.length, 1);
const resourceGuard = resourceSteps[0];
assert.equal(resourceGuard.run, 'node scripts/ops/stage-supabase-resource-health.mjs --enforce');
assert.equal(resourceGuard['continue-on-error'], undefined);
assert.equal(stageJob['continue-on-error'], undefined);
assert.equal(resourceGuard.env.SUPABASE_STAGE_MANAGEMENT_TOKEN, '${{ secrets.SUPABASE_STAGE_MANAGEMENT_TOKEN }}');
assert.equal(stageJob.env.SUPABASE_STAGE_MANAGEMENT_TOKEN, undefined);
assert.equal(stageJob.steps.filter((step) => step.env?.SUPABASE_STAGE_MANAGEMENT_TOKEN).length, 1);
assert.equal(resourceGuard.if, "${{ (github.event_name == 'schedule' && github.event.schedule == '7,22,37,52 * * * *') || (github.event_name == 'workflow_dispatch' && (inputs.mode == 'external-scheduled-automatic' || inputs.mode == 'bot-only-7d-automatic' || inputs.mode == 'existing-30d' || inputs.mode == 'external-existing-30d')) }}");
for (const name of [
  'Run existing 30-day Stage automation',
  'Run activated bot-only 7-day Stage automation',
  'Run activated closed-human 30-day Stage automation',
  'Run Stage escrow account retention',
]) {
  const step = stageJob.steps.find((item) => item.name === name);
  assert.ok(stageJob.steps.indexOf(resourceGuard) < stageJob.steps.indexOf(step));
  assert.doesNotMatch(step.if, /always\(|failure\(|cancelled\(/, 'cleanup must retain implicit success()');
}

const finalRetentionCheck = stageJob.steps.find((step) => step.name === 'Fail scheduled retention run after independent path failures');
assert.match(finalRetentionCheck.if, /always\(\)/);
assert.equal(finalRetentionCheck['continue-on-error'], undefined);
assert.doesNotMatch(finalRetentionCheck.run, /GITHUB_ENV|GITHUB_OUTPUT|resource_health/);

process.stdout.write("chips-ledger-stage-automation workflow guard passed\n");
