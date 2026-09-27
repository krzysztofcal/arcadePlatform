import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SLOW_THRESHOLD_CH,
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

test("threshold evidence is inclusive and does not downgrade sticky automatic SLOW", () => {
  assert.equal(applyAutomaticThresholdEvidence({
    automaticClass: "NORMAL",
    override: "AUTO",
    evidenceCh: DEFAULT_SLOW_THRESHOLD_CH - 1,
    slowThresholdCh: DEFAULT_SLOW_THRESHOLD_CH,
  }).automaticClass, "NORMAL");
  assert.equal(applyAutomaticThresholdEvidence({
    automaticClass: "NORMAL",
    override: "AUTO",
    evidenceCh: DEFAULT_SLOW_THRESHOLD_CH,
    slowThresholdCh: DEFAULT_SLOW_THRESHOLD_CH,
  }).automaticClass, "SLOW");
  assert.equal(applyAutomaticThresholdEvidence({
    automaticClass: "SLOW",
    override: "FORCE_NORMAL",
    evidenceCh: 0,
    slowThresholdCh: DEFAULT_SLOW_THRESHOLD_CH,
  }).automaticClass, "SLOW");
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
