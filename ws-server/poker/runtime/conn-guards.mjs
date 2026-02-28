const VIOLATION_WINDOW_MS = 30_000;
const VIOLATION_THRESHOLD = 3;

export function recordProtocolViolation(connState, nowMs = Date.now()) {
  connState.protocolViolations.push(nowMs);
  connState.protocolViolations = connState.protocolViolations.filter((time) => nowMs - time <= VIOLATION_WINDOW_MS);
  return connState.protocolViolations.length;
}

export function shouldClose(connState, count = connState.protocolViolations.length) {
  return count >= VIOLATION_THRESHOLD;
}
