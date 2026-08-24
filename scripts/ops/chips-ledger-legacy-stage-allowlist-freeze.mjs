import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import {
  LEGACY_STAGE_ALLOWLIST_CUTOFF,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  LEGACY_STAGE_ALLOWLIST_TABLE_COUNT,
} from "./chips-ledger-archive-export.mjs";
import {
  LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN,
  LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256,
  buildLegacyPlan,
  legacyAllowlistQuerySha256,
  readLegacyAllowlist,
  readOnlyStagePreflight,
  writeLegacyPlanFiles,
} from "./chips-ledger-legacy-stage-allowlist.mjs";
import {
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";
import { ensurePrivateDirectory } from "./_shared/chips-ledger-archive-files.mjs";

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^[0-9]+$/;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function assertCommit(env) {
  const sha = text(env.DEPLOYED_COMMIT_SHA || env.GITHUB_SHA).toLowerCase();
  if (!COMMIT_SHA_RE.test(sha)) fail("DEPLOYED_COMMIT_SHA/GITHUB_SHA must be the checked-out commit SHA");
  return sha;
}

function resolveFreezeRunId(env) {
  const runId = text(env.FREEZE_RUN_ID || env.GITHUB_RUN_ID);
  if (!RUN_ID_RE.test(runId)) fail("FREEZE_RUN_ID/GITHUB_RUN_ID must be the actual workflow run ID");
  return runId;
}

export async function runLegacyStageAllowlistFreeze({
  env = process.env,
  cwd = process.cwd(),
  deps = {},
} = {}) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    && process.argv.slice(2).length !== 0) {
    fail("legacy Stage allowlist freeze accepts no arguments");
  }
  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const deployedCommitSha = assertCommit(env);
  const freezeRunId = resolveFreezeRunId(env);
  const outputDirectory = path.resolve(
    text(env.FREEZE_OUTPUT_DIR) || path.join(cwd, "freeze-artifacts"),
  );
  ensurePrivateDirectory(outputDirectory);

  let sql = deps.sql || postgres(config.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
  });
  const ownsSql = !deps.sql;
  try {
    const preflight = await (deps.preflight || readOnlyStagePreflight)(sql);
    const generated = await (deps.readAllowlist || readLegacyAllowlist)(sql, {
      cutoff: LEGACY_STAGE_ALLOWLIST_CUTOFF,
      sourceRun: LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
      expectedProjectRef: STAGE_PROJECT_REF,
      expectedSystemIdentifier: STAGE_SYSTEM_IDENTIFIER,
      freezeRunId,
      diagnosticSourceRun: LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN,
      diagnosticSourceRunSha256: LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256,
    });
    if (generated.masterManifest.table_count !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT) {
      fail("legacy Stage freeze returned an unexpected table count");
    }
    const plan = buildLegacyPlan(generated.masterManifest, generated.batchManifest);
    const files = (deps.writePlan || writeLegacyPlanFiles)(outputDirectory, plan);
    return {
      state: "completed",
      mode: "freeze-read-only",
      reason: "legacy_allowlist_frozen",
      readOnly: true,
      databaseWrites: false,
      archiveWrites: false,
      proofWrites: false,
      deployedCommitSha,
      freezeRunId,
      policyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
      cutoff: LEGACY_STAGE_ALLOWLIST_CUTOFF,
      projectRef: STAGE_PROJECT_REF,
      systemIdentifier: STAGE_SYSTEM_IDENTIFIER,
      generatorSha256: legacyAllowlistQuerySha256(),
      diagnosticSourceRun: LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN,
      diagnosticSourceRunSha256: LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256,
      sourceRun: LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
      tableCount: generated.masterManifest.table_count,
      allowlistSha256: generated.masterManifest.allowlist_sha256,
      masterManifestSha256: generated.masterManifest.manifest_sha256,
      batchManifestSha256: generated.batchManifest.manifest_sha256,
      outputDirectory,
      artifacts: files.paths.map((filePath) => path.relative(outputDirectory, filePath)),
      preflight,
    };
  } finally {
    if (ownsSql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLegacyStageAllowlistFreeze().then((result) => {
    process.stdout.write(`${JSON.stringify({ event: "chips_ledger_legacy_stage_allowlist_freeze", ...result })}\n`);
  }).catch((error) => {
    process.stderr.write(`chips-ledger-legacy-stage-allowlist-freeze failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
