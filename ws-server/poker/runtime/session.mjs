function nowIso(nowTs) {
  return typeof nowTs === "function" ? nowTs() : new Date().toISOString();
}

export function createSession({ sessionId, nowTs }) {
  const ts = nowIso(nowTs);
  return {
    sessionId,
    userId: null,
    authedAt: null,
    lastSeenAt: ts
  };
}

export function touchSession(session, nowTs) {
  session.lastSeenAt = nowIso(nowTs);
  return session;
}

export function bindSessionUser({ session, userId, nowTs }) {
  const ts = nowIso(nowTs);

  if (session.userId === null) {
    session.userId = userId;
    session.authedAt = ts;
    session.lastSeenAt = ts;
    return { ok: true, changed: true };
  }

  if (session.userId !== userId) {
    return {
      ok: false,
      code: "auth_session_locked",
      message: "Session user is already bound for this connection"
    };
  }

  session.lastSeenAt = ts;
  return { ok: true, changed: false };
}
