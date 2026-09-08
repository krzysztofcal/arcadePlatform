import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOT_ONLY_EXACT_TABLE_SELECTOR,
  BOT_ONLY_EXACT_TABLE_SQL,
  BOT_ONLY_TABLE_DISCOVERY_SELECTOR,
  BOT_ONLY_TABLE_DISCOVERY_SQL,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import { runBotOnlySelectorDiagnostic } from "../../scripts/ops/chips-ledger-stage-timeout-diagnostic.mjs";

const diagnostic = fs.readFileSync("scripts/ops/chips-ledger-stage-timeout-diagnostic.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-timeout-diagnostic.yml", "utf8");

assert.match(diagnostic, /set transaction isolation level repeatable read, read only/);
assert.match(diagnostic, /explain \(format json, verbose true, costs true, settings true\)/i);
assert.doesNotMatch(diagnostic, /EXPLAIN\s*\([^)]*ANALYZE/i);
assert.match(diagnostic, /set local statement_timeout = '\$\{REPLAY_STATEMENT_TIMEOUT_MS\}ms'/);
assert.match(diagnostic, /from pg_catalog\.pg_settings/);
assert.match(diagnostic, /Math\.min\(configuredTimeoutMs, REPLAY_STATEMENT_TIMEOUT_MS\)/);
assert.match(diagnostic, /configuredTimeoutMs === 0/);
assert.match(diagnostic, /selectorReplay/);
assert.match(diagnostic, /runBotOnlyTableIdentitySummaryDiagnostic/);
assert.match(diagnostic, /runBotOnlySelectorDiagnostic/);
assert.match(diagnostic, /BOT_ONLY_TABLE_DISCOVERY_SQL/);
assert.match(diagnostic, /BOT_ONLY_EXACT_TABLE_SQL/);
assert.match(diagnostic, /runExport/);
assert.match(diagnostic, /verifyLocalArchive/);
assert.match(diagnostic, /diagnoseTableIdentitySummary/);
assert.match(diagnostic, /statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS/);
assert.doesNotMatch(diagnostic, /boundedProbe|DIAGNOSTIC_PROBE_TIMEOUT_MS/);
assert.match(diagnostic, /candidate_result_limit: STAGE_MAX_BATCH_SIZE/);
assert.match(diagnostic, /EXACT_BOT_ONLY_DIAGNOSTIC_BATCH_ID = "481"/);
assert.match(diagnostic, /--batch-id 481/);
assert.match(diagnostic, /BOT_ONLY_PROOF_TARGET_TRANSACTIONS_EXPLAIN_SQL/);
assert.match(diagnostic, /table_transaction_rows as \(/);
assert.match(diagnostic, /transactions\.tx_type = 'TABLE_BUY_IN'::public\.chips_tx_type/);
assert.match(diagnostic, /transactions\.tx_type = 'TABLE_CASH_OUT'::public\.chips_tx_type/);
assert.match(diagnostic, /from table_transaction_rows transactions/);
assert.doesNotMatch(diagnostic, /set local enable_seqscan = 'off';/);
assert.doesNotMatch(diagnostic, /planner_setting/);
assert.match(diagnostic, /candidate_transaction_ids as \(/);
assert.match(diagnostic, /from candidate_transaction_ids candidates\s+join public\.chips_transactions transactions on transactions\.id = candidates\.id/s);
assert.match(diagnostic, /registry\.table_id = \$2::uuid/);
assert.match(diagnostic, /entries\.transaction_id/);
assert.doesNotMatch(diagnostic, /target_transactions\s+as\s*\([\s\S]*?from public\.chips_transactions transactions[\s\S]*?transactions\.id = any[\s\S]*?\bor[\s\S]*?public\.chips_entries/s);
assert.match(diagnostic, /BOT_ONLY_PROOF_UNKNOWN_REGISTRY_EXPLAIN_SQL/);
assert.match(diagnostic, /BOT_ONLY_PROOF_REGISTRY_KEY_COMPLETENESS_EXPLAIN_SQL/);
assert.match(diagnostic, /assertExactBotOnlyDiagnosticBatch/);
assert.match(diagnostic, /downloadPrivateArchiveObject/);
assert.match(diagnostic, /buildPruneEvidence/);
assert.match(diagnostic, /proof_helper_definition/);
assert.match(diagnostic, /explain_analyze: false/);
assert.match(diagnostic, /plan_sha256: sqlSha256\(JSON\.stringify\(plan\)\)/);
assert.match(diagnostic, /access_path: planAccessSummary\(plan\)/);
assert.match(diagnostic, /startup_cost: root\["Startup Cost"\]/);
assert.match(diagnostic, /total_cost: root\["Total Cost"\]/);
assert.match(diagnostic, /estimated_rows: root\["Plan Rows"\]/);
assert.doesNotMatch(diagnostic, /plan: rows\[0\]/);
assert.match(diagnostic, /output_contains_sql_parameters: false/);
assert.match(diagnostic, /output_contains_rows: false/);
assert.match(diagnostic, /output_contains_transaction_ids: false/);
assert.match(diagnostic, /output_contains_registry_keys: false/);
assert.match(diagnostic, /storage_access: false/);
assert.doesNotMatch(diagnostic, /\b(?:insert|update|delete|truncate|alter|drop)\s+(?:into\s+)?public\./i);

const selectorDiagnosticSource = diagnostic.slice(
  diagnostic.indexOf("function selectorTableId"),
  diagnostic.indexOf("export async function runStageTimeoutDiagnostic"),
);
assert.match(selectorDiagnosticSource, /readSnapshot/);
assert.match(selectorDiagnosticSource, /includeEntries: false/);
assert.doesNotMatch(
  selectorDiagnosticSource,
  /BOT_ONLY_CANDIDATE_SQL|runExport|storeArchive|pruneArchive|downloadPrivateArchiveObject|ensureArchiveBucket|registerProof|executeVerifiedCycle/i,
);
assert.doesNotMatch(selectorDiagnosticSource, /\b(?:insert|update|delete|truncate|alter|drop)\b/i);

const SELECTOR_TABLE_ID = "00000000-0000-4000-8000-000000000020";

function selectorSql({ discoveryRows, exactRows, statementTimeoutMs = "0" }) {
  const calls = [];
  const sql = {
    typed: (value, type) => ({ value, type }),
    async begin(callback) {
      return callback({
        async unsafe(query, parameters = []) {
          calls.push({ query, parameters });
          if (query.includes("set transaction isolation level")) return [];
          if (query.includes("from pg_catalog.pg_settings")) return [{ statement_timeout_ms: statementTimeoutMs }];
          if (query.startsWith("set local statement_timeout")) return [];
          if (query === BOT_ONLY_TABLE_DISCOVERY_SQL) return discoveryRows;
          if (query === BOT_ONLY_EXACT_TABLE_SQL) return exactRows;
          throw new Error(`unexpected selector diagnostic SQL: ${query.slice(0, 80)}`);
        },
      });
    },
  };
  return { sql, calls };
}

const identityAndFence = { fence_active: true, enforcement_active: true };
const cutoff = "2026-09-01T00:00:00.000Z";

{
  const { sql, calls } = selectorSql({ discoveryRows: [], exactRows: [] });
  const report = await runBotOnlySelectorDiagnostic({ sql, cutoff, identityAndFence });
  assert.equal(report.state, "no_candidate");
  assert.equal(report.discovery.selector, BOT_ONLY_TABLE_DISCOVERY_SELECTOR);
  assert.equal(report.discovery.result_count, 0);
  assert.equal(report.discovery.sqlstate, "00000");
  assert.equal(report.discovery.table_id, null);
  assert.equal(report.discovery.elapsed_ms >= 0, true);
  assert.equal(report.exact_revalidation, null);
  assert.equal(report.read_only_contract.statement_timeout_max_ms, 120000);
  assert.equal(calls.filter(({ query }) => query === BOT_ONLY_TABLE_DISCOVERY_SQL).length, 1);
  assert.equal(calls.filter(({ query }) => query === BOT_ONLY_EXACT_TABLE_SQL).length, 0);
  assert.equal(calls.filter(({ query }) => query.startsWith("set local statement_timeout = '120000ms'")).length, 1);
  assert.equal(calls.length, 4, "empty discovery must not run an entries query");
}

{
  const { sql, calls } = selectorSql({
    discoveryRows: [{ table_id: SELECTOR_TABLE_ID }],
    exactRows: [{ table_id: SELECTOR_TABLE_ID }],
    statementTimeoutMs: "5000",
  });
  const report = await runBotOnlySelectorDiagnostic({ sql, cutoff, identityAndFence });
  assert.equal(report.state, "revalidated");
  assert.equal(report.selected_table_id, SELECTOR_TABLE_ID);
  assert.equal(report.discovery.selector, BOT_ONLY_TABLE_DISCOVERY_SELECTOR);
  assert.equal(report.discovery.result_count, 1);
  assert.equal(report.discovery.table_id, SELECTOR_TABLE_ID);
  assert.equal(report.exact_revalidation.selector, BOT_ONLY_EXACT_TABLE_SELECTOR);
  assert.equal(report.exact_revalidation.result_count, 1);
  assert.equal(report.exact_revalidation.table_id, SELECTOR_TABLE_ID);
  assert.equal(report.exact_revalidation.sqlstate, "00000");
  assert.equal(report.exact_revalidation.elapsed_ms >= 0, true);
  assert.equal(report.read_only_contract.statement_timeout_policy, "min(configured, 120000ms)");
  assert.equal(calls.filter(({ query }) => query === BOT_ONLY_TABLE_DISCOVERY_SQL).length, 1);
  assert.equal(calls.filter(({ query }) => query === BOT_ONLY_EXACT_TABLE_SQL).length, 1);
  const exactCall = calls.find(({ query }) => query === BOT_ONLY_EXACT_TABLE_SQL);
  assert.equal(exactCall.parameters[4], SELECTOR_TABLE_ID);
  assert.equal(calls.filter(({ query }) => query.startsWith("set local statement_timeout = '5000ms'")).length, 2);
  assert.equal(calls.length, 8, "selector diagnostic must omit the entries query");
}

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /schedule:/);
assert.match(workflow, /SUPABASE_STAGE_DB_URL: \$\{\{ secrets\.SUPABASE_STAGE_DB_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_URL: \$\{\{ secrets\.SUPABASE_STAGE_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_STAGE_SERVICE_ROLE_KEY \}\}/);
assert.match(workflow, /DEPLOYED_COMMIT_SHA: \$\{\{ steps\.checkout-sha\.outputs\.sha \}\}/);
assert.match(workflow, /node scripts\/ops\/chips-ledger-stage-timeout-diagnostic\.mjs/);
assert.match(workflow, /bot_only_batch_id:/);
assert.match(workflow, /BOT_ONLY_DIAGNOSTIC_BATCH_ID: \$\{\{ inputs\.bot_only_batch_id \}\}/);
assert.match(workflow, /args=\(\)/);
assert.match(workflow, /args\+=\(--batch-id/);
assert.doesNotMatch(workflow, /--execute|CHIPS_LEDGER_BOT_ONLY_EXECUTE|SUPABASE_PROD_/);

process.stdout.write("chips-ledger-stage-timeout-diagnostic guard passed\n");
