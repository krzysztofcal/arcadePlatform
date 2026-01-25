const redactShowdownForViewer = (state, { viewerUserId, activeUserIds }) => {
  if (!state || state.phase !== "SHOWDOWN" || !state.showdown) return state;
  const safeViewerId = typeof viewerUserId === "string" ? viewerUserId.trim() : "";
  if (!safeViewerId) return { ...state, showdown: { ...state.showdown, revealedHoleCardsByUserId: {} } };
  if (!Array.isArray(activeUserIds)) return { ...state, showdown: { ...state.showdown, revealedHoleCardsByUserId: {} } };
  const activeList = activeUserIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean);
  if (!activeList.includes(safeViewerId)) {
    return { ...state, showdown: { ...state.showdown, revealedHoleCardsByUserId: {} } };
  }
  return state;
};

export { redactShowdownForViewer };
