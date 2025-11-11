(function (window, document) {
  if (!window || !document) return;

  const FRAME_INTERVAL = 80; // ~12.5 FPS
  const DEFAULT_TTL = 15_000;

  const state = {
    attached: false,
    badge: null,
    chip: null,
    multiplierEl: null,
    timerEl: null,
    boost: null,
    rafId: null,
    timerId: null,
    lastTick: 0,
    hasConic: detectConic(),
    watchersBound: false,
    boostListener: null,
    tickListener: null,
    attachRetryId: null,
    comboDetail: { mode: "build", multiplier: 1, progress: 0, cap: 1 },
    pendingCombo: null,
  };

  let attachAttempts = 0;

  function detectConic() {
    if (!window.CSS || typeof window.CSS.supports !== "function") return false;
    try { return window.CSS.supports("background", "conic-gradient(from 90deg, #000, #fff)"); }
    catch (_) { return false; }
  }

  function isDocumentHidden() {
    try {
      if (typeof document.visibilityState === "string" && document.visibilityState !== "visible") return true;
      if (document.hidden === true) return true;
    } catch (_) {}
    return false;
  }

  function isActiveGame() {
    const bridge = window.GameXpBridge;
    if (!bridge || typeof bridge.isActiveGameWindow !== "function") return false;
    let active = false;
    try { active = !!bridge.isActiveGameWindow(); }
    catch (_) { active = false; }
    return active;
  }

  function getBadge() {
    if (!document || typeof document.querySelector !== "function") return null;
    let badge = null;
    try { badge = document.querySelector(".xp-badge__link"); }
    catch (_) { badge = null; }
    if (badge) return badge;
    if (typeof document.getElementById === "function") {
      try { badge = document.getElementById("xpBadge"); }
      catch (_) { badge = null; }
    }
    return badge || null;
  }

  function ensureChip(badge) {
    if (!badge || typeof badge.appendChild !== "function") return null;
    if (state.chip && badge.contains && badge.contains(state.chip)) return state.chip;

    const chip = document.createElement ? document.createElement("span") : null;
    if (!chip) return null;
    chip.className = "xp-boost-chip";
    chip.setAttribute("aria-hidden", "true");

    const mult = document.createElement ? document.createElement("span") : null;
    const timer = document.createElement ? document.createElement("span") : null;
    if (!mult || !timer) return null;
    mult.className = "xp-boost-chip__multiplier";
    timer.className = "xp-boost-chip__timer";
    mult.textContent = "";
    timer.textContent = "";
    chip.appendChild(mult);
    chip.appendChild(timer);
    try { badge.appendChild(chip); }
    catch (_) {}

    state.chip = chip;
    state.multiplierEl = mult;
    state.timerEl = timer;
    return chip;
  }

  function formatMultiplier(value) {
    const numeric = Number(value) || 0;
    if (!Number.isFinite(numeric) || numeric <= 0) return "x1";
    if (Math.abs(numeric - Math.round(numeric)) < 0.05) {
      return "x" + Math.round(numeric);
    }
    return "x" + numeric.toFixed(1);
  }

  function formatSeconds(ms) {
    const remaining = Math.max(0, Math.ceil(ms / 1000));
    return remaining + "s";
  }

  function setBadgeVariable(name, value) {
    if (!state.badge || !state.badge.style || typeof state.badge.style.setProperty !== "function") return;
    try { state.badge.style.setProperty(name, String(value)); }
    catch (_) {}
  }

  function clearBadgeVariable(name) {
    if (!state.badge || !state.badge.style || typeof state.badge.style.removeProperty !== "function") return;
    try { state.badge.style.removeProperty(name); }
    catch (_) {}
  }

  function computeHue(multiplier) {
    const base = 168;
    const extra = Math.min(36, Math.max(0, (Number(multiplier) || 1) - 1) * 18);
    return Math.round(base + extra);
  }

  function computeGlow(multiplier) {
    const strength = Math.min(0.75, 0.35 + Math.max(0, (Number(multiplier) || 1) - 1) * 0.15);
    return `rgba(45, 212, 191, ${strength.toFixed(2)})`;
  }

  function stopTicker() {
    if (state.rafId != null && typeof window.cancelAnimationFrame === "function") {
      try { window.cancelAnimationFrame(state.rafId); }
      catch (_) {}
    }
    if (state.timerId != null && typeof window.clearTimeout === "function") {
      try { window.clearTimeout(state.timerId); }
      catch (_) {}
    }
    state.rafId = null;
    state.timerId = null;
  }

  function clearAttachRetry() {
    if (state.attachRetryId != null && typeof window.clearTimeout === "function") {
      try { window.clearTimeout(state.attachRetryId); }
      catch (_) {}
    }
    state.attachRetryId = null;
  }

  function deactivateBoost() {
    state.boost = null;
    stopTicker();
    state.lastTick = 0;
    state.pendingCombo = null;
    if (state.badge && state.badge.classList && typeof state.badge.classList.remove === "function") {
      try { state.badge.classList.remove("xp-boost--active"); }
      catch (_) {}
    }
    clearBadgeVariable("--boost-frac");
    clearBadgeVariable("--boost-hue");
    clearBadgeVariable("--boost-glow");
    if (state.timerEl) state.timerEl.textContent = "";
    if (state.multiplierEl) state.multiplierEl.textContent = "";
  }

  function updateBoostDisplay(now) {
    if (!state.boost) return;
    const current = typeof now === "number" ? now : Date.now();
    const remaining = Math.max(0, state.boost.expiresAt - current);
    if (remaining <= 0) {
      deactivateBoost();
      return;
    }
    const fraction = state.boost.durationMs > 0 ? remaining / state.boost.durationMs : 0;
    const progress = Math.max(0, Math.min(1, 1 - fraction));
    setBadgeVariable("--boost-hue", computeHue(state.boost.multiplier));
    setBadgeVariable("--boost-glow", computeGlow(state.boost.multiplier));
    if (state.hasConic) {
      setBadgeVariable("--boost-frac", progress);
    } else {
      clearBadgeVariable("--boost-frac");
    }
    if (state.multiplierEl) state.multiplierEl.textContent = formatMultiplier(state.boost.multiplier);
    if (state.timerEl) state.timerEl.textContent = formatSeconds(remaining);
    if (!state.badge || !state.badge.classList || typeof state.badge.classList.add !== "function") return;
    try { state.badge.classList.add("xp-boost--active"); }
    catch (_) {}
  }

  function tick(now) {
    if (!state.boost) return;
    const current = typeof now === "number" ? now : Date.now();
    if (current - state.lastTick < FRAME_INTERVAL) {
      scheduleNextTick();
      return;
    }
    state.lastTick = current;
    updateBoostDisplay(current);
    scheduleNextTick();
  }

  function applyCombo(detail) {
    const payload = detail && typeof detail === "object" ? detail : null;
    const combo = payload && payload.combo && typeof payload.combo === "object" ? payload.combo : null;
    if (!combo) return;
    const mode = typeof payload.mode === "string" ? payload.mode : (combo.mode || "build");
    const rawMultiplier = Number(combo.multiplier);
    const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
    const cap = Math.max(1, Number(combo.cap) || multiplier || 1);
    const progress = Math.max(0, Math.min(1, Number(payload.progressToNext)));
    state.comboDetail = { mode, multiplier, progress, cap };
    if (state.badge && state.badge.classList && typeof state.badge.classList.toggle === "function") {
      try { state.badge.classList.toggle("xp-combo--sustain", mode === "sustain"); }
      catch (_) {}
      try { state.badge.classList.toggle("xp-combo--cooldown", mode === "cooldown"); }
      catch (_) {}
    }
    setBadgeVariable("--combo-progress", progress);
    setBadgeVariable("--combo-multiplier", multiplier);
    setBadgeVariable("--combo-hue", 48);
    setBadgeVariable("--combo-glow", "rgba(251, 191, 36, 0.25)");
  }

  function handleTick(event) {
    if (!event || !event.detail || typeof event.detail !== "object") return;
    state.pendingCombo = event.detail;
    if (state.attached) {
      applyCombo(event.detail);
    }
  }

  function scheduleNextTick() {
    stopTicker();
    if (!state.boost) return;
    if (typeof window.requestAnimationFrame === "function") {
      state.rafId = window.requestAnimationFrame(tick);
      return;
    }
    if (typeof window.setTimeout === "function") {
      state.timerId = window.setTimeout(() => tick(Date.now()), FRAME_INTERVAL);
    }
  }

  function applyBoost(detail) {
    const payload = detail && typeof detail === "object" ? detail : { multiplier: detail };
    let multiplier = Number(payload.multiplier);
    if (!Number.isFinite(multiplier)) multiplier = 1;
    if (multiplier <= 1) {
      deactivateBoost();
      return;
    }
    let ttl = Number(payload.ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) ttl = Number(payload.durationMs);
    if (!Number.isFinite(ttl) || ttl <= 0) ttl = DEFAULT_TTL;
    const startedAt = Date.now();
    state.boost = {
      multiplier,
      startedAt,
      durationMs: ttl,
      expiresAt: startedAt + ttl,
    };
    updateBoostDisplay(startedAt);
    scheduleNextTick();
  }

  function handleBoost(event) {
    if (!event) return;
    applyBoost(event.detail);
  }

  function attach() {
    if (state.attached) return true;
    if (!isActiveGame()) return false;
    if (isDocumentHidden()) return false;
    const badge = getBadge();
    if (!badge) return false;
    state.badge = badge;
    ensureChip(badge);
    if (typeof window.addEventListener === "function") {
      state.boostListener = handleBoost;
      try { window.addEventListener("xp:boost", state.boostListener); }
      catch (_) {}
      state.tickListener = handleTick;
      try { window.addEventListener("xp:tick", state.tickListener); }
      catch (_) {}
    }
    state.attached = true;
    attachAttempts = 0;
    clearAttachRetry();
    const xp = window.XP;
    if ((!state.boost || !state.boost.expiresAt || state.boost.expiresAt <= Date.now())
      && xp && typeof xp.getBoost === "function") {
      let hydrated = null;
      try { hydrated = xp.getBoost(); }
      catch (_) { hydrated = null; }
      const expiresAt = hydrated && Number(hydrated.expiresAt);
      const ttl = expiresAt ? (expiresAt - Date.now()) : 0;
      if (hydrated && Number(hydrated.multiplier) > 1 && ttl > 0) {
        applyBoost({ multiplier: hydrated.multiplier, ttlMs: ttl });
      }
    }
    if (state.boost && state.boost.expiresAt > Date.now()) {
      updateBoostDisplay(Date.now());
      scheduleNextTick();
    } else {
      deactivateBoost();
    }
    if (state.pendingCombo) {
      applyCombo(state.pendingCombo);
    }
    return true;
  }

  function detach() {
    if (!state.attached) return;
    clearAttachRetry();
    attachAttempts = 0;
    state.attached = false;
    stopTicker();
    if (typeof window.removeEventListener === "function" && state.boostListener) {
      try { window.removeEventListener("xp:boost", state.boostListener); }
      catch (_) {}
    }
    if (typeof window.removeEventListener === "function" && state.tickListener) {
      try { window.removeEventListener("xp:tick", state.tickListener); }
      catch (_) {}
    }
    state.boostListener = null;
    state.tickListener = null;
    if (state.badge && state.badge.classList && typeof state.badge.classList.remove === "function") {
      try { state.badge.classList.remove("xp-boost--active"); }
      catch (_) {}
      try { state.badge.classList.remove("xp-combo--sustain"); }
      catch (_) {}
      try { state.badge.classList.remove("xp-combo--cooldown"); }
      catch (_) {}
    }
    clearBadgeVariable("--combo-progress");
    clearBadgeVariable("--combo-multiplier");
    clearBadgeVariable("--combo-hue");
    clearBadgeVariable("--combo-glow");
    state.badge = null;
    state.pendingCombo = null;
  }

  function handleVisibilityChange() {
    if (isDocumentHidden()) {
      detach();
      return;
    }
    tryAttachWithBackoff();
  }

  function handleLifecycleTeardown() {
    detach();
  }

  function handlePageShow() {
    if (!isDocumentHidden()) {
      tryAttachWithBackoff();
    }
  }

  function tryAttachWithBackoff() {
    clearAttachRetry();
    if (attach()) return true;
    if (!window || typeof window.setTimeout !== "function") return false;
    if (attachAttempts++ < 10) {
      const delay = Math.min(50 * attachAttempts, 250);
      try {
        state.attachRetryId = window.setTimeout(() => {
          state.attachRetryId = null;
          tryAttachWithBackoff();
        }, delay);
      } catch (_) {
        state.attachRetryId = null;
      }
    }
    return false;
  }

  function bindWatchers() {
    if (state.watchersBound) return;
    state.watchersBound = true;
    if (document && typeof document.addEventListener === "function") {
      try { document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true }); }
      catch (_) { try { document.addEventListener("visibilitychange", handleVisibilityChange); } catch (_) {} }
      try { document.addEventListener("DOMContentLoaded", tryAttachWithBackoff, { passive: true, once: false }); }
      catch (_) { try { document.addEventListener("DOMContentLoaded", tryAttachWithBackoff); } catch (_) {} }
    }
    if (window && typeof window.addEventListener === "function") {
      try { window.addEventListener("pageshow", handlePageShow, { passive: true }); }
      catch (_) { try { window.addEventListener("pageshow", handlePageShow); } catch (_) {} }
      try { window.addEventListener("pagehide", handleLifecycleTeardown, { passive: true }); }
      catch (_) { try { window.addEventListener("pagehide", handleLifecycleTeardown); } catch (_) {} }
      try { window.addEventListener("beforeunload", handleLifecycleTeardown, { passive: true }); }
      catch (_) { try { window.addEventListener("beforeunload", handleLifecycleTeardown); } catch (_) {} }
    }
  }

  function readyOrAttach() {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      tryAttachWithBackoff();
    }
  }

  bindWatchers();
  readyOrAttach();

  window.XPOverlay = Object.assign({}, window.XPOverlay || {}, {
    __test: {
      attach,
      detach,
      getState: function () { return Object.assign({}, state); },
      applyBoost,
      deactivateBoost,
      applyCombo,
      handleTick,
    },
  });
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
