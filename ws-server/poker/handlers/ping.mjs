import { PROTOCOL_VERSION } from "../protocol/constants.mjs";

export function handlePing({ frame, connState, nowTs }) {
  const clientTime = frame.payload.clientTime;
  if (typeof clientTime !== "string" || clientTime.trim().length === 0) {
    return {
      ok: false,
      code: "INVALID_COMMAND",
      message: "payload.clientTime is required"
    };
  }

  const response = {
    version: PROTOCOL_VERSION,
    type: "pong",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: {
      clientTime,
      serverTime: nowTs()
    }
  };

  if (frame.requestId) {
    response.requestId = frame.requestId;
  }

  return { ok: true, frame: response };
}
