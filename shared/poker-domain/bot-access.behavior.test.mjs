import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SLOW_THRESHOLD_CH,
  DEFAULT_SLOW_RECOVERY_THRESHOLD_CH,
  deriveAccessState,
  applyAutomaticThresholdEvidence,
  normalizeAccessClass,
  resolveEffectiveClass,
} from "./bot-access.mjs";

test("FORCE_NORMAL changes only effective class while automatic SLOW persists", () => {
  const initial = deriveAccessState({ automaticClass: "NORMAL", override: "AUTO" });
  assert.deepEqual(initial, {
    automaticClass: "NORMAL",
    override: "AUTO",
    effectiveClass: "NORMAL",
  });

  const forced = deriveAccessState({ automaticClass: initial.automaticClass, override: "FORCE_NORMAL" });
  assert.equal(forced.effectiveClass, "NORMAL");

  const classified = applyAutomaticThresholdEvidence({
    automaticClass: forced.automaticClass,
    override: forced.override,
    evidenceCh: DEFAULT_SLOW_THRESHOLD_CH,
    slowThresholdCh: DEFAULT_SLOW_THRESHOLD_CH,
  });
  assert.equal(classified.automaticClass, "SLOW");
  assert.equal(classified.effectiveClass, "NORMAL");

  const returnedToAuto = deriveAccessState({
    automaticClass: classified.automaticClass,
    override: "AUTO",
  });
  assert.equal(returnedToAuto.effectiveClass, "SLOW");
  assert.equal(resolveEffectiveClass("SLOW", "FORCE_NORMAL"), "NORMAL");
});

