import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { gunzipSync } from "node:zlib";

import {
  BOT_ONLY_BLOCKING_ANOMALY_SQL,
  BOT_ONLY_CANDIDATE_SQL,
  BOT_ONLY_RETENTION_DAYS,
  BOT_ONLY_RETENTION_POLICY_ID,
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  parseJsonl,
  runExport,
} from "./chips-ledger-archive-export.mjs";
import {
  diagnoseTableIdentitySummary,
  resolveStorageTarget,
  verifyLocalArchive,
} from "./chips-ledger-archive-store.mjs";
import {
  redactedError,
  STAGE_MAX_BATCH_SIZE,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  STAGE_OWN_BATCHES_SQL,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";

const REPLAY_STATEMENT_TIMEOUT_MS = 120000;
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

const SETTINGS_SQL = `
with configured as (
  select 'role'::text as scope,
         unnest(coalesce(rolconfig, array[]::text[])) as config
    from pg_catalog.pg_roles
   where rolname = current_user
  union all
  select case
           when setrole = 0 then 'database'
           when setdatabase = 0 then 'role'
           else 'role_in_database'
         end,
         unnest(setconfig)
    from pg_catalog.pg_db_role_setting
   where (setrole = 0 or setrole = (select oid from pg_catalog.pg_roles where rolname = current_user))
     and (setdatabase = 0 or setdatabase = (select oid from pg_catalog.pg_database where datname = current_database()))
)
select current_user::text as current_user,
       current_database()::text as current_database,
       pg_catalog.current_setting('statement_timeout', true) as session_statement_timeout,
       setting,
       unit,
       context,
       source,
       sourcefile,
       sourceline,
       boot_val,
       reset_val,
       coalesce(
         (
           select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'scope', configured.scope,
               'value', pg_catalog.split_part(configured.config, '=', 2)
             )
           )
             from configured
            where pg_catalog.split_part(configured.config, '=', 1) = 'statement_timeout'
         ),
         '[]'::jsonb
       ) as configured_statement_timeout_sources
  from pg_catalog.pg_settings
 where name = 'statement_timeout';
`;

const IDENTITY_SQL = "select system_identifier::text as system_identifier from pg_catalog.pg_control_system();";
const FENCE_SQL = "select public.chips_table_fence_is_active() as active;";
const FENCE_CONTROL_SQL = "select enforcement_active from public.chips_table_fence_control where control_id is true;";

function sqlState(error) {
  const value = String(error?.code || error?.sqlState || error?.sqlstate || "").toUpperCase();
  return SQLSTATE_RE.test(value) ? value : null;
}

function sqlSha256(query) {
  return crypto.createHash("sha256").update(query).digest("hex");
}

function stringify(value) {
  return JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? nested.toString() : nested), 2);
}

function boundedReadOnlySql(sql) {
  return {
    typed: typeof sql.typed === "function" ? (value, type) => sql.typed(value, type) : undefined,
    begin: (callback) => sql.begin(async (tx) => {
      let timeoutConfigured = false;
      const boundedTx = {
        unsafe: async (query, parameters) => {
          const result = parameters === undefined
            ? await tx.unsafe(query)
            : await tx.unsafe(query, parameters);
          if (!timeoutConfigured && /^\s*set transaction\b/i.test(query)) {
            await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
            timeoutConfigured = true;
          }
          return result;
        },
      };
      return callback(boundedTx);
    }),
  };
}

async function readOnlyTransaction(sql, callback) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
    return callback(tx);
  });
}

async function readSettings(sql) {
  const rows = await readOnlyTransaction(sql, (tx) => tx.unsafe(SETTINGS_SQL));
  return rows[0] || null;
}

async function readIdentityAndFence(sql) {
  return readOnlyTransaction(sql, async (tx) => {
    const identityRows = await tx.unsafe(IDENTITY_SQL);
    const activeRows = await tx.unsafe(FENCE_SQL);
    const controlRows = await tx.unsafe(FENCE_CONTROL_SQL);
    return {
      system_identifier: identityRows[0]?.system_identifier || null,
      fence_active: activeRows[0]?.active === true || activeRows[0]?.active === "t",
      enforcement_active: controlRows.length === 1
        && (controlRows[0]?.enforcement_active === true || controlRows[0]?.enforcement_active === "t"),
    };
  });
}

