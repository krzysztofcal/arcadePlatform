const normalizeMs = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
};

const resetTurnTimer = (state, nowMs, turnMs) => {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const durationMs = normalizeMs(turnMs, 20000);
  return {
    ...state,
    turnStartedAt: now,
    turnDeadlineAt: now + durationMs,
  };
};

export { resetTurnTimer };
