const DEFAULT_BASE_XP = 100;
const DEFAULT_MULTIPLIER = 1.35;

function finitePositive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function computeXpLevel(totalXp, options = {}) {
  const total = Math.max(0, Math.floor(Number(totalXp) || 0));
  const baseXp = finitePositive(options.baseXp, DEFAULT_BASE_XP);
  const multiplier = finitePositive(options.multiplier, DEFAULT_MULTIPLIER);
  let level = 1;
  let requirement = baseXp;
  let accumulated = 0;
  while (total >= accumulated + requirement) {
    accumulated += requirement;
    level += 1;
    requirement = Math.max(1, Math.ceil(requirement * multiplier));
  }
  return level;
}

export { DEFAULT_BASE_XP, DEFAULT_MULTIPLIER };
