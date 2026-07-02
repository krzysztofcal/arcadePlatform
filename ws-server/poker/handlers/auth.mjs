import { PROTOCOL_VERSION } from "../protocol/constants.mjs";
import { bindSessionUser } from "../runtime/session.mjs";

export function handleAuth({ frame, connState, nowTs, verifyToken }) {
  const token = frame.payload.token;
  const verification = verifyToken({ token });

  if (!verification.ok) {
    return {
      ok: false,
      code: verification.code,
      message: verification.message
    };
  }

  const bound = bindSessionUser({
    session: connState.session,
    userId: verification.userId,
    identityMode: verification.identityMode || "user",
    nickname: verification.nickname || null,
    nowTs
  });

  if (!bound.ok) {
    return bound;
  }

  connState.userId = connState.session.userId;
  connState.identityMode = connState.session.identityMode || "user";
  connState.nickname = connState.session.nickname || null;
  connState.guestTableId = verification.tableId || null;

  const response = {
    version: PROTOCOL_VERSION,
    type: "authOk",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: {
      sessionId: connState.sessionId,
      userId: connState.session.userId,
      mode: connState.identityMode,
      nickname: connState.nickname
    }
  };

  if (frame.requestId) {
    response.requestId = frame.requestId;
  }

  return { ok: true, frame: response };
}
