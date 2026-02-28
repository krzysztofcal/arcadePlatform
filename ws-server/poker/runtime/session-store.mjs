export function createSessionStore() {
  const userBySocket = new Map();
  const socketsByUserId = new Map();

  function trackConnection({ ws, userId }) {
    const priorUserId = userBySocket.get(ws);
    if (priorUserId === userId) {
      return;
    }

    if (priorUserId) {
      untrackConnection({ ws, userId: priorUserId });
    }

    userBySocket.set(ws, userId);
    if (!socketsByUserId.has(userId)) {
      socketsByUserId.set(userId, new Set());
    }
    socketsByUserId.get(userId).add(ws);
  }

  function untrackConnection({ ws, userId }) {
    const resolvedUserId = userBySocket.get(ws) || userId;
    if (!resolvedUserId) {
      return;
    }

    userBySocket.delete(ws);
    const sockets = socketsByUserId.get(resolvedUserId);
    if (!sockets) {
      return;
    }

    sockets.delete(ws);
    if (sockets.size === 0) {
      socketsByUserId.delete(resolvedUserId);
    }
  }

  function hasActiveConnection(userId) {
    return Boolean(socketsByUserId.get(userId)?.size);
  }

  function connectionsForUser(userId) {
    const sockets = socketsByUserId.get(userId);
    return sockets ? [...sockets] : [];
  }

  return {
    trackConnection,
    untrackConnection,
    hasActiveConnection,
    connectionsForUser
  };
}
