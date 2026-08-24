import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-automation.yml", "utf8");

assert.match(
  workflow,
  /workflow_dispatch:\n\s+inputs:\n\s+mode:\n\s+description: Stage automation mode\n\s+required: true\n\s+default: existing-30d\n\s+type: choice\n\s+options:\n\s+- existing-30d\n\s+- bot-only-7d-prepare-only\n\s+- legacy-stage-allowlist-prepare-only/,
);
assert.equal((workflow.match(/^\s+- (?:existing-30d|bot-only-7d-prepare-only|legacy-stage-allowlist-prepare-only)$/gm) || []).length, 3);
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
assert.doesNotMatch(workflow, /--execute|CHIPS_LEDGER_BOT_ONLY_EXECUTE/);

const legacyRun = workflow.match(
  /- name: Run legacy Stage allowlist prepare-only[\s\S]*$/,
)[0];
assert.match(legacyRun, /github\.event_name == 'workflow_dispatch'/);
assert.match(legacyRun, /inputs\.mode == 'legacy-stage-allowlist-prepare-only'/);
assert.match(legacyRun, /run: node scripts\/ops\/chips-ledger-legacy-stage-allowlist\.mjs\s*$/m);
assert.doesNotMatch(legacyRun, /\\|--|stage-automation|execute/i);
assert.equal((workflow.match(/node scripts\/ops\/chips-ledger-legacy-stage-allowlist\.mjs/g) || []).length, 1);
assert.doesNotMatch(existingRun, /legacy-stage-allowlist/);
assert.doesNotMatch(botOnlyRun, /legacy-stage-allowlist/);
assert.doesNotMatch(workflow.match(/- cron:[\s\S]*?(?=\n\s*concurrency:)/)[0], /legacy-stage-allowlist/);

process.stdout.write("chips-ledger-stage-automation workflow guard passed\n");
