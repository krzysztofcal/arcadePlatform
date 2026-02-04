const normalizeSeconds = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
};

const resetTurnTimer = (state, nowMs, turnSeconds) => {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const seconds = normalizeSeconds(turnSeconds, 20);
  return {
    ...state,
    turnStartedAt: now,
    turnDeadlineAt: now + seconds * 1000,
  };
};

export { resetTurnTimer };
