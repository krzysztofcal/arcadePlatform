const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isValidViewer = (viewerUserId) => typeof viewerUserId === "string" && viewerUserId.trim();

const redactShowdownForViewer = (state, { viewerUserId, activeUserIds } = {}) => {
  if (!isPlainObject(state)) return state;
  const showdown = state.showdown;
  if (!isPlainObject(showdown)) return state;
  const activeList = Array.isArray(activeUserIds) ? activeUserIds : [];
  const canReveal = isValidViewer(viewerUserId) && activeList.includes(viewerUserId);
  const revealed = canReveal && isPlainObject(showdown.revealedHoleCardsByUserId) ? showdown.revealedHoleCardsByUserId : {};
  return {
    ...state,
    showdown: {
      ...showdown,
      revealedHoleCardsByUserId: revealed,
    },
  };
};

export { redactShowdownForViewer };