async function explain(sql, queryName, query, parameters) {
  const startedAt = process.hrtime.bigint();
  try {
    const rows = await readOnlyTransaction(sql, (tx) => tx.unsafe(
      `explain (format json, verbose true, costs true, settings true) ${query}`,
      parameters,
    ));
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: "00000",
      plan: rows[0]?.["QUERY PLAN"] || rows[0]?.["query plan"] || null,
    };
  } catch (error) {
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: sqlState(error),
      plan: null,
      error_class: "explain_failed",
    };
  }
}

async function replay(sql, queryName, query, parameters) {
  const startedAt = process.hrtime.bigint();
  try {
    await readOnlyTransaction(sql, async (tx) => {
      await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
      await tx.unsafe(query, parameters);
    });
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: "00000",
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      read_only: true,
      output_rows: false,
    };
  } catch (error) {
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: sqlState(error),
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      read_only: true,
      output_rows: false,
    };
  }
}

function tableSummaryFailure(diagnosis, recordIndex) {
  if (!diagnosis) return null;
  if (!diagnosis.ok) {
    return {
      code: diagnosis.code,
      field: diagnosis.field,
      record_index: recordIndex,
      strict_timestamp_equal: diagnosis.strict_timestamp_equal ?? null,
      semantic_timestamp_equal: diagnosis.semantic_timestamp_equal ?? null,
    };
  }
  if (diagnosis.strict_timestamp_equal === false) {
    return {
      code: "TABLE_IDENTITY_SUMMARY_NEWEST_CREATED_AT_MISMATCH",
      field: "newest_created_at",
      record_index: recordIndex,
      strict_timestamp_equal: false,
      semantic_timestamp_equal: true,
      representation_only: true,
    };
  }
  return null;
}

