(function (window, document) {
  if (typeof window === "undefined") return;

  const DEFAULT_SCORE_DELTA_CEILING = 10_000;

  function dispatchXpEvent(name, detail) {
    if (!window || typeof window.dispatchEvent !== "function") return false;
    const payload = detail && typeof detail === "object" ? detail : null;
    if (!payload) return false;
    try {
      if (typeof CustomEvent === "function") {
        const evt = new CustomEvent(name, { detail: payload });
        window.dispatchEvent(evt);
        return true;
      }
    } catch (_) {}
    if (!document || typeof document.createEvent !== "function") return false;
    try {
      const legacy = document.createEvent("CustomEvent");
      legacy.initCustomEvent(name, false, false, payload);
      window.dispatchEvent(legacy);
      return true;
    } catch (_) {}
    return false;
  }

  function sanitizeProgress(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 0) return 0;
    if (numeric >= 1) return 1;
    return numeric;
  }

  function dispatchXpTick(detail) {
    if (!detail || typeof detail !== "object") return false;
    const awarded = Number(detail.awarded);
    const comboRaw = Number(detail.combo);
    const boostRaw = Number(detail.boost);
    const ts = Number(detail.ts);
    if (!Number.isFinite(awarded) || awarded < 0) return false;
    if (!Number.isFinite(comboRaw) || comboRaw < 1) return false;
    if (!Number.isFinite(boostRaw) || boostRaw < 1) return false;
    if (!Number.isFinite(ts)) return false;
    const progress = sanitizeProgress(detail.progressToNext);
    const payload = {
      awarded,
      combo: Math.max(1, Math.floor(comboRaw)),
      boost: Math.max(1, boostRaw),
      progressToNext: progress,
      ts,
    };
    if (detail.gameId != null) {
      const gameIdText = String(detail.gameId).trim();
      if (gameIdText) {
        payload.gameId = gameIdText;
      }
    }
    if (detail.base != null) {
      const base = Number(detail.base);
      if (Number.isFinite(base) && base >= 0) {
        payload.base = base;
      }
    }
    if (detail.total != null) {
      const total = Number(detail.total);
      if (Number.isFinite(total) && total >= 0) {
        payload.total = total;
      }
    }
    return dispatchXpEvent("xp:tick", payload);
  }

  function dispatchXpBoost(detail) {
    if (!detail || typeof detail !== "object") return false;
    const multiplier = Number(detail.multiplier);
    const secondsLeft = Number(detail.secondsLeft);
    if (!Number.isFinite(multiplier) || multiplier < 1) return false;
    if (!Number.isFinite(secondsLeft) || secondsLeft < 0) return false;
    const payload = {
      multiplier: multiplier < 1 ? 1 : multiplier,
      secondsLeft: secondsLeft <= 0 ? 0 : Math.floor(secondsLeft),
    };
    if (detail.source != null) {
      const sourceText = String(detail.source).trim();
      if (sourceText) {
        payload.source = sourceText;
      }
    }
    if (detail.gameId != null) {
      const gameIdText = String(detail.gameId).trim();
      if (gameIdText) {
        payload.gameId = gameIdText;
      }
    }
    return dispatchXpEvent("xp:boost", payload);
  }

  function parseNumber(value, fallback) {
    if (value == null) return fallback;
    const sanitized = typeof value === "string" ? value.replace(/_/g, "") : value;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : fallback;
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

  const MIN_FLUSH_DELAY_MS = 16;
  const MAX_FLUSH_DELAY_MS = 1000;

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
    activeGameId: null,
    sessionScore: 0,
    sessionHighScore: 0,
    sessionRecordActive: false,
    lastScorePulseTs: 0,
    idleTickerId: null,
  };

  let autoBootedSlug = null;
  let autoBootstrapped = false;
  let autoBootGuarded = false;
  let boostLifecycleBound = false;

  const RECORD_KEY_PREFIX = "ap:hs:";
  const RECORD_BOOST_SENTINEL_SECONDS = 9999;
  const RECORD_DEFAULT_MULTIPLIER = 1.5;
  const BOOST_KEEPALIVE_MS = 2000;
  const BOOST_IDLE_LIMIT_MS = 20_000;

  let _boostActive = false;
  let _boostMultiplier = RECORD_DEFAULT_MULTIPLIER;
  let _boostTicker = null;
  let _boostSecondsLeft = 0;
  let _boostSource = "newRecord";
  let _boostGameId = null;

  function ensureAutoBootstrapped() {
    if (autoBootstrapped) return;
    autoBootstrapped = true;
    ensureAutoListeners();
    ensureDomReadyKickoff();
    ensureBoostLifecycle();
  }

  function ensureAutoBootGuard() {
    if (autoBootGuarded) return;
    autoBootGuarded = true;
    ensureAutoBootstrapped();
  }

  function getStorage() {
    if (!window || !window.localStorage) return null;
    try {
      return window.localStorage;
    } catch (_) {
      return null;
    }
  }

  function storageKeyFor(gameId) {
    const slug = slugifyGameId(gameId);
    if (!slug) return null;
    return `${RECORD_KEY_PREFIX}${slug}`;
  }

  function getHighScore(gameId) {
    const key = storageKeyFor(gameId);
    if (!key) return 0;
    const store = getStorage();
    if (!store || typeof store.getItem !== "function") return 0;
    try {
      const raw = store.getItem(key);
      if (!raw) return 0;
      const parsed = parseInt(String(raw).replace(/[^0-9-]/g, ""), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (_) {
      return 0;
    }
  }

  function setHighScore(gameId, score) {
    const key = storageKeyFor(gameId);
    if (!key) return;
    const store = getStorage();
    if (!store || typeof store.setItem !== "function") return;
    const value = Math.max(0, Math.floor(Number(score) || 0));
    try {
      store.setItem(key, String(value));
    } catch (_) {}
  }

  function updateHighScoreIfBetter(gameId, score) {
    const slug = slugifyGameId(gameId);
    if (!slug) {
      return { isNewRecord: false, previous: 0, current: 0 };
    }
    const previous = getHighScore(slug);
    const value = Math.max(0, Math.floor(Number(score) || 0));
    if (value > previous) {
      setHighScore(slug, value);
      return { isNewRecord: true, previous, current: value };
    }
    return { isNewRecord: false, previous, current: previous };
  }

  function clearBoostTicker() {
    if (_boostTicker) {
      try { window.clearInterval(_boostTicker); } catch (_) {}
      _boostTicker = null;
    }
  }

  function emitBoost(detail) {
    try { dispatchXpBoost(detail); } catch (_) {}
  }

  function requestRuntimeBoost(multiplier, reason) {
    const xp = getXp();
    if (!xp || typeof xp.requestBoost !== "function") return;
    try { xp.requestBoost({ multiplier, ttlMs: BOOST_KEEPALIVE_MS, reason }); } catch (_) {}
  }

  function stopBoost(reason, forceEmit) {
    const endReason = reason == null ? "gameOver" : String(reason);
    const force = forceEmit === true;
    const lastGameId = _boostGameId || state.activeGameId || state.lastGameId;
    if (!_boostActive && !_boostTicker) {
      if (force) {
        requestRuntimeBoost(1, endReason);
        emitBoost({ multiplier: 1, secondsLeft: 0, source: endReason, gameId: lastGameId });
      }
      _boostGameId = null;
      _boostSecondsLeft = 0;
      return;
    }
    clearBoostTicker();
    _boostActive = false;
    _boostSecondsLeft = 0;
    _boostGameId = null;
    requestRuntimeBoost(1, endReason);
    emitBoost({ multiplier: 1, secondsLeft: 0, source: endReason, gameId: lastGameId });
  }

  function maintainBoostKeepAlive() {
    if (!_boostActive) return;
    _boostSecondsLeft = Math.max(1, _boostSecondsLeft - 1);
    requestRuntimeBoost(_boostMultiplier, _boostSource);
    emitBoost({
      multiplier: _boostMultiplier,
      secondsLeft: _boostSecondsLeft,
      source: _boostSource,
      gameId: _boostGameId,
    });
  }

  function startNewRecordBoost(gameId, multiplier) {
    const slug = slugifyGameId(gameId || state.activeGameId || state.lastGameId);
    if (!slug) return;
    if (!isActiveGameWindow(slug)) return;
    const desired = Number(multiplier);
    const normalized = Number.isFinite(desired) ? Math.max(1, desired) : RECORD_DEFAULT_MULTIPLIER;
    if (normalized <= 1) return;
    if (_boostActive && _boostGameId === slug) {
      requestRuntimeBoost(_boostMultiplier, _boostSource);
      return;
    }
    if (_boostActive && _boostGameId && _boostGameId !== slug) {
      stopBoost("sessionSwitch");
    }
    _boostActive = true;
    _boostMultiplier = normalized;
    _boostGameId = slug;
    _boostSource = "newRecord";
    _boostSecondsLeft = RECORD_BOOST_SENTINEL_SECONDS;
    state.sessionRecordActive = true;
    requestRuntimeBoost(_boostMultiplier, _boostSource);
    emitBoost({
      multiplier: _boostMultiplier,
      secondsLeft: _boostSecondsLeft,
      source: _boostSource,
      gameId: _boostGameId,
    });
    clearBoostTicker();
    if (typeof window.setInterval === "function") {
      _boostTicker = window.setInterval(maintainBoostKeepAlive, 1000);
    }
  }

  function isBoostActive() {
    return _boostActive === true;
  }

  function ensureBoostLifecycle() {
    if (boostLifecycleBound) return;
    boostLifecycleBound = true;
    const handleHidden = () => { stopBoost("hidden", true); };
    if (document && typeof document.addEventListener === "function") {
      try { document.addEventListener("xp:hidden", handleHidden, { passive: true }); } catch (_) {
        try { document.addEventListener("xp:hidden", handleHidden); } catch (_) {}
      }
    }
  }

  function ensureIdleTicker() {
    if (state.idleTickerId || !window || typeof window.setInterval !== "function") return;
    state.idleTickerId = window.setInterval(() => {
      if (!_boostActive) return;
      if (!state.lastScorePulseTs) return;
      if ((Date.now() - state.lastScorePulseTs) >= BOOST_IDLE_LIMIT_MS) {
        stopBoost("idle");
      }
    }, 1000);
  }

  function clearIdleTicker() {
    if (!state.idleTickerId) return;
    try { window.clearInterval(state.idleTickerId); } catch (_) {}
    state.idleTickerId = null;
  }

  function recordScorePulse(gameId, score) {
    const slug = slugifyGameId(gameId || state.activeGameId || state.lastGameId);
    const numeric = Math.max(0, Math.floor(Number(score) || 0));
    if (!slug || numeric < 0) return;
    state.lastScorePulseTs = Date.now();
    if (!isActiveGameWindow(slug)) return;
    if (numeric > state.sessionScore) {
      state.sessionScore = numeric;
    }
    const stored = state.sessionHighScore || getHighScore(slug);
    state.sessionHighScore = stored;
    if (!_boostActive && !state.sessionRecordActive && numeric > stored) {
      startNewRecordBoost(slug, RECORD_DEFAULT_MULTIPLIER);
    }
  }

  function isDocumentVisible() {
    if (!document) return false;
    if (typeof document.visibilityState === "string") {
      return document.visibilityState === "visible";
    }
    if (typeof document.hidden === "boolean") {
      return document.hidden === false;
    }
    return true;
  }

  function isActiveGameWindow(gameId) {
    const xp = getXp();
    const running = xp && typeof xp.isRunning === "function" ? !!xp.isRunning() : false;
    if (!running) return false;
    if (!isDocumentVisible()) return false;
    const requested = slugifyGameId(gameId || state.activeGameId || state.lastGameId);
    const current = slugifyGameId(state.activeGameId || state.lastGameId);
    if (!requested || !current) return false;
    return requested === current;
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

    const title = document && normalizeGameId(document.title);
    if (title) return title;

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
      const amount = state.queuedWhole;
      state.queuedWhole = 0;
      try {
        xp.addScore(amount);
      } catch (_) {
        state.queuedWhole += amount;
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

    const activity = () => {
      try { nudge(); } catch (_) {}
    };

    if (document && typeof document.addEventListener === "function") {
      document.addEventListener("xp:visible", handleVisible, { passive: true });
      document.addEventListener("xp:hidden", handleHidden, { passive: true });
    }

    if (window && typeof window.addEventListener === "function") {
      ["pointerdown", "pointerup", "keydown", "keyup", "touchstart", "wheel"].forEach((evt) => {
        try { window.addEventListener(evt, activity, { passive: true }); } catch (_) {}
      });
      try {
        window.addEventListener("message", (event) => {
          try {
            if (!event || !event.data || typeof event.data !== "object") return;
            if (event.origin && window.location && event.origin !== window.location.origin) return;
            if (event.data.type !== "game-score") return;
            recordScorePulse(event.data.gameId, event.data.score);
          } catch (_) {}
        }, { passive: true });
      } catch (_) {
        try {
          window.addEventListener("message", (event) => {
            try {
              if (!event || !event.data || typeof event.data !== "object") return;
              if (event.origin && window.location && event.origin !== window.location.origin) return;
              if (event.data.type !== "game-score") return;
              recordScorePulse(event.data.gameId, event.data.score);
            } catch (_) {}
          });
        } catch (_) {}
      }
    }
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
      state.runningDesired = false;
      state.pendingStartGameId = null;
      return;
    }
    ensureAutoBootGuard();
    const xp = getXp();
    state.lastGameId = slugged;
    state.activeGameId = slugged;
    state.sessionScore = 0;
    state.sessionHighScore = getHighScore(slugged);
    state.sessionRecordActive = false;
    state.lastScorePulseTs = Date.now();
    ensureIdleTicker();
    const running = xp && typeof xp.isRunning === "function" ? !!xp.isRunning() : false;
    const currentGameId = xp && xp.__lastGameId ? slugifyGameId(xp.__lastGameId) : null;

    if (running && currentGameId === slugged) {
      try { xp.startSession(slugged); } catch (_) {}
      state.runningDesired = true;
      state.pendingStopOptions = null;
      state.pendingStartGameId = null;
      return;
    }

    if (running && currentGameId && currentGameId !== slugged) {
      stopBoost("sessionSwitch");
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
    if (!flush()) scheduleFlush();
    if (state.activeGameId) {
      if (state.sessionScore > 0) {
        updateHighScoreIfBetter(state.activeGameId, state.sessionScore);
      }
    }
    state.sessionScore = 0;
    state.sessionRecordActive = false;
    state.sessionHighScore = state.activeGameId ? getHighScore(state.activeGameId) : 0;
    state.activeGameId = null;
    state.lastScorePulseTs = 0;
    clearIdleTicker();
    stopBoost("sessionEnd");
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
      try { window.parent.postMessage({ type: "kcswh:activity", userGesture: true }, window.location ? window.location.origin || "*" : "*"); } catch (_) {}
    }
  }

  const bridge = window.GameXpBridge || {};
  bridge.auto = auto;
  bridge.start = start;
  bridge.stop = stop;
  bridge.add = add;
  bridge.nudge = nudge;
  bridge.dispatchXpTick = dispatchXpTick;
  bridge.dispatchXpBoost = dispatchXpBoost;
  bridge.gameOver = function (payload) {
    const detail = payload && typeof payload === "object" ? payload : {};
    const rawScore = detail.score;
    const rawGameId = detail.gameId || state.activeGameId || state.lastGameId;
    if (rawGameId) {
      const slug = slugifyGameId(rawGameId);
      if (slug && Number.isFinite(Number(rawScore))) {
        updateHighScoreIfBetter(slug, rawScore);
      }
    }
    if (state.sessionScore > 0 && state.activeGameId) {
      updateHighScoreIfBetter(state.activeGameId, Math.max(state.sessionScore, Number(rawScore) || 0));
    }
    state.sessionScore = 0;
    state.sessionHighScore = state.activeGameId ? getHighScore(state.activeGameId) : 0;
    state.sessionRecordActive = false;
    state.lastScorePulseTs = 0;
    if (_boostActive && (!_boostGameId || _boostGameId === slugifyGameId(rawGameId))) {
      stopBoost("gameOver");
    }
  };
  bridge.isBoostActive = isBoostActive;
  bridge.isActiveGameWindow = isActiveGameWindow;
  bridge.startNewRecordBoost = startNewRecordBoost;
  bridge.stopBoost = stopBoost;
  bridge.getHighScore = getHighScore;
  bridge.setHighScore = setHighScore;
  bridge.updateHighScoreIfBetter = updateHighScoreIfBetter;

  window.GameXpBridge = bridge;
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
