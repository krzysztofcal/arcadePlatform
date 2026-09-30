import test from "node:test";
import assert from "node:assert/strict";
import {
  refillIdempotencyKey,
  refillPool,
  resolveRefillAuthorization,
  runRefill,
  utcBucketStart,
} from "./poker-bot-pool-refill.mjs";

function fakeTx({
  balance = 0,
  consumed = null,
  systemIdentifier = "7656985631720456337",
  clock = () => "2026-09-27T07:00:00.000Z",
  onQuery = async () => {},
} = {}) {
  const calls = [];
  return {
    calls,
    async unsafe(query, params = []) {
      calls.push({ query: String(query), params });
      const text = String(query).toLowerCase();
      await onQuery(text, params);
      if (text.includes("pg_control_system")) return [{ system_identifier: systemIdentifier }];
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

function transactionalRefillDb({
  policies = [policy],
  systemIdentifier = "7656985631720456337",
  now = "2026-09-27T07:00:00.000Z",
  balances = {},
  beforeQuery = async () => {},
  beforePost = async () => {},
} = {}) {
  const state = {
    policies,
    systemIdentifier,
    now,
    balances: new Map(Object.entries(balances)),
    committed: new Map(),
    transactionCount: 0,
    committedTransactions: 0,
    rolledBackTransactions: 0,
    postCount: 0,
    nextTransactionId: 0,
  };
  const pendingByTx = new WeakMap();

  async function beginSqlFn(callback) {
    state.transactionCount += 1;
    const pending = [];
    const tx = {
      async unsafe(query, params = []) {
        const text = String(query).toLowerCase();
        await beforeQuery({ state, text, params, tx });
        if (text.includes("pg_control_system")) return [{ system_identifier: state.systemIdentifier }];
        if (text.includes("clock_timestamp()")) return [{ now: state.now }];
        if (text.includes("poker_bot_tier_policy")) {
          if (params.length) {
            return state.policies.filter((row) => Number(row.buy_in) === Number(params[0])
              && (!text.includes("enabled = true") || row.enabled === true));
          }
          return state.policies.filter((row) => !text.includes("enabled = true") || row.enabled === true);
        }
        if (text.includes("chips_transactions") && text.includes("poker_pool_refill")) {
          const committed = state.committed.get(`${params[0]}:${params[1]}`);
          return committed ? [committed] : [];
        }
        if (text.includes("chips_accounts") && text.includes("system_key = 'genesis'")) {
          return [{ id: "genesis-account" }];
        }
        if (text.includes("chips_accounts") && text.includes("system_key = $1")) {
          return [{ id: `account:${params[0]}`, balance: state.balances.get(params[0]) ?? 0, status: "active" }];
        }
        return [];
      },
    };
    pendingByTx.set(tx, pending);
    try {
      const result = await callback(tx);
      for (const commit of pending) commit();
      state.committedTransactions += 1;
      return result;
    } catch (error) {
      state.rolledBackTransactions += 1;
      throw error;
    }
  }

  async function postTransactionFn(payload) {
    state.postCount += 1;
    await beforePost({ state, payload });
    const transaction = {
      id: `tx-${state.nextTransactionId += 1}`,
      reference: payload.reference,
    };
    const metadata = payload.metadata;
    pendingByTx.get(payload.tx).push(() => {
      state.committed.set(`${metadata.bankrollSystemKey}:${metadata.bucket}`, {
        id: transaction.id,
        idempotency_key: payload.idempotencyKey,
        metadata,
      });
      state.balances.set(metadata.bankrollSystemKey,
        (state.balances.get(metadata.bankrollSystemKey) ?? 0) + payload.entries[1].amount);
    });
    return { transaction };
  }

  return { state, beginSqlFn, postTransactionFn };
}

function authorizedStageMutateEnv(overrides = {}) {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  return {
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/ops/refill-test",
    GITHUB_SHA: sha,
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: sha,
    POKER_BOT_REFILL_CHECKED_SHA: sha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    ...overrides,
  };
}

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

test("owner-gated Stage canary accepts only the dispatched exact SHA", () => {
  const reviewedSha = "0123456789abcdef0123456789abcdef01234567";
  const authorized = resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_STAGE_CANARY: "1",
    POKER_BOT_REFILL_POOL_CLASS: "NORMAL",
  });
  assert.equal(authorized.stageCanary, true);
  assert.equal(authorized.poolClass, "NORMAL");
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "other-user",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_STAGE_CANARY: "1",
    POKER_BOT_REFILL_POOL_CLASS: "NORMAL",
  }), { code: "refill_actor_not_allowed" });
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_STAGE_CANARY: "1",
    POKER_BOT_REFILL_POOL_CLASS: "NORMAL",
    POKER_BOT_REFILL_PRODUCTION_GO: "1",
  }), { code: "refill_stage_canary_scope_invalid" });
  const authorizedSlow = resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_STAGE_CANARY: "1",
    POKER_BOT_REFILL_POOL_CLASS: "SLOW",
    POKER_BOT_REFILL_BUY_IN: "500",
  });
  assert.equal(authorizedSlow.stageCanary, true);
  assert.equal(authorizedSlow.poolClass, "SLOW");
  assert.equal(authorizedSlow.buyIn, 500);

  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_STAGE_CANARY: "1",
    POKER_BOT_REFILL_POOL_CLASS: "OTHER",
  }), { code: "refill_pool_class_invalid" });

  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_STAGE_CANARY: "1",
    POKER_BOT_REFILL_POOL_CLASS: "",
  }), { code: "refill_stage_canary_pool_class_invalid" });

  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/docs/issue-1018-bot-quarantine",
    GITHUB_SHA: reviewedSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: reviewedSha,
    POKER_BOT_REFILL_CHECKED_SHA: reviewedSha,
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_STAGE_CANARY: "1",
    POKER_BOT_REFILL_POOL_CLASS: "SLOW",
    POKER_BOT_REFILL_BUY_IN: "250",
  }), { code: "refill_buy_in_invalid" });
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

