(function (window) {
  const DEFAULT_SCORE_DELTA_CEILING = 10_000;
  const DEFAULT_CLIENT_DELTA_CAP = 300;
  const FLUSH_INTERVAL_MS = 15_000;
  const FLUSH_THRESHOLD = 50;
  const FLUSH_ENDPOINT = (typeof window !== 'undefined' && window && typeof window.XP_FLUSH_ENDPOINT === 'string')
    ? window.XP_FLUSH_ENDPOINT
    : null;

  function parseNumber(value, fallback) {
    if (value == null) return fallback;
    const sanitized = typeof value === 'string' ? value.replace(/_/g, '') : value;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getScoreDeltaCeiling() {
    return parseNumber(window && window.XP_SCORE_DELTA_CEILING, DEFAULT_SCORE_DELTA_CEILING);
  }

  function getClientDeltaCap() {
    if (typeof window === 'undefined' || !window) {
      return DEFAULT_CLIENT_DELTA_CAP;
    }
    const raw = Object.prototype.hasOwnProperty.call(window, 'XP_DELTA_CAP_CLIENT')
      ? window.XP_DELTA_CAP_CLIENT
      : undefined;
    const parsed = parseNumber(raw, DEFAULT_CLIENT_DELTA_CAP);
    if (!Number.isFinite(parsed)) return DEFAULT_CLIENT_DELTA_CAP;
    const normalized = Math.max(0, Math.floor(parsed));
    return normalized || 0;
  }

  function addScore(state, delta, now, ceilingOverride) {
    const numeric = Number(delta);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 0) return 0;

    if (!Number.isFinite(state.scoreDeltaRemainder)) {
      state.scoreDeltaRemainder = 0;
    }

    state.scoreDeltaRemainder += numeric;
    if (state.scoreDeltaRemainder < 1) {
      return 0;
    }

    const whole = Math.floor(state.scoreDeltaRemainder);
    if (whole <= 0) {
      state.scoreDeltaRemainder = Math.max(0, state.scoreDeltaRemainder);
      return 0;
    }

    const current = Math.max(0, Math.round(state.scoreDelta));
    const ceiling = Number.isFinite(ceilingOverride) ? ceilingOverride : getScoreDeltaCeiling();
    const capacity = Math.max(0, ceiling - current);
    if (capacity <= 0) {
      state.scoreDeltaRemainder = Math.max(0, state.scoreDeltaRemainder);
      return 0;
    }

    const toAdd = Math.min(whole, capacity);
    state.scoreDelta = current + toAdd;
    state.scoreDeltaRemainder = Math.max(0, state.scoreDeltaRemainder - toAdd);
    state.scoreDeltaSinceLastAward = Math.max(0, (state.scoreDeltaSinceLastAward || 0) + toAdd);
    state.lastScorePulseTs = now || Date.now();
    return toAdd;
  }

  function shouldFlush(state, opts) {
    const force = opts && opts.force;
    const isDocumentVisible = opts && typeof opts.isDocumentVisible === 'function'
      ? opts.isDocumentVisible
      : () => true;
    const isAtCap = opts && typeof opts.isAtCap === 'function' ? opts.isAtCap : () => false;

    if (force) return true;
    if (state.flush.inflight) return false;
    if (!state.flush.pending) return false;
    if (!isDocumentVisible()) return true;
    if (isAtCap()) return true;
    const now = Date.now();
    if (state.flush.pending >= FLUSH_THRESHOLD) return true;
    if (!state.flush.lastSync) return true;
    if ((now - state.flush.lastSync) >= FLUSH_INTERVAL_MS) return true;
    return false;
  }

  function markFlushSuccess(state, amount) {
    const delta = Math.max(0, Number(amount) || 0);
    if (delta > 0) {
      state.flush.pending = Math.max(0, state.flush.pending - delta);
      state.regen.pending = Math.max(0, state.regen.pending - delta);
    }
    state.flush.lastSync = Date.now();
  }

  function flush(state, opts) {
    if (state.flush && state.flush.inflight) {
      return state.flush.inflight;
    }
    const options = opts || {};
    const persist = typeof options.persistRuntimeState === 'function'
      ? options.persistRuntimeState
      : () => {};
    const endpoint = typeof options.endpoint === 'string' ? options.endpoint : FLUSH_ENDPOINT;
    const shouldSend = shouldFlush(state, options);
    if (!shouldSend) return Promise.resolve(false);
    const pending = Math.max(0, state.flush.pending || 0);
    if (!pending) return Promise.resolve(false);

    const payload = {
      pending,
      totalToday: state.totalToday || 0,
      totalLifetime: state.totalLifetime || 0,
      ts: Date.now(),
    };
    const serialized = JSON.stringify(payload);
    const done = () => {
      markFlushSuccess(state, pending);
      persist();
    };

    if (!endpoint) {
      done();
      return Promise.resolve(true);
    }

    if (typeof navigator !== 'undefined' && navigator && typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon(endpoint, serialized);
      if (sent) {
        done();
        return Promise.resolve(true);
      }
    }

    if (typeof fetch !== 'function') {
      done();
      return Promise.resolve(true);
    }

    const request = fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serialized,
      keepalive: true,
      credentials: 'omit',
    })
      .then(() => { done(); return true; })
      .catch((err) => {
        if (window.console && console.debug) {
          console.debug('XP flush failed', err);
        }
        persist();
        return false;
      })
      .finally(() => { state.flush.inflight = null; });

    state.flush.inflight = request;
    return request;
  }

  window.XpScoring = {
    DEFAULT_CLIENT_DELTA_CAP,
    getScoreDeltaCeiling,
    getClientDeltaCap,
    addScore,
    shouldFlush,
    flush,
  };
})(typeof window !== 'undefined' ? window : this);
