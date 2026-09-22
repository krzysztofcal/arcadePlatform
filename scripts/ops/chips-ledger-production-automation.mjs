import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  BOT_ONLY_RETENTION_DAYS,
  DEFAULT_CUTOFF_DAYS,
  runExport,
  PRODUCTION_AUTOMATION_POLICY_ID,
  PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID,
  PRODUCTION_CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  PRODUCTION_ESCROW_RETENTION_POLICY_ID,
} from "./chips-ledger-archive-export.mjs";
import {
  acquireRetentionAdvisoryLock,
  assertRetentionAdvisoryLock,
  assertDurableRecoveryReady,
  assertExactCanaryArgs,
  assertResumeRecoveryState,
  findOwnCycle,
  inspectDurableRecovery,
  persistDurableRecovery,
  releaseRetentionAdvisoryLock,
  runRetentionCycle,
} from "./_shared/chips-ledger-retention-cycle.mjs";
import { validateRetentionEnvironment } from "./_shared/chips-ledger-retention-profile.mjs";
import {
  accountIdsSha256,
  assertProductionEscrowProfile,
  buildAccountRecoverySnapshot,
  ensureAccountRecoveryObject,
  serializeAccountRecovery,
  runWithEscrowRetry,
} from "./_shared/chips-ledger-escrow-retention.mjs";
import {
  createStorageVerificationContext,
  downloadPrivateArchiveObject,
  ensureArchiveBucket,
  resolveStorageTarget,
  storeArchive,
} from "./chips-ledger-archive-store.mjs";
import { createPruneStore, pruneArchive } from "./chips-ledger-archive-prune.mjs";
import { ensurePrivateDirectory } from "./_shared/chips-ledger-archive-files.mjs";

const PRODUCTION_STATE_SQL = Object.freeze({
  identity: "select system_identifier::text as system_identifier from pg_catalog.pg_control_system();",
  control: `select enabled, max_transactions, activated_at::text as activated_at
      from public.chips_production_retention_control where control_id is true;`,
  fence: `select enforcement_active from public.chips_table_fence_control where control_id is true;`,
  policies: `select policy_id, enabled, canary_batch_id::text as canary_batch_id,
      activated_at::text as activated_at
    from public.chips_production_bot_only_retention_policy
    union all
    select policy_id, enabled, canary_batch_id::text as canary_batch_id,
      activated_at::text as activated_at
    from public.chips_production_closed_human_table_retention_policy
    union all
    select policy_id, enabled, canary_batch_id::text as canary_batch_id,
      activated_at::text as activated_at
    from public.chips_production_escrow_account_retention_policy;`,
});

export const PRODUCTION_POLICIES = Object.freeze({
  "existing-30d": PRODUCTION_AUTOMATION_POLICY_ID,
  "bot-only-7d": PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID,
  "closed-human-30d": PRODUCTION_CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  escrow: PRODUCTION_ESCROW_RETENTION_POLICY_ID,
});
export const PRODUCTION_MODES = Object.freeze(["diagnostic", "prepare", "canary", "automatic"]);
export const PRODUCTION_DISPATCH_ACTOR = "arcade-production-dispatch";

const SHA256_RE = /^[0-9a-f]{64}$/;

const PRODUCTION_OWN_BATCHES_SQL = `select object_path, source_policy_id, status,
    batch_id::text as batch_id, project_ref,
    transaction_count::text as transaction_count,
    entry_count::text as entry_count,
    compressed_sha256,
    created_at::text as created_at,
    pruned_at::text as pruned_at,
    archive_proof_verified_at::text as archive_proof_verified_at,
    registry_cleaned_at::text as registry_cleaned_at
  from public.chips_ledger_archive_batches
  where project_ref = $1 and source_policy_id = $2
  order by created_at desc, batch_id desc;`;

const PRODUCTION_EXECUTE_RECEIPT_FIELDS = Object.freeze([
  "pruned_at",
  "pruned_transaction_count",
  "pruned_entry_count",
  "pruned_transaction_ids_sha256",
  "pruned_entry_ids_sha256",
  "registry_cleaned_at",
  "registry_cleaned_key_count",
  "registry_cleaned_keys_sha256",
]);