test("runRefill fails closed when the current bucket expires while acquiring a pool policy lock", async () => {
  const db = transactionalRefillDb({
    now: "2026-09-27T08:59:59.000Z",
    beforeQuery: async ({ state, text }) => {
      if (text.includes("poker_bot_tier_policy") && text.includes("for share")) state.now = "2026-09-27T09:00:00.000Z";
    },
  });
  const result = await runRefill({
    env: { POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main" },
    beginSqlFn: db.beginSqlFn,
    postTransactionFn: db.postTransactionFn,
  });
  assert.equal(result.failed, true);
  assert.equal(result.outcomes[0].status, "failed");
  assert.equal(result.outcomes[0].errorCode, "refill_bucket_expired");
  assert.equal(db.state.postCount, 0);
});

test("Production identity mismatch fails both dry-run and mutate before refill SQL or ledger writes", async () => {
  const checkedSha = "0123456789abcdef0123456789abcdef01234567";
  const identityQuery = "select system_identifier::text as system_identifier from pg_catalog.pg_control_system();";
  for (const mode of ["dry-run", "mutate"]) {
    const queries = [];
    let posts = 0;
    const tx = {
      async unsafe(query) {
        queries.push(String(query));
        if (String(query).toLowerCase().includes("pg_control_system")) {
          return [{ system_identifier: "7656985631720456337" }];
        }
        return [];
      },
    };
    const env = {
      GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
      GITHUB_REPOSITORY_OWNER: "krzysztofcal",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: checkedSha,
      GITHUB_ACTOR: "krzysztofcal",
      POKER_BOT_REFILL_REVIEWED_REF: "main",
      POKER_BOT_REFILL_CHECKED_SHA: checkedSha,
      POKER_BOT_REFILL_TARGET: "production",
      POKER_BOT_REFILL_MODE: mode,
      POKER_BOT_REFILL_FEATURE_ENABLED: "1",
      POKER_BOT_REFILL_PRODUCTION_GO: "1",
      POKER_BOT_REFILL_OPERATION: "initial-seed-all",
      POKER_BOT_REFILL_INITIAL_SEED_CONFIRMATION: checkedSha,
    };
    await assert.rejects(runRefill({
      env,
      beginSqlFn: async (callback) => callback(tx),
      postTransactionFn: async () => { posts += 1; },
    }), { code: "refill_database_identity_mismatch" });
    assert.deepEqual(queries, [identityQuery]);
    assert.equal(posts, 0);
  }
});

test("runRefill accepts the matching Stage and Production PostgreSQL identities", async () => {
  for (const [target, systemIdentifier] of [
    ["stage", "7656985631720456337"],
    ["production", "7575202818581710058"],
  ]) {
    const queries = [];
    const tx = {
      async unsafe(query) {
        queries.push(String(query));
        const text = String(query).toLowerCase();
        if (text.includes("pg_control_system")) return [{ system_identifier: systemIdentifier }];
        if (text.includes("clock_timestamp()")) return [{ now: "2026-09-27T07:00:00.000Z" }];
        return [];
      },
    };
    const result = await runRefill({
      env: {
        GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
        GITHUB_REF: "refs/heads/main",
        POKER_BOT_REFILL_REVIEWED_REF: "main",
        POKER_BOT_REFILL_TARGET: target,
        POKER_BOT_REFILL_MODE: "dry-run",
      },
      beginSqlFn: async (callback) => callback(tx),
    });
    assert.equal(result.authorization.target, target);
    assert.match(queries[0], /pg_control_system/);
  }
});

test("runRefill filters by buyIn when configured", async () => {
  const policies = [
    { buy_in: 100, enabled: true, normal_refill_threshold_ch: 100, normal_refill_amount_ch: 50, slow_refill_threshold_ch: 80, slow_refill_amount_ch: 25, revision: 1 },
    { buy_in: 500, enabled: true, normal_refill_threshold_ch: 500, normal_refill_amount_ch: 250, slow_refill_threshold_ch: 400, slow_refill_amount_ch: 200, revision: 1 }
  ];
  const tx = {
    async unsafe(query, params = []) {
      const text = String(query).toLowerCase();
      if (text.includes("pg_control_system")) return [{ system_identifier: "7656985631720456337" }];
      if (text.includes("clock_timestamp()")) return [{ now: "2026-09-27T07:00:00.000Z" }];
      if (text.includes("poker_bot_tier_policy")) {
        return params.length
          ? policies.filter((row) => Number(row.buy_in) === Number(params[0]) && (!text.includes("enabled = true") || row.enabled === true))
          : policies.filter((row) => !text.includes("enabled = true") || row.enabled === true);
      }
      if (text.includes("chips_transactions") && text.includes("poker_pool_refill")) return [];
      if (text.includes("chips_accounts") && text.includes("system_key = $1")) return [{ id: "pool", balance: 0, status: "active" }];
      return [];
    }
  };
  const processedBuyIns = [];
  const result = await runRefill({
    env: {
      POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main",
      POKER_BOT_REFILL_POOL_CLASS: "SLOW",
      POKER_BOT_REFILL_BUY_IN: "500"
    },
    beginSqlFn: async (callback) => callback(tx),
    postTransactionFn: async (payload) => {
      processedBuyIns.push(payload.metadata.buyIn);
      return { transaction: { id: "tx-buyin" } };
    }
  });
  assert.equal(result.authorization.buyIn, 500);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].poolKey, "POKER_BOT_SLOW_BANKROLL_500");
  assert.equal(result.outcomes[0].status, "would_refill");
});

