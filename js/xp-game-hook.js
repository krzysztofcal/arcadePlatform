(function (window, document) {
  if (typeof window === "undefined") return;

  const DEFAULT_SCORE_DELTA_CEILING = 10_000;
  const DEFAULT_BOOST_SEC = 15;

  function parseNumber(value, fallback) {
    if (value == null) return fallback;
    const sanitized = typeof value === "string" ? value.replace(/_/g, "") : value;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function logDebug(kind, data) {
    try {
      if (!window || !window.KLog || typeof window.KLog.log !== "function") return false;
      return !!window.KLog.log(kind, data || {});
    } catch (_) {
      return false;
    }
  }

  let cachedScoreDeltaCeiling = DEFAULT_SCORE_DELTA_CEILING;

  function resolveScoreDeltaCeiling() {
    const xp = window && window.XP;
    const candidates = [];
    if (xp && Object.prototype.hasOwnProperty.call(xp, "scoreDeltaCeiling")) {
      candidates.push(xp.scoreDeltaCeiling);
    }
    if (window && Object.prototype.hasOwnProperty.call(window, "XP_SCORE_DELTA_CEILING")) {
      candidates.push(window.XP_SCORE_DELTA_CEILING);
    }

    for (let i = 0; i < candidates.length; i += 1) {
      const parsed = parseNumber(candidates[i], NaN);
      if (Number.isFinite(parsed) && parsed > 0) {
        cachedScoreDeltaCeiling = parsed;
        return cachedScoreDeltaCeiling;
      }
    }

    return cachedScoreDeltaCeiling;
  }
  const DEFAULT_GAME_ID = "game";
  const HIGH_SCORE_PREFIX = "xp:hs:";

  const MIN_FLUSH_DELAY_MS = 16;
  const MAX_FLUSH_DELAY_MS = 1000;

  const highScoreMemory = {};

  const state = {
    remainder: 0,
    queuedWhole: 0,
    pendingStartGameId: null,
    pendingStopOptions: null,
    runningDesired: false,
    lastGameId: null,
    autoListenersBound: false,
    flushScheduled: false,
    flushDelayMs: MIN_FLUSH_DELAY_MS,
    domReadyListenerBound: false,
    handleVisible: null,
    handleHidden: null,
    activityListener: null,
    handleVisibleRan: false,
    lastDailyCapLog: 0,
  };

  let autoBootedSlug = null;
  let autoBootstrapped = false;
  let autoBootGuarded = false;

  function ensureAutoBootstrapped() {
    if (autoBootstrapped) return;
    autoBootstrapped = true;
    ensureAutoListeners();
    ensureDomReadyKickoff();
  }

  function ensureAutoBootGuard() {
    if (autoBootGuarded) return;
    autoBootGuarded = true;
    ensureAutoBootstrapped();
  }

  function isHostDocument() {
    try {
      if (!document || !document.body) return false;
      const body = document.body;
      if (typeof body.hasAttribute === "function" && body.hasAttribute("data-game-host")) return true;
      if (body.dataset) {
        if (Object.prototype.hasOwnProperty.call(body.dataset, "gameHost")) return true;
        if (body.dataset.gameId) return true;
        if (body.dataset.gameSlug) return true;
      }
      if (typeof document.getElementById === "function") {
        if (document.getElementById("gameFrame") || document.getElementById("frameBox") || document.getElementById("frameWrap")) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function getXp() {
    const xp = window && window.XP;
    if (!xp || typeof xp.startSession !== "function") return null;
    return xp;
  }

  function scheduleFlush(delay = state.flushDelayMs || MIN_FLUSH_DELAY_MS) {
    if (!window || typeof window.setTimeout !== "function") return;
    if (state.flushScheduled) return;
    state.flushScheduled = true;
    window.setTimeout(() => {
      state.flushScheduled = false;
      const success = flush();
      if (success) {
        state.flushDelayMs = MIN_FLUSH_DELAY_MS;
      } else {
        const nextDelay = Math.min(
          MAX_FLUSH_DELAY_MS,
          Math.max(MIN_FLUSH_DELAY_MS, (state.flushDelayMs || MIN_FLUSH_DELAY_MS) * 2),
        );
        state.flushDelayMs = nextDelay;
        scheduleFlush(nextDelay);
      }
    }, delay);
  }

  function normalizeGameId(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  }

  function slugifyGameId(value) {
    if (!value) return null;
    const lowered = String(value).trim().toLowerCase();
    if (!lowered) return null;
    const dashed = lowered.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const limited = dashed.slice(0, 64);
    return limited || null;
  }

  function resolveBridgeGameId() {
    try {
      if (window && window.GameXpBridge && typeof window.GameXpBridge.getCurrentGameId === "function") {
        const id = window.GameXpBridge.getCurrentGameId();
        if (id) return id;
      }
    } catch (_) {}
    if (state.lastGameId) return state.lastGameId;
    const detected = detectGameId();
    return detected;
  }

  function getHighScoreKey(gameId) {
    const slugged = slugifyGameId(gameId) || DEFAULT_GAME_ID;
    return `${HIGH_SCORE_PREFIX}${slugged}`;
  }

  function getHighScore(gameId) {
    const key = getHighScoreKey(gameId);
    let raw = null;
    try {
      if (window && window.localStorage && typeof window.localStorage.getItem === "function") {
        raw = window.localStorage.getItem(key);
      }
    } catch (_) {
      raw = null;
    }
    if (raw == null && Object.prototype.hasOwnProperty.call(highScoreMemory, key)) {
      raw = highScoreMemory[key];
    }
    let parsed = parseNumber(raw, NaN);
    if (!Number.isFinite(parsed) || parsed < 0) {
      parsed = 0;
    }
    const normalized = Math.max(0, Math.floor(parsed));
    highScoreMemory[key] = normalized;
    return normalized;
  }

  function setHighScore(gameId, score) {
    const key = getHighScoreKey(gameId);
    const numeric = Math.max(0, Math.floor(parseNumber(score, 0) || 0));
    highScoreMemory[key] = numeric;
    try {
      if (window && window.localStorage && typeof window.localStorage.setItem === "function") {
        window.localStorage.setItem(key, String(numeric));
      }
    } catch (_) {}
    return numeric;
  }

  function updateHighScoreIfBetter(gameId, score) {
    const numeric = Math.max(0, Math.floor(parseNumber(score, NaN)) || 0);
    const current = getHighScore(gameId);
    if (!Number.isFinite(numeric) || numeric <= current) {
      return { updated: false, highScore: current };
    }
    const updated = setHighScore(gameId, numeric);
    return { updated: true, highScore: updated };
  }

  function dispatchBoost(detail) {
    if (!window || typeof window.dispatchEvent !== "function") return;
    const payload = detail && typeof detail === "object" ? { ...detail } : {};
    const now = Date.now();
    if (Object.prototype.hasOwnProperty.call(payload, "totalSeconds")) {
      const total = parseNumber(payload.totalSeconds, NaN);
      if (Number.isFinite(total)) {
        payload.totalSeconds = Math.max(0, Math.floor(total));
      } else {
        delete payload.totalSeconds;
      }
    }

    let ttlMs = parseNumber(payload.ttlMs, NaN);
    if (Number.isFinite(ttlMs)) {
      ttlMs = Math.max(0, Math.floor(ttlMs));
    } else {
      ttlMs = NaN;
    }

    let expiresAt = null;
    if (Object.prototype.hasOwnProperty.call(payload, "expiresAt")) {
      expiresAt = parseNumber(payload.expiresAt, NaN);
    } else if (Object.prototype.hasOwnProperty.call(payload, "endsAt")) {
      expiresAt = parseNumber(payload.endsAt, NaN);
    }
    if (Number.isFinite(expiresAt)) {
      if (expiresAt > 0 && expiresAt < 1e12) {
        expiresAt = Math.floor(expiresAt * 1000);
      } else {
        expiresAt = Math.floor(expiresAt);
      }
    } else {
      expiresAt = NaN;
    }

    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      ttlMs = Number.isFinite(expiresAt) && expiresAt > now ? Math.max(0, expiresAt - now) : 0;
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      expiresAt = ttlMs > 0 ? now + ttlMs : now;
    }

    payload.ttlMs = ttlMs > 0 ? ttlMs : 0;
    payload.expiresAt = expiresAt;
    payload.endsAt = expiresAt;
    if (Object.prototype.hasOwnProperty.call(payload, "secondsLeft")) {
      delete payload.secondsLeft;
    }

    const targets = [];
    if (window && typeof window.dispatchEvent === "function") targets.push(window);
    if (document && typeof document.dispatchEvent === "function") targets.push(document);
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      try {
        if (typeof CustomEvent === "function") {
          target.dispatchEvent(new CustomEvent("xp:boost", { detail: payload }));
          continue;
        }
      } catch (_) {}
      try {
        if (document && typeof document.createEvent === "function") {
          const legacyEvt = document.createEvent("CustomEvent");
          legacyEvt.initCustomEvent("xp:boost", false, false, payload);
          target.dispatchEvent(legacyEvt);
          continue;
        }
      } catch (_) {}
      try { target.dispatchEvent({ type: "xp:boost", detail: payload }); } catch (_) {}
    }
  }

  function emitBoostStop(source, gameId) {
    const now = Date.now();
    const payload = {
      multiplier: 1,
      totalSeconds: DEFAULT_BOOST_SEC,
      ttlMs: 0,
      expiresAt: now,
      endsAt: now,
      source: source || "gameOver",
    };
    const resolvedId = slugifyGameId(gameId) || slugifyGameId(resolveBridgeGameId());
    if (resolvedId) payload.gameId = resolvedId;
    dispatchBoost(payload);
  }

  function readWindowGameId() {
    try {
      if (typeof window === "undefined") return null;
      if (Object.prototype.hasOwnProperty.call(window, "__GAME_ID__")) {
        return normalizeGameId(window.__GAME_ID__);
      }
      if (window.__GAME_ID__ != null) {
        return normalizeGameId(window.__GAME_ID__);
      }
    } catch (_) {}
    return null;
  }

  function resolvePageGameId() {
    const fromWindow = readWindowGameId();
    if (fromWindow) return slugifyGameId(fromWindow);
    if (state.lastGameId) return slugifyGameId(state.lastGameId);
    const detected = detectGameId();
    return slugifyGameId(detected);
  }

  function resolveSessionGameId(xp) {
    if (!xp) return null;
    try {
      if (xp.session && typeof xp.session === "object") {
        const sessionId = normalizeGameId(xp.session.gameId);
        if (sessionId) return sessionId;
      }
    } catch (_) {}
    try {
      if (xp.__lastGameId) {
        const fromLast = normalizeGameId(xp.__lastGameId);
        if (fromLast) return fromLast;
      }
    } catch (_) {}
    return null;
  }

  function updateXpSessionGameId(xp, gameId) {
    if (!xp) return;
    try {
      if (!xp.session || typeof xp.session !== "object") {
        xp.session = {};
      }
      xp.session.gameId = gameId || null;
    } catch (_) {}
  }

  function detectGameId() {
    const fromWindow = normalizeGameId(window && window.GAME_ID);
    if (fromWindow) return fromWindow;

    if (document && document.body) {
      if (typeof document.body.getAttribute === "function") {
        const attr = normalizeGameId(document.body.getAttribute("data-game-id"));
        if (attr) return attr;
      }
      const datasetId = document.body.dataset && normalizeGameId(document.body.dataset.gameId);
      if (datasetId) return datasetId;
    }

    try {
      if (typeof location !== "undefined" && location && typeof location.pathname === "string") {
        const parts = location.pathname.split("/").filter(Boolean);
        if (parts.length) {
          let segment = parts[parts.length - 1];
          if (/^index(?:\.[a-z0-9]+)?$/i.test(segment) && parts.length >= 2) {
            segment = parts[parts.length - 2];
          }
          if (parts[0] && parts[0].toLowerCase() === "games-open" && parts.length >= 2) {
            segment = parts[1];
          }
          segment = String(segment || "").replace(/\.[a-z0-9]+$/i, "");
          segment = segment.replace(/^game[_-]?/i, "");
          segment = segment.replace(/_/g, "-");
          if (segment.toLowerCase() === "trex") {
            segment = "t-rex";
          }
          const fromPath = normalizeGameId(segment);
          if (fromPath) return fromPath;
        }
      }
    } catch (_) {}

    const title = document && normalizeGameId(document.title);
    if (title) return title;

    const fallback = readWindowGameId();
    if (fallback) return fallback;

    return null;
  }

  function resetSessionAccounting() {
    state.remainder = 0;
    state.queuedWhole = 0;
  }

  function flush() {
    const xp = getXp();
    if (!xp) {
      return false;
    }

    let didWork = false;
    if (state.pendingStopOptions) {
      try {
        xp.stopSession(state.pendingStopOptions);
      } catch (_) {}
      state.pendingStopOptions = null;
      didWork = true;
    }

    const ceiling = resolveScoreDeltaCeiling();
    if (state.queuedWhole > ceiling) {
      state.queuedWhole = ceiling;
    }

    if (state.pendingStartGameId != null) {
      try {
        xp.startSession(state.pendingStartGameId);
      } catch (_) {}
      state.pendingStartGameId = null;
      didWork = true;
    }

    if (state.queuedWhole > 0) {
      let allowance = Infinity;
      if (xp && typeof xp.getRemainingDaily === "function") {
        const remaining = xp.getRemainingDaily();
        allowance = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : Infinity;
      }
      if (allowance <= 0) {
        const now = Date.now();
        if (!state.lastDailyCapLog || (now - state.lastDailyCapLog) > 500) {
          state.lastDailyCapLog = now;
          logDebug("award_skip", { reason: "daily_cap" });
        }
        state.queuedWhole = 0;
        state.remainder = 0;
        logDebug("award_drop_buffer", { reason: "daily_cap" });
        return didWork;
      }
      let amount = state.queuedWhole;
      if (allowance < amount) {
        logDebug("award_preclamp", { want: amount, remaining: allowance });
        amount = allowance;
      }
      const leftover = Math.max(0, state.queuedWhole - amount);
      state.queuedWhole = leftover;
      try {
        xp.addScore(amount);
      } catch (_) {
        state.queuedWhole = amount + leftover;
        return false;
      }
      didWork = true;
    }

    if (didWork) state.flushDelayMs = MIN_FLUSH_DELAY_MS;
    return didWork;
  }

  function ensureAutoListeners() {
    if (state.autoListenersBound) return;
    state.autoListenersBound = true;

    const handleVisible = () => {
      const gameId = state.lastGameId || detectGameId();
      if (gameId) {
        start(gameId);
      }
    };

    state.handleVisible = handleVisible;

    const handleHidden = () => {
      stop({ flush: true });
    };
    state.handleHidden = handleHidden;

    const activity = () => {
      try { nudge(); } catch (_) {}
    };
    state.activityListener = activity;

    if (document && typeof document.addEventListener === "function") {
      document.addEventListener("xp:visible", handleVisible, { passive: true });
      document.addEventListener("xp:hidden", handleHidden, { passive: true });
    }

    if (window && typeof window.addEventListener === "function") {
      ["pointerdown", "pointerup", "keydown", "keyup", "touchstart", "wheel"].forEach((evt) => {
        try { window.addEventListener(evt, activity, { passive: true }); } catch (_) {}
      });
    }

  }

  /**
   * Remove all event listeners set up by ensureAutoListeners.
   * Call this when the game is completely unloaded to prevent memory leaks.
   * After cleanup, auto() or start() can re-initialize the listeners.
   */
  function cleanup() {
    if (!state.autoListenersBound) return;

    if (document && typeof document.removeEventListener === "function") {
      if (state.handleVisible) {
        try { document.removeEventListener("xp:visible", state.handleVisible); } catch (_) {}
      }
      if (state.handleHidden) {
        try { document.removeEventListener("xp:hidden", state.handleHidden); } catch (_) {}
      }
    }

    if (window && typeof window.removeEventListener === "function" && state.activityListener) {
      ["pointerdown", "pointerup", "keydown", "keyup", "touchstart", "wheel"].forEach((evt) => {
        try { window.removeEventListener(evt, state.activityListener); } catch (_) {}
      });
    }

    state.autoListenersBound = false;
    state.handleVisible = null;
    state.handleHidden = null;
    state.activityListener = null;
    // Reset bootstrap flag so listeners can be re-bound on next auto()/start() call
    autoBootstrapped = false;
  }

  function ensureDomReadyKickoff() {
    if (state.domReadyListenerBound) return;
    state.domReadyListenerBound = true;

    const runVisible = () => {
      try {
        if (typeof state.handleVisible === "function") {
          state.handleVisible();
        } else {
          const gameId = state.lastGameId || detectGameId();
          if (gameId) start(gameId);
        }
      } catch (_) {}
    };

    const immediateReady = document && typeof document.readyState === "string"
      && (document.readyState === "interactive" || document.readyState === "complete");

    if (immediateReady) {
      runVisible();
      return;
    }

    const once = () => {
      try {
        if (document && typeof document.removeEventListener === "function") {
          document.removeEventListener("DOMContentLoaded", once);
        }
      } catch (_) {}
      try {
        if (window && typeof window.removeEventListener === "function") {
          window.removeEventListener("load", once);
        }
      } catch (_) {}
      runVisible();
    };

    if (document && typeof document.addEventListener === "function") {
      try { document.addEventListener("DOMContentLoaded", once, { once: true, passive: true }); } catch (_) {
        try { document.addEventListener("DOMContentLoaded", once); } catch (_) {}
      }
    }

    if (window && typeof window.addEventListener === "function") {
      try { window.addEventListener("load", once, { once: true, passive: true }); } catch (_) {
        try { window.addEventListener("load", once); } catch (_) {}
      }
    }

    if (window && typeof window.setTimeout === "function") {
      try {
        const attemptStart = () => {
          if (!state.runningDesired || state.handleVisibleRan) return;
          const candidate = state.lastGameId || readWindowGameId() || detectGameId();
          if (candidate) {
            start(candidate);
          }
          if (state.runningDesired && !state.handleVisibleRan) {
            window.setTimeout(attemptStart, 100);
          }
        };
        window.setTimeout(attemptStart, 50);
      } catch (_) {}
    }
  }

  /**
   * @typedef {object} GameXpBridge
   * @property {(gameId?: string) => void} start Begin an XP session for the supplied game identifier.
   * @property {(options?: object) => void} stop Halt the active XP session, flushing the server payload by default.
   * @property {(delta: number) => void} add Award XP points, with fractional roll-up and 10k window cap alignment.
   * @property {() => void} nudge Mark the player as active for the current session.
   * @property {(gameId?: string) => void} auto Auto-start the session with lifecycle and activity wiring.
   */

  /**
   * Automatically begin an XP session for the detected game and attach lifecycle wiring.
   * @param {string} [gameId] Optional override for the game identifier.
   */
  function auto(gameId) {
    const resolved = normalizeGameId(gameId) || detectGameId();
    const slugged = slugifyGameId(resolved);
    state.runningDesired = true;
    if (!isHostDocument()) {
      if (slugged) {
        state.lastGameId = slugged;
      }
      return;
    }
    ensureAutoBootGuard();
    if (!slugged) {
      return;
    }
    const xp = getXp();
    const running = xp && typeof xp.isRunning === "function" ? !!xp.isRunning() : false;
    if (autoBootedSlug && slugged === autoBootedSlug && running) {
      return;
    }
    autoBootedSlug = slugged;
    start(slugged);
  }

  /**
   * Start or resume awarding XP for the provided game.
   * @param {string} [gameId] Identifier used when reporting XP windows.
   */
  function start(gameId) {
    const resolved = normalizeGameId(gameId) || detectGameId();
    const slugged = slugifyGameId(resolved);
    if (!slugged) {
      state.pendingStartGameId = null;
      return;
    }
    ensureAutoBootGuard();
    state.handleVisibleRan = true;
    const xp = getXp();
    state.lastGameId = slugged;
    try { if (window) window.__GAME_ID__ = slugged; } catch (_) {}
    updateXpSessionGameId(xp, slugged);
    const running = xp && typeof xp.isRunning === "function" ? !!xp.isRunning() : false;
    const currentGameId = xp && xp.__lastGameId ? slugifyGameId(xp.__lastGameId) : null;

    if (running && currentGameId === slugged) {
      try {
        if (xp && typeof xp.nudge === "function") {
          xp.nudge({ skipMark: true });
        }
      } catch (_) {}
      state.runningDesired = true;
      state.pendingStopOptions = null;
      state.pendingStartGameId = null;
      return;
    }

    if (running && currentGameId && currentGameId !== slugged) {
      try { xp.stopSession({ flush: true }); } catch (_) {}
    }

    state.runningDesired = true;
    resetSessionAccounting();
    state.pendingStopOptions = null;
    state.pendingStartGameId = slugged;
    if (!flush()) scheduleFlush();
  }

  /**
   * Stop the active XP session. Flushes by default to preserve awards.
   * @param {{ flush?: boolean }} [options]
   */
  function stop(options) {
    state.runningDesired = false;
    state.pendingStartGameId = null;
    resetSessionAccounting();
    const opts = options && typeof options === "object" ? { ...options } : {};
    if (!Object.prototype.hasOwnProperty.call(opts, "flush")) {
      opts.flush = true;
    }
    state.pendingStopOptions = opts;
    const xp = getXp();
    updateXpSessionGameId(xp, null);
    if (!flush()) scheduleFlush();
  }

  /**
   * Queue an XP award, aggregating fractional adds until a whole number is earned.
   * @param {number} delta Amount of XP to add.
   */
  function add(delta) {
    const numeric = Number(delta);
    if (!Number.isFinite(numeric) || numeric <= 0) return;

    if (!Number.isFinite(state.remainder)) state.remainder = 0;

    state.remainder += numeric;
    const whole = Math.floor(state.remainder);
    if (whole <= 0) return;

    state.remainder -= whole;

    const maxScoreDelta = resolveScoreDeltaCeiling();
    const usable = Math.min(whole, maxScoreDelta);
    const unused = whole - usable;
    if (unused > 0) state.remainder += unused;
    if (usable <= 0) return;

    state.queuedWhole = Math.min(maxScoreDelta, state.queuedWhole + usable);
    if (!flush()) scheduleFlush();
  }

  /**
   * Signal user activity to keep the XP session active.
   */
  function nudge() {
    const xp = getXp();
    if (xp && typeof xp.nudge === "function") {
      try { xp.nudge(); return; } catch (_) {}
    }
    if (window && window.parent && window.parent !== window && typeof window.parent.postMessage === "function") {
      const targetOrigin = window.location?.origin;
      if (targetOrigin && targetOrigin !== "null") {
        try { window.parent.postMessage({ type: "kcswh:activity", userGesture: true }, targetOrigin); } catch (_) {}
      }
    }
  }

  const bridge = window.GameXpBridge || {};
  bridge.auto = auto;
  bridge.start = start;
  bridge.stop = stop;
  bridge.cleanup = cleanup;
  bridge.add = add;
  bridge.nudge = nudge;
  bridge.getCurrentGameId = function getCurrentGameId() {
    const pageId = resolvePageGameId();
    if (pageId) return pageId;
    const xp = getXp();
    const sessionId = resolveSessionGameId(xp);
    const slugged = slugifyGameId(sessionId);
    if (slugged) return slugged;
    const detected = slugifyGameId(detectGameId());
    return detected;
  };
  bridge.getHighScore = getHighScore;
  bridge.setHighScore = setHighScore;
  bridge.updateHighScoreIfBetter = updateHighScoreIfBetter;
  bridge.gameOver = function gameOver(payload) {
    const data = payload && typeof payload === "object" ? payload : {};
    const gameId = slugifyGameId(data.gameId) || resolveBridgeGameId();
    const result = updateHighScoreIfBetter(gameId, data.score);
    emitBoostStop("gameOver", gameId);
    return result;
  };
  bridge.isActiveGameWindow = function isActiveGameWindow() {
    if (!window || !document) return false;
    try {
      if (typeof document.visibilityState === "string" && document.visibilityState !== "visible") return false;
      if (document.hidden === true) return false;
    } catch (_) {}
    const pageId = resolvePageGameId();
    if (!pageId) return false;
    const xp = getXp();
    const sessionId = slugifyGameId(resolveSessionGameId(xp));
    if (!sessionId) return false;
    if (sessionId !== pageId) return false;
    let running = false;
    if (xp && typeof xp.isRunning === "function") {
      try { running = !!xp.isRunning(); } catch (_) { running = false; }
    }
    if (!running && !state.runningDesired) return false;
    return true;
  };

  window.GameXpBridge = bridge;
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
