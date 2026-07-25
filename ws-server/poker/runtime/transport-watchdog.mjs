function normalizeNowMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

export function acknowledgeTransportEvidence(connState) {
  if (!connState || connState.transportTerminationStarted === true) {
    return false;
  }
  connState.pendingTransportPingSentAtMs = null;
  return true;
}

export function beginTransportTermination(connState) {
  if (!connState || connState.transportTerminationStarted === true) {
    return false;
  }
  connState.transportTerminationStarted = true;
  return true;
}

export function decideTransportWatchdogAction(connState, {
  nowMs = Date.now(),
  timeoutMs = 60_000
} = {}) {
  if (!connState || connState.transportTerminationStarted === true) {
    return { action: "noop", reason: "termination_started" };
  }

  const normalizedNowMs = normalizeNowMs(nowMs);
  const rawPendingAtMs = connState.pendingTransportPingSentAtMs;
  const pendingAtMs = Number(rawPendingAtMs);
  if (rawPendingAtMs == null || !Number.isFinite(pendingAtMs)) {
    return { action: "ping", nowMs: normalizedNowMs };
  }

  const ageMs = Math.max(0, normalizedNowMs - pendingAtMs);
  if (ageMs < normalizeTimeoutMs(timeoutMs)) {
    return { action: "noop", reason: "probe_pending", ageMs };
  }

  beginTransportTermination(connState);
  return { action: "terminate", reason: "pong_timeout", ageMs };
}

export function markTransportPingSent(connState, sentAtMs = Date.now()) {
  if (
    !connState
    || connState.transportTerminationStarted === true
    || (
      connState.pendingTransportPingSentAtMs != null
      && Number.isFinite(Number(connState.pendingTransportPingSentAtMs))
    )
  ) {
    return false;
  }
  connState.pendingTransportPingSentAtMs = normalizeNowMs(sentAtMs);
  return true;
}
