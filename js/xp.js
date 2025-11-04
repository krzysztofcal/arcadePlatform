(function (window, document) {
  const CHUNK_MS = 10_000;
  const ACTIVE_WINDOW_MS = 5_000;
  const CACHE_KEY = "kcswh:xp:last";

  const LEVEL_BASE_XP = 100;
  const LEVEL_MULTIPLIER = 1.1;

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
  };

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

  function bumpBadge() {
    if (!state.badge) return;
    state.badge.classList.remove("xp-badge--bump");
    void state.badge.offsetWidth; // force reflow
    state.badge.classList.add("xp-badge--bump");
  }

  function attachBadge() {
    if (state.badge) return;
    state.badge = document.getElementById("xpBadge");
    if (!state.badge) return;
    ensureBadgeElements();
    loadCache();
    updateBadge();
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
    const visibility = Math.round(state.visibilitySeconds);
    const inputs = state.inputEvents;
    const payload = {
      gameId: state.gameId || "game",
      windowStart: state.windowStart,
      windowEnd: now,
      visibilitySeconds: visibility,
      inputEvents: inputs,
      chunkMs: CHUNK_MS,
      pointsPerPeriod: 10
    };
    state.windowStart = now;
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.pending = window.XPClient.postWindow(payload)
      .then((data) => handleResponse(data))
      .catch(handleError)
      .finally(() => { state.pending = null; });
  }

  function tick() {
    const now = Date.now();
    const delta = state.lastTick ? Math.max(0, now - state.lastTick) : 0;
    state.lastTick = now;
    if (!state.running) return;
    const visible = !document.hidden;
    if (visible) {
      state.visibilitySeconds += delta / 1000;
      if (now <= state.activeUntil) {
        state.activeMs += delta;
      }
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
  }

  function stopSession(options) {
    const opts = options || {};
    if (state.running && opts.flush !== false) {
      sendWindow(true);
    }
    state.running = false;
    state.gameId = null;
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.activeUntil = 0;
  }

  function nudge() {
    state.activeUntil = Date.now() + ACTIVE_WINDOW_MS;
    state.inputEvents += 1;
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
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", attachBadge, { once: true });
      } else {
        attachBadge();
      }
      document.addEventListener("visibilitychange", () => {
        state.lastTick = Date.now();
      });
    }
    if (typeof window !== "undefined") {
      ensureTimer();
      window.addEventListener("message", (event) => {
        if (event && event.data && event.data.type === "kcswh:activity") {
          nudge();
        }
      }, { passive: true });
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
  });
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

(function(){
  try {
    const nodes = document.querySelectorAll('a.xp-badge#xpBadge');
    if (nodes.length !== 1) {
      console.warn(`[xp] expected 1 xp-badge anchor with id="xpBadge", found ${nodes.length}`);
    }
  } catch {}
})();
