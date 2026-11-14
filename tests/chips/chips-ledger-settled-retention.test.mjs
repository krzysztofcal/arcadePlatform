import assert from "node:assert/strict";
import { deletePrivateObjectIfExists } from "../../scripts/ops/chips-ledger-archive-store.mjs";
import { validateRetentionEnvironment } from "../../scripts/ops/_shared/chips-ledger-retention-profile.mjs";
import {
  archiveObjectPaths,
  parseSettledRetentionArgs,
  requireSettledRetentionAuthorization,
  runSettledRetention,
  storageTargetFor,
} from "../../scripts/ops/chips-ledger-settled-retention.mjs";

// #1157 fundamental contracts: DELETE-only Storage access, lock checked before
// each object, unmarked batch on any failure, canary/automatic gates.

const sha = (digit) => digit.repeat(64);
const storageTarget = { target: "stage", projectRef: "krydukthwdvccggbyjfw", baseUrl: "https://krydukthwdvccggbyjfw.supabase.co", serviceKey: "test-key" };

// Storage helper: one DELETE, missing is idempotent success, anything else fails.
{
  const calls = [];
  const fetch = async (url, request) => {
    calls.push([request.method, url]);
    const status = url.endsWith("missing.jsonl.gz") ? 400 : url.endsWith("broken.jsonl.gz") ? 500 : 200;
    return new Response(status === 400 ? '{"error":"not_found","message":"Object not found"}' : "{}", { status });
  };
  assert.equal(await deletePrivateObjectIfExists(storageTarget, "v1/sha256/present.jsonl.gz", { fetch }), "deleted");
  assert.equal(await deletePrivateObjectIfExists(storageTarget, "v1/sha256/missing.jsonl.gz", { fetch }), "missing");
  await assert.rejects(deletePrivateObjectIfExists(storageTarget, "v1/sha256/broken.jsonl.gz", { fetch }), /HTTP 500/);
  assert.deepEqual(calls.map(([method]) => method), ["DELETE", "DELETE", "DELETE"], "a failed DELETE is never retried");
  assert.equal(calls[0][1], "https://krydukthwdvccggbyjfw.supabase.co/storage/v1/object/chips-ledger-archive/v1/sha256/present.jsonl.gz");
}

assert.deepEqual(archiveObjectPaths({ batch_id: "7", object_path: `v1/sha256/${sha("a")}.jsonl.gz`, compressed_sha256: sha("a"),
  account_retirement_recovery_object_path: `account-recovery/v1/sha256/${sha("b")}.json.gz` }), [
  `v1/sha256/${sha("a")}.jsonl.gz`,
  `recovery/v1/sha256/${sha("a")}.jsonl.gz`,
  `recovery/v1/sha256/${sha("a")}.recovery.json.gz`,
  `account-recovery/v1/sha256/${sha("b")}.json.gz`,
]);
assert.throws(() => archiveObjectPaths({ batch_id: "7", object_path: `v1/sha256/${sha("c")}.jsonl.gz`, compressed_sha256: sha("a") }), /does not match/);

const OWNER_ENV = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform", GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY_OWNER: "krzysztofcal", GITHUB_ACTOR: "krzysztofcal", GITHUB_TRIGGERING_ACTOR: "krzysztofcal",
};
assert.throws(() => parseSettledRetentionArgs(["--target", "prod", "--mode", "diagnostic"]), /stage or production/);
assert.throws(() => requireSettledRetentionAuthorization({ target: "stage", mode: "canary", batchId: "7", confirmation: "GO 7", env: OWNER_ENV }), /EXPIRE ARCHIVE/);
assert.throws(() => requireSettledRetentionAuthorization({ target: "production", mode: "diagnostic", cutoff: "2026-11-01T00:00:00Z", env: {} }), /Stage-only/);
assert.throws(() => requireSettledRetentionAuthorization({ target: "stage", mode: "automatic", env: { ...OWNER_ENV, GITHUB_TRIGGERING_ACTOR: "someone" } }), /GITHUB_TRIGGERING_ACTOR/);
assert.doesNotThrow(() => requireSettledRetentionAuthorization({ target: "stage", mode: "diagnostic", env: {} }));

const profile = { target: "stage", label: "Stage", projectRef: "krydukthwdvccggbyjfw", systemIdentifier: "7656985631720456337",
  lockKey: "chips-ledger-stage-automation-v1:krydukthwdvccggbyjfw", automationEnabled: true };

