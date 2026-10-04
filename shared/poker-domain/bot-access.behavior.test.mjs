import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SLOW_THRESHOLD_CH,
  DEFAULT_SLOW_HYSTERESIS_BPS,
  MIN_SLOW_HYSTERESIS_BPS,
  MAX_SLOW_HYSTERESIS_BPS,
  DEFAULT_SLOW_RECOVERY_THRESHOLD_CH,
  deriveSlowRecoveryThresholdCh,
  deriveAccessState,
  applyAutomaticThresholdEvidence,
  normalizeAccessClass,
  resolveEffectiveClass,
  normalizePolicySnapshot,
  isFreshPolicySnapshot,
  classifySettledAccessEvidence,
  readPokerTierPolicySnapshot,
  resolvePokerEnabledBuyIns,
} from "./bot-access.mjs";

test("FORCE_* overrides prevent automatic threshold mutations to durable class (Finding 1)", () => {
  const entry = DEFAULT_SLOW_THRESHOLD_CH; // 1_000_000_000
  const recovery = DEFAULT_SLOW_RECOVERY_THRESHOLD_CH; // 950_000_000

  // 1. FORCE_NORMAL + evidence above entry:
  // - automatic class unchanged (NORMAL)
  // - effective NORMAL
  // - changed = false
  const forceNormalAboveEntry = applyAutomaticThresholdEvidence({
    automaticClass: "NORMAL",
    override: "FORCE_NORMAL",
    evidenceCh: entry + 500,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(forceNormalAboveEntry.automaticClass, "NORMAL");
  assert.equal(forceNormalAboveEntry.override, "FORCE_NORMAL");
  assert.equal(forceNormalAboveEntry.effectiveClass, "NORMAL");
  assert.equal(forceNormalAboveEntry.changed, false);

  // 2. FORCE_SLOW + evidence below recovery:
  // - automatic class unchanged (SLOW)
  // - effective SLOW
  // - changed = false
  const forceSlowBelowRecovery = applyAutomaticThresholdEvidence({
    automaticClass: "SLOW",
    override: "FORCE_SLOW",
    evidenceCh: recovery - 500,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
    allowRecovery: true,
  });
  assert.equal(forceSlowBelowRecovery.automaticClass, "SLOW");
  assert.equal(forceSlowBelowRecovery.override, "FORCE_SLOW");
  assert.equal(forceSlowBelowRecovery.effectiveClass, "SLOW");
  assert.equal(forceSlowBelowRecovery.changed, false);

  // 3. FORCE_RESTRICTED + any threshold evidence:
  // - automatic class unchanged
  // - effective RESTRICTED
  // - changed = false
  for (const evidence of [entry + 1000, recovery - 1000, 950_000_000]) {
    const forceRestricted = applyAutomaticThresholdEvidence({
      automaticClass: "NORMAL",
      override: "FORCE_RESTRICTED",
      evidenceCh: evidence,
      slowThresholdCh: entry,
      slowRecoveryThresholdCh: recovery,
    });
    assert.equal(forceRestricted.automaticClass, "NORMAL");
    assert.equal(forceRestricted.override, "FORCE_RESTRICTED");
    assert.equal(forceRestricted.effectiveClass, "RESTRICTED");
    assert.equal(forceRestricted.changed, false);
  }

  // 4. Returning to AUTO:
  // the next authoritative evidence check may then transition automatic class normally
  const returnedToAutoEntry = applyAutomaticThresholdEvidence({
    automaticClass: forceNormalAboveEntry.automaticClass, // still NORMAL
    override: "AUTO",
    evidenceCh: entry + 500,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
  });
  assert.equal(returnedToAutoEntry.automaticClass, "SLOW");
  assert.equal(returnedToAutoEntry.override, "AUTO");
  assert.equal(returnedToAutoEntry.effectiveClass, "SLOW");
  assert.equal(returnedToAutoEntry.changed, true);

  const returnedToAutoRecovery = applyAutomaticThresholdEvidence({
    automaticClass: forceSlowBelowRecovery.automaticClass, // still SLOW
    override: "AUTO",
    evidenceCh: recovery - 500,
    slowThresholdCh: entry,
    slowRecoveryThresholdCh: recovery,
    allowRecovery: true,
  });
  assert.equal(returnedToAutoRecovery.automaticClass, "NORMAL");
  assert.equal(returnedToAutoRecovery.override, "AUTO");
  assert.equal(returnedToAutoRecovery.effectiveClass, "NORMAL");
  assert.equal(returnedToAutoRecovery.changed, true);
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
    slowHysteresisBps: 500,
    slowRecoveryThresholdCh: 950_000_000,
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
    slowRecoveryThresholdCh: DEFAULT_SLOW_RECOVERY_THRESHOLD_CH,
  });
  assert.equal(classified.automaticClass, "NORMAL");
  assert.equal(classified.effectiveClass, "RESTRICTED");
  assert.equal(classified.changed, false);

  const returnedToAuto = deriveAccessState({ automaticClass: classified.automaticClass, override: "AUTO" });
  assert.equal(returnedToAuto.effectiveClass, "NORMAL");

  const autoClassified = applyAutomaticThresholdEvidence({
    automaticClass: returnedToAuto.automaticClass,
    override: "AUTO",
    evidenceCh: DEFAULT_SLOW_THRESHOLD_CH,
    slowThresholdCh: DEFAULT_SLOW_THRESHOLD_CH,
    slowRecoveryThresholdCh: DEFAULT_SLOW_RECOVERY_THRESHOLD_CH,
  });
  assert.equal(autoClassified.automaticClass, "SLOW");
  assert.equal(autoClassified.effectiveClass, "SLOW");
  assert.equal(autoClassified.changed, true);
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
      slowHysteresisBps: 2000,
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

test("schema-backed policy missing slowRecoveryThresholdCh or slowHysteresisBps is rejected / treated unknown rather than synthesized (T061/T066)", () => {
  // normalizePolicySnapshot returns null if slowRecoveryThresholdCh or slowHysteresisBps is missing
  assert.equal(normalizePolicySnapshot({
    slow_threshold_ch: 1_000_000_000,
    revision: 1,
    loadedAtMs: 1000,
  }), null);

  assert.equal(normalizePolicySnapshot({
    slowThresholdCh: 2000,
    slowRecoveryThresholdCh: 1900,
    revision: 1,
    loadedAtMs: 1000,
  }), null);

  assert.equal(normalizePolicySnapshot({
    slowThresholdCh: 2000,
    slowHysteresisBps: 500,
    revision: 1,
    loadedAtMs: 1000,
  }), null);

  // isFreshPolicySnapshot returns false if slowRecoveryThresholdCh or slowHysteresisBps is missing
  assert.equal(isFreshPolicySnapshot({
    slowThresholdCh: 1_000_000_000,
    revision: 1,
    expiresAtMs: Date.now() + 30_000,
  }), false);

  assert.equal(isFreshPolicySnapshot({
    slowThresholdCh: 1_000_000_000,
    slowRecoveryThresholdCh: 950_000_000,
    revision: 1,
    expiresAtMs: Date.now() + 30_000,
  }), false);

  // classifySettledAccessEvidence returns access_cache_unknown if recovery threshold is missing
  const res = classifySettledAccessEvidence({
    snapshot: {
      automaticClass: "NORMAL",
      override: "AUTO",
      effectiveClass: "NORMAL",
      revision: 1,
      expiresAtMs: Date.now() + 30_000,
    },
    settledStackCh: 500,
    policy: {
      slowThresholdCh: 1_000_000_000,
      revision: 1,
      expiresAtMs: Date.now() + 30_000,
    },
    nowMs: Date.now(),
  });
  assert.equal(res.known, false);
  assert.equal(res.reason, "access_cache_unknown");
});

test("custom thresholds entry=2000 and bps=2500 (25%) derive recovery=1500 and normalize without synthesizing (T061/T066)", () => {
  const normalized = normalizePolicySnapshot({
    slow_threshold_ch: 2000,
    slow_hysteresis_bps: 2500,
    slow_recovery_threshold_ch: 1500,
    revision: 3,
    loadedAtMs: 100,
  });
  assert.equal(normalized.slowThresholdCh, 2000);
  assert.equal(normalized.slowHysteresisBps, 2500);
  assert.equal(normalized.slowRecoveryThresholdCh, 1500);

  assert.equal(isFreshPolicySnapshot(normalized, 100), true);

  const res = classifySettledAccessEvidence({
    snapshot: {
      automaticClass: "NORMAL",
      override: "AUTO",
      effectiveClass: "NORMAL",
      revision: 1,
      expiresAtMs: 100000,
    },
    settledStackCh: 2500,
    policy: normalized,
    nowMs: 200,
  });
  assert.equal(res.known, true);
  assert.equal(res.slowThresholdCh, 2000);
  assert.equal(res.slowHysteresisBps, 2500);
  assert.equal(res.slowRecoveryThresholdCh, 1500);
  assert.equal(res.automaticClass, "SLOW");
  assert.equal(res.changed, true);
});

test("deriveSlowRecoveryThresholdCh adheres strictly to deterministic integer derivation contract (T066)", () => {
  // Required examples from specification
  assert.equal(deriveSlowRecoveryThresholdCh(1_000_000_000, 500), 950_000_000);
  assert.equal(deriveSlowRecoveryThresholdCh(2000, 500), 1900);
  assert.equal(deriveSlowRecoveryThresholdCh(10000, 500), 9500);

  // Boundary bps: 100 bps (1%) and 5000 bps (50%)
  assert.equal(deriveSlowRecoveryThresholdCh(10000, 100), 9900);
  assert.equal(deriveSlowRecoveryThresholdCh(10000, 5000), 5000);

  // Fractional floor check
  // 1999 * (10000 - 500) / 10000 = 1999 * 9500 / 10000 = 18990500 / 10000 = 1899.05 -> floor 1899
  assert.equal(deriveSlowRecoveryThresholdCh(1999, 500), 1899);

  // Out of range bps
  assert.equal(deriveSlowRecoveryThresholdCh(10000, 99), null);
  assert.equal(deriveSlowRecoveryThresholdCh(10000, 5001), null);
  assert.equal(deriveSlowRecoveryThresholdCh(10000, 0), null);
  assert.equal(deriveSlowRecoveryThresholdCh(10000, -500), null);
  assert.equal(deriveSlowRecoveryThresholdCh(10000, 500.5), null);

  // Invalid / non-positive entry thresholds
  assert.equal(deriveSlowRecoveryThresholdCh(0, 500), null);
  assert.equal(deriveSlowRecoveryThresholdCh(-100, 500), null);
  assert.equal(deriveSlowRecoveryThresholdCh(null, 500), null);
  assert.equal(deriveSlowRecoveryThresholdCh(undefined, 500), null);
  assert.equal(deriveSlowRecoveryThresholdCh("1000", 500), null);
  assert.equal(deriveSlowRecoveryThresholdCh(1000.5, 500), null);

  // Derived recovery <= 0 (e.g. entry = 1 with 5000 bps -> floor(1 * 5000 / 10000) = 0)
  assert.equal(deriveSlowRecoveryThresholdCh(1, 5000), null);

  // Safe integer bounds
  assert.equal(deriveSlowRecoveryThresholdCh(Number.MAX_SAFE_INTEGER + 1, 500), null);
});

test("schema-backed inconsistent entry/bps/recovery tuple treated UNKNOWN / fail-closed (T067)", () => {
  // Inconsistent recovery (900M when 1B with 500 bps should be 950M)
  const inconsistentRow = {
    slow_threshold_ch: 1_000_000_000,
    slow_hysteresis_bps: 500,
    slow_recovery_threshold_ch: 900_000_000,
    revision: 1,
    loadedAtMs: 100,
  };
  assert.equal(normalizePolicySnapshot(inconsistentRow), null);

  const inconsistentSnapshot = {
    slowThresholdCh: 1_000_000_000,
    slowHysteresisBps: 500,
    slowRecoveryThresholdCh: 900_000_000,
    revision: 1,
    expiresAtMs: Date.now() + 60_000,
  };
  assert.equal(isFreshPolicySnapshot(inconsistentSnapshot), false);

  const res = classifySettledAccessEvidence({
    snapshot: {
      automaticClass: "NORMAL",
      override: "AUTO",
      effectiveClass: "NORMAL",
      revision: 1,
      expiresAtMs: Date.now() + 60_000,
    },
    settledStackCh: 500,
    policy: inconsistentSnapshot,
    nowMs: Date.now(),
  });
  assert.equal(res.known, false);
  assert.equal(res.reason, "access_cache_unknown");
});

test("AUTO/SLOW user under low threshold recovers to AUTO/NORMAL on next fresh wallet JOIN check when operator raises entry threshold without manual user repair (T070)", () => {
  // 1. Initial operator configuration: entry = 2000, hysteresis = 5% (500 bps) -> recovery = 1900
  const initialPolicy = normalizePolicySnapshot({
    slow_threshold_ch: 2000,
    slow_hysteresis_bps: 500,
    slow_recovery_threshold_ch: 1900,
    revision: 1,
    loadedAtMs: 1000,
  });
  assert.notEqual(initialPolicy, null);
  assert.equal(initialPolicy.slowRecoveryThresholdCh, 1900);

  // User has wallet balance 5000 CH (>= 2000 entry) -> classified SLOW
  const userInitial = applyAutomaticThresholdEvidence({
    automaticClass: "NORMAL",
    override: "AUTO",
    evidenceCh: 5000,
    slowThresholdCh: initialPolicy.slowThresholdCh,
    slowRecoveryThresholdCh: initialPolicy.slowRecoveryThresholdCh,
    allowRecovery: true,
  });
  assert.equal(userInitial.automaticClass, "SLOW");
  assert.equal(userInitial.effectiveClass, "SLOW");
  assert.equal(userInitial.changed, true);

  // 2. Operator raises entry threshold: entry = 10000, hysteresis = 5% (500 bps) -> recovery = 9500
  const updatedPolicy = normalizePolicySnapshot({
    slow_threshold_ch: 10000,
    slow_hysteresis_bps: 500,
    slow_recovery_threshold_ch: 9500,
    revision: 2,
    loadedAtMs: 2000,
  });
  assert.notEqual(updatedPolicy, null);
  assert.equal(updatedPolicy.slowRecoveryThresholdCh, 9500);

  // 3. User joins table next time with fresh authoritative wallet balance = 5000 CH
  // Under updated policy: 5000 < 9500 (derived recovery threshold)
  // User automatically recovers from SLOW -> NORMAL without any manual user repair!
  const userRecovered = applyAutomaticThresholdEvidence({
    automaticClass: userInitial.automaticClass, // currently SLOW
    override: "AUTO",
    evidenceCh: 5000,
    slowThresholdCh: updatedPolicy.slowThresholdCh,
    slowRecoveryThresholdCh: updatedPolicy.slowRecoveryThresholdCh,
    allowRecovery: true,
  });
  assert.equal(userRecovered.automaticClass, "NORMAL");
  assert.equal(userRecovered.effectiveClass, "NORMAL");
  assert.equal(userRecovered.changed, true);
});



test("tier activation snapshot batches the catalog once per transaction and changes on refresh", async () => {
  let enabled = true;
  let queries = 0;
  const transaction = () => ({ unsafe: async (sql, params) => {
    queries += 1;
    if (sql.includes("to_regclass")) return [{ available: true }];
    if (sql.includes("poker_bot_tier_policy")) return [100, 500, 1000, 5000, 200, 10000].map((buy_in) => ({
      buy_in, enabled: buy_in <= 1000 && (buy_in !== 1000 || enabled), revision: buy_in === 10000 ? 0 : enabled ? 1 : 2,
      normal_refill_threshold_ch: 1, normal_refill_amount_ch: 10,
      slow_refill_threshold_ch: 1, slow_refill_amount_ch: 10
    }));
    if (sql.includes("system_key = any")) return params[0].map((system_key) => ({ system_key }));
    throw new Error("unexpected query");
  } });
  const tx = transaction();
  const snapshot = await readPokerTierPolicySnapshot(tx, { nowMs: 0 });
  assert.equal(await readPokerTierPolicySnapshot(tx, { nowMs: 1 }), snapshot);
  assert.equal(queries, 3);
  assert.deepEqual(resolvePokerEnabledBuyIns(snapshot, [100, 500, 1000, 5000, 200], 25_000), [100, 500, 1000]);
  assert.equal(snapshot.tiers[200], undefined);
  assert.equal(snapshot.tiers[10000], undefined);
  assert.deepEqual(resolvePokerEnabledBuyIns(snapshot, undefined, 30_001), []);
  enabled = false;
  const refreshed = await readPokerTierPolicySnapshot(transaction(), { nowMs: 25_000 });
  assert.deepEqual(resolvePokerEnabledBuyIns(refreshed, undefined, 25_001), [100, 500]);
  assert.equal(refreshed.tiers[1000].revision, 2);
  assert.equal(queries, 6);
});

test("tier activation requires trusted fresh policy and both exact provisioned pools", async () => {
  for (const snapshot of [null, { schemaBacked: false, expiresAtMs: 30_000 },
    { schemaBacked: true, expiresAtMs: 30_000, tiers: {} }]) {
    assert.deepEqual(resolvePokerEnabledBuyIns(snapshot, [100, 500], 0), []);
  }
  const snapshot = { schemaBacked: true, expiresAtMs: 30_000, tiers: {
    500: { enabled: true, provisioned: { NORMAL: true, SLOW: false } }
  } };
  assert.deepEqual(resolvePokerEnabledBuyIns(snapshot, [100, 500], 0), []);
  snapshot.tiers[500].provisioned.SLOW = true;
  assert.deepEqual(resolvePokerEnabledBuyIns(snapshot, [100, 500], 0), [500]);
  snapshot.tiers[500].enabled = false;
  assert.deepEqual(resolvePokerEnabledBuyIns(snapshot, [100, 500], 0), []);
});