test("runRefill bounds each pool in its own transaction", async () => {
  const policies = [
    policy,
    { ...policy, buy_in: 500, normal_refill_threshold_ch: 500, normal_refill_amount_ch: 250 },
  ];
  const db = transactionalRefillDb({ policies });
  const result = await runRefill({
    env: {
      POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main",
      POKER_BOT_REFILL_POOL_CLASS: "NORMAL",
    },
    beginSqlFn: db.beginSqlFn,
    postTransactionFn: db.postTransactionFn,
  });

  assert.equal(db.state.transactionCount, 3, "one discovery transaction plus one transaction per pool");
  assert.equal(db.state.committedTransactions, 3);
  assert.deepEqual(result.outcomes.map(({ status }) => status), ["would_refill", "would_refill"]);
});

test("a failed pool leaves prior commits intact, later pools proceed, and rerun safely completes only the failed pool", async () => {
  const policies = [
    policy,
    { ...policy, buy_in: 500, normal_refill_threshold_ch: 500, normal_refill_amount_ch: 250 },
    { ...policy, buy_in: 5000, normal_refill_threshold_ch: 5000, normal_refill_amount_ch: 2500 },
  ];
  let fail500Once = true;
  const db = transactionalRefillDb({
    policies,
    beforePost: async ({ payload }) => {
      if (payload.metadata.buyIn === 500 && fail500Once) {
        fail500Once = false;
        const error = new Error("injected independent pool failure");
        error.code = "injected_pool_failure";
        throw error;
      }
    },
  });
  const env = authorizedStageMutateEnv({
    POKER_BOT_REFILL_POOL_CLASS: "NORMAL",
  });
  const first = await runRefill({ env, beginSqlFn: db.beginSqlFn, postTransactionFn: db.postTransactionFn });
  assert.equal(first.failed, true);
  assert.deepEqual(first.outcomes.map(({ status }) => status), ["refilled", "failed", "refilled"]);
  assert.equal(first.outcomes[1].errorCode, "injected_pool_failure");
  assert.equal(db.state.committed.size, 2, "successful pools on both sides of the failure committed independently");
  assert.equal(db.state.balances.get(first.outcomes[0].poolKey), 50);
  assert.equal(db.state.balances.get("POKER_BOT_BANKROLL") ?? 0, 0);
  assert.equal(db.state.balances.get(first.outcomes[2].poolKey), 2500);

  const rerun = await runRefill({ env, beginSqlFn: db.beginSqlFn, postTransactionFn: db.postTransactionFn });
  assert.equal(rerun.failed, false);
  assert.deepEqual(rerun.outcomes.map(({ status }) => status), ["replay", "refilled", "replay"]);
  assert.equal(db.state.committed.size, 3);
  assert.equal(db.state.postCount, 4, "already committed pools are never posted again");
  assert.equal(db.state.balances.get(rerun.outcomes[0].poolKey), 50);
  assert.equal(db.state.balances.get("POKER_BOT_BANKROLL"), 250);
  assert.equal(db.state.balances.get(rerun.outcomes[2].poolKey), 2500);
});

