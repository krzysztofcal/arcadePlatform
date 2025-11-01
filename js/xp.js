(function (window, document) {
  const CHUNK_MS = 10_000;
  const ACTIVE_WINDOW_MS = 5_000;
  const CACHE_KEY = "kcswh:xp:last";

  const state = {
    badge: null,
    labelEl: null,
    totalToday: null,
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
  };

  function loadCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.totalToday === "number") state.totalToday = parsed.totalToday;
      if (typeof parsed.cap === "number") state.cap = parsed.cap;
      state.lastResultTs = parsed.ts || 0;
    } catch (_) { /* ignore */ }
  }

  function saveCache() {
    try {
      const payload = {
        totalToday: state.totalToday,
        cap: state.cap,
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
    const capText = state.cap ? ` / ${state.cap}` : "";
    state.labelEl.textContent = `XP ${state.totalToday}${capText}`;
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
  }

  function handleResponse(data) {
    if (!data || typeof data !== "object") return;
    if (typeof data.totalToday === "number") {
      const previous = state.totalToday;
      state.totalToday = data.totalToday;
      if (data.cap != null) state.cap = data.cap;
      if (data.awarded && data.awarded > 0 && typeof previous === "number") {
        bumpBadge();
      }
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
      pointsPerPeriod: 1
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
    saveCache();
    updateBadge();
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
  });
})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : undefined);
