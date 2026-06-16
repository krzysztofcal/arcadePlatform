export function resolveSettledRevealDueAt({ settledAt, nowMs, revealMs }) {
  const normalizedNowMs = Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
  const normalizedRevealMs = Number.isFinite(revealMs) && revealMs >= 0 ? Math.trunc(revealMs) : 0;
  const settledAtMs = Date.parse(settledAt || "");
  const baseMs = Number.isFinite(settledAtMs) ? settledAtMs : normalizedNowMs;
  return baseMs + normalizedRevealMs;
}
