const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const patchMissedTurnsByUserId = (state, userId, nextValue) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { nextState: state, changed: false };
  if (typeof userId !== "string" || !userId.trim()) return { nextState: state, changed: false };
  const map = isPlainObject(state.missedTurnsByUserId) ? state.missedTurnsByUserId : {};
  const hasKey = Object.prototype.hasOwnProperty.call(map, userId);

  if (nextValue === undefined) {
    if (!hasKey) return { nextState: state, changed: false };
    const nextMap = { ...map };
    delete nextMap[userId];
    return { nextState: { ...state, missedTurnsByUserId: nextMap }, changed: true };
  }

  const normalized = Number.isFinite(nextValue) ? Math.trunc(nextValue) : nextValue;
  if (hasKey && map[userId] === normalized) return { nextState: state, changed: false };
  return { nextState: { ...state, missedTurnsByUserId: { ...map, [userId]: normalized } }, changed: true };
};

const clearMissedTurns = (state, userId) => patchMissedTurnsByUserId(state, userId, undefined);

const clearInactivityPenalty = (state, userId) => {
  const cleared = clearMissedTurns(state, userId);
  let nextState = cleared.nextState;
  let changed = cleared.changed;
  for (const key of ["pendingAutoSitOutByUserId", "sitOutByUserId"]) {
    if (!isPlainObject(nextState?.[key]) || !Object.prototype.hasOwnProperty.call(nextState[key], userId)) continue;
    const map = { ...nextState[key] };
    delete map[userId];
    nextState = { ...nextState, [key]: map };
    changed = true;
  }
  return { nextState, changed };
};

export { clearMissedTurns, patchMissedTurnsByUserId, clearInactivityPenalty };
