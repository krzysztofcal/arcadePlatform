import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  buildObjectPath,
  resolveStorageTarget,
} from "./chips-ledger-archive-store.mjs";
import { pruneArchive as runArchivePrune } from "./chips-ledger-archive-prune.mjs";
import {
  buildLegacyPlan,
  loadFrozenLegacyAllowlist,
} from "./chips-ledger-legacy-stage-allowlist.mjs";
import { validateStageEnvironment } from "./chips-ledger-stage-automation.mjs";

const EXECUTE_GATE = "CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE";
const SHA256_RE = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;

const HELP = `Usage: ${EXECUTE_GATE}=1 node scripts/ops/chips-ledger-legacy-stage-allowlist-execute.mjs \
  --batch-id <exact batch_id> \
  --object-path <exact object_path> \
  --confirm-sha <exact compressed_sha256> \
  --recovery-dir <private directory>

This Stage-only runner loads the checked-in legacy_stage_allowlist_v1 plan and
executes exactly one previously authorized batch. The database GO function
remains the final authorization gate.
`;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function parseArgs(argv) {
  const valueArgs = new Map([
    ["--batch-id", "batchId"],
    ["--object-path", "objectPath"],
    ["--confirm-sha", "confirmSha"],
    ["--recovery-dir", "recoveryDir"],
  ]);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    const key = valueArgs.get(token);
    if (!key) fail(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    if (args[key] !== undefined) fail(`${token} was supplied more than once`);
    args[key] = value;
    index += 1;
  }
  if (args.help) return args;
  for (const [key, option] of Object.entries({
    batchId: "--batch-id",
    objectPath: "--object-path",
    confirmSha: "--confirm-sha",
    recoveryDir: "--recovery-dir",
  })) {
    if (!args[key]) fail(`${option} is required`);
  }
  if (!POSITIVE_INTEGER_RE.test(args.batchId)) fail("--batch-id must be a positive canonical integer");
  if (!SHA256_RE.test(args.confirmSha)) fail("--confirm-sha must be a lowercase SHA-256");
  if (args.objectPath !== buildObjectPath(args.confirmSha)) fail("--object-path does not match --confirm-sha");
  return args;
}

function buildFrozenPlan(cwd, deps) {
  const generated = (deps.readFrozenAllowlist || loadFrozenLegacyAllowlist)({ cwd });
  const plan = buildLegacyPlan(generated.masterManifest, generated.batchManifest);
  plan.masterManifest = generated.masterManifest;
  plan.batchManifest = generated.batchManifest;
  return plan;
}

function summarizeExecution({ result, args, plan, deployedCommitSha }) {
  return {
    state: result.state,
    mode: result.mode,
    reason: result.state === "already_pruned" ? "legacy_batch_already_pruned" : "legacy_batch_executed",
    deployedCommitSha,
    target: "stage",
    projectRef: result.target?.projectRef || null,
    postgresSystemIdentifier: result.identity || null,
    batchId: args.batchId,
    objectPath: args.objectPath,
    compressedSha256: args.confirmSha,
    allowlistSha256: plan.allowlistSha256,
    transactions: result.evidence?.transactionCount ?? null,
    entries: result.evidence?.entryCount ?? null,
    proof: result.evidence ? {
      transactionIdsSha256: result.evidence.transactionIdsSha256,
      entryIdsSha256: result.evidence.entryIdsSha256,
    } : null,
    recovery: result.recoveryBundle ? {
      artifactPath: result.recoveryBundle.artifactPath,
      manifestPath: result.recoveryBundle.manifestPath,
      reused: result.recoveryBundle.reused,
    } : null,
  };
}

export async function runLegacyStageAllowlistExecute({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  deps = {},
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return null;
  }
  if (text(env[EXECUTE_GATE]) !== "1") fail(`${EXECUTE_GATE}=1 is required for legacy Stage allowlist execution`);

  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const plan = buildFrozenPlan(cwd, deps);
  const storageTarget = deps.storageTarget
    || resolveStorageTarget("stage", config.moduleEnv, { singleTarget: true });
  const result = await (deps.pruneArchive || runArchivePrune)({
    argv: [
      "--target", "stage",
      "--object-path", args.objectPath,
      "--confirm-sha", args.confirmSha,
      "--execute",
      "--approved-batch-id", args.batchId,
      "--recovery-dir", args.recoveryDir,
    ],
    env: config.moduleEnv,
    cwd,
    deps: {
      ...deps,
      storageTarget,
      targetOptions: { singleTarget: true },
      legacyStageAllowlistPlan: plan,
      emit: false,
    },
  });
  return summarizeExecution({
    result,
    args,
    plan,
    deployedCommitSha: config.deployedCommitSha,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLegacyStageAllowlistExecute().then((result) => {
    process.stdout.write(`${stringifyJson({ event: "chips_ledger_legacy_stage_allowlist_execute", ...result })}\n`);
  }).catch((error) => {
    process.stderr.write(`chips-ledger-legacy-stage-allowlist-execute failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
