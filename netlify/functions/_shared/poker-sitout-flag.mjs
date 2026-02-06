const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const patchSitOutByUserId = (state, userId, value = false) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { nextState: state, changed: false };
  if (typeof userId !== "string" || !userId.trim()) return { nextState: state, changed: false };
  const map = isPlainObject(state.sitOutByUserId) ? state.sitOutByUserId : {};
  const nextValue = !!value;
  if (!!map[userId] === nextValue) {
    return { nextState: state, changed: false };
  }
  const nextMap = { ...map, [userId]: nextValue };
  return { nextState: { ...state, sitOutByUserId: nextMap }, changed: true };
};

export { patchSitOutByUserId };