const PRODUCTION_ESCROW_CANDIDATE_SQL = `select batches.*,
    accounts.id::text as account_id,
    accounts.user_id::text as account_user_id,
    accounts.system_key as account_system_key,
    accounts.account_type::text as account_account_type,
    accounts.status::text as account_status,
    accounts.label as account_label,
    accounts.balance::text as account_balance,
    accounts.next_entry_seq::text as account_next_entry_seq,
    accounts.created_at::text as account_created_at,
    accounts.updated_at::text as account_updated_at
  from public.chips_ledger_archive_batches batches
  join public.chips_accounts accounts
    on accounts.system_key = 'POKER_TABLE:' || batches.bot_only_table_id::text
   and accounts.account_type::text = 'ESCROW'
   and accounts.user_id is null
   and lower(accounts.status::text) = 'active'
   and accounts.balance = 0
  where batches.project_ref = $1
    and batches.source_policy_id = $2
    and batches.status = 'committed'
    and batches.pruned_at is not null
    and batches.registry_cleaned_at is not null
    and batches.account_retirement_at is null
    and batches.bot_only_table_id is not null
    and batches.bot_only_table_count = 1
    and not exists (select 1 from public.poker_tables tables where tables.id = batches.bot_only_table_id)
    and not exists (select 1 from public.chips_entries entries where entries.account_id = accounts.id)
    and not exists (select 1 from public.chips_account_snapshot snapshots where snapshots.account_id = accounts.id)
    and not exists (
      select 1 from public.chips_transaction_idempotency registry
      where registry.table_id = batches.bot_only_table_id
         or registry.archive_batch_id = batches.batch_id
    )
    and ($3::bigint is null or batches.batch_id = $3::bigint)
  order by batches.batch_id asc
  limit 2;`;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function fail(message) {
  throw new Error(message);
}

function klog(event, data) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

function policyKey(policy) {
  const key = text(policy);
  if (!Object.hasOwn(PRODUCTION_POLICIES, key)) fail("Production policy must be existing-30d, bot-only-7d, closed-human-30d, or escrow");
  return key;
}

