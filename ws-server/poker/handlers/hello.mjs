import { PROTOCOL_VERSION } from "../protocol/constants.mjs";
import { HEARTBEAT_MS } from "../runtime/conn-state.mjs";

export function handleHello({ frame, connState, nowTs }) {
  const supportedVersions = frame.payload.supportedVersions;
  if (!Array.isArray(supportedVersions) || !supportedVersions.includes(PROTOCOL_VERSION)) {
    return {
      ok: false,
      code: "UNSUPPORTED_VERSION",
      message: "No mutually supported protocol version",
      closeCode: 1002
    };
  }

  const response = {
    version: PROTOCOL_VERSION,
    type: "helloAck",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: {
      version: PROTOCOL_VERSION,
      sessionId: connState.sessionId,
      heartbeatMs: HEARTBEAT_MS
    }
  };

  if (frame.requestId) {
    response.requestId = frame.requestId;
  }

  return { ok: true, frame: response };
}
