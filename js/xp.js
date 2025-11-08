(function (window, document) {
  const CHUNK_MS = 10_000;
  const ACTIVE_WINDOW_MS = 5_000;
  const CACHE_KEY = "kcswh:xp:last";

  const LEVEL_BASE_XP = 100;
  const LEVEL_MULTIPLIER = 1.1;

  const DEFAULT_SCORE_DELTA_CEILING = 10_000;

  function parseNumber(value, fallback) {
    if (value == null) return fallback;
    const sanitized = typeof value === "string" ? value.replace(/_/g, "") : value;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const MAX_SCORE_DELTA = parseNumber(window && window.XP_SCORE_DELTA_CEILING, DEFAULT_SCORE_DELTA_CEILING);

  const state = {
    badge: null,
    labelEl: null,
    totalToday: null,
    totalLifetime: null,
    cap: null,
    running: false,
    gameId: null,
    windowStart: 0,
    activeMs: 0,
    visibilitySeconds: 0,
    inputEvents: 0,
    activeUntil: 0,
    lastTick: 0,
    timerId: null,
    pending: null,
    lastResultTs: 0,
    snapshot: null,
    scoreDelta: 0,
    scoreDeltaRemainder: 0,
  };

  function resetActivityCounters(now) {
    const ts = typeof now === "number" ? now : Date.now();
    state.windowStart = ts;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.activeMs = 0;
    state.activeUntil = 0;
    state.scoreDelta = 0;
    state.scoreDeltaRemainder = 0;
  }

  function isDocumentVisible() {
    if (typeof document === "undefined") return false;
    if (typeof document.hidden === "boolean") {
      return !document.hidden;
    }
    if (typeof document.visibilityState === "string") {
      return document.visibilityState === "visible";
    }
    return false;
  }

  function computeLevel(totalXp) {
    const total = Math.max(0, Number(totalXp) || 0);
    let level = 1;
    let requirement = LEVEL_BASE_XP;
    let accumulated = 0;
    while (total >= accumulated + requirement) {
      accumulated += requirement;
      level += 1;
      requirement = Math.max(1, Math.ceil(requirement * LEVEL_MULTIPLIER));
    }
    const xpIntoLevel = total - accumulated;
    const xpForNextLevel = requirement;
    const xpToNextLevel = Math.max(0, xpForNextLevel - xpIntoLevel);
    const progress = xpForNextLevel > 0 ? xpIntoLevel / xpForNextLevel : 0;
    return { level, totalXp: total, xpIntoLevel, xpForNextLevel, xpToNextLevel, progress };
  }

  function loadCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.totalToday === "number") state.totalToday = parsed.totalToday;
      if (typeof parsed.cap === "number") state.cap = parsed.cap;
      if (typeof parsed.totalLifetime === "number") state.totalLifetime = parsed.totalLifetime;
      state.lastResultTs = parsed.ts || 0;
    } catch (_) { /* ignore */ }
  }

  function saveCache() {
    try {
      const payload = {
        totalToday: state.totalToday,
        cap: state.cap,
        totalLifetime: state.totalLifetime,
        ts: Date.now(),
      };
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) { /* ignore */ }
  }

  function ensureBadgeElements() {
    if (!state.badge) return;
    if (!state.labelEl || !state.badge.contains(state.labelEl)) {
      state.labelEl = state.badge.querySelector(".xp-badge__label");
      if (!state.labelEl) {
        state.labelEl = document.createElement("span");
        state.labelEl.className = "xp-badge__label";
        state.badge.textContent = "";
        state.badge.appendChild(state.labelEl);
      }
    }
  }

  function setBadgeLoading(isLoading) {
    if (!state.badge) return;
    state.badge.setAttribute("aria-busy", isLoading ? "true" : "false");
    state.badge.classList.toggle("xp-badge--loading", !!isLoading);
  }

  function updateBadge() {
    if (!state.badge) return;
    ensureBadgeElements();
    if (state.totalToday == null) {
      state.totalToday = 0;
    }
    if (state.totalLifetime == null) {
      state.totalLifetime = 0;
    }
    state.snapshot = computeLevel(state.totalLifetime);
    const totalText = state.snapshot.totalXp.toLocaleString();
    state.labelEl.textContent = `Lvl ${state.snapshot.level}, ${totalText} XP`;
    setBadgeLoading(false);
  }

  function refreshBadgeFromStorage() {
    attachBadge();
    if (!state.badge) return;
    state.snapshot = null;
    loadCache();
    updateBadge();
  }

  function bumpBadge() {
    if (!state.badge) return;
    state.badge.classList.remove("xp-badge--bump");
    void state.badge.offsetWidth; // force reflow
    state.badge.classList.add("xp-badge--bump");
  }

  function attachBadge() {
    if (state.badge) return;
    if (document && typeof document.querySelector === "function") {
      state.badge = document.querySelector(".xp-badge__link, #xpBadge, .xp-badge");
    } else {
      const getByClass = (cls) => {
        if (!document || typeof document.getElementsByClassName !== "function") return null;
        const list = document.getElementsByClassName(cls);
        if (!list || !list.length) return null;
        return list[0] || null;
      };
      const byLink = getByClass("xp-badge__link");
      const byId = document && typeof document.getElementById === "function" ? document.getElementById("xpBadge") : null;
      const byWrapper = getByClass("xp-badge");
      state.badge = byLink || byId || byWrapper || null;
    }
    if (!state.badge) return;
    ensureBadgeElements();
    state.badge.addEventListener("animationend", (event) => {
      if (event.animationName === "xp-badge-bump") {
        state.badge.classList.remove("xp-badge--bump");
      }
    });
    maybeRefreshStatus();
  }

  function handleResponse(data) {
    if (!data || typeof data !== "object") return;
    if (typeof data.totalToday === "number") {
      const previous = state.totalToday;
      state.totalToday = data.totalToday;
      if (data.cap != null) state.cap = data.cap;
      if (typeof data.totalLifetime === "number") state.totalLifetime = data.totalLifetime;
      if (data.awarded && data.awarded > 0 && typeof previous === "number") {
        bumpBadge();
      }
      state.lastResultTs = Date.now();
      saveCache();
      updateBadge();
    }
    setBadgeLoading(false);
  }

  function handleError(err) {
    if (window.console && console.debug) {
      console.debug("XP window failed", err);
    }
    setBadgeLoading(false);
  }

  async function sendWindow(force) {
    if (!state.running || !window.XPClient || typeof window.XPClient.postWindow !== "function") return;
    if (state.pending) return;
    const now = Date.now();
    const elapsed = now - state.windowStart;
    if (!force && elapsed < CHUNK_MS) return;
    const visibilitySecondsRaw = state.visibilitySeconds;
    const visibility = Math.round(visibilitySecondsRaw);
    const inputs = state.inputEvents;
    /* xp idle guard */
    if (!isDocumentVisible()) {
      state.windowStart = now;
      state.activeMs = 0;
      state.visibilitySeconds = 0;
      state.inputEvents = 0;
      return;
    }
    const _minInputsGate = Math.max(2, Math.ceil(CHUNK_MS / 4000));
    if (visibilitySecondsRaw <= 1 || inputs < _minInputsGate) {
      state.windowStart = now;
      state.activeMs = 0;
      state.visibilitySeconds = 0;
      state.inputEvents = 0;
      return;
    }

    const payload = {
      gameId: state.gameId || "game",
      windowStart: state.windowStart,
      windowEnd: now,
      visibilitySeconds: visibility,
      inputEvents: inputs,
      chunkMs: CHUNK_MS,
      pointsPerPeriod: 10
    };
    if (state.scoreDelta > 0) {
      payload.scoreDelta = state.scoreDelta;
    }
    state.windowStart = now;
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.pending = window.XPClient.postWindow(payload)
      .then((data) => handleResponse(data))
      .catch(handleError)
      .finally(() => { state.pending = null; });
    state.scoreDelta = 0;
  }

  function tick() {
    const now = Date.now();
    const delta = state.lastTick ? Math.max(0, now - state.lastTick) : 0;
    state.lastTick = now;
    if (!state.running) return;
    const visible = isDocumentVisible();
    if (!visible) {
      resetActivityCounters(now);
      return;
    }

    state.visibilitySeconds += delta / 1000;
    if (now <= state.activeUntil) {
      state.activeMs += delta;
    }
    if (state.activeMs >= CHUNK_MS) {
      sendWindow(false);
    }
  }

  function ensureTimer() {
    if (state.timerId) return;
    state.lastTick = Date.now();
    state.timerId = window.setInterval(tick, 1000);
  }

  function clearTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function startSession(gameId) {
    attachBadge();
    ensureTimer();

    state.running = true;
    state.gameId = gameId || "game";
    state.windowStart = Date.now();
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.activeUntil = Date.now();
    state.scoreDelta = 0;
    state.scoreDeltaRemainder = 0;
  }

  function stopSession(options) {
    const opts = options || {};
    /* xp stop flush guard */ if (state.running && opts.flush !== false) {
      const _minInputsGate = Math.max(2, Math.ceil(CHUNK_MS / 4000));
      if (!(state.visibilitySeconds > 1 && state.inputEvents >= _minInputsGate)) {
        // skip network flush if idle
      } else {
      sendWindow(true); }
    }
    state.running = false;
    state.gameId = null;
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.activeUntil = 0;
    state.scoreDelta = 0;
    state.scoreDeltaRemainder = 0;
  }

  function nudge() {
    state.activeUntil = Date.now() + ACTIVE_WINDOW_MS;
    state.inputEvents += 1;
  }

  function addScore(delta) {
    const numeric = Number(delta);
    if (!Number.isFinite(numeric)) return;
    if (numeric <= 0) return;

    if (!Number.isFinite(state.scoreDeltaRemainder)) {
      state.scoreDeltaRemainder = 0;
    }

    state.scoreDeltaRemainder += numeric;
    if (state.scoreDeltaRemainder < 1) {
      return;
    }

    const whole = Math.floor(state.scoreDeltaRemainder);
    if (whole <= 0) {
      state.scoreDeltaRemainder = Math.max(0, state.scoreDeltaRemainder);
      return;
    }

    const current = Math.max(0, Math.round(state.scoreDelta));
    const capacity = Math.max(0, MAX_SCORE_DELTA - current);
    if (capacity <= 0) {
      state.scoreDeltaRemainder = Math.max(0, state.scoreDeltaRemainder);
      return;
    }

    const toAdd = Math.min(whole, capacity);
    state.scoreDelta = current + toAdd;
    state.scoreDeltaRemainder = Math.max(0, state.scoreDeltaRemainder - toAdd);
  }

  function setTotals(total, cap) {
    state.totalToday = typeof total === "number" ? total : state.totalToday;
    state.cap = typeof cap === "number" ? cap : state.cap;
    if (arguments.length >= 3 && typeof arguments[2] === "number") {
      state.totalLifetime = arguments[2];
    }
    saveCache();
    updateBadge();
  }

  function getSnapshot() {
    if (!state.snapshot) {
      state.snapshot = computeLevel(state.totalLifetime || 0);
    }
    return {
      totalToday: typeof state.totalToday === "number" ? state.totalToday : 0,
      cap: state.cap != null ? state.cap : null,
      totalXp: state.snapshot.totalXp,
      level: state.snapshot.level,
      xpIntoLevel: state.snapshot.xpIntoLevel,
      xpForNextLevel: state.snapshot.xpForNextLevel,
      xpToNextLevel: state.snapshot.xpToNextLevel,
      progress: state.snapshot.progress,
      lastSync: state.lastResultTs || 0,
    };
  }

  function refreshStatus() {
    if (!window.XPClient || typeof window.XPClient.fetchStatus !== "function") return Promise.resolve(null);
    setBadgeLoading(true);
    return window.XPClient.fetchStatus()
      .then((data) => { handleResponse(data); return data; })
      .catch((err) => { handleError(err); throw err; });
  }

  function maybeRefreshStatus() {
    const now = Date.now();
    const staleMs = 60_000;
    if (!state.lastResultTs || (now - state.lastResultTs) > staleMs) {
      refreshStatus().catch(() => {});
    }
  }

  function init() {
    if (typeof document !== "undefined") {
      const handleDomReady = () => { try { refreshBadgeFromStorage(); } catch (_) {} };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", handleDomReady, { once: true });
      } else {
        handleDomReady();
      }
      document.addEventListener("visibilitychange", () => {
        const now = Date.now();
        state.lastTick = now;
        if (!isDocumentVisible()) {
          resetActivityCounters(now);
        } else {
          refreshBadgeFromStorage();
        }
      }, { passive: true });
    }

    if (typeof window !== "undefined") {
      ensureTimer();

      window.addEventListener("pageshow", () => {
        try {
          refreshBadgeFromStorage();
        } catch (_) {}
      }, { passive: true });

      window.addEventListener("focus", () => {
        try {
          refreshBadgeFromStorage();
        } catch (_) {}
      }, { passive: true });

      window.addEventListener("storage", (event) => {
        try {
          if (!event) return;
          if (event.storageArea && event.storageArea !== window.localStorage) return;
          if (event.key && event.key !== CACHE_KEY) return;
          refreshBadgeFromStorage();
        } catch (_) {}
      });

      window.addEventListener("xp:updated", () => {
        try { refreshBadgeFromStorage(); } catch (_) {}
      });

      // Hardened activity bridge (same-origin, visible doc, requires userGesture:true, throttled)
    (function(){
      let __lastNudgeTs = 0;
      window.addEventListener("message", (event) => {
        try {
          if (!event || !event.data) return;
          if (typeof document !== "undefined" && document.hidden) return;
          if (event.origin && typeof location !== "undefined" && event.origin !== location.origin) return;
          if (event.data.type !== "kcswh:activity") return;
          if (event.data.userGesture !== true) return;

          const now = Date.now();
          if (now - __lastNudgeTs < 100) return; // ~10/sec
          __lastNudgeTs = now;

          if (typeof nudge === "function") nudge();
        } catch {}
      }, { passive: true });
    })();

    // Top-frame input listeners -> nudge (only on real user gestures)
    (function(){
      // Decide if this event represents a true user gesture (not synthetic noise)
      function isRealUserGesture(e){
        // Prefer the platform signal if present
        if (typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.isActive) return true;
        // Fallback heuristics
        if (!e || e.isTrusted === false) return false;
        switch (e.type) {
          case "pointerdown":
          case "touchstart":
          case "keydown":
          case "wheel":
            return true;
          // Explicitly ignore move/hover; too noisy and often synthetic in headless runs
          case "pointermove":
          case "mousemove":
          default:
            return false;
        }
      }

      ["pointerdown","keydown","wheel","touchstart" /* no 'pointermove' */].forEach(evt => {
        try {
          window.addEventListener(evt, (ev) => {
            try { if (isRealUserGesture(ev) && typeof nudge === "function") nudge(); } catch(_) {}
          }, { passive: true });
        } catch(_) {}
      });
    })();
  }
}

  init();

  window.XP = Object.assign({}, window.XP || {}, {
    startSession,
    stopSession,
    nudge,
    setTotals,
    getSnapshot,
    refreshStatus,
    addScore,
    scoreDeltaCeiling: MAX_SCORE_DELTA,

    isRunning: function(){ try { return !!(typeof state !== 'undefined' ? state.running : (this && this.__running)); } catch(_) { return !!(this && this.__running); } },});
})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : undefined);
// --- XP resume polyfill (idempotent) ---
(function () {
  if (typeof window === 'undefined') return;
  if (!window.XP) return;
  if (window.XP.__xpResumeWired) return; // already wired

  window.XP.__xpResumeWired = true;

  // Wrap start/stop to track running state and last gameId
  var _origStart = typeof window.XP.startSession === 'function' ? window.XP.startSession.bind(window.XP) : null;
  var _origStop  = typeof window.XP.stopSession  === 'function' ? window.XP.stopSession.bind(window.XP)  : null;

  // Track flags on the XP object (no dependency on internal state)
  window.XP.__running = false;
  window.XP.__lastGameId = null;

  if (_origStart) {
    window.XP.startSession = function (gameId) {
      try {
        if (gameId) window.XP.__lastGameId = gameId;
        var ret = _origStart.apply(this, arguments);
        window.XP.__running = true;
        return ret;
      } catch (_) {}
    };
  }

  if (_origStop) {
    window.XP.stopSession = function () {
      try {
        var ret = _origStop.apply(this, arguments);
        window.XP.__running = false;
        return ret;
      } catch (_) {
        window.XP.__running = false;
      }
    };
  }

  // Public probe
  if (typeof window.XP.isRunning !== 'function') {
    window.XP.isRunning = function () { return !!window.XP.__running; };
  }

  // Provide resumeSession if missing — restarts the ticker by calling startSession
  if (typeof window.XP.resumeSession !== 'function') {
    window.XP.resumeSession = function () {
      try {
        if (window.XP.isRunning && window.XP.isRunning()) {
          // already running; give a tiny prod so UI/timers align
          try { window.XP.nudge && window.XP.nudge(); } catch (_) {}
          return;
        }
        var gid = window.XP.__lastGameId || undefined; // fall back to last seen gameId
        if (typeof window.XP.startSession === 'function') {
          return window.XP.startSession(gid, { resume: true });
        }
      } catch (_) {}
    };
  }
})();