function harness({ candidates = 2, control = true, loseLockAfterDeletes = Infinity, failDeleteOn = null, disableAfterBatches = Infinity, disableAfterDeletes = Infinity } = {}) {
  const log = [];
  const state = { control, deletes: 0, expiredBatches: 0, lockLost: false };
  const rows = Array.from({ length: candidates }, (_, index) => ({
    batch_id: String(index + 1), object_path: `v1/sha256/${sha(String(index + 1))}.jsonl.gz`,
    compressed_sha256: sha(String(index + 1)), account_retirement_recovery_object_path: null,
  }));
  const sql = {
    unsafe: async (query, values = []) => {
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: "settled" }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: state.lockLost ? "other" : "settled" }];
      if (query.includes("pg_advisory_unlock")) return [{ released: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: profile.systemIdentifier }];
      if (query.includes("chips_settled_retention_control")) return [{ enabled: state.control }];
      if (query.includes("order by b.last_created_at")) { log.push(["candidates", values[3]]); return rows.filter((row) => values[2] == null || row.batch_id === String(values[2])).slice(0, values[3]); }
      if (query.includes("sum(compressed_bytes)")) return [{ batches: values[0].length, compressed_bytes: "16" }];
      if (query.includes("chips_expire_archive_batch")) {
        const [, batchId, , execute, confirmation] = values;
        log.push([execute ? "expire" : "dry", batchId, confirmation]);
        if (!execute) return [{ result: { state: "eligible" } }];
        state.expiredBatches += 1;
        if (state.expiredBatches >= disableAfterBatches) state.control = false;
        return [{ result: { state: "expired", registry_deleted: 3 } }];
      }
      if (query.includes("chips_settled_retention_12m_run")) {
        const execute = query.includes("timestamptz, true)");
        log.push(["tables", execute, values[0]]);
        return [{ result: { state: execute ? "executed" : "diagnosed" } }];
      }
      throw new Error(`unexpected settled retention SQL: ${query}`);
    },
  };
  const deps = {
    profile, sql, storageTarget,
    verifyBucket: async () => log.push(["bucket"]),
    deleteObject: async (_target, objectPath) => {
      state.deletes += 1;
      log.push(["delete", objectPath]);
      if (state.deletes >= loseLockAfterDeletes) state.lockLost = true;
      if (state.deletes >= disableAfterDeletes) state.control = false;
      if (failDeleteOn && objectPath.includes(failDeleteOn)) throw new Error("Storage API private object delete failed with HTTP 503");
      return "deleted";
    },
  };
  return { log, state, deps };
}

// Diagnostic: aggregates only, no Storage call at all.
{
  const h = harness();
  const result = await runSettledRetention({ target: "stage", mode: "diagnostic", deps: h.deps, env: {} });
  assert.equal(result.state, "diagnosed");
  assert.equal(result.archiveBatches, 2);
  assert.equal(h.log.some(([kind]) => kind === "delete" || kind === "bucket"), false, "diagnostic never touches Storage");
}

// Automatic: dry recheck, every object deleted under the lock, then the mark; tables after archives.
{
  const h = harness();
  const result = await runSettledRetention({ target: "stage", mode: "automatic", deps: h.deps, env: OWNER_ENV });
  assert.equal(result.expired.length, 2);
  assert.deepEqual(h.log.filter(([kind]) => kind !== "delete").map(([kind]) => kind), ["candidates", "bucket", "dry", "expire", "dry", "expire", "tables"]);
  assert.equal(h.log.find(([kind]) => kind === "candidates")[1], 10, "automatic processes at most 10 batches");
  assert.equal(h.state.deletes, 6);
  assert.deepEqual(h.log.at(-1), ["tables", true, 5000], "one bounded table cleanup after the archives");
}

// Automatic is dark while the DB control is off.
{
  const h = harness({ control: false });
  assert.equal((await runSettledRetention({ target: "stage", mode: "automatic", deps: h.deps, env: OWNER_ENV })).reason, "settled_retention_control_disabled");
  assert.equal(h.state.deletes, 0);
}

