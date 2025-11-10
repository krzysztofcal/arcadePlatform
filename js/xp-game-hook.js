(function (window, document) {
  if (typeof window === "undefined") return;

  const DEFAULT_SCORE_DELTA_CEILING = 10_000;
  const RUNTIME_CACHE_KEY = "kcswh:xp:regen";
  const TICK_EVENT = "xp:tick";
  const BOOST_EVENT = "xp:boost";
  const UPDATED_EVENT = "xp:updated";

  const overlayBridgeState = {
    wired: false,
    lastBoostKey: null,
    lastTotalXp: null,
  };

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
  };

  let autoBootedSlug = null;
  let autoBootstrapped = false;
  let autoBootGuarded = false;

  function ensureAutoBootstrapped() {
    if (autoBootstrapped) return;
    autoBootstrapped = true;
    ensureAutoListeners();
    ensureDomReadyKickoff();
    ensureOverlayBridge();
  }

  function ensureAutoBootGuard() {
    if (autoBootGuarded) return;
    autoBootGuarded = true;
    ensureAutoBootstrapped();
  }

  function safeDispatch(eventName, detail) {
    if (!window || typeof window.dispatchEvent !== "function") return;
    const payload = detail && typeof detail === "object" ? { ...detail } : {};
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
    } catch (_) {
      try {
        if (typeof document !== "undefined" && document.createEvent) {
          const legacyEvt = document.createEvent("CustomEvent");
          legacyEvt.initCustomEvent(eventName, false, false, payload);
          window.dispatchEvent(legacyEvt);
        }
      } catch (_) {}
    }
  }

  function clamp01(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 0) return 0;
    if (numeric >= 1) return 1;
    return numeric;
  }

  function readRuntimeState() {
    if (!window || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(RUNTIME_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function readComboInfo(runtime) {
    const combo = runtime && Number(runtime.comboCount);
    if (!Number.isFinite(combo) || combo <= 0) {
      return { count: 0, multiplier: 1 };
    }
    const count = Math.max(0, Math.floor(combo));
    if (count <= 1) {
      return { count, multiplier: 1 };
    }
    const bonus = Math.min(0.75, count * 0.03);
    return {
      count,
      multiplier: 1 + bonus,
    };
  }

  function readBoostFromRuntime(runtime) {
    if (!runtime || typeof runtime !== "object") return null;
    const raw = runtime.boost;
    if (!raw || typeof raw !== "object") return null;
    const multiplier = parseNumber(raw.multiplier, NaN);
    if (!Number.isFinite(multiplier) || multiplier <= 1) return null;
    const expiresAt = parseNumber(raw.expiresAt, NaN);
    const now = Date.now();
    const secondsLeft = Number.isFinite(expiresAt)
      ? Math.max(0, Math.round((expiresAt - now) / 1000))
      : 0;
    return {
      multiplier: Math.max(1, multiplier),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      secondsLeft,
    };
  }

  function getSnapshot() {
    if (!window || !window.XP || typeof window.XP.getSnapshot !== "function") return null;
    try {
      return window.XP.getSnapshot();
    } catch (_) {
      return null;
    }
  }

  function buildTickDetail(awarded, runtime, snapshot) {
    const snap = typeof snapshot === "undefined" ? getSnapshot() : snapshot;
    const comboInfo = readComboInfo(runtime);
    const combo = comboInfo.multiplier;
    const boostInfo = readBoostFromRuntime(runtime);
    const boost = boostInfo ? boostInfo.multiplier : 1;
    const progress = snap && typeof snap.progress === "number"
      ? clamp01(snap.progress)
      : 0;
    const detail = {
      awarded: Math.max(0, Math.round(awarded)),
      combo,
      boost: Math.max(1, Number(boost) || 1),
      progressToNext: progress,
      ts: Date.now(),
    };
    if (comboInfo.count != null) {
      detail.comboCount = comboInfo.count;
    }
    if (snap && typeof snap.totalXp === "number") {
      detail.total = snap.totalXp;
    }
    return detail;
  }

  function maybeEmitBoost(detail) {
    if (!detail || typeof detail !== "object") return;
    const multiplier = parseNumber(detail.multiplier, NaN);
    if (!Number.isFinite(multiplier) || multiplier <= 1) return;
    let secondsLeft = parseNumber(detail.secondsLeft, NaN);
    if (!Number.isFinite(secondsLeft)) {
      const expiresAt = parseNumber(detail.expiresAt, NaN);
      if (Number.isFinite(expiresAt)) {
        secondsLeft = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      }
    }
    const normalizedSeconds = Number.isFinite(secondsLeft) ? Math.max(0, Math.round(secondsLeft)) : 0;
    const expiresKey = parseNumber(detail.expiresAt, NaN);
    const key = `${Math.max(1, multiplier)}:${Number.isFinite(expiresKey) ? Math.floor(expiresKey) : ""}`;
    if (overlayBridgeState.lastBoostKey === key) return;
    overlayBridgeState.lastBoostKey = key;
    const normalizedMultiplier = Math.max(1, multiplier);
    const payload = {
      multiplier: normalizedMultiplier,
      secondsLeft: normalizedSeconds,
    };
    if (normalizedSeconds > 0) {
      const ttlMs = normalizedSeconds * 1000;
      payload.ttlMs = ttlMs;
      payload.durationMs = ttlMs;
    }
    if (Number.isFinite(expiresKey)) {
      payload.expiresAt = Math.floor(expiresKey);
    }
    safeDispatch(BOOST_EVENT, payload);
    if (window && window.XP_DIAG) {
      try {
        console.log("overlay:boost_start", { multiplier: normalizedMultiplier, secondsLeft: normalizedSeconds });
      } catch (_) {}
    }
  }

  function computeBoostDetailFromEvent(detail) {
    const payload = detail && typeof detail === "object" ? detail : {};
    const runtime = readRuntimeState();
    const runtimeBoost = readBoostFromRuntime(runtime);
    let multiplier = parseNumber(payload.multiplier, NaN);
    if (!Number.isFinite(multiplier)) multiplier = parseNumber(payload.mult, NaN);
    if (!Number.isFinite(multiplier) && runtimeBoost) multiplier = runtimeBoost.multiplier;
    if (!Number.isFinite(multiplier) || multiplier <= 1) return null;

    const now = Date.now();
    let expiresAt = parseNumber(payload.expiresAt, NaN);
    if (!Number.isFinite(expiresAt)) {
      const ttlMs = parseNumber(payload.ttlMs, NaN);
      if (Number.isFinite(ttlMs)) expiresAt = now + ttlMs;
    }
    if (!Number.isFinite(expiresAt)) {
      const durationMs = parseNumber(payload.durationMs, NaN);
      if (Number.isFinite(durationMs)) expiresAt = now + durationMs;
    }
    if (!Number.isFinite(expiresAt) && runtimeBoost && runtimeBoost.expiresAt) {
      expiresAt = runtimeBoost.expiresAt;
    }

    let secondsLeft = parseNumber(payload.secondsLeft, NaN);
    if (!Number.isFinite(secondsLeft) && Number.isFinite(expiresAt)) {
      secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));
    }
    if (!Number.isFinite(secondsLeft) && runtimeBoost) {
      secondsLeft = runtimeBoost.secondsLeft;
    }

    return {
      multiplier: Math.max(1, multiplier),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      secondsLeft: Number.isFinite(secondsLeft) ? Math.max(0, Math.round(secondsLeft)) : 0,
    };
  }

  function handleXpUpdated(event) {
    let awarded = event && event.detail && typeof event.detail.awarded !== "undefined"
      ? Number(event.detail.awarded)
      : NaN;
    const runtime = readRuntimeState();
    const snapshot = getSnapshot();
    const totalXp = snapshot && typeof snapshot.totalXp === "number" ? snapshot.totalXp : null;
    if ((!Number.isFinite(awarded) || awarded < 0) && Number.isFinite(totalXp)) {
      const lastTotal = Number(overlayBridgeState.lastTotalXp);
      const delta = Number.isFinite(lastTotal) ? totalXp - lastTotal : NaN;
      if (Number.isFinite(delta) && delta > 0) {
        awarded = delta;
      }
    }
    if (!Number.isFinite(awarded) || awarded < 0) {
      overlayBridgeState.lastTotalXp = Number.isFinite(totalXp) ? totalXp : overlayBridgeState.lastTotalXp;
      return;
    }
    const detail = buildTickDetail(awarded, runtime, snapshot);
    safeDispatch(TICK_EVENT, detail);
    if (window && window.XP_DIAG) {
      try { console.log("overlay:tick", detail); } catch (_) {}
    }
    if (Number.isFinite(totalXp)) {
      overlayBridgeState.lastTotalXp = totalXp;
    }
    const boostFromRuntime = readBoostFromRuntime(runtime);
    if (boostFromRuntime) {
      maybeEmitBoost(boostFromRuntime);
    }
  }

  function handleBoost(event) {
    const computed = computeBoostDetailFromEvent(event && event.detail);
    if (computed) {
      maybeEmitBoost(computed);
    }
  }

  function ensureOverlayBridge() {
    if (overlayBridgeState.wired) return;
    if (!window || typeof window.addEventListener !== "function") return;
    overlayBridgeState.wired = true;
    try { window.addEventListener(UPDATED_EVENT, handleXpUpdated, { passive: true }); } catch (_) {
      try { window.addEventListener(UPDATED_EVENT, handleXpUpdated); } catch (_) {}
    }
    try { window.addEventListener(BOOST_EVENT, handleBoost, { passive: true }); } catch (_) {
      try { window.addEventListener(BOOST_EVENT, handleBoost); } catch (_) {}
    }
    const runtimeBoost = readBoostFromRuntime(readRuntimeState());
    if (runtimeBoost) {
      maybeEmitBoost(runtimeBoost);
    }
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

  window.GameXpBridge = bridge;
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