test("automatic classification follows hysteresis contract (T059)", () => {
  const entry = DEFAULT_SLOW_THRESHOLD_CH; // 1_000_000_000
  const recovery = DEFAULT_SLOW_RECOVERY_THRESHOLD_CH; // 900_000_000

  // 1. NORMAL at entry - 1 stays NORMAL
  const normalBelowEntry = applyAutomaticThresholdEvidence({
    automaticClass: "NORMAL",
    override: "AUTO",
    evidenceCh: entry - 1,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(normalBelowEntry.automaticClass, "NORMAL");
  assert.equal(normalBelowEntry.effectiveClass, "NORMAL");
  assert.equal(normalBelowEntry.changed, false);

  // 2. NORMAL at entry becomes SLOW
  const normalAtEntry = applyAutomaticThresholdEvidence({
    automaticClass: "NORMAL",
    override: "AUTO",
    evidenceCh: entry,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(normalAtEntry.automaticClass, "SLOW");
  assert.equal(normalAtEntry.effectiveClass, "SLOW");
  assert.equal(normalAtEntry.changed, true);

  // 3. SLOW wallet at recovery stays SLOW (equality with recovery remains SLOW)
  const slowAtRecovery = applyAutomaticThresholdEvidence({
    automaticClass: "SLOW",
    override: "AUTO",
    evidenceCh: recovery,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(slowAtRecovery.automaticClass, "SLOW");
  assert.equal(slowAtRecovery.effectiveClass, "SLOW");
  assert.equal(slowAtRecovery.changed, false);

  // 4. SLOW wallet at recovery - 1 becomes NORMAL
  const slowBelowRecovery = applyAutomaticThresholdEvidence({
    automaticClass: "SLOW",
    override: "AUTO",
    evidenceCh: recovery - 1,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(slowBelowRecovery.automaticClass, "NORMAL");
  assert.equal(slowBelowRecovery.effectiveClass, "NORMAL");
  assert.equal(slowBelowRecovery.changed, true);

  // 5. Both classes retain their state inside the hysteresis band [recovery, entry)
  const midpoint = Math.floor((recovery + entry) / 2);
  const normalInBand = applyAutomaticThresholdEvidence({
    automaticClass: "NORMAL",
    override: "AUTO",
    evidenceCh: midpoint,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(normalInBand.automaticClass, "NORMAL");
  assert.equal(normalInBand.changed, false);

  const slowInBand = applyAutomaticThresholdEvidence({
    automaticClass: "SLOW",
    override: "AUTO",
    evidenceCh: midpoint,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(slowInBand.automaticClass, "SLOW");
  assert.equal(slowInBand.changed, false);
});

test("settled table stack can promote NORMAL->SLOW but cannot downgrade SLOW->NORMAL (T060)", async () => {
  const { classifySettledAccessEvidence } = await import("./bot-access.mjs");
  const policy = {
    slowThresholdCh: 1_000_000_000,
    slowRecoveryThresholdCh: 900_000_000,
    revision: 1,
    loadedAtMs: Date.now(),
    expiresAtMs: Date.now() + 30_000,
  };
  const normalSnapshot = {
    automaticClass: "NORMAL",
    override: "AUTO",
    effectiveClass: "NORMAL",
    revision: 1,
    loadedAtMs: Date.now(),
    expiresAtMs: Date.now() + 30_000,
  };
  const slowSnapshot = {
    automaticClass: "SLOW",
    override: "AUTO",
    effectiveClass: "SLOW",
    revision: 1,
    loadedAtMs: Date.now(),
    expiresAtMs: Date.now() + 30_000,
  };

  // 6. High settled stack can promote NORMAL->SLOW
  const promoted = classifySettledAccessEvidence({
    snapshot: normalSnapshot,
    settledStackCh: 1_000_000_000,
    policy,
  });
  assert.equal(promoted.known, true);
  assert.equal(promoted.automaticClass, "SLOW");
  assert.equal(promoted.effectiveClass, "SLOW");
  assert.equal(promoted.changed, true);

  // 7. Low settled stack cannot downgrade SLOW->NORMAL
  const notDowngraded = classifySettledAccessEvidence({
    snapshot: slowSnapshot,
    settledStackCh: 100, // Very low stack on this table
    policy,
  });
  assert.equal(notDowngraded.known, true);
  assert.equal(notDowngraded.automaticClass, "SLOW");
  assert.equal(notDowngraded.effectiveClass, "SLOW");
  assert.equal(notDowngraded.changed, false);
});

test("FORCE_RESTRICTED is effective-only and never an automatic class", () => {
  assert.equal(normalizeAccessClass("RESTRICTED"), null);

  const forced = deriveAccessState({ automaticClass: "NORMAL", override: "FORCE_RESTRICTED" });
  assert.equal(forced.automaticClass, "NORMAL");
  assert.equal(forced.effectiveClass, "RESTRICTED");

  const classified = applyAutomaticThresholdEvidence({
    automaticClass: forced.automaticClass,
    override: forced.override,
    evidenceCh: DEFAULT_SLOW_THRESHOLD_CH,
    slowThresholdCh: DEFAULT_SLOW_THRESHOLD_CH,
  });
  assert.equal(classified.automaticClass, "SLOW");
  assert.equal(classified.effectiveClass, "RESTRICTED");

  const returnedToAuto = deriveAccessState({ automaticClass: classified.automaticClass, override: "AUTO" });
  assert.equal(returnedToAuto.effectiveClass, "SLOW");
});

test("pre-migration capability uses legacy access, rechecks next transaction, and propagates database errors", async () => {
  const { hasPokerPoolSchema, readPokerAccessSnapshot, readPokerAccessPolicy } = await import("./bot-access.mjs");
  const queries = [];
  const legacy = { unsafe: async (query) => {
    queries.push(query);
    assert.match(query, /to_regclass/);
    return [{ available: false }];
  } };
  assert.equal(await hasPokerPoolSchema(legacy), false);
  assert.equal((await readPokerAccessSnapshot(legacy, { userId: "user" })).effectiveClass, "NORMAL");
  assert.equal((await readPokerAccessPolicy(legacy)).schemaBacked, false);
  assert.equal(queries.length, 1, "one capability probe per transaction, no absent-column query");
  assert.equal(await hasPokerPoolSchema({ unsafe: async () => [{ available: true }] }), true);
  const denied = Object.assign(new Error("permission denied for poker_access_policy"), { code: "42501" });
  await assert.rejects(hasPokerPoolSchema({ unsafe: async () => { throw denied; } }), (error) => error === denied);
});


test("schema-backed access never turns missing data or unrelated SQL errors into legacy NORMAL", async () => {
  const { readPokerAccessSnapshot } = await import("./bot-access.mjs");
  assert.equal(await readPokerAccessSnapshot({ unsafe: async (query) => query.includes("to_regclass") ? [{ available: true }] : [] }, { userId: "user" }), null);
  for (const code of ["42501", "42703", "08006"]) {
    const failure = Object.assign(new Error("poker access read failed"), { code });
    await assert.rejects(readPokerAccessSnapshot({ unsafe: async (query) => {
      if (query.includes("to_regclass")) return [{ available: true }];
      throw failure;
    } }, { userId: "user" }), (error) => error === failure);
  }
});

test("persistAutomaticTransition supports reversible transitions with exact single write and revision bump (T062)", async () => {
  const { persistAutomaticTransition } = await import("./bot-access.mjs");
  const executedSql = [];

  // NORMAL -> SLOW transition
  const mockTxSlow = {
    unsafe: async (sql, params) => {
      executedSql.push({ sql, params });
      return [{
        poker_auto_class: "SLOW",
        poker_access_override: "AUTO",
        poker_access_revision: 2,
        poker_auto_slow_at: "2026-09-29T12:00:00.000Z",
      }];
    }
  };
  const toSlow = await persistAutomaticTransition(mockTxSlow, {
    userId: "00000000-0000-4000-8000-000000000001",
    targetClass: "SLOW",
    expectedRevision: 1,
  });
  assert.equal(toSlow.changed, true);
  assert.equal(toSlow.snapshot.automaticClass, "SLOW");
  assert.equal(toSlow.snapshot.revision, 2);
  assert.match(executedSql[0].sql, /set poker_auto_class = 'SLOW'/);
  assert.match(executedSql[0].sql, /poker_auto_slow_at = coalesce\(poker_auto_slow_at/);
  assert.match(executedSql[0].sql, /poker_access_revision = poker_access_revision \+ 1/);
  assert.match(executedSql[0].sql, /and poker_auto_class = 'NORMAL'/);
  assert.match(executedSql[0].sql, /and poker_access_revision = \$2/);

  // SLOW -> NORMAL transition (recovery)
  const mockTxNormal = {
    unsafe: async (sql, params) => {
      executedSql.push({ sql, params });
      return [{
        poker_auto_class: "NORMAL",
        poker_access_override: "AUTO",
        poker_access_revision: 3,
        poker_auto_slow_at: "2026-09-29T12:00:00.000Z", // preserved historical metadata
      }];
    }
  };
  const toNormal = await persistAutomaticTransition(mockTxNormal, {
    userId: "00000000-0000-4000-8000-000000000001",
    targetClass: "NORMAL",
    expectedRevision: 2,
  });
  assert.equal(toNormal.changed, true);
  assert.equal(toNormal.snapshot.automaticClass, "NORMAL");
  assert.equal(toNormal.snapshot.revision, 3);
  assert.match(executedSql[1].sql, /set poker_auto_class = 'NORMAL'/);
  assert.doesNotMatch(executedSql[1].sql, /poker_auto_slow_at = coalesce/); // not overwritten on recovery
  assert.match(executedSql[1].sql, /poker_access_revision = poker_access_revision \+ 1/);
  assert.match(executedSql[1].sql, /and poker_auto_class = 'SLOW'/);

  // No rows updated (e.g. revision conflict or already in target class) => changed: false
  const mockTxConflict = {
    unsafe: async () => []
  };
  const noChange = await persistAutomaticTransition(mockTxConflict, {
    userId: "00000000-0000-4000-8000-000000000001",
    targetClass: "SLOW",
    expectedRevision: 99,
  });
  assert.equal(noChange.changed, false);
});

test("classifySettledAccessEvidence performs pure in-memory calculation with zero DB queries or global scans (T060)", async () => {
  const { classifySettledAccessEvidence } = await import("./bot-access.mjs");
  // Passes pure in-memory data, proves zero async / zero DB query
  const res = classifySettledAccessEvidence({
    snapshot: {
      automaticClass: "SLOW",
      override: "AUTO",
      effectiveClass: "SLOW",
      revision: 5,
      loadedAtMs: 1000,
      expiresAtMs: 50000,
    },
    settledStackCh: 50,
    policy: {
      slowThresholdCh: 1000,
      slowRecoveryThresholdCh: 800,
      revision: 2,
      loadedAtMs: 1000,
      expiresAtMs: 50000,
    },
    nowMs: 2000,
  });
  assert.equal(res.known, true);
  assert.equal(res.automaticClass, "SLOW"); // settled stack < recovery cannot downgrade
  assert.equal(res.changed, false);
});

