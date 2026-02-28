import { PROTOCOL_VERSION } from "../protocol/constants.mjs";

export function handleProtectedEcho({ frame, connState, nowTs }) {
  const response = {
    version: PROTOCOL_VERSION,
    type: "protectedEchoOk",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: {
      userId: connState.session.userId,
      echo: frame.payload.echo ?? null
    }
  };

  if (frame.requestId) {
    response.requestId = frame.requestId;
  }

  return { ok: true, frame: response };
}
