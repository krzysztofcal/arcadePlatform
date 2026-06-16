import { PROTOCOL_VERSION, TYPE_PATTERN } from "./constants.mjs";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseFrame(text) {
  try {
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) {
      return { ok: false, error: "Frame must be a JSON object" };
    }

    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: "Invalid JSON frame" };
  }
}

export function validateEnvelope(frame) {
  const requestId = typeof frame.requestId === "string" ? frame.requestId : null;

  if (frame.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "UNSUPPORTED_VERSION",
      message: `Unsupported protocol version: ${String(frame.version)}`,
      requestId
    };
  }

  if (typeof frame.type !== "string" || !TYPE_PATTERN.test(frame.type)) {
    return { ok: false, code: "INVALID_ENVELOPE", message: "Invalid envelope field: type", requestId };
  }

  if (typeof frame.ts !== "string" || frame.ts.trim().length === 0) {
    return { ok: false, code: "INVALID_ENVELOPE", message: "Invalid envelope field: ts", requestId };
  }

  if (!isObject(frame.payload)) {
    return { ok: false, code: "INVALID_ENVELOPE", message: "Invalid envelope field: payload", requestId };
  }

  return { ok: true, value: frame };
}

export function makeErrorFrame({ code, message, requestId = null, sessionId, ts = new Date().toISOString() }) {
  const frame = {
    version: PROTOCOL_VERSION,
    type: "error",
    ts,
    payload: {
      code,
      message,
      retryable: false,
      requestId
    }
  };

  if (sessionId) {
    frame.sessionId = sessionId;
  }

  if (requestId) {
    frame.requestId = requestId;
  }

  return frame;
}
