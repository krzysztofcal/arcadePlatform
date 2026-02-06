const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const patchLeftTableByUserId = (state, userId, value = false) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { nextState: state, changed: false };
  if (typeof userId !== "string" || !userId.trim()) return { nextState: state, changed: false };
  const map = isPlainObject(state.leftTableByUserId) ? state.leftTableByUserId : {};
  const nextValue = !!value;
  if (!!map[userId] === nextValue) {
    return { nextState: state, changed: false };
  }
  const nextMap = { ...map, [userId]: nextValue };
  return { nextState: { ...state, leftTableByUserId: nextMap }, changed: true };
};

export { patchLeftTableByUserId };