test("runRefill fails closed when a per-pool transaction exceeds 60 seconds or crosses its bucket", async () => {
  for (const [initialTime, nextTime, expectedCode] of [
    ["2026-09-27T07:00:00.000Z", "2026-09-27T07:01:00.001Z", "refill_transaction_expired"],
    ["2026-09-27T08:59:59.000Z", "2026-09-27T09:00:00.000Z", "refill_bucket_expired"],
  ]) {
    const db = transactionalRefillDb({
      policies: [policy],
      now: initialTime,
      beforeQuery: async ({ state, text }) => {
        if (text.includes("poker_bot_tier_policy") && text.includes("for share")) state.now = nextTime;
      },
    });
    const result = await runRefill({
      env: {
        POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main",
        POKER_BOT_REFILL_POOL_CLASS: "NORMAL",
      },
      beginSqlFn: db.beginSqlFn,
      postTransactionFn: db.postTransactionFn,
    });
    assert.equal(result.failed, true);
    assert.equal(result.outcomes[0].status, "failed");
    assert.equal(result.outcomes[0].errorCode, expectedCode);
    assert.equal(db.state.postCount, 0);
    assert.equal(db.state.committed.size, 0);
  }
});

test("canonical buy-in filter accepts all 11 canonical tiers and rejects non-canonical", () => {
  for (const buyIn of [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000]) {
    const auth = resolveRefillAuthorization({
      GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
      POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main",
      POKER_BOT_REFILL_BUY_IN: String(buyIn),
    });
    assert.equal(auth.buyIn, buyIn);
  }
  for (const invalid of [250, 750, 1200, 99999, 100000000]) {
    assert.throws(() => resolveRefillAuthorization({
      GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
      POKER_BOT_REFILL_REVIEWED_REF: "refs/heads/main",
      POKER_BOT_REFILL_BUY_IN: String(invalid),
    }), { code: "refill_buy_in_invalid" });
  }
});

