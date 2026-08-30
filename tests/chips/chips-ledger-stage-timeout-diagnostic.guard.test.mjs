import assert from "node:assert/strict";
import fs from "node:fs";

const diagnostic = fs.readFileSync("scripts/ops/chips-ledger-stage-timeout-diagnostic.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-timeout-diagnostic.yml", "utf8");

assert.match(diagnostic, /set transaction isolation level repeatable read, read only/);
assert.match(diagnostic, /explain \(format json, verbose true, costs true, settings true\)/i);
assert.doesNotMatch(diagnostic, /EXPLAIN\s*\([^)]*ANALYZE/i);
assert.match(diagnostic, /set local statement_timeout = '\$\{REPLAY_STATEMENT_TIMEOUT_MS\}ms'/);
assert.match(diagnostic, /selectorReplay/);
assert.match(diagnostic, /runBotOnlyTableIdentitySummaryDiagnostic/);
assert.match(diagnostic, /runExport/);
assert.match(diagnostic, /verifyLocalArchive/);
assert.match(diagnostic, /diagnoseTableIdentitySummary/);
assert.match(diagnostic, /statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS/);
assert.doesNotMatch(diagnostic, /boundedProbe|DIAGNOSTIC_PROBE_TIMEOUT_MS/);
assert.match(diagnostic, /candidate_result_limit: STAGE_MAX_BATCH_SIZE/);
assert.match(diagnostic, /output_contains_sql_parameters: false/);
assert.match(diagnostic, /output_contains_rows: false/);
assert.match(diagnostic, /storage_access: false/);
assert.doesNotMatch(diagnostic, /\b(?:insert|update|delete|truncate|alter|drop)\s+(?:into\s+)?public\./i);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /schedule:/);
assert.match(workflow, /SUPABASE_STAGE_DB_URL: \$\{\{ secrets\.SUPABASE_STAGE_DB_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_URL: \$\{\{ secrets\.SUPABASE_STAGE_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_STAGE_SERVICE_ROLE_KEY \}\}/);
assert.match(workflow, /DEPLOYED_COMMIT_SHA: \$\{\{ steps\.checkout-sha\.outputs\.sha \}\}/);
assert.match(workflow, /node scripts\/ops\/chips-ledger-stage-timeout-diagnostic\.mjs/);
assert.doesNotMatch(workflow, /--execute|CHIPS_LEDGER_BOT_ONLY_EXECUTE|SUPABASE_PROD_/);

process.stdout.write("chips-ledger-stage-timeout-diagnostic guard passed\n");
