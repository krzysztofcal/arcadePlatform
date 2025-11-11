(function (window, document) {
  if (!window || !document) return;

  const MAX_POPS = 4;
  const IDLE_FADE_MS = 2200;
  const SECOND = 1000;

  const state = {
    initialized: false,
    listenersBound: false,
    root: null,
    stack: null,
    comboText: null,
    comboFill: null,
    boostChip: null,
    boostTimer: null,
    boostSeconds: 0,
    boostMultiplier: 1,
    boostVisible: false,
    boostSource: null,
    idleTimer: null,
    lastCombo: 1,
    lastProgress: 0,
    lastTickTs: 0,
    lastGameId: null,
    overlayActive: false,
    mutations: [],
    rafQueued: false,
    tickHandler: null,
    boostHandler: null,
  };

  function logDiag(type, detail) {
    if (!window.XP_DIAG) return;
    try {
      const payload = detail && typeof detail === "object" ? detail : {};
      window.console.debug(`overlay:${type}`, payload);
    } catch (_) {}
  }

  function scheduleMutation(fn) {
    if (typeof fn !== "function") return;
    state.mutations.push(fn);
    if (state.rafQueued) return;
    state.rafQueued = true;
    const raf = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (cb) => window.setTimeout(cb, 16);
    raf(() => {
      state.rafQueued = false;
      const pending = state.mutations.splice(0, state.mutations.length);
      for (let i = 0; i < pending.length; i += 1) {
        try { pending[i](); } catch (_) {}
      }
    });
  }

  function formatMultiplier(multiplier) {
    if (!Number.isFinite(multiplier)) return "1";
    if (Math.abs(multiplier - Math.round(multiplier)) < 0.001) {
      return String(Math.round(multiplier));
    }
    return multiplier.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function formatSeconds(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return seconds < 10 ? `0${seconds}` : String(seconds);
  }

  function attachElementListeners() {
    if (state.comboText && !state.comboText.__xpOverlayBound) {
      state.comboText.addEventListener("animationend", (event) => {
        if (event && event.animationName === "xpPulse") {
          state.comboText.classList.remove("xp-pulse");
        }
      });
      state.comboText.__xpOverlayBound = true;
    }
    if (state.comboFill && !state.comboFill.__xpOverlayBound) {
      state.comboFill.addEventListener("animationend", (event) => {
        if (event && event.animationName === "xpProgressFlash") {
          state.comboFill.classList.remove("xp-overlay__progress-fill--flash");
        }
      });
      state.comboFill.__xpOverlayBound = true;
    }
  }

  function ensureRoot() {
    if (state.root && state.root.isConnected) {
      attachElementListeners();
      return state.root;
    }
    let root = document.getElementById("xpOverlay");
    if (!root) {
      root = document.createElement("div");
      root.id = "xpOverlay";
      root.setAttribute("aria-live", "polite");
      root.setAttribute("hidden", "hidden");
      const stack = document.createElement("div");
      stack.id = "xpOverlayStack";
      stack.className = "xp-overlay__stack";
      const row = document.createElement("div");
      row.className = "xp-overlay__row";
      const combo = document.createElement("div");
      combo.className = "xp-overlay__combo";
      const comboText = document.createElement("span");
      comboText.id = "xpComboText";
      comboText.textContent = "x1";
      const progress = document.createElement("div");
      progress.className = "xp-overlay__progress";
      const fill = document.createElement("div");
      fill.id = "xpComboFill";
      fill.style.width = "0%";
      progress.appendChild(fill);
      combo.appendChild(comboText);
      combo.appendChild(progress);
      const boost = document.createElement("div");
      boost.id = "xpBoostChip";
      boost.className = "xp-overlay__boost";
      boost.setAttribute("hidden", "hidden");
      row.appendChild(combo);
      row.appendChild(boost);
      root.appendChild(stack);
      root.appendChild(row);
      if (document.body) {
        document.body.appendChild(root);
      }
      state.stack = stack;
      state.comboText = comboText;
      state.comboFill = fill;
      state.boostChip = boost;
    } else {
      state.stack = root.querySelector("#xpOverlayStack") || root.querySelector(".xp-overlay__stack");
      state.comboText = root.querySelector("#xpComboText");
      state.comboFill = root.querySelector("#xpComboFill");
      state.boostChip = root.querySelector("#xpBoostChip");
    }
    state.root = root;
    attachElementListeners();
    return state.root;
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

  function hasGameHostHint() {
    try {
      const body = document && document.body;
      if (!body) return false;
      if (typeof body.hasAttribute === "function" && body.hasAttribute("data-game-host")) return true;
      if (body.dataset && (body.dataset.gameHost || body.dataset.gameId || body.dataset.gameSlug)) return true;
    } catch (_) {}
    return false;
  }

  function shouldDisplay(detail) {
    if (!isDocumentVisible()) return false;
    const bridge = window && window.GameXpBridge;
    const candidate = detail && detail.gameId ? detail.gameId : state.lastGameId;
    if (bridge && typeof bridge.isActiveGameWindow === "function") {
      try {
        return bridge.isActiveGameWindow(candidate) === true;
      } catch (_) {}
    }
    return hasGameHostHint();
  }

  function hideOverlayRoot() {
    if (!state.overlayActive && state.root && state.root.hasAttribute && state.root.hasAttribute("hidden")) return;
    state.overlayActive = false;
    scheduleMutation(() => {
      const root = ensureRoot();
      if (!root) return;
      root.setAttribute("hidden", "hidden");
      root.classList.remove("xp-faded");
    });
  }

  function showOverlayRoot() {
    if (state.overlayActive) return;
    state.overlayActive = true;
    scheduleMutation(() => {
      const root = ensureRoot();
      if (!root) return;
      root.removeAttribute("hidden");
    });
  }

  function clearIdleTimer() {
    if (state.idleTimer) {
      try { window.clearTimeout(state.idleTimer); } catch (_) {}
      state.idleTimer = null;
    }
  }

  function stopBoostTimer() {
    if (state.boostTimer) {
      try { window.clearInterval(state.boostTimer); } catch (_) {}
      state.boostTimer = null;
    }
  }

  function markActive() {
    clearIdleTimer();
    showOverlayRoot();
    scheduleMutation(() => {
      const root = ensureRoot();
      if (root) root.classList.remove("xp-faded");
    });
    if (typeof window.setTimeout === "function") {
      state.idleTimer = window.setTimeout(() => {
        scheduleMutation(() => {
          if (!state.root) return;
          state.root.classList.add("xp-faded");
        });
      }, IDLE_FADE_MS);
    }
  }

  function renderPop(text) {
    if (!text) return;
    scheduleMutation(() => {
      const root = ensureRoot();
      const stack = state.stack;
      if (!root || !stack) return;
      const pop = document.createElement("div");
      pop.className = "xp-pop xp-pop--enter";
      pop.textContent = text;
      const handle = (event) => {
        if (!event || !event.animationName) return;
        if (event.animationName === "xpPopEnter") {
          pop.classList.remove("xp-pop--enter");
          pop.classList.add("xp-pop--float");
          return;
        }
        if (event.animationName === "xpFloat") {
          pop.removeEventListener("animationend", handle);
          if (pop.parentNode) pop.parentNode.removeChild(pop);
        }
      };
      pop.addEventListener("animationend", handle);
      stack.appendChild(pop);
      while (stack.childElementCount > MAX_POPS) {
        const first = stack.firstElementChild;
        if (first) {
          stack.removeChild(first);
        } else {
          break;
        }
      }
    });
  }

  function updateCombo(combo) {
    const value = Math.max(1, Math.floor(Number(combo) || 1));
    const previous = state.lastCombo;
    state.lastCombo = value;
    scheduleMutation(() => {
      ensureRoot();
      if (!state.comboText) return;
      state.comboText.textContent = `x${value}`;
      if (value > previous) {
        state.comboText.classList.remove("xp-pulse");
        void state.comboText.offsetWidth;
        state.comboText.classList.add("xp-pulse");
      }
    });
  }

  function updateProgress(progress) {
    const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const previous = state.lastProgress;
    state.lastProgress = clamped;
    const percent = Math.round(clamped * 100);
    scheduleMutation(() => {
      ensureRoot();
      if (!state.comboFill) return;
      state.comboFill.style.width = `${percent}%`;
      if (previous > clamped) {
        state.comboFill.classList.remove("xp-overlay__progress-fill--flash");
        void state.comboFill.offsetWidth;
        state.comboFill.classList.add("xp-overlay__progress-fill--flash");
      }
    });
  }

  function refreshBoostText() {
    if (!state.boostChip) return;
    if (state.boostSource === "newRecord") {
      state.boostChip.textContent = `BOOST x${formatMultiplier(state.boostMultiplier)} · RECORD`;
      return;
    }
    state.boostChip.textContent = `BOOST x${formatMultiplier(state.boostMultiplier)} · ${formatSeconds(state.boostSeconds)}s`;
  }

  function hideBoost() {
    if (!state.boostVisible && state.boostSeconds <= 0) {
      stopBoostTimer();
      state.boostMultiplier = 1;
      state.boostSeconds = 0;
      state.boostSource = null;
      return;
    }
    state.boostVisible = false;
    state.boostMultiplier = 1;
    state.boostSeconds = 0;
    state.boostSource = null;
    stopBoostTimer();
    scheduleMutation(() => {
      ensureRoot();
      if (!state.boostChip) return;
      state.boostChip.setAttribute("hidden", "hidden");
      state.boostChip.classList.remove("xp-overlay__boost--active");
    });
    logDiag("boost_end");
  }

  function startBoostCountdown() {
    stopBoostTimer();
    if (state.boostSeconds <= 0) return;
    if (typeof window.setInterval !== "function") return;
    if (state.boostSource === "newRecord") {
      refreshBoostText();
      return;
    }
    state.boostTimer = window.setInterval(() => {
      state.boostSeconds = Math.max(0, state.boostSeconds - 1);
      if (state.boostSeconds <= 0) {
        scheduleMutation(() => {
          refreshBoostText();
          hideBoost();
        });
      } else {
        scheduleMutation(() => {
          refreshBoostText();
        });
      }
    }, SECOND);
  }

  function showBoost(multiplier, secondsLeft, detail) {
    const mult = Number(multiplier);
    const seconds = Number(secondsLeft);
    if (!Number.isFinite(mult) || mult < 1 || !Number.isFinite(seconds) || seconds < 0) {
      hideBoost();
      return;
    }
    const normalizedMultiplier = mult < 1 ? 1 : mult;
    const normalizedSeconds = seconds <= 0 ? 0 : Math.floor(seconds);
    if (normalizedMultiplier <= 1 || normalizedSeconds <= 0) {
      hideBoost();
      return;
    }
    state.boostMultiplier = normalizedMultiplier;
    state.boostSeconds = normalizedSeconds;
    state.boostSource = detail && typeof detail.source === "string" ? detail.source : null;
    if (detail && detail.gameId) {
      state.lastGameId = detail.gameId;
    }
    state.boostVisible = true;
    scheduleMutation(() => {
      ensureRoot();
      if (!state.boostChip) return;
      state.boostChip.removeAttribute("hidden");
      state.boostChip.classList.add("xp-overlay__boost--active");
      refreshBoostText();
    });
    startBoostCountdown();
    logDiag("boost_start", { multiplier: normalizedMultiplier, seconds: normalizedSeconds });
  }

  function onXpTick(detail) {
    if (!detail || typeof detail !== "object") return;
    const awarded = Number(detail.awarded);
    const combo = Number(detail.combo);
    const boost = Number(detail.boost);
    const progress = Number(detail.progressToNext);
    const ts = Number(detail.ts);
    if (!Number.isFinite(awarded) || awarded < 0) return;
    if (!Number.isFinite(combo) || combo < 1) return;
    if (!Number.isFinite(boost) || boost < 1) return;
    if (!Number.isFinite(ts)) return;
    if (!shouldDisplay(detail)) {
      hideOverlayRoot();
      clearIdleTimer();
      hideBoost();
      return;
    }
    const comboValue = Math.max(1, Math.floor(combo));
    const boostValue = boost > 1 ? boost : 1;
    const progressValue = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    state.lastGameId = detail && detail.gameId ? detail.gameId : state.lastGameId;
    const awardedText = Math.abs(awarded - Math.round(awarded)) < 0.001 ? Math.round(awarded) : Number(awarded.toFixed(2));
    const textParts = [`+${awardedText}`];
    const suffix = [`x${comboValue}`];
    if (boostValue > 1) {
      suffix.push(`• x${formatMultiplier(boostValue)} boost`);
    }
    if (suffix.length) {
      textParts.push(`(${suffix.join(" ")})`);
    }
    renderPop(textParts.join(" "));
    updateCombo(comboValue);
    updateProgress(progressValue);
    if (boostValue <= 1) {
      hideBoost();
    }
    state.lastTickTs = ts;
    markActive();
    logDiag("tick", { awarded: awardedText, combo: comboValue, boost: boostValue });
  }

  function onXpBoost(detail) {
    if (!detail || typeof detail !== "object") return;
    const multiplier = Number(detail.multiplier);
    const secondsLeft = Number(detail.secondsLeft);
    if (!shouldDisplay(detail)) {
      hideBoost();
      hideOverlayRoot();
      return;
    }
    if (!Number.isFinite(multiplier) || multiplier < 1) {
      hideBoost();
      return;
    }
    if (!Number.isFinite(secondsLeft) || secondsLeft < 0) {
      hideBoost();
      return;
    }
    if (multiplier <= 1 || secondsLeft <= 0) {
      hideBoost();
      return;
    }
    showOverlayRoot();
    showBoost(multiplier, secondsLeft, detail);
  }

  function attachListeners() {
    if (state.listenersBound) return;
    state.tickHandler = (event) => {
      try { onXpTick(event && event.detail); } catch (_) {}
    };
    state.boostHandler = (event) => {
      try { onXpBoost(event && event.detail); } catch (_) {}
    };
    try { window.addEventListener("xp:tick", state.tickHandler, { passive: true }); } catch (_) { window.addEventListener("xp:tick", state.tickHandler); }
    try { window.addEventListener("xp:boost", state.boostHandler, { passive: true }); } catch (_) { window.addEventListener("xp:boost", state.boostHandler); }
    state.listenersBound = true;
  }

  function detachListeners() {
    if (!state.listenersBound) return;
    try { window.removeEventListener("xp:tick", state.tickHandler); } catch (_) {}
    try { window.removeEventListener("xp:boost", state.boostHandler); } catch (_) {}
    state.listenersBound = false;
  }

  function bindLifecycle() {
    if (state.lifecycleBound) return;
    state.lifecycleBound = true;
    try { document.addEventListener("xp:hidden", handleXpHidden, { passive: true }); } catch (_) { document.addEventListener("xp:hidden", handleXpHidden); }
    try { document.addEventListener("xp:visible", handleXpVisible, { passive: true }); } catch (_) { document.addEventListener("xp:visible", handleXpVisible); }
  }

  function handleXpHidden() {
    detachListeners();
    clearIdleTimer();
    stopBoostTimer();
    hideBoost();
    hideOverlayRoot();
    logDiag("cleanup", { reason: "xp:hidden" });
  }

  function handleXpVisible() {
    scheduleMutation(() => { ensureRoot(); });
    attachListeners();
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    scheduleMutation(() => { ensureRoot(); });
    attachListeners();
    bindLifecycle();
    logDiag("init");
  }

  init();
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