test("initial-seed-all authorization strictly gates Production seeding", () => {
  const mainSha = "0123456789abcdef0123456789abcdef01234567";

  // Dry-run mode on production: accepted
  const dryRunAuth = resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REF: "refs/heads/main",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
    POKER_BOT_REFILL_MODE: "dry-run",
  });
  assert.equal(dryRunAuth.initialSeedAll, true);
  assert.equal(dryRunAuth.dryRun, true);

  // Initial-seed-all target must be production
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REF: "refs/heads/main",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_TARGET: "stage",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
  }), { code: "refill_initial_seed_production_only" });

  // Dispatcher is strictly forbidden for initial-seed-all
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: "arcade-poker-refill-dispatch",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
  }), { code: "refill_initial_seed_dispatcher_forbidden" });

  // Ref must be main
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REF: "refs/heads/feature-branch",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
  }), { code: "refill_main_ref_required" });

  // Mutate mode requires owner actor
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: mainSha,
    GITHUB_ACTOR: "unauthorized-user",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_CHECKED_SHA: mainSha,
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_PRODUCTION_GO: "1",
    POKER_BOT_REFILL_INITIAL_SEED_CONFIRMATION: mainSha,
  }), { code: "refill_initial_seed_owner_required" });

  // Mutate mode requires checked SHA
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: mainSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_CHECKED_SHA: "wrong-sha",
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_PRODUCTION_GO: "1",
    POKER_BOT_REFILL_INITIAL_SEED_CONFIRMATION: mainSha,
  }), { code: "refill_checked_sha_mismatch" });

  // Mutate mode requires production GO
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: mainSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_CHECKED_SHA: mainSha,
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_INITIAL_SEED_CONFIRMATION: mainSha,
  }), { code: "refill_production_go_required" });

  // Mutate mode requires confirmation matching GITHUB_SHA
  assert.throws(() => resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: mainSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_CHECKED_SHA: mainSha,
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_PRODUCTION_GO: "1",
    POKER_BOT_REFILL_INITIAL_SEED_CONFIRMATION: "wrong-confirmation-sha",
  }), { code: "refill_initial_seed_confirmation_required" });

  // Mutate mode succeeds with all owner gates
  const mutateAuth = resolveRefillAuthorization({
    GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REPOSITORY_OWNER: "krzysztofcal",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: mainSha,
    GITHUB_ACTOR: "krzysztofcal",
    POKER_BOT_REFILL_REVIEWED_REF: "main",
    POKER_BOT_REFILL_CHECKED_SHA: mainSha,
    POKER_BOT_REFILL_TARGET: "production",
    POKER_BOT_REFILL_FEATURE_ENABLED: "1",
    POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
    POKER_BOT_REFILL_MODE: "mutate",
    POKER_BOT_REFILL_PRODUCTION_GO: "1",
    POKER_BOT_REFILL_INITIAL_SEED_CONFIRMATION: mainSha,
  });
  assert.equal(mutateAuth.initialSeedAll, true);
  assert.equal(mutateAuth.dryRun, false);
});

test("runRefill with initial-seed-all seeds disabled tiers without enabling them", async () => {
  const policies = [
    { buy_in: 1000, enabled: false, normal_refill_threshold_ch: 10000, normal_refill_amount_ch: 20000, slow_refill_threshold_ch: 4000, slow_refill_amount_ch: 10000, revision: 1 }
  ];
  let queriedWhere = null;
  const tx = {
    async unsafe(query, params = []) {
      const text = String(query).toLowerCase();
      if (text.includes("pg_control_system")) return [{ system_identifier: "7575202818581710058" }];
      if (text.includes("clock_timestamp()")) return [{ now: "2026-09-27T07:00:00.000Z" }];
      if (text.includes("poker_bot_tier_policy")) {
        queriedWhere = text;
        return policies;
      }
      if (text.includes("chips_transactions") && text.includes("poker_pool_refill")) return [];
      if (text.includes("chips_accounts") && text.includes("system_key = $1")) return [{ id: "pool", balance: 0, status: "active" }];
      return [];
    }
  };
  const result = await runRefill({
    env: {
      GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
      GITHUB_REF: "refs/heads/main",
      POKER_BOT_REFILL_REVIEWED_REF: "main",
      POKER_BOT_REFILL_TARGET: "production",
      POKER_BOT_REFILL_INITIAL_SEED_ALL: "1",
      POKER_BOT_REFILL_MODE: "dry-run",
      POKER_BOT_REFILL_BUY_IN: "1000",
      POKER_BOT_REFILL_POOL_CLASS: "NORMAL",
    },
    beginSqlFn: async (callback) => callback(tx),
  });
  assert.equal(queriedWhere.includes("where enabled = true"), false);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].poolKey, "POKER_BOT_BANKROLL_1000");
  assert.equal(result.outcomes[0].status, "would_refill");
  assert.equal(result.outcomes[0].amount, 20000);
});
