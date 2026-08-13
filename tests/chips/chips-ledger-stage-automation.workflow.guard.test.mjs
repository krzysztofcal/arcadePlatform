import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-automation.yml", "utf8");

assert.match(workflow, /workflow_dispatch:/);
assert.equal((workflow.match(/- cron:/g) || []).length, 1);
assert.match(workflow, /cancel-in-progress:\s*false/);
assert.match(workflow, /CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED == '1'/);
assert.match(workflow, /SUPABASE_STAGE_DB_URL: \$\{\{ secrets\.SUPABASE_STAGE_DB_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_URL: \$\{\{ secrets\.SUPABASE_STAGE_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_STAGE_SERVICE_ROLE_KEY \}\}/);
assert.doesNotMatch(workflow, /SUPABASE_PROD_|PRODUCTION|--target/);
assert.match(workflow, /node scripts\/ops\/chips-ledger-stage-automation\.mjs/);

process.stdout.write("chips-ledger-stage-automation workflow guard passed\n");
