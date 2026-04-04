function lastSeenMs(session) {
  const parsed = Date.parse(session.lastSeenAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createSessionStore({ sessionTtlMs = 60_000 } = {}) {
  const userBySocket = new Map();
  const socketsByUserId = new Map();
  const sessionById = new Map();
  const sessionIdBySocket = new Map();
  const socketBySessionId = new Map();

  function registerSession({ session }) {
    sessionById.set(session.sessionId, session);
  }

  function sessionForId(sessionId) {
    return sessionById.get(sessionId) ?? null;
  }

  function trackConnection({ ws, userId, sessionId = null }) {
    const priorUserId = userBySocket.get(ws);
    if (priorUserId && priorUserId !== userId) {
      untrackConnection({ ws, userId: priorUserId });
    }

    const priorSessionId = sessionIdBySocket.get(ws) ?? null;
    if (priorSessionId && priorSessionId !== sessionId && socketBySessionId.get(priorSessionId) === ws) {
      socketBySessionId.delete(priorSessionId);
      sessionIdBySocket.delete(ws);
    }

    userBySocket.set(ws, userId);
    if (!socketsByUserId.has(userId)) {
      socketsByUserId.set(userId, new Set());
    }
    socketsByUserId.get(userId).add(ws);

    if (sessionId) {
      const session = sessionForId(sessionId);
      if (session) {
        sessionIdBySocket.set(ws, sessionId);
        socketBySessionId.set(sessionId, ws);
      }
    }
  }

  function untrackConnection({ ws, userId }) {
    const trackedSessionId = sessionIdBySocket.get(ws) ?? null;
    const resolvedUserId = userBySocket.get(ws) || userId;
    if (resolvedUserId) {
      userBySocket.delete(ws);
      const sockets = socketsByUserId.get(resolvedUserId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          socketsByUserId.delete(resolvedUserId);
        }
      }
    }

    sessionIdBySocket.delete(ws);
    if (trackedSessionId && socketBySessionId.get(trackedSessionId) === ws) {
      socketBySessionId.delete(trackedSessionId);
    }
  }

  function hasActiveConnection(userId) {
    return Boolean(socketsByUserId.get(userId)?.size);
  }

  function connectionsForUser(userId) {
    const sockets = socketsByUserId.get(userId);
    return sockets ? [...sockets] : [];
  }

  function rebindSession({ sessionId, userId, ws }) {
    const session = sessionForId(sessionId);
    if (!session) {
      return { ok: false, reason: "unknown_session" };
    }

    if (session.userId !== userId) {
      return { ok: false, reason: "session_user_mismatch" };
    }

    const priorSocket = socketBySessionId.get(sessionId) ?? null;
    if (priorSocket && priorSocket !== ws) {
      untrackConnection({ ws: priorSocket, userId });
    }

    trackConnection({ ws, userId, sessionId });
    return { ok: true, session, priorSocket };
  }

  function socketOwnsSession({ ws, sessionId }) {
    if (!ws || typeof sessionId !== "string" || sessionId.trim() === "") {
      return false;
    }
    return socketBySessionId.get(sessionId) === ws;
  }

  function sweepExpiredSessions({ nowMs = Date.now() } = {}) {
    const activeSessionIds = new Set(sessionIdBySocket.values());
    const expiredSessionIds = [];

    for (const [sessionId, session] of sessionById.entries()) {
      if (activeSessionIds.has(sessionId)) {
        continue;
      }

      const ageMs = nowMs - lastSeenMs(session);
      if (ageMs >= sessionTtlMs) {
        sessionById.delete(sessionId);
        expiredSessionIds.push(sessionId);
      }
    }

    return expiredSessionIds;
  }

  return {
    registerSession,
    sessionForId,
    trackConnection,
    untrackConnection,
    hasActiveConnection,
    connectionsForUser,
    rebindSession,
    socketOwnsSession,
    sweepExpiredSessions
  };
}
