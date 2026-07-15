const normalizeContribution = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
  return Math.floor(num);
};

const normalizeContributions = ({ contributionsByUserId, participantUserIds, eligibleUserIds }) => {
  const userIds = Array.isArray(participantUserIds) ? participantUserIds : eligibleUserIds;
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const source = contributionsByUserId && typeof contributionsByUserId === "object"
    ? contributionsByUserId
    : {};
  return userIds.map((userId) => ({
    userId,
    contribution: normalizeContribution(source[userId]),
  }));
};

const buildSidePots = ({ contributionsByUserId, participantUserIds, eligibleUserIds }) => {
  if (!Array.isArray(eligibleUserIds) || eligibleUserIds.length === 0) return [];
  const normalized = normalizeContributions({ contributionsByUserId, participantUserIds, eligibleUserIds });
  const eligibleUserIdSet = new Set(eligibleUserIds);
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
        eligibleUserIds: participants.filter((userId) => eligibleUserIdSet.has(userId)),
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
