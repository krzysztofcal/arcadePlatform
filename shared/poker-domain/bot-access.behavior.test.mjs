import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SLOW_THRESHOLD_CH,
  deriveAccessState,
  applyAutomaticThresholdEvidence,
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
