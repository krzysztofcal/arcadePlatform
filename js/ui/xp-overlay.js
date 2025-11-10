(function (window, document) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const FADE_IDLE_MS = 2_200;
  const MAX_POP_ELEMENTS = 4;

  const state = {
    initialized: false,
    listenersAttached: false,
    root: null,
    stack: null,
    comboText: null,
    comboFill: null,
    progressEl: null,
    boostChip: null,
    boostInterval: null,
    boostSecondsLeft: 0,
    boostMultiplier: 1,
    comboValue: 1,
    lastProgress: 0,
    popQueue: [],
    idleTimer: null,
  };

  function logDiag(label, payload) {
    if (!window || !window.XP_DIAG) return;
    try { console.log(label, payload || {}); } catch (_) {}
  }

  function withFrame(callback) {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        try { callback(); } catch (_) {}
      });
      return;
    }
    try { callback(); } catch (_) {}
  }

  function ensureRoot() {
    if (state.root && document.body && document.body.contains(state.root)) {
      return state.root;
    }

    if (!document.body) return null;

    let root = document.getElementById("xpOverlay");
    if (!root) {
      root = document.createElement("div");
      root.id = "xpOverlay";
      root.className = "xp-overlay";
      root.setAttribute("aria-live", "polite");

      const stack = document.createElement("div");
      stack.id = "xpOverlayStack";
      stack.className = "xp-overlay__stack";
      root.appendChild(stack);

      const row = document.createElement("div");
      row.className = "xp-overlay__row";

      const combo = document.createElement("div");
      combo.className = "xp-overlay__combo";

      const comboText = document.createElement("span");
      comboText.id = "xpComboText";
      comboText.textContent = "x1";
      combo.appendChild(comboText);

      const progress = document.createElement("div");
      progress.className = "xp-overlay__progress";

      const fill = document.createElement("div");
      fill.id = "xpComboFill";
      progress.appendChild(fill);

      combo.appendChild(progress);
      row.appendChild(combo);

      const boost = document.createElement("div");
      boost.id = "xpBoostChip";
      boost.className = "xp-overlay__boost";
      boost.hidden = true;
      row.appendChild(boost);

      root.appendChild(row);
      document.body.appendChild(root);
    }

    state.root = root;
    state.stack = root.querySelector("#xpOverlayStack");
    state.comboText = root.querySelector("#xpComboText");
    state.comboFill = root.querySelector("#xpComboFill");
    state.progressEl = root.querySelector(".xp-overlay__progress");
    state.boostChip = root.querySelector("#xpBoostChip");

    return state.root;
  }

  function clearIdleTimer() {
    if (!state.idleTimer) return;
    try { window.clearTimeout(state.idleTimer); } catch (_) {}
    state.idleTimer = null;
  }

  function scheduleIdleFade() {
    clearIdleTimer();
    if (!window || typeof window.setTimeout !== "function") return;
    state.idleTimer = window.setTimeout(() => {
      state.idleTimer = null;
      if (!ensureRoot()) return;
      withFrame(() => {
        if (state.root) state.root.classList.add("xp-faded");
      });
    }, FADE_IDLE_MS);
  }

  function formatMultiplier(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "1";
    const rounded = Math.round(numeric * 100) / 100;
    if (Math.abs(rounded - Math.round(rounded)) < 0.01) {
      return String(Math.round(rounded));
    }
    return rounded.toFixed(2).replace(/\.0+$/, "").replace(/0+$/, "");
  }

  function formatSeconds(seconds) {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric) || numeric <= 0) return "00";
    const clamped = Math.max(0, Math.round(numeric));
    return clamped.toString().padStart(2, "0");
  }

  function triggerPulse(element) {
    if (!element) return;
    element.classList.remove("xp-pulse");
    void element.offsetWidth;
    element.classList.add("xp-pulse");
  }

  function flashProgress() {
    if (!state.progressEl) return;
    state.progressEl.classList.remove("xp-overlay__progress--flash");
    void state.progressEl.offsetWidth;
    state.progressEl.classList.add("xp-overlay__progress--flash");
  }

  function removePop(pop) {
    if (!pop) return;
    const parent = pop.parentNode;
    if (parent) {
      parent.removeChild(pop);
    }
    state.popQueue = state.popQueue.filter((node) => node !== pop);
  }

  function createPop(detail) {
    if (!ensureRoot() || !state.stack) return;
    const awarded = detail.awarded;
    const combo = detail.combo;
    const boost = detail.boost;

    const pieces = [`+${awarded}`];
    const comboText = `x${formatMultiplier(combo)}`;
    const hasBoost = Number.isFinite(boost) && boost > 1.001;
    let suffix = comboText;
    if (hasBoost) {
      suffix = `${comboText} • x${formatMultiplier(boost)} boost`;
    }
    pieces.push(`(${suffix})`);

    const pop = document.createElement("div");
    pop.className = "xp-pop xp-pop--enter";
    pop.textContent = pieces.join(" ");

    pop.addEventListener("animationend", (event) => {
      if (!event || !event.animationName) return;
      if (event.animationName === "xpPopEnter") {
        pop.classList.remove("xp-pop--enter");
        pop.classList.add("xp-pop--float");
        return;
      }
      if (event.animationName === "xpFloat") {
        removePop(pop);
      }
    });

    state.stack.appendChild(pop);
    state.popQueue.push(pop);
    while (state.popQueue.length > MAX_POP_ELEMENTS) {
      removePop(state.popQueue.shift());
    }
  }

  function clearPops() {
    state.popQueue.forEach((pop) => {
      if (pop && pop.parentNode) {
        pop.parentNode.removeChild(pop);
      }
    });
    state.popQueue = [];
  }

  function updateCombo(combo) {
    const numeric = Number(combo);
    const normalized = Number.isFinite(numeric) ? Math.max(1, numeric) : 1;
    const previous = state.comboValue;
    state.comboValue = normalized;
    if (!ensureRoot()) return;
    withFrame(() => {
      if (state.comboText) {
        state.comboText.textContent = `x${formatMultiplier(normalized)}`;
        if (normalized > previous + 0.001) {
          triggerPulse(state.comboText);
        }
      }
    });
  }

  function updateProgress(progress) {
    const numeric = Number(progress);
    const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
    const previous = state.lastProgress;
    state.lastProgress = clamped;
    if (!ensureRoot()) return;
    withFrame(() => {
      if (state.comboFill) {
        state.comboFill.style.width = `${Math.round(clamped * 100)}%`;
      }
      if (previous > clamped + 0.001) {
        flashProgress();
      }
    });
  }

  function clearBoostTimer() {
    if (state.boostInterval) {
      try { window.clearInterval(state.boostInterval); } catch (_) {}
      state.boostInterval = null;
    }
  }

  function renderBoost(multiplier, secondsLeft) {
    if (!ensureRoot() || !state.boostChip) return;
    const seconds = Math.max(0, Math.round(secondsLeft));
    if (multiplier <= 1 || seconds <= 0) {
      clearBoostTimer();
      withFrame(() => {
        if (!state.boostChip) return;
        state.boostChip.hidden = true;
        state.boostChip.textContent = "";
      });
      state.boostSecondsLeft = 0;
      state.boostMultiplier = 1;
      logDiag("overlay:boost_end");
      return;
    }

    state.boostSecondsLeft = seconds;
    state.boostMultiplier = Math.max(1, multiplier);
    withFrame(() => {
      if (!state.boostChip) return;
      state.boostChip.hidden = false;
      state.boostChip.textContent = `BOOST x${formatMultiplier(multiplier)} · ${formatSeconds(seconds)}s`;
    });
    logDiag("overlay:boost_start", { multiplier, seconds });

    clearBoostTimer();
    if (!window || typeof window.setInterval !== "function") return;
    state.boostInterval = window.setInterval(() => {
      state.boostSecondsLeft -= 1;
      if (state.boostSecondsLeft <= 0) {
        renderBoost(1, 0);
        return;
      }
      withFrame(() => {
        if (!state.boostChip) return;
        state.boostChip.textContent = `BOOST x${formatMultiplier(multiplier)} · ${formatSeconds(state.boostSecondsLeft)}s`;
      });
    }, 1_000);
  }

  function handleXpTick(event) {
    const detail = event && typeof event.detail === "object" ? event.detail : null;
    if (!detail) return;
    const awarded = Number(detail.awarded);
    const combo = Number(detail.combo);
    const boost = Number(detail.boost);
    const progress = Number(detail.progressToNext);
    if (!Number.isFinite(awarded) || awarded < 0) return;
    const normalizedCombo = Number.isFinite(combo) ? Math.max(1, combo) : 1;
    const normalizedBoost = Number.isFinite(boost) ? Math.max(1, boost) : 1;
    const normalizedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;

    ensureRoot();
    withFrame(() => {
      if (state.root) state.root.classList.remove("xp-faded");
    });
    scheduleIdleFade();

    createPop({
      awarded: Math.round(awarded),
      combo: normalizedCombo,
      boost: normalizedBoost,
    });
    updateCombo(normalizedCombo);
    updateProgress(normalizedProgress);
    logDiag("overlay:tick", {
      awarded: Math.round(awarded),
      combo: normalizedCombo,
      boost: normalizedBoost,
      progress: normalizedProgress,
    });
  }

  function handleXpBoost(event) {
    const detail = event && typeof event.detail === "object" ? event.detail : null;
    if (!detail) return;
    const multiplier = Number(detail.multiplier);
    const secondsLeft = Number(detail.secondsLeft);
    const normalizedMultiplier = Number.isFinite(multiplier) ? Math.max(1, multiplier) : 1;
    const normalizedSeconds = Number.isFinite(secondsLeft) ? Math.max(0, Math.round(secondsLeft)) : 0;
    if (normalizedMultiplier <= 1 || normalizedSeconds <= 0) {
      renderBoost(1, 0);
      return;
    }
    renderBoost(normalizedMultiplier, normalizedSeconds);
  }

  function attachListeners() {
    if (state.listenersAttached) return;
    if (!window || typeof window.addEventListener !== "function") return;
    ensureRoot();
    try { window.addEventListener("xp:tick", handleXpTick, { passive: true }); } catch (_) {
      try { window.addEventListener("xp:tick", handleXpTick); } catch (_) {}
    }
    try { window.addEventListener("xp:boost", handleXpBoost, { passive: true }); } catch (_) {
      try { window.addEventListener("xp:boost", handleXpBoost); } catch (_) {}
    }
    state.listenersAttached = true;
  }

  function detachListeners() {
    if (!state.listenersAttached) return;
    if (window && typeof window.removeEventListener === "function") {
      try { window.removeEventListener("xp:tick", handleXpTick, { passive: true }); } catch (_) {
        try { window.removeEventListener("xp:tick", handleXpTick); } catch (_) {}
      }
      try { window.removeEventListener("xp:boost", handleXpBoost, { passive: true }); } catch (_) {
        try { window.removeEventListener("xp:boost", handleXpBoost); } catch (_) {}
      }
    }
    state.listenersAttached = false;
  }

  function cleanup() {
    detachListeners();
    clearIdleTimer();
    clearBoostTimer();
    clearPops();
    if (state.root) {
      withFrame(() => {
        if (state.root) state.root.classList.add("xp-faded");
      });
    }
    logDiag("overlay:cleanup");
  }

  function handleXpHidden() {
    cleanup();
  }

  function handleXpVisible() {
    attachListeners();
    scheduleIdleFade();
    if (state.boostMultiplier > 1 && state.boostSecondsLeft > 0) {
      renderBoost(state.boostMultiplier, state.boostSecondsLeft);
    }
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    ensureRoot();
    attachListeners();
    scheduleIdleFade();
    if (document && typeof document.addEventListener === "function") {
      try { document.addEventListener("xp:hidden", handleXpHidden, { passive: true }); } catch (_) {
        try { document.addEventListener("xp:hidden", handleXpHidden); } catch (_) {}
      }
      try { document.addEventListener("xp:visible", handleXpVisible, { passive: true }); } catch (_) {
        try { document.addEventListener("xp:visible", handleXpVisible); } catch (_) {}
      }
    }
    logDiag("overlay:init");
  }

  if (document.readyState === "loading") {
    try {
      document.addEventListener("DOMContentLoaded", init, { once: true, passive: true });
    } catch (_) {
      try { document.addEventListener("DOMContentLoaded", init, { once: true }); } catch (_) {
        try { document.addEventListener("DOMContentLoaded", init); } catch (_) {}
      }
    }
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : undefined, typeof document !== "undefined" ? document : undefined);
