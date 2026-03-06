function nowIso(nowTs) {
  return typeof nowTs === "function" ? nowTs() : new Date().toISOString();
}

const DEFAULT_REPLAY_WINDOW_SIZE = 20;

function ensureTableReplay(session, tableId) {
  if (!session.replayByTableId.has(tableId)) {
    session.replayByTableId.set(tableId, []);
  }
  return session.replayByTableId.get(tableId);
}

export function createSession({ sessionId, nowTs, replayWindowSize = DEFAULT_REPLAY_WINDOW_SIZE }) {
  const ts = nowIso(nowTs);
  return {
    sessionId,
    userId: null,
    authedAt: null,
    lastSeenAt: ts,
    latestDeliveredSeq: 0,
    replayWindowSize,
    replayByTableId: new Map(),
    latestDeliveredSeqByTableId: new Map()
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

export function recordReplayFrame({ session, tableId, frame }) {
  const seq = session.latestDeliveredSeq + 1;
  session.latestDeliveredSeq = seq;

  const replayFrame = JSON.parse(JSON.stringify({ ...frame, seq }));
  const tableReplay = ensureTableReplay(session, tableId);
  tableReplay.push({ seq, frame: replayFrame });

  while (tableReplay.length > session.replayWindowSize) {
    tableReplay.shift();
  }

  session.latestDeliveredSeqByTableId.set(tableId, seq);
  return replayFrame;
}

export function resolveReplay({ session, tableId, lastSeq }) {
  const tableReplay = ensureTableReplay(session, tableId);
  const latestSeq = session.latestDeliveredSeqByTableId.get(tableId) ?? 0;

  if (tableReplay.length === 0) {
    return { ok: false, reason: "replay_window_empty", latestSeq };
  }

  const earliestSeq = tableReplay[0].seq;
  if (lastSeq < earliestSeq - 1) {
    return { ok: false, reason: "last_seq_out_of_window", latestSeq, earliestSeq };
  }

  if (lastSeq > latestSeq) {
    return { ok: false, reason: "last_seq_ahead_of_head", latestSeq, earliestSeq };
  }

  const frames = tableReplay
    .filter((entry) => entry.seq > lastSeq)
    .map((entry) => JSON.parse(JSON.stringify(entry.frame)));

  return {
    ok: true,
    latestSeq,
    earliestSeq,
    frames
  };
}