// --- XP lifecycle wiring (pagehide/pageshow/visibilitychange/beforeunload) ---

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!window.XP) return;
  if (window.XP.__xpLifecycleWired) return;
  window.XP.__xpLifecycleWired = true;

  let retryTimer = null;

  function tryCall(fnName, arg) {
    try {
      const XP = window.XP;
      if (!XP || typeof XP[fnName] !== 'function') return false;
      XP[fnName](arg);
      return true;
    } catch (_) { return false; }
  }

  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }

  function retryResume(attempt = 0) {
    clearRetry();
    const isRunning = !!(window.XP && typeof window.XP.isRunning === 'function' && window.XP.isRunning());
    if (isRunning) return;
    const ok = tryCall('resumeSession');
    if (ok) return;
    if (attempt >= 3) return;
    retryTimer = setTimeout(() => retryResume(attempt + 1), 150 * (attempt + 1));
  }

  function resume() {
    var runningNow = false;
    try {
      if (window.XP && typeof window.XP.isRunning === 'function') runningNow = !!window.XP.isRunning();
      else runningNow = !!(typeof state !== 'undefined' ? state.running : false);
    } catch(_) {}
    if (runningNow) return;
    const ok = tryCall('resumeSession') || tryCall('nudge');
    if (ok) {
      try { document.dispatchEvent(new Event('xp:visible')); } catch {}
      clearRetry();
    } else {
      retryResume(0);
    }
  }

  function pause() {
    var runningNow = false;
    try {
      if (window.XP && typeof window.XP.isRunning === 'function') runningNow = !!window.XP.isRunning();
      else runningNow = !!(typeof state !== 'undefined' ? state.running : false);
    } catch(_) {}
    if (!runningNow) return;
    tryCall('stopSession', { flush: true });
    clearRetry();
    try { document.dispatchEvent(new Event('xp:hidden')); } catch {}
  }

  function persisted(event){ return !!(event && event.persisted); }

  window.addEventListener('pageshow', (event) => {
    if (!persisted(event)) return;
    resume();
  }, { passive: true });

  window.addEventListener('pagehide', (event) => {
    if (persisted(event)) return;
    pause();
  }, { passive: true });

  window.addEventListener('beforeunload', () => { pause(); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
    else pause();
  }, { passive: true });

  if (document.visibilityState === 'visible') {
    setTimeout(resume, 0);
  }
})();
(function(){
  try {
    const nodes = document.querySelectorAll('a.xp-badge#xpBadge');
    if (nodes.length !== 1) {
      console.warn(`[xp] expected 1 xp-badge anchor with id="xpBadge", found ${nodes.length}`);
    }
  } catch {}
})();
