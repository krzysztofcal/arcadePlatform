(function (window, document) {
  if (!window || !document) return;

  const DIAG_QUERY = /\bxpdiag=1\b/;

  function detectDiagEnabled() {
    if (window && window.XP_DIAG) return true;
    try {
      if (typeof location !== "undefined" && location && typeof location.search === "string") {
        return DIAG_QUERY.test(location.search);
      }
      if (window && window.location && typeof window.location.search === "string") {
        return DIAG_QUERY.test(window.location.search);
      }
    } catch (_) {}
    return false;
  }

  const diagEnabled = detectDiagEnabled();

  function diagLog(label, payload) {
    if (!diagEnabled) return;
    try { console.debug(`[xp-overlay] ${label}`, payload); }
    catch (_) {}
  }

  function normalizeExpiresAt(raw) {
    if (raw == null) return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (numeric > 1e9 && numeric < 1e12) {
      if (typeof console !== "undefined" && console && typeof console.warn === "function") {
        try { console.warn("[xp-overlay] expiresAt provided in seconds; normalizing to ms", { expiresAt: numeric }); }
        catch (_) {}
      }
      return Math.floor(numeric * 1000);
    }
    return Math.floor(numeric);
  }

  function computeRemainingSeconds(expiresAtMs, now) {
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return 0;
    const current = Number.isFinite(now) ? now : Date.now();
    const delta = Math.ceil((expiresAtMs - current) / 1000);
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    return delta;
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
  }

  const burstState = {
    root: null,
    burstEl: null,
    labelEl: null,
    metaEl: null,
    pendingArgs: null,
    waitingForDom: false,
  };

  function applyDebugDataset() {
    if (!diagEnabled) return;
    try {
      if (document && document.body && document.body.dataset) {
        document.body.dataset.xpOverlayDebug = "1";
      }
    } catch (_) {}
  }

  function ensureBurstRoot() {
    if (burstState.root && burstState.root.parentNode) {
      applyDebugDataset();
      return burstState.root;
    }
    if (!document || !document.body || typeof document.createElement !== "function") {
      return null;
    }
    let root = null;
    try { root = document.querySelector(".xp-overlay"); }
    catch (_) { root = null; }
    if (!root) {
      root = document.createElement("div");
      root.className = "xp-overlay";
      if (root.style && typeof root.style.setProperty === "function") {
        try { root.style.setProperty("z-index", "2147483647"); } catch (_) {}
        try { root.style.setProperty("position", "fixed"); } catch (_) {}
        try { root.style.setProperty("inset", "0"); } catch (_) {}
        try { root.style.setProperty("pointer-events", "none"); } catch (_) {}
      }
      const burst = document.createElement("div");
      burst.className = "xp-overlay__burst";
      burst.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "xp-overlay__label";
      const meta = document.createElement("span");
      meta.className = "xp-overlay__meta";
      burst.appendChild(label);
      burst.appendChild(meta);
      root.appendChild(burst);
      try { document.body.appendChild(root); }
      catch (_) {}
      burstState.root = root;
      burstState.burstEl = burst;
      burstState.labelEl = label;
      burstState.metaEl = meta;
      applyDebugDataset();
      return root;
    }
    try {
      if (!document.body.contains(root)) {
        document.body.appendChild(root);
      }
    } catch (_) {}
    burstState.root = root;
    burstState.burstEl = root.querySelector ? root.querySelector(".xp-overlay__burst") : null;
    burstState.labelEl = root.querySelector ? root.querySelector(".xp-overlay__label") : null;
    burstState.metaEl = root.querySelector ? root.querySelector(".xp-overlay__meta") : null;
    if (!burstState.burstEl) {
      const burst = document.createElement("div");
      burst.className = "xp-overlay__burst";
      burst.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "xp-overlay__label";
      const meta = document.createElement("span");
      meta.className = "xp-overlay__meta";
      burst.appendChild(label);
      burst.appendChild(meta);
      try { root.appendChild(burst); }
      catch (_) {}
      burstState.burstEl = burst;
      burstState.labelEl = label;
      burstState.metaEl = meta;
    } else {
      if (!burstState.labelEl) {
        const label = document.createElement("span");
        label.className = "xp-overlay__label";
        try { burstState.burstEl.appendChild(label); }
        catch (_) {}
        burstState.labelEl = label;
      }
      if (!burstState.metaEl) {
        const meta = document.createElement("span");
        meta.className = "xp-overlay__meta";
        try { burstState.burstEl.appendChild(meta); }
        catch (_) {}
        burstState.metaEl = meta;
      }
    }
    applyDebugDataset();
    return burstState.root;
  }

  function scheduleBurstReplay() {
    if (burstState.waitingForDom) return;
    burstState.waitingForDom = true;
    const replay = function () {
      burstState.waitingForDom = false;
      if (burstState.pendingArgs) {
        const pending = burstState.pendingArgs;
        burstState.pendingArgs = null;
        showBurst(pending);
      }
    };
    if (document && typeof document.addEventListener === "function") {
      try { document.addEventListener("DOMContentLoaded", replay, { once: true }); return; }
      catch (_) { try { document.addEventListener("DOMContentLoaded", replay); return; } catch (_) {} }
    }
    if (window && typeof window.setTimeout === "function") {
      try { window.setTimeout(replay, 0); }
      catch (_) {}
    }
  }

  function restartBurstAnimation(el) {
    if (!el || !el.classList || typeof el.classList.remove !== "function" || typeof el.classList.add !== "function") return;
    try { el.classList.remove("is-animating"); }
    catch (_) {}
    try { /* eslint-disable no-unused-expressions */ el.offsetWidth; /* eslint-enable no-unused-expressions */ }
    catch (_) {}
    try { el.classList.add("is-animating"); }
    catch (_) {}
  }

  function formatMetaMultiplier(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "×1";
    if (Math.abs(numeric - Math.round(numeric)) < 0.05) {
      return "×" + Math.round(numeric);
    }
    return "×" + numeric.toFixed(1);
  }

  function showBurst(args) {
    const payload = args && typeof args === "object" ? args : {};
    const xp = Math.max(0, Math.floor(Number(payload.xp) || 0));
    const combo = Number(payload.combo);
    const boost = Number(payload.boost);
    const root = ensureBurstRoot();
    if (!root || !burstState.burstEl || !burstState.labelEl || !burstState.metaEl) {
      burstState.pendingArgs = { xp, combo, boost };
      scheduleBurstReplay();
      return;
    }
    diagLog("burst", { xp, combo, boost });
    try { root.classList.add("is-visible"); }
    catch (_) {}
    burstState.labelEl.textContent = "+" + xp + " XP";
    const parts = [];
    if (Number.isFinite(combo) && combo > 1) {
      parts.push("Combo " + formatMetaMultiplier(combo));
    }
    if (Number.isFinite(boost) && boost !== 1 && boost > 0) {
      parts.push("Boost " + formatMetaMultiplier(boost));
    }
    burstState.metaEl.textContent = parts.join(" · ");
    restartBurstAnimation(burstState.burstEl);
    if (burstState.burstEl && typeof burstState.burstEl.addEventListener === "function") {
      const handleEnd = function handleEnd() {
        try { burstState.burstEl.classList.remove("is-animating"); }
        catch (_) {}
        if (burstState.burstEl && typeof burstState.burstEl.removeEventListener === "function") {
          try { burstState.burstEl.removeEventListener("animationend", handleEnd); }
          catch (_) {}
        }
      };
      try { burstState.burstEl.addEventListener("animationend", handleEnd, { once: true }); }
      catch (_) { try { burstState.burstEl.addEventListener("animationend", handleEnd); } catch (_) {} }
    }
  }

  if (diagEnabled) {
    if (document && typeof document.addEventListener === "function") {
      try { document.addEventListener("DOMContentLoaded", applyDebugDataset, { once: true }); }
      catch (_) { try { document.addEventListener("DOMContentLoaded", applyDebugDataset); } catch (_) {} }
    } else {
      applyDebugDataset();
    }
  }

  const FRAME_INTERVAL = 80; // ~12.5 FPS

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
    comboVisual: { hue: null, glow: null },
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
    try { badge = document.querySelector(".xp-badge__link, .xp-badge"); }
    catch (_) { badge = null; }
    if (badge) return badge;
    if (typeof document.getElementById === "function") {
      try { badge = document.getElementById("xpBadge"); }
      catch (_) { badge = null; }
      if (badge) return badge;
    }
    try { badge = document.querySelector("[data-xp-badge], a[href*='xp']"); }
    catch (_) { badge = null; }
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
    if (typeof window !== "undefined" && window.__xpBoostInterval) {
      try { clearInterval(window.__xpBoostInterval); }
      catch (_) {}
      try { delete window.__xpBoostInterval; }
      catch (_) { window.__xpBoostInterval = null; }
    }
    if (state.badge && state.badge.classList && typeof state.badge.classList.remove === "function") {
      try { state.badge.classList.remove("xp-boost--active"); }
      catch (_) {}
    }
    clearBadgeVariable("--boost-frac");
    clearBadgeVariable("--boost-hue");
    clearBadgeVariable("--boost-glow");
    if (state.timerEl) {
      state.timerEl.textContent = "";
      if (state.timerEl.style && typeof state.timerEl.style.setProperty === "function") {
        try { state.timerEl.style.setProperty("display", "none"); }
        catch (_) {}
      } else if (state.timerEl.style && typeof state.timerEl.style.display !== "undefined") {
        try { state.timerEl.style.display = "none"; }
        catch (_) {}
      }
    }
    if (state.multiplierEl) state.multiplierEl.textContent = "";
  }

  function updateBoostDisplay(now) {
    if (!state.boost) return;
    const current   = Number.isFinite(now) ? now : Date.now();
    let   expiresAt = Number(state.boost && state.boost.expiresAt) || 0;
    expiresAt = (expiresAt > 0 && expiresAt < 1e12 && Date.now() > 1e12)
      ? Math.floor(expiresAt * 1000)
      : Math.floor(expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= current) {
      diagLog("boost_expired", { expiresAt, now: current });
      deactivateBoost();
      return;
    }
    let remainingMs = Math.max(0, expiresAt - current);
    const UI_CAP_MS = 30 * 1000;
    if (remainingMs > UI_CAP_MS) remainingMs = UI_CAP_MS;
    if (remainingMs <= 0) {
      diagLog("boost_timer_ended", { expiresAt, now: current });
      deactivateBoost();
      return;
    }

    state.boost.expiresAt = expiresAt;

    let totalMs = Number(state.boost.durationMs);
    if (!Number.isFinite(totalMs) || totalMs <= 0 || totalMs < remainingMs) {
      totalMs = remainingMs;
    }
    state.boost.durationMs = totalMs;
    state.boost.startedAt = expiresAt - totalMs;

    const progress = totalMs > 0 ? 1 - (remainingMs / totalMs) : 1;
    setBadgeVariable("--boost-hue", computeHue(state.boost.multiplier));
    setBadgeVariable("--boost-glow", computeGlow(state.boost.multiplier));
    if (state.hasConic) {
      setBadgeVariable("--boost-frac", Math.max(0, Math.min(1, progress)));
    } else {
      clearBadgeVariable("--boost-frac");
    }
    if (state.multiplierEl) state.multiplierEl.textContent = formatMultiplier(state.boost.multiplier);
    if (state.timerEl) {
      const seconds = Math.ceil(remainingMs / 1000);
      state.timerEl.textContent = `${seconds}s`;
      if (state.timerEl.style && typeof state.timerEl.style.removeProperty === "function") {
        try { state.timerEl.style.removeProperty("display"); }
        catch (_) {}
      } else if (state.timerEl.style && typeof state.timerEl.style.display !== "undefined") {
        try { state.timerEl.style.display = ""; }
        catch (_) {}
      }
    }
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
    if (state.hasConic) {
      setBadgeVariable("--combo-progress", progress);
    } else {
      clearBadgeVariable("--combo-progress");
    }
    setBadgeVariable("--combo-multiplier", multiplier);
    const targetHue = 48;
    const targetGlow = "rgba(251, 191, 36, 0.25)";
    if (state.comboVisual.hue !== targetHue) {
      state.comboVisual.hue = targetHue;
      setBadgeVariable("--combo-hue", targetHue);
    }
    if (state.comboVisual.glow !== targetGlow) {
      state.comboVisual.glow = targetGlow;
      setBadgeVariable("--combo-glow", targetGlow);
    }
  }

  function handleTick(event) {
    if (!event || !event.detail || typeof event.detail !== "object") return;
    state.pendingCombo = event.detail;
    diagLog("tick", event.detail);
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
    try {
      if (state.boost) {
        const now = Date.now();
        const nextMultiplier = Number(payload && payload.multiplier);
        const currentMultiplier = Number(state.boost && state.boost.multiplier) || 1;
        const rawExpires = Object.prototype.hasOwnProperty.call(payload || {}, "expiresAt")
          ? payload.expiresAt
          : payload && payload.endsAt;
        const nextExpires = normalizeExpiresAt(rawExpires);
        const currentExpires = normalizeExpiresAt(state.boost && state.boost.expiresAt);
        if (Number.isFinite(currentExpires) && currentExpires > now
          && (!Number.isFinite(nextMultiplier) || nextMultiplier <= currentMultiplier)
          && Number.isFinite(nextExpires) && nextExpires <= currentExpires + 1000) {
          diagLog("boost_ignored", { reason: "redundant" });
          return;
        }
      }
    } catch (_) {}
    let multiplier = Number(payload.multiplier);
    if (!Number.isFinite(multiplier)) multiplier = 1;
    if (multiplier <= 1) {
      deactivateBoost();
      return;
    }

    const now = Date.now();
    const rawExpires = Object.prototype.hasOwnProperty.call(payload || {}, "expiresAt")
      ? payload.expiresAt
      : payload && payload.endsAt;
    const expiresAt = normalizeExpiresAt(rawExpires);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      diagLog("boost_rejected", { reason: "invalid_expires", expiresAt: rawExpires, now });
      deactivateBoost();
      return;
    }

    const remainingMs = Math.max(0, expiresAt - now);
    if (remainingMs <= 0) {
      diagLog("boost_rejected", { reason: "expired", expiresAt, now });
      deactivateBoost();
      return;
    }

    state.boost = {
      multiplier,
      expiresAt,
      durationMs: remainingMs,
      startedAt: Math.max(0, expiresAt - remainingMs),
    };

    const ttlCandidate = Number(payload && payload.ttlMs);
    if (Number.isFinite(ttlCandidate) && ttlCandidate > 0) {
      const ttl = Math.floor(ttlCandidate);
      if (ttl > 0 && ttl >= remainingMs) {
        state.boost.durationMs = ttl;
        state.boost.startedAt = Math.max(0, expiresAt - ttl);
      }
    }

    updateBoostDisplay(now);
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
    if (typeof window !== "undefined" && typeof window.setInterval === "function" && !window.__xpBoostInterval) {
      try {
        window.__xpBoostInterval = window.setInterval(() => {
          try { updateBoostDisplay(Date.now()); }
          catch (_) {}
        }, 1000);
      } catch (_) {
        try { delete window.__xpBoostInterval; }
        catch (_) { window.__xpBoostInterval = null; }
      }
    }
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
    diagLog("attached", { hasConic: state.hasConic });
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
      diagLog("replay combo", state.pendingCombo);
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
    if (typeof window !== "undefined" && window.__xpBoostInterval) {
      try { clearInterval(window.__xpBoostInterval); }
      catch (_) {}
      try { delete window.__xpBoostInterval; }
      catch (_) { window.__xpBoostInterval = null; }
    }
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
    state.comboVisual = { hue: null, glow: null };
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

  const existingTest = (window.XpOverlay && window.XpOverlay.__test)
    || (window.XPOverlay && window.XPOverlay.__test)
    || {};
  const testApi = Object.assign({}, existingTest, {
    attach,
    detach,
    getState: function () { return Object.assign({}, state); },
    normalizeExpiresAt,
    computeRemainingSeconds,
    formatClock,
    applyBoost,
    deactivateBoost,
    applyCombo,
    handleTick,
    showBurst,
    ensureBurstRoot,
  });

  const overlayApi = Object.assign({}, window.XpOverlay || window.XPOverlay || {}, {
    showBurst,
    __test: testApi,
  });

  window.XpOverlay = overlayApi;
  window.XPOverlay = overlayApi;
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