export async function runBotOnlyTableIdentitySummaryDiagnostic({ config, sql, cutoff }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-table-summary-diagnostic-"));
  fs.chmodSync(tempRoot, 0o700);
  const artifactPath = path.join(tempRoot, "bot-only.archive.jsonl.gz");
  const manifestPath = path.join(tempRoot, "bot-only.archive.manifest.json");
  const boundedSql = boundedReadOnlySql(sql);
  try {
    const exported = await runExport({
      argv: [
        "--target", "stage",
        "--cutoff", cutoff,
        "--batch-size", String(STAGE_MAX_BATCH_SIZE),
        "--output", artifactPath,
        "--manifest", manifestPath,
      ],
      env: config.moduleEnv,
      cwd: tempRoot,
      now: new Date(cutoff),
      deps: {
        sql: boundedSql,
        selector: "bot-only-7d",
        schemaVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
        sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
        targetOptions: { singleTarget: true },
        noCandidateIfEmpty: true,
        emit: false,
      },
    });
    if (exported?.noCandidate) {
      return {
        state: "no_candidate",
        records: 0,
        entries: 0,
        first_failure: null,
        local_archive_store_validation: { state: "not_run", error_code: null },
      };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const rawBytes = gunzipSync(fs.readFileSync(artifactPath));
    const records = parseJsonl(rawBytes.toString("utf8"));
    let representative = null;
    let firstFailure = null;
    for (const [recordIndex, record] of records.entries()) {
      const diagnosis = diagnoseTableIdentitySummary(record?.table_context?.table_identity_summary, manifest.bot_only);
      if (!representative) representative = diagnosis;
      const failure = tableSummaryFailure(diagnosis, recordIndex);
      if (failure) {
        firstFailure = failure;
        break;
      }
    }

    let localValidation = { state: "pass", error_code: null };
    try {
      verifyLocalArchive({
        artifactPath,
        manifestPath,
        target: resolveStorageTarget("stage", config.moduleEnv, { singleTarget: true }),
      });
    } catch (error) {
      localValidation = {
        state: "blocked",
        error_code: error?.code || null,
        error_class: "local_archive_store_validation_failed",
      };
    }

    return {
      state: firstFailure || localValidation.state !== "pass" ? "blocked" : "pass",
      records: records.length,
      entries: records.reduce((total, record) => total + (Array.isArray(record?.entries) ? record.entries.length : 0), 0),
      first_failure: firstFailure,
      checks: representative?.checks || [],
      strict_timestamp_equal: representative?.strict_timestamp_equal ?? null,
      semantic_timestamp_equal: representative?.semantic_timestamp_equal ?? null,
      local_archive_store_validation: localValidation,
      read_only_contract: {
        transaction: "repeatable read, read only",
        statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
        writes: false,
        storage_access: false,
        output_contains_rows: false,
      },
    };
  } catch (error) {
    return {
      state: "error",
      records: null,
      entries: null,
      first_failure: null,
      error_code: error?.code || null,
      error_class: "bounded_table_summary_diagnostic_failed",
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function runStageTimeoutDiagnostic({ env = process.env, now = new Date(), summaryOnly = false } = {}) {
  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const sql = postgres(config.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
  });
  const cutoff = new Date(now.getTime() - BOT_ONLY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const candidateParameters = [cutoff, STAGE_MAX_BATCH_SIZE, null, null];
  const anomalyParameters = [cutoff, STAGE_MAX_BATCH_SIZE];
  const ownBatchParameters = [STAGE_PROJECT_REF, BOT_ONLY_RETENTION_POLICY_ID];

  try {
    const identityAndFence = await readIdentityAndFence(sql);
    if (identityAndFence.system_identifier !== STAGE_SYSTEM_IDENTIFIER) {
      throw new Error("database is not canonical Stage");
    }

    if (summaryOnly) {
      const tableIdentitySummary = await runBotOnlyTableIdentitySummaryDiagnostic({
        config,
        sql,
        cutoff,
      });
      return {
        event: "chips_ledger_stage_summary_diagnostic",
        target: "stage",
        mode: "bot-only-7d-summary-diagnostic",
        project_ref: STAGE_PROJECT_REF,
        deployed_commit_sha: config.deployedCommitSha,
        stage_identity_and_fence: identityAndFence,
        cutoff,
        bot_only_table_identity_summary: tableIdentitySummary,
        read_only_contract: {
          transaction: "repeatable read, read only",
          statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
          writes: false,
          storage_access: false,
          output_contains_sql_parameters: false,
          output_contains_rows: false,
        },
      };
    }

    const settings = await readSettings(sql);
    const explains = [
      await explain(sql, "stage.load_own_batches", STAGE_OWN_BATCHES_SQL, ownBatchParameters),
      await explain(sql, "snapshot.bot_only_candidate_selector", BOT_ONLY_CANDIDATE_SQL, candidateParameters),
      await explain(sql, "snapshot.bot_only_blocking_anomalies", BOT_ONLY_BLOCKING_ANOMALY_SQL, anomalyParameters),
    ];
    const selectorReplay = await replay(
      sql,
      "snapshot.bot_only_candidate_selector",
      BOT_ONLY_CANDIDATE_SQL,
      candidateParameters,
    );
    const tableIdentitySummary = await runBotOnlyTableIdentitySummaryDiagnostic({
      config,
      sql,
      cutoff,
    });

    return {
      event: "chips_ledger_stage_timeout_diagnostic",
      target: "stage",
      project_ref: STAGE_PROJECT_REF,
      deployed_commit_sha: config.deployedCommitSha,
      stage_identity_and_fence: identityAndFence,
      cutoff,
      statement_timeout: settings,
      explains,
      selector_replay: selectorReplay,
      bot_only_table_identity_summary: tableIdentitySummary,
      read_only_contract: {
        transaction: "repeatable read, read only",
        explain: "EXPLAIN (FORMAT JSON, VERBOSE, COSTS, SETTINGS), without ANALYZE",
        writes: false,
        replay_statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
        candidate_result_limit: STAGE_MAX_BATCH_SIZE,
        output_contains_sql_parameters: false,
        output_contains_rows: false,
      },
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && process.argv[1].endsWith("chips-ledger-stage-timeout-diagnostic.mjs")) {
  const argv = process.argv.slice(2);
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--summary-only")) {
    process.stderr.write("usage: node scripts/ops/chips-ledger-stage-timeout-diagnostic.mjs [--summary-only]\n");
    process.exitCode = 1;
  } else {
    runStageTimeoutDiagnostic({ summaryOnly: argv[0] === "--summary-only" })
    .then((report) => process.stdout.write(`${stringify(report)}\n`))
    .catch((error) => {
      process.stderr.write(`chips-ledger-stage-timeout-diagnostic failed: ${redactedError(error)}\n`);
      process.exitCode = 1;
    });
  }
}