export function parseProductionAutomationArgs(argv = process.argv.slice(2)) {
  const args = {};
  const valueArgs = new Map([
    ["--policy", "policy"],
    ["--mode", "mode"],
    ["--batch-id", "batchId"],
    ["--confirmation", "confirmation"],
    ["--account-ids-sha256", "accountIdsSha256"],
    ["--recovery-object-path", "recoveryObjectPath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    const key = valueArgs.get(token);
    if (!key || args[key] !== undefined) fail(`unknown or repeated argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    args[key] = value;
    index += 1;
  }
  if (!args.policy || !args.mode) fail("--policy and --mode are required");
  policyKey(args.policy);
  if (!PRODUCTION_MODES.includes(args.mode)) fail("Production mode must be diagnostic, prepare, canary, or automatic");
  return args;
}

function selectorForPolicy(policy) {
  switch (policy) {
    case "existing-30d": return "prunable";
    case "bot-only-7d": return "bot-only-7d";
    case "closed-human-30d": return "closed-human-table-30d";
    case "escrow": return "bot-only-7d-discovery";
    default: fail(`unsupported Production policy: ${policy}`);
  }
}

function archivePolicyIdFor(policy) {
  return policy === "escrow"
    ? PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID
    : PRODUCTION_POLICIES[policy];
}

function requireCanaryAuthorization({ mode, env, batchId, confirmation, policy, accountIdsSha256 = null, recoveryObjectPath = null }) {
  if (mode !== "canary") return;
  if (env.CHIPS_LEDGER_PRODUCTION_CANARY !== "1") fail("Production canary requires CHIPS_LEDGER_PRODUCTION_CANARY=1");
  assertExactCanaryArgs({ batchId, confirmation, maxTransactions: 2 });
  if (policy === "escrow") {
    const expectedHash = text(env.CHIPS_LEDGER_PRODUCTION_ACCOUNT_IDS_SHA256);
    if (!SHA256_RE.test(expectedHash) || expectedHash !== expectedHash.toLowerCase()
      || !SHA256_RE.test(text(accountIdsSha256))
      || text(accountIdsSha256) !== expectedHash) {
      fail("Production escrow canary requires the exact account ID SHA-256");
    }
    if (!/^account-recovery\/v1\/sha256\/[0-9a-f]{64}\.json\.gz$/.test(text(recoveryObjectPath))) {
      fail("Production escrow canary requires the exact recovery object path");
    }
  }
}

function requireAutomaticAuthorization({ env, mode }) {
  if (mode !== "automatic") return;
  if (env.CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED !== "1") fail("Production automatic cleanup is disabled");
  if (text(env.CHIPS_LEDGER_PRODUCTION_DISPATCH_ACTOR) !== text(env.GITHUB_ACTOR)
    || text(env.GITHUB_ACTOR) !== PRODUCTION_DISPATCH_ACTOR) {
    fail("Production automatic cleanup requires the dedicated dispatch actor");
  }
}

function productionExportArgs(policy, outputPath, manifestPath) {
  const cutoffDays = policy === "bot-only-7d" || policy === "escrow"
    ? BOT_ONLY_RETENTION_DAYS
    : DEFAULT_CUTOFF_DAYS;
  return ["--target", "prod", "--output", outputPath, "--manifest", manifestPath, "--cutoff-days", String(cutoffDays), "--batch-size", "2"];
}

async function readProductionState({ profile, deps = {} } = {}) {
  if (typeof deps.sqlRead === "function") return deps.sqlRead({ profile });
  const sql = postgres(profile.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
  });
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level repeatable read, read only;");
      const identityRows = await tx.unsafe(PRODUCTION_STATE_SQL.identity);
      const systemIdentifier = text(identityRows[0]?.system_identifier);
      if (systemIdentifier !== profile.systemIdentifier) fail("database is not canonical Production");
      const controlRows = await tx.unsafe(PRODUCTION_STATE_SQL.control);
      const fenceRows = await tx.unsafe(PRODUCTION_STATE_SQL.fence);
      const policyRows = await tx.unsafe(PRODUCTION_STATE_SQL.policies);
      if (controlRows.length !== 1 || fenceRows.length !== 1 || policyRows.length !== 3) {
        fail("Production retention contract is incomplete or non-singleton");
      }
      return {
        projectRef: profile.projectRef,
        systemIdentifier,
        readOnly: true,
        control: controlRows[0],
        fenceActive: fenceRows[0].enforcement_active === true || fenceRows[0].enforcement_active === "t",
        policies: policyRows,
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function productionTargetOptions() {
  return { singleTarget: true };
}

function productionStorageDeps(deps, storageTarget) {
  const storageVerificationContext = deps.storageVerificationContext || createStorageVerificationContext();
  const storageDeps = { ...deps, storageVerificationContext };
  const verifyBucket = deps.verifyBucket || ((target, options = {}) => (
    options.fresh
      ? storageVerificationContext.verifyFresh(target, storageDeps)
      : storageVerificationContext.verify(target, storageDeps)
  ));
  return { storageDeps, verifyBucket, storageTarget };
}

function assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId }) {
  if (!row
    || text(row.batch_id) !== text(batchId)
    || row.project_ref !== profile.projectRef
    || row.source_policy_id !== sourcePolicyId
    || row.status !== "committed"
    || !row.committed_at
    || row.pruned_at != null) {
    fail("active Production batch manifest does not match the exact prepared batch");
  }
  if (!row.archive_proof_verified_at
    || !SHA256_RE.test(text(row.archived_transaction_ids_sha256))
    || !SHA256_RE.test(text(row.archived_entry_ids_sha256))) {
    fail("active Production batch is missing its immutable archive proof");
  }
  if (PRODUCTION_EXECUTE_RECEIPT_FIELDS.some((field) => row[field] != null)) {
    fail("active Production batch has a partial cleanup receipt");
  }
  if ((row.destructive_go_at == null) !== (row.destructive_go_batch_id == null)
    || (row.destructive_go_batch_id != null && text(row.destructive_go_batch_id) !== text(batchId))) {
    fail("active Production batch has a partial or foreign destructive GO");
  }
  return row;
}

async function resumeProductionCanaryBatch({
  activeRow,
  profile,
  env,
  policy,
  mode,
  batchId,
  confirmation,
  sql,
  lockSession,
  pruneStore,
  storageTarget,
  verifyBucket,
  storageDeps,
  tempRoot,
  deps,
}) {
  const sourcePolicyId = PRODUCTION_POLICIES[policy];
  if (mode !== "canary") fail("only Production canary may resume an active batch");
  if (text(activeRow?.batch_id) !== text(batchId)) {
    fail("exact active Production batch ID does not match --batch-id");
  }
  if (activeRow?.project_ref !== profile.projectRef
    || activeRow?.source_policy_id !== sourcePolicyId
    || activeRow?.status !== "committed"
    || activeRow?.pruned_at != null) {
    fail("active Production batch summary does not match the exact prepared batch");
  }
  let row = await pruneStore.getManifest(activeRow.object_path);
  assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId });
  await verifyBucket(storageTarget);

  const runPrune = deps.pruneArchive || pruneArchive;
  const pruneDeps = {
    ...storageDeps,
    sql,
    pruneStore,
    storageTarget,
    targetOptions: productionTargetOptions(),
    verifyBucket,
    emit: false,
  };
  const dry = await runPrune({
    argv: ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256],
    env,
    cwd: tempRoot,
    deps: pruneDeps,
  });
  if (dry?.state !== "ready") fail(`active Production canary dry-run did not become ready: ${dry?.state || "unknown"}`);
  if (!dry.evidence
    || dry.evidence.transactionIdsSha256 !== row.archived_transaction_ids_sha256
    || dry.evidence.entryIdsSha256 !== row.archived_entry_ids_sha256) {
    fail("active Production canary dry-run evidence does not match the committed proof");
  }

  row = await pruneStore.getManifest(activeRow.object_path);
  assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId });
  const inspectRecovery = storageDeps.inspectDurableRecovery || inspectDurableRecovery;
  const durable = await inspectRecovery(storageTarget, row, profile, dry.evidence, storageDeps);
  assertResumeRecoveryState(row, durable, profile);
  assertDurableRecoveryReady(durable);

  await assertRetentionAdvisoryLock(sql, lockSession);
  const authorization = await authorizeProductionBatch({ sql, policy, batchId, confirmation, deps });
  if (!authorization
    || text(authorization.state) !== "authorized"
    || text(authorization.batch_id) !== text(batchId)) {
    fail("Production canary authorization did not persist the exact batch GO");
  }
  row = await pruneStore.getManifest(activeRow.object_path);
  assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId });
  if (!row.destructive_go_at || text(row.destructive_go_batch_id) !== text(batchId)) {
    fail("Production canary authorization did not persist the exact destructive GO");
  }

  await assertRetentionAdvisoryLock(sql, lockSession);
  const recoveryDir = archiveRecoveryDir(tempRoot);
  const executed = await runPrune({
    argv: [
      "--target", "prod",
      "--object-path", row.object_path,
      "--confirm-sha", row.compressed_sha256,
      "--execute",
      "--recovery-dir", recoveryDir,
      "--approved-batch-id", String(batchId),
    ],
    env,
    cwd: tempRoot,
    deps: {
      ...pruneDeps,
      downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
    },
  });
  return {
    state: executed?.state || "unknown",
    receipt: executed?.state || "unknown",
    projectRef: profile.projectRef,
    systemIdentifier: profile.systemIdentifier,
    batchId: String(batchId),
    transactions: dry.evidence.transactionCount,
    entries: dry.evidence.entryCount,
    compressedSha256: row.compressed_sha256,
    recoveryArchiveSha256: durable.recoveryArchive.sha256,
    recoveryManifestSha256: durable.recoveryManifest.sha256,
    storageWrites: 0,
    databaseWrites: 2,
  };
}

async function authorizeProductionBatch({ sql, policy, batchId, confirmation, accountIdsSha256: expectedAccountIdsSha256 = null, deps = {} }) {
  if (typeof deps.authorize === "function") return deps.authorize({ sql, policy, batchId, confirmation, accountIdsSha256: expectedAccountIdsSha256 });
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level serializable;");
    await tx.unsafe("set local lock_timeout = '5s';");
    await tx.unsafe("set local statement_timeout = '120s';");
    const functions = {
      "existing-30d": "chips_authorize_production_existing_30d_canary",
      "bot-only-7d": "chips_authorize_bot_only_archive_batch",
      "closed-human-30d": "chips_authorize_closed_human_table_retention_canary",
    };
    if (policy === "escrow") {
      if (!SHA256_RE.test(text(expectedAccountIdsSha256))) fail("Production escrow canary requires the exact account ID SHA-256");
      const rows = await tx.unsafe(`select public.chips_authorize_production_escrow_account_retirement_canary(
        $1::bigint, $2::text, $3::text
      ) as result;`, [batchId, expectedAccountIdsSha256, confirmation]);
      return rows[0]?.result;
    }
    const routine = functions[policy];
    if (!routine) fail("Production policy authorization routine is unavailable");
    const rows = await tx.unsafe(`select public.${routine}($1::bigint, $2::text) as result;`, [batchId, confirmation]);
    return rows[0]?.result;
  });
}

function archiveRecoveryDir(tempRoot) {
  const recoveryDir = path.join(tempRoot, "recovery");
  ensurePrivateDirectory(recoveryDir);
  return recoveryDir;
}

function productionEscrowAccountFromRow(row) {
  return {
    id: row.account_id,
    user_id: row.account_user_id,
    system_key: row.account_system_key,
    account_type: row.account_account_type,
    status: row.account_status,
    label: row.account_label,
    balance: row.account_balance,
    next_entry_seq: row.account_next_entry_seq,
    created_at: row.account_created_at,
    updated_at: row.account_updated_at,
  };
}

async function runProductionEscrowDatabaseFunction({ sql, candidate, recovery, execute, confirmation, canary = false, automatic = false }) {
  return sql.begin(async (tx) => {
    await tx.unsafe(execute ? "set transaction isolation level serializable;" : "set transaction isolation level repeatable read, read only;");
    await tx.unsafe("set local lock_timeout = '5s';");
    await tx.unsafe("set local statement_timeout = '30s';");
    if (canary) await tx.unsafe("set local chips.production_canary = '1';");
    if (automatic) await tx.unsafe("set local chips.production_automatic = '1';");
    const rows = await tx.unsafe(`select public.chips_retire_production_escrow_accounts(
      $1::bigint, $2::uuid[], $3::text, $4::text, $5::text, $6::boolean, $7::text
    ) as result;`, [
      candidate.batchId,
      candidate.accountIds,
      recovery.objectPath,
      recovery.compressedSha256,
      recovery.snapshotSha256,
      execute,
      confirmation,
    ]);
    return rows[0]?.result;
  });
}

async function runProductionEscrowCycle({
  profile,
  env,
  mode,
  batchId = null,
  confirmation = null,
  accountIdsSha256: expectedAccountIdsSha256 = null,
  recoveryObjectPath: expectedRecoveryObjectPath = null,
  deps = {},
  cwd = process.cwd(),
  identity,
} = {}) {
  let sql = deps.sql || postgres(profile.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 30 });
  const ownsSql = !deps.sql;
  let lockSession = null;
  const tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-production-escrow-"));
  ensurePrivateDirectory(tempRoot);
  const storageTarget = deps.storageTarget || resolveStorageTarget("prod", env, productionTargetOptions());
  const { storageDeps, verifyBucket } = productionStorageDeps(deps, storageTarget);
  try {
    if (mode === "automatic") {
      const controlEnabled = identity?.control?.enabled === true || identity?.control?.enabled === "t";
      const policyEnabled = identity?.policies?.some((row) => row.policy_id === PRODUCTION_POLICIES.escrow
        && (row.enabled === true || row.enabled === "t"));
      if (!controlEnabled || !policyEnabled) {
        return {
          state: "disabled",
          mode,
          policy: "escrow",
          policyId: PRODUCTION_POLICIES.escrow,
          reason: !controlEnabled ? "production_control_disabled" : "production_policy_disabled",
          processed: 0,
        };
      }
    }
    lockSession = await acquireRetentionAdvisoryLock(sql, profile);
    if (!lockSession) return { state: "no-op", mode, policy: "escrow", policyId: PRODUCTION_POLICIES.escrow, reason: "advisory_lock_busy", processed: 0 };
    const identityRows = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    if (text(identityRows[0]?.system_identifier) !== profile.systemIdentifier) fail("database is not canonical Production");
    const candidates = await sql.unsafe(PRODUCTION_ESCROW_CANDIDATE_SQL, [
      profile.projectRef,
      PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID,
      batchId || null,
    ]);
    if (batchId && candidates.length !== 1) fail(`exact Production escrow batch ${batchId} is not a current safe candidate`);
    if (candidates.length === 0) return { state: "no-op", mode, policy: "escrow", policyId: PRODUCTION_POLICIES.escrow, reason: "no_eligible_candidate", processed: 0 };
    const row = candidates[0];
    const account = productionEscrowAccountFromRow(row);
    const candidate = {
      batchId: String(row.batch_id),
      accountIds: [String(row.account_id).toLowerCase()],
      tableIds: [String(row.bot_only_table_id).toLowerCase()],
    };
    const actualAccountIdsSha256 = accountIdsSha256(candidate.accountIds);
    if (expectedAccountIdsSha256 != null && text(expectedAccountIdsSha256) !== actualAccountIdsSha256) {
      fail("Production escrow account ID evidence differs from the current candidate");
    }
    await verifyBucket(storageTarget);
    const snapshot = buildAccountRecoverySnapshot({
      profile,
      batch: row,
      accounts: [account],
      tableIds: candidate.tableIds,
    });
    const recovery = serializeAccountRecovery(snapshot);
    if (expectedRecoveryObjectPath != null && text(expectedRecoveryObjectPath) !== recovery.objectPath) {
      fail("Production escrow recovery object evidence differs from the current candidate");
    }
    const storedRecovery = await ensureAccountRecoveryObject({
      profile,
      storageTarget,
      recovery,
      deps: storageDeps,
      expectedSnapshot: snapshot,
      expectedAccountIds: candidate.accountIds,
      allowCreate: true,
    });
    const dry = await runProductionEscrowDatabaseFunction({
      sql,
      candidate,
      recovery: storedRecovery,
      execute: false,
      confirmation: null,
    });
    if (dry?.state !== "eligible") fail(`Production escrow dry-run did not become eligible: ${dry?.state || "unknown"}`);
    const prepared = {
      state: "prepared",
      mode,
      policy: "escrow",
      policyId: PRODUCTION_POLICIES.escrow,
      projectRef: profile.projectRef,
      systemIdentifier: identity?.systemIdentifier || profile.systemIdentifier,
      batchId: candidate.batchId,
      accountCount: candidate.accountIds.length,
      accountIdsSha256: actualAccountIdsSha256,
      recoveryObjectPath: storedRecovery.objectPath,
      recoveryObjectSha256: storedRecovery.compressedSha256,
      snapshotSha256: storedRecovery.snapshotSha256,
      storageWrites: storedRecovery.storageWrites,
      databaseWrites: 1,
    };
    if (mode === "prepare") return prepared;
    if (mode === "canary") {
      await authorizeProductionBatch({
        sql,
        policy: "escrow",
        batchId: candidate.batchId,
        confirmation,
        accountIdsSha256: actualAccountIdsSha256,
        deps,
      });
    }
    const executed = await runWithEscrowRetry({
      onAttempt: async () => {
        await assertRetentionAdvisoryLock(sql, lockSession);
      },
      revalidate: async () => {
        await assertRetentionAdvisoryLock(sql, lockSession);
      },
      execute: async () => runProductionEscrowDatabaseFunction({
        sql,
        candidate,
        recovery: storedRecovery,
        execute: true,
        confirmation: mode === "canary" ? confirmation : `GO ${candidate.batchId}`,
        canary: mode === "canary",
        automatic: mode === "automatic",
      }),
      sleep: deps.sleep,
    });
    return {
      ...prepared,
      state: executed.result?.state || "unknown",
      receipt: executed.result?.state || "unknown",
      executeAttempts: executed.attempts,
      executeRetryCount: executed.retryCount,
      executeSqlstates: executed.sqlstates,
      databaseWrites: 2,
    };
  } finally {
    if (lockSession) await releaseRetentionAdvisoryLock(sql, lockSession);
    if (ownsSql) await sql.end({ timeout: 5 });
    if (!deps.tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function runProductionArchiveCycle({
  profile,
  env,
  policy,
  mode,
  batchId = null,
  confirmation = null,
  accountIdsSha256 = null,
  recoveryObjectPath = null,
  deps = {},
  now = new Date(),
  cwd = process.cwd(),
  identity,
} = {}) {
  if (policy === "escrow") {
    if (typeof deps.escrow === "function") return deps.escrow({ profile, env, mode, batchId, confirmation, accountIdsSha256, recoveryObjectPath, identity });
    return runProductionEscrowCycle({
      profile,
      env,
      mode,
      batchId,
      confirmation,
      accountIdsSha256,
      recoveryObjectPath,
      deps,
      cwd,
      identity,
    });
  }
  let sql = deps.sql || postgres(profile.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 30 });
  const ownsSql = !deps.sql;
  let lockSession = null;
  const tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-production-automation-"));
  ensurePrivateDirectory(tempRoot);
  const moduleEnv = env;
  const storageTarget = deps.storageTarget || resolveStorageTarget("prod", moduleEnv, productionTargetOptions());
  const { storageDeps, verifyBucket } = productionStorageDeps(deps, storageTarget);
  const pruneStore = deps.pruneStore || createPruneStore(sql, storageTarget.target);
  const sourcePolicyId = PRODUCTION_POLICIES[policy];
  try {
    if (mode === "automatic") {
      const controlEnabled = identity?.control?.enabled === true || identity?.control?.enabled === "t";
      const policyEnabled = policy === "existing-30d"
        ? controlEnabled
        : identity?.policies?.some((row) => row.policy_id === sourcePolicyId
          && (row.enabled === true || row.enabled === "t"));
      if (!controlEnabled || !policyEnabled) {
        return {
          state: "disabled",
          mode,
          policy,
          policyId: sourcePolicyId,
          reason: !controlEnabled ? "production_control_disabled" : "production_policy_disabled",
          processed: 0,
        };
      }
    }
    lockSession = await acquireRetentionAdvisoryLock(sql, profile);
    if (!lockSession) return { state: "no-op", mode, policy, policyId: sourcePolicyId, reason: "advisory_lock_busy", processed: 0 };
    const identityRows = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    if (text(identityRows[0]?.system_identifier) !== profile.systemIdentifier) fail("database is not canonical Production");
    const ownRows = await sql.unsafe(PRODUCTION_OWN_BATCHES_SQL, [profile.projectRef, sourcePolicyId]);
    const cycle = findOwnCycle(ownRows, sourcePolicyId);
    if (cycle.active) {
      if (mode !== "canary") {
        fail("Production retention has an incomplete active batch; resume it through the reviewed recovery path");
      }
      const resumed = await resumeProductionCanaryBatch({
        activeRow: cycle.active,
        profile,
        env: moduleEnv,
        policy,
        mode,
        batchId,
        confirmation,
        sql,
        lockSession,
        pruneStore,
        storageTarget,
        verifyBucket,
        storageDeps,
        tempRoot,
        deps,
      });
      return { state: resumed.state, mode, policy, policyId: sourcePolicyId, ...resumed };
    }
    if (cycle.latestCompleted) {
      const completed = await pruneArchive({
        argv: ["--target", "prod", "--object-path", cycle.latestCompleted.object_path, "--confirm-sha", cycle.latestCompleted.compressed_sha256],
        env: moduleEnv,
        cwd: tempRoot,
        deps: { ...storageDeps, sql, pruneStore, storageTarget, targetOptions: productionTargetOptions(), verifyBucket, emit: false },
      });
      if (completed.state !== "already_pruned" && completed.state !== "already_cleaned") {
        fail(`completed Production cycle did not revalidate as terminal: ${completed.state}`);
      }
    }
    await verifyBucket(storageTarget);
    const outputPath = path.join(tempRoot, "archive.jsonl.gz");
    const manifestPath = path.join(tempRoot, "archive.manifest.json");
    const invocation = buildProductionExportInvocation(policy, { outputPath, manifestPath });
    const exported = await invocation.run({
      env: moduleEnv,
      cwd: tempRoot,
      now,
      deps: {
        sql,
        noCandidateIfEmpty: true,
        emit: false,
      },
    });
    if (exported.noCandidate) return { state: "no-op", mode, policy, policyId: sourcePolicyId, reason: "no_eligible_candidate", processed: 0 };
    await ensureArchiveBucket(storageTarget, storageDeps);
    const stored = await storeArchive({
      argv: ["--target", "prod", "--artifact", outputPath, "--manifest", manifestPath],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...storageDeps, sql, storageTarget, targetOptions: productionTargetOptions(), emit: false },
    });
    let row = await pruneStore.getManifest(stored.objectPath);
    if (!row) fail("stored Production archive manifest is missing");
    await pruneArchive({
      argv: ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256, "--register-proof"],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...storageDeps, sql, pruneStore, storageTarget, targetOptions: productionTargetOptions(), verifyBucket, emit: false },
    });
    row = await pruneStore.getManifest(row.object_path);
    const dry = await pruneArchive({
      argv: ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...storageDeps, sql, pruneStore, storageTarget, targetOptions: productionTargetOptions(), verifyBucket, emit: false },
    });
    if (dry.state !== "ready") fail(`Production ${policy} dry-run did not become ready: ${dry.state}`);
    const main = await downloadPrivateArchiveObject(storageTarget, row.object_path, storageDeps);
    const durable = await persistDurableRecovery(storageTarget, row, profile, dry.evidence, main.bytes, storageDeps);
    const prepared = {
      state: "prepared",
      mode,
      policy,
      policyId: sourcePolicyId,
      projectRef: profile.projectRef,
      systemIdentifier: identity?.systemIdentifier || profile.systemIdentifier,
      batchId: String(row.batch_id),
      transactions: dry.evidence.transactionCount,
      entries: dry.evidence.entryCount,
      compressedSha256: row.compressed_sha256,
      recoveryArchiveSha256: durable.recoveryArchive.sha256,
      recoveryManifestSha256: durable.recoveryManifest.sha256,
      storageWrites: 2,
      databaseWrites: 2,
    };
    if (mode === "prepare") return prepared;
    if (mode === "canary") {
      if (String(batchId) !== String(row.batch_id)) fail("exact Production canary batch does not match the selected fresh batch");
      await authorizeProductionBatch({ sql, policy, batchId, confirmation, deps });
    }
    const recoveryDir = archiveRecoveryDir(tempRoot);
    const executeArgs = ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256, "--execute", "--recovery-dir", recoveryDir];
    if (mode === "canary") executeArgs.push("--approved-batch-id", String(batchId));
    if (mode === "automatic") executeArgs.push("--automatic");
    const executed = await pruneArchive({
      argv: executeArgs,
      env: moduleEnv,
      cwd: tempRoot,
      deps: {
        ...storageDeps,
        sql,
        pruneStore,
        storageTarget,
        targetOptions: productionTargetOptions(),
        verifyBucket,
        downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
        emit: false,
      },
    });
    return { ...prepared, state: executed.state, receipt: executed.state, storageWrites: 2, databaseWrites: 3 };
  } finally {
    if (lockSession) await releaseRetentionAdvisoryLock(sql, lockSession);
    if (ownsSql) await sql.end({ timeout: 5 });
    if (!deps.tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function runProductionAutomation({
  env = process.env,
  deps = {},
  policy,
  mode,
  batchId = null,
  confirmation = null,
  accountIdsSha256 = null,
  recoveryObjectPath = null,
  cwd = process.cwd(),
} = {}) {
  const selectedPolicy = policyKey(policy);
  if (!PRODUCTION_MODES.includes(mode)) fail("Production mode must be diagnostic, prepare, canary, or automatic");
  const profile = deps.profile || validateRetentionEnvironment("production", env, { requireCommitSha: true });
  if (selectedPolicy === "escrow") assertProductionEscrowProfile(profile);
  const sourcePolicyId = PRODUCTION_POLICIES[selectedPolicy];
  if (mode === "automatic" && !profile.automationEnabled) {
    return { state: "disabled", mode, policy: selectedPolicy, policyId: sourcePolicyId, processed: 0 };
  }
  requireCanaryAuthorization({
    mode,
    env,
    batchId,
    confirmation,
    accountIdsSha256,
    recoveryObjectPath,
    policy: selectedPolicy,
  });
  requireAutomaticAuthorization({ env, mode });

  const read = deps.read || (({ profile: activeProfile }) => readProductionState({ profile: activeProfile, deps }));
  const execute = deps.execute || (({ profile: activeProfile, identity: activeIdentity }) => runProductionArchiveCycle({
    profile: activeProfile,
    env,
    policy: selectedPolicy,
    mode,
    batchId,
    confirmation,
    deps,
    cwd,
    accountIdsSha256,
    recoveryObjectPath,
    identity: activeIdentity,
  }));
  const prepare = deps.prepare || (({ profile: activeProfile, identity: activeIdentity }) => runProductionArchiveCycle({
    profile: activeProfile,
    env,
    policy: selectedPolicy,
    mode: "prepare",
    deps,
    cwd,
    accountIdsSha256,
    recoveryObjectPath,
    identity: activeIdentity,
  }));

  const cycle = await runRetentionCycle({
    target: "production",
    env,
    mode,
    policyId: sourcePolicyId,
    deps: { ...deps, profile, read, prepare, execute },
    automatic: mode === "automatic",
  });
  const result = {
    ...cycle,
    mode,
    policy: selectedPolicy,
    policyId: sourcePolicyId,
    projectRef: profile.projectRef,
    systemIdentifier: profile.systemIdentifier,
    maxTransactions: 2,
    accountIdsSha256: accountIdsSha256 || null,
    recoveryObjectPath: recoveryObjectPath || null,
  };
  klog("chips_ledger_production_automation", result);
  return result;
}

export function buildProductionExportInvocation(policy, { outputPath, manifestPath }) {
  const selectedPolicy = policyKey(policy);
  if (!outputPath || !manifestPath) fail("Production export requires private output and manifest paths");
  const archivePolicyId = archivePolicyIdFor(selectedPolicy);
  return {
    policy: selectedPolicy,
    policyId: PRODUCTION_POLICIES[selectedPolicy],
    archivePolicyId,
    selector: selectorForPolicy(selectedPolicy),
    schemaVersion: selectedPolicy === "bot-only-7d" || selectedPolicy === "escrow" ? BOT_ONLY_EXPORT_SCHEMA_VERSION : 1,
    argv: productionExportArgs(selectedPolicy, outputPath, manifestPath),
    run: (deps = {}) => runExport({
      argv: productionExportArgs(selectedPolicy, outputPath, manifestPath),
      ...deps,
      deps: {
        ...(deps.deps || {}),
        targetOptions: { singleTarget: true, ...(deps.deps?.targetOptions || {}) },
        selector: selectorForPolicy(selectedPolicy),
        schemaVersion: selectedPolicy === "bot-only-7d" || selectedPolicy === "escrow" ? BOT_ONLY_EXPORT_SCHEMA_VERSION : 1,
        sourcePolicyId: archivePolicyId,
      },
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseProductionAutomationArgs();
  if (args.help) {
    process.stdout.write("Usage: node scripts/ops/chips-ledger-production-automation.mjs --policy <existing-30d|bot-only-7d|closed-human-30d|escrow> --mode <diagnostic|prepare|canary|automatic>\n");
  } else {
    runProductionAutomation({ ...args }).catch((error) => {
      process.stderr.write(`chips-ledger-production-automation failed: ${error?.message || error}\n`);
      process.exitCode = 1;
    });
  }
}
