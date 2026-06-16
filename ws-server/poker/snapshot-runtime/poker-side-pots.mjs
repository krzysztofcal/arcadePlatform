const normalizeContribution = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  return Math.floor(num);
};

const normalizeContributions = ({ contributionsByUserId, eligibleUserIds }) => {
  if (!Array.isArray(eligibleUserIds) || eligibleUserIds.length === 0) return [];
  const source = contributionsByUserId && typeof contributionsByUserId === "object"
    ? contributionsByUserId
    : {};
  return eligibleUserIds.map((userId) => ({
    userId,
    contribution: normalizeContribution(source[userId]),
  }));
};

const buildSidePots = ({ contributionsByUserId, eligibleUserIds }) => {
  if (!Array.isArray(eligibleUserIds) || eligibleUserIds.length === 0) return [];
  const normalized = normalizeContributions({ contributionsByUserId, eligibleUserIds });
  const levels = [...new Set(normalized.map(({ contribution }) => contribution).filter((value) => value > 0))]
    .sort((a, b) => a - b);
  if (levels.length === 0) return [];
  const pots = [];
  let prev = 0;
  levels.forEach((level) => {
    const participants = normalized
      .filter(({ contribution }) => contribution >= level)
      .map(({ userId }) => userId);
    const delta = level - prev;
    const amount = delta * participants.length;
    if (amount > 0) {
      pots.push({
        amount,
        eligibleUserIds: participants,
        minContribution: prev,
        maxContribution: level,
      });
    }
    prev = level;
  });
  return pots;
};

export {
  buildSidePots,
  normalizeContributions,
};
