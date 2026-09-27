import test from "node:test";
import assert from "node:assert/strict";
import {
  refillIdempotencyKey,
  refillPool,
  resolveRefillAuthorization,
  runRefill,
  utcBucketStart,
} from "./poker-bot-pool-refill.mjs";

function fakeTx({ balance = 0, consumed = null, clock = () => "2026-09-27T07:00:00.000Z", onQuery = async () => {} } = {}) {
  const calls = [];
  return {
    calls,
    async unsafe(query, params = []) {
      calls.push({ query: String(query), params });
      const text = String(query).toLowerCase();
      await onQuery(text, params);
      if (text.includes("clock_timestamp()")) return [{ now: clock() }];
      if (text.includes("chips_transactions") && text.includes("poker_pool_refill")) return consumed ? [consumed] : [];
      if (text.includes("chips_accounts") && text.includes("system_key = $1")) {
        return [{ id: "pool", balance, status: "active" }];
      }
      return [];
    },
  };
}

const policy = {
  buy_in: 100,
  enabled: true,
  normal_refill_threshold_ch: 100,
  normal_refill_amount_ch: 50,
  slow_refill_threshold_ch: 80,
  slow_refill_amount_ch: 25,
  revision: 3,
};

test("refill uses the current UTC three-hour bucket and one configured amount", async () => {
  const now = new Date("2026-09-27T07:59:00.000Z");
  assert.equal(utcBucketStart(now), "2026-09-27T06:00:00.000Z");
  assert.equal(refillIdempotencyKey({
    bankrollSystemKey: "POKER_BOT_BANKROLL_100",
    policyRevision: 3,
    bucket: "2026-09-27T06:00:00.000Z",
  }), "poker-pool-refill:POKER_BOT_BANKROLL_100:3:2026-09-27T06:00:00.000Z");
  const tx = fakeTx({ balance: 0 });
  let posts = 0;
  const outcome = await refillPool({
    tx,
    policy,
    poolClass: "NORMAL",
    now,
    dryRun: false,
    postTransactionFn: async (payload) => {
      posts += 1;
      assert.equal(payload.trustedScheduledRefill, true);
      assert.equal(payload.entries[1].systemKey, "POKER_BOT_BANKROLL_100");
      assert.equal(payload.entries[1].amount, 50);
      return { transaction: { id: "refill-1" } };
    },
  });
  assert.equal(outcome.status, "refilled");
  assert.equal(posts, 1);
});

test("refill is a no-op at threshold and a replay across policy revisions", async () => {
  const now = new Date("2026-09-27T07:00:00.000Z");
  const atThreshold = await refillPool({ tx: fakeTx({ balance: 100 }), policy, poolClass: "NORMAL", now, dryRun: false });
  assert.equal(atThreshold.status, "no_op");
  const replay = await refillPool({
    tx: fakeTx({ balance: 0, consumed: { id: "old-refill", idempotency_key: "old-key" } }),
    policy: { ...policy, revision: 4 },
    poolClass: "NORMAL",
    now,
    dryRun: false,
  });
  assert.equal(replay.status, "replay");
});

test("mutation authorization cannot be supplied by arbitrary workflow inputs", () => {
  assert.equal(resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main",
    POKER_BOT_REFILL_MODE: "dry-run",
  }).dryRun, true);
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main",
    POKER_BOT_REFILL_MODE: "mutate",
  }), { code: "refill_feature_disabled" });
});

test("Stage mutation requires the exact checked reviewed commit", () => {
  const reviewedSha = "0123456789abcdef0123456789abcdef01234567";
  const authorized = resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
  });
  assert.equal(authorized.dryRun, false);
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98",
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
  }), { code: "refill_stage_reviewed_sha_required" });
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: "fedcba9876543210fedcba9876543210fedcba98",
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
  }), { code: "refill_checked_sha_mismatch" });
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98",
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
  }), { code: "refill_dispatch_sha_mismatch" });
});

test("Production mutation remains main-only and cannot target a PR SHA", () => {
  const mainSha = "0123456789abcdef0123456789abcdef01234567";
  const authorized = resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: mainSha,
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_CHECKED_SHA: mainSha,
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_PRODUCTION_GO: "1",
  });
  assert.equal(authorized.target, "production");
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: mainSha,
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: mainSha,
    POKER_BOT_REFILL_CHECKED_SHA: mainSha,
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_PRODUCTION_GO: "1",
  }), { code: "refill_production_ref_required" });
});

for (const lock of ["pg_advisory_xact_lock", "system_key = 'genesis'", "system_key = $1"]) {
  test(`refill skips an old bucket after waiting on ${lock}`, async () => {
    let dbNow = "2026-09-27T08:59:59.000Z";
    let posts = 0;
    const tx = fakeTx({
      clock: () => dbNow,
      onQuery: async (query) => {
        // Deterministic lock-release barrier: the DB clock advances while waiting.
        if (query.includes(lock)) dbNow = "2026-09-27T09:00:00.000Z";
      },
    });
    const outcome = await refillPool({
      tx, policy, poolClass: "NORMAL", dryRun: false,
      now: new Date("2026-09-27T08:59:59.000Z"),
      bucket: "2026-09-27T06:00:00.000Z",
      postTransactionFn: async () => { posts += 1; },
    });
    assert.equal(outcome.status, "stale_bucket");
    assert.equal(posts, 0);
  });
}

test("refill uses the database clock even when the runner clock is skewed", async () => {
  const result = await refillPool({
    tx: fakeTx(), policy, poolClass: "NORMAL", dryRun: false,
    now: new Date("2020-01-01T00:00:00Z"),
    postTransactionFn: async ({ metadata }) => {
      assert.equal(metadata.bucket, "2026-09-27T06:00:00.000Z");
      return { transaction: { id: "db-clock" } };
    },
  });
  assert.equal(result.status, "refilled");
});

test("refill aborts its transaction when a later ledger wait crosses the boundary", async () => {
  let dbNow = "2026-09-27T08:59:59.000Z";
  await assert.rejects(refillPool({
    tx: fakeTx({ clock: () => dbNow }), policy, poolClass: "NORMAL", dryRun: false,
    postTransactionFn: async () => { dbNow = "2026-09-27T09:00:00.000Z"; },
  }), { code: "refill_bucket_expired" });
});

test("runRefill rolls back a bucket that expires while acquiring policy locks", async () => {
  let dbNow = "2026-09-27T08:59:59.000Z";
  let posts = 0;
  const tx = fakeTx({
    clock: () => dbNow,
    onQuery: async (query) => {
      if (query.includes("for share")) dbNow = "2026-09-27T09:00:00.000Z";
    },
  });
  await assert.rejects(runRefill({
    env: { POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main" },
    beginSqlFn: async (callback) => callback(tx),
    postTransactionFn: async () => { posts += 1; },
  }), { code: "refill_bucket_expired" });
  assert.equal(posts, 0);
});
