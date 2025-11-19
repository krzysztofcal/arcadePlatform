(function (window) {
  const COMBO_CAP = 20;
  const COMBO_SUSTAIN_MS = 5_000;
  const COMBO_COOLDOWN_MS = 3_000;

  function computeComboStepThreshold(multiplier) {
    const stage = Math.max(1, Math.floor(Number(multiplier) || 1));
    if (stage >= COMBO_CAP) return 1;
    const base = 1 + Math.floor((stage - 1) / 3);
    return Math.max(1, Math.min(5, base));
  }

  function createComboState() {
    return {
      mode: 'build',
      multiplier: 1,
      points: 0,
      stepThreshold: computeComboStepThreshold(1),
      sustainLeftMs: 0,
      cooldownLeftMs: 0,
      cap: COMBO_CAP,
    };
  }

  function normalizeCombo(raw) {
    const combo = raw && typeof raw === 'object' ? raw : {};
    combo.cap = COMBO_CAP;
    if (combo.mode !== 'sustain' && combo.mode !== 'cooldown') {
      combo.mode = 'build';
    }
    combo.multiplier = Math.max(1, Math.min(combo.cap, Math.floor(Number(combo.multiplier) || 1)));
    combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
    combo.points = Math.max(0, Math.min(combo.stepThreshold, Number(combo.points) || 0));
    combo.sustainLeftMs = Math.max(0, Math.min(COMBO_SUSTAIN_MS, Number(combo.sustainLeftMs) || 0));
    combo.cooldownLeftMs = Math.max(0, Math.min(COMBO_COOLDOWN_MS, Number(combo.cooldownLeftMs) || 0));

    if (combo.multiplier >= combo.cap) {
      combo.multiplier = combo.cap;
      combo.points = 0;
      if (combo.mode === 'build') {
        combo.mode = combo.sustainLeftMs > 0 ? 'sustain' : 'cooldown';
      }
    }

    if (combo.mode === 'sustain') {
      combo.multiplier = combo.cap;
      if (combo.sustainLeftMs <= 0) {
        combo.mode = 'cooldown';
        combo.cooldownLeftMs = Math.max(combo.cooldownLeftMs, COMBO_COOLDOWN_MS);
        combo.sustainLeftMs = 0;
      }
      combo.points = 0;
    }

    if (combo.mode === 'cooldown') {
      combo.multiplier = 1;
      combo.points = 0;
      combo.sustainLeftMs = 0;
      if (combo.cooldownLeftMs <= 0) {
        combo.mode = 'build';
      }
    }

    if (combo.mode === 'build') {
      combo.sustainLeftMs = 0;
      combo.cooldownLeftMs = 0;
      combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
      combo.points = Math.max(0, Math.min(combo.stepThreshold, combo.points));
    }

    return combo;
  }

  function snapshotCombo(raw) {
    const combo = normalizeCombo(raw);
    return {
      mode: combo.mode,
      multiplier: combo.multiplier,
      points: combo.points,
      stepThreshold: combo.stepThreshold,
      sustainLeftMs: combo.sustainLeftMs,
      cooldownLeftMs: combo.cooldownLeftMs,
      cap: combo.cap,
    };
  }

  function computeComboProgress(combo) {
    if (!combo || typeof combo !== 'object') return 0;
    if (combo.mode === 'sustain') {
      if (COMBO_SUSTAIN_MS <= 0) return 0;
      return Math.max(0, Math.min(1, combo.sustainLeftMs / COMBO_SUSTAIN_MS));
    }
    if (combo.mode === 'cooldown') {
      return 0;
    }
    const threshold = combo.stepThreshold > 0 ? combo.stepThreshold : 1;
    return Math.max(0, Math.min(1, combo.points / threshold));
  }

  function advanceCombo(rawCombo, deltaMs, activityRatio, isActive, awardIntervalMs) {
    const combo = normalizeCombo(rawCombo);
    const elapsed = Math.max(0, Number(deltaMs) || 0);
    const ratio = Math.max(0, Math.min(1, Number(activityRatio) || 0));
    const awardInterval = Math.max(1, Math.floor(Number(awardIntervalMs) || 1));

    if (combo.mode === 'cooldown') {
      if (elapsed > 0) {
        combo.cooldownLeftMs = Math.max(0, combo.cooldownLeftMs - elapsed);
        if (combo.cooldownLeftMs <= 0) {
          combo.mode = 'build';
          combo.multiplier = 1;
          combo.points = 0;
        }
      }
      return normalizeCombo(combo);
    }

    if (combo.mode === 'sustain') {
      if (elapsed > 0) {
        combo.sustainLeftMs = Math.max(0, combo.sustainLeftMs - elapsed);
        if (combo.sustainLeftMs <= 0) {
          combo.mode = 'cooldown';
          combo.cooldownLeftMs = COMBO_COOLDOWN_MS;
          combo.multiplier = 1;
          combo.points = 0;
        }
      }
      return normalizeCombo(combo);
    }

    if (!isActive) {
      combo.points = Math.max(0, combo.points * 0.5);
      return normalizeCombo(combo);
    }

    if (ratio <= 0) {
      combo.points = 0;
      combo.multiplier = 1;
      return normalizeCombo(combo);
    }

    const scaledGain = ratio * (elapsed > 0 ? Math.max(1, elapsed / awardInterval) : 1);
    if (Number.isFinite(scaledGain) && scaledGain > 0) {
      combo.points = Math.max(0, combo.points + scaledGain);
    }

    while (combo.multiplier < combo.cap && combo.points >= combo.stepThreshold) {
      combo.points -= combo.stepThreshold;
      combo.multiplier += 1;
      combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
    }

    if (combo.multiplier >= combo.cap) {
      combo.multiplier = combo.cap;
      combo.mode = 'sustain';
      combo.sustainLeftMs = COMBO_SUSTAIN_MS;
      combo.points = 0;
    }

    return normalizeCombo(combo);
  }

  window.XpCombo = {
    constants: {
      CAP: COMBO_CAP,
      SUSTAIN_MS: COMBO_SUSTAIN_MS,
      COOLDOWN_MS: COMBO_COOLDOWN_MS,
    },
    computeStepThreshold: computeComboStepThreshold,
    createState: createComboState,
    normalize: normalizeCombo,
    snapshot: snapshotCombo,
    progress: computeComboProgress,
    advance: advanceCombo,
  };
})(typeof window !== 'undefined' ? window : this);