// Control turned off between batches stops before the next batch and the table cleanup.
{
  const h = harness({ disableAfterBatches: 1 });
  const result = await runSettledRetention({ target: "stage", mode: "automatic", deps: h.deps, env: OWNER_ENV });
  assert.equal(result.expired.length, 1);
  assert.equal(result.tables, null);
}

// Control disabled after selection: stop before the first DELETE.
{
  const h = harness();
  h.deps.verifyBucket = async () => { h.state.control = false; };
  const result = await runSettledRetention({ target: "stage", mode: "automatic", deps: h.deps, env: OWNER_ENV });
  assert.deepEqual([result.expired.length, h.state.deletes, result.tables], [0, 0, null]);
}

// Control disabled mid-batch: no further DELETE and no mark.
{
  const h = harness({ disableAfterDeletes: 1 });
  await assert.rejects(runSettledRetention({ target: "stage", mode: "automatic", deps: h.deps, env: OWNER_ENV }), /disabled during batch 1/);
  assert.equal(h.state.deletes, 1);
  assert.equal(h.log.some(([kind]) => kind === "expire"), false);
}

// Lock lost after the first DELETE: no further DELETE and no mark.
{
  const h = harness({ loseLockAfterDeletes: 1 });
  await assert.rejects(runSettledRetention({ target: "stage", mode: "automatic", deps: h.deps, env: OWNER_ENV }), /lock session changed/);
  assert.equal(h.state.deletes, 1);
  assert.equal(h.log.some(([kind]) => kind === "expire"), false);
}

// Storage failure: the batch stays unmarked.
{
  const h = harness({ failDeleteOn: "recovery.json.gz" });
  await assert.rejects(runSettledRetention({ target: "stage", mode: "automatic", deps: h.deps, env: OWNER_ENV }), /HTTP 503/);
  assert.equal(h.log.some(([kind]) => kind === "expire"), false);
}

// Canary: exactly the confirmed batch, no table rows; any other batch is refused.
{
  const h = harness();
  const result = await runSettledRetention({ target: "stage", mode: "canary", batchId: "2", confirmation: "EXPIRE ARCHIVE 2", deps: h.deps, env: OWNER_ENV });
  assert.deepEqual(result.expired.map((row) => row.batchId), ["2"]);
  assert.deepEqual(h.log.find(([kind]) => kind === "expire"), ["expire", "2", "EXPIRE ARCHIVE 2"]);
  assert.equal(h.log.some(([kind]) => kind === "tables"), false);
  await assert.rejects(runSettledRetention({ target: "stage", mode: "canary", batchId: "9", confirmation: "EXPIRE ARCHIVE 9", deps: harness().deps, env: OWNER_ENV }), /not an eligible canary/);
}

// Real Storage target resolution from the workflow environment (T050 canary
// regression: the Stage target needs the Stage DB URL as well).
{
  const sha40 = "a".repeat(40);
  const stageEnv = {
    EXPECTED_SUPABASE_STAGE_PROJECT_REF: "krydukthwdvccggbyjfw", DEPLOYED_COMMIT_SHA: sha40,
    SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    SUPABASE_STAGE_URL: "https://krydukthwdvccggbyjfw.supabase.co", SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-key",
  };
  const stage = storageTargetFor(validateRetentionEnvironment("stage", stageEnv, { requireCommitSha: true }), stageEnv);
  assert.equal(stage.projectRef, "krydukthwdvccggbyjfw");
  assert.equal(stage.baseUrl, "https://krydukthwdvccggbyjfw.supabase.co");
  assert.equal(stage.serviceKey, "stage-key");
  const prodEnv = {
    EXPECTED_SUPABASE_PROD_PROJECT_REF: "otbqfijerkieoxwpxjnm", DEPLOYED_COMMIT_SHA: sha40,
    SUPABASE_PROD_DB_URL: "postgresql://postgres.otbqfijerkieoxwpxjnm:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    SUPABASE_PROD_URL: "https://otbqfijerkieoxwpxjnm.supabase.co", SUPABASE_PROD_SERVICE_ROLE_KEY: "prod-key",
  };
  const prod = storageTargetFor(validateRetentionEnvironment("production", prodEnv, { requireCommitSha: true }), prodEnv);
  assert.equal(prod.baseUrl, "https://otbqfijerkieoxwpxjnm.supabase.co");
  assert.equal(prod.serviceKey, "prod-key");
}

console.log("chips-ledger-settled-retention tests passed");
