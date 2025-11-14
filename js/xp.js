(function (window, document) {
  const CHUNK_MS = 10_000;
  const HARD_IDLE_MS = parseNumber(window && window.XP_HARD_IDLE_MS, 6_000);
  const isLikelyMobile = () => {
    try {
      if (typeof navigator !== "undefined" && navigator && typeof navigator.userAgentData === "object" && typeof navigator.userAgentData.mobile === "boolean") {
        return navigator.userAgentData.mobile;
      }
      if (typeof navigator !== "undefined" && navigator && typeof navigator.userAgent === "string") {
        return /Android|iPhone|iPad|iPod|Mobile|IEMobile|BlackBerry/i.test(navigator.userAgent);
      }
    } catch (_) {}
    return false;
  };
  const DEFAULT_ACTIVE_WINDOW_MS = isLikelyMobile() ? 3_000 : 5_000;
  const ACTIVE_WINDOW_MS = parseNumber(window && window.XP_ACTIVE_WINDOW_MS, DEFAULT_ACTIVE_WINDOW_MS);
  const CACHE_KEY = "kcswh:xp:last";

  const LEVEL_BASE_XP = 100;
  const LEVEL_MULTIPLIER = 1.1;

  const DEFAULT_SCORE_DELTA_CEILING = 10_000;
  const DEFAULT_CLIENT_DELTA_CAP = 300;
  const DEFAULT_BOOST_SEC = 15;
  const COMBO_CAP = 20;
  const COMBO_SUSTAIN_MS = 5_000;
  const COMBO_COOLDOWN_MS = 3_000;
  const DIAG_QUERY = /\bxpdiag=1\b/;

  let diagEnabledCache = null;

  function isDiagEnabled() {
    if (diagEnabledCache != null) return diagEnabledCache;
    if (window && window.XP_DIAG) {
      diagEnabledCache = true;
      return true;
    }
    try {
      if (typeof location !== "undefined" && location && typeof location.search === "string") {
        if (DIAG_QUERY.test(location.search)) {
          diagEnabledCache = true;
          return true;
        }
      }
    } catch (_) {}
    try {
      if (window && window.location && typeof window.location.search === "string") {
        if (DIAG_QUERY.test(window.location.search)) {
          diagEnabledCache = true;
          return true;
        }
      }
    } catch (_) {}
    diagEnabledCache = false;
    return false;
  }

  function parseNumber(value, fallback) {
    if (value == null) return fallback;
    const sanitized = typeof value === "string" ? value.replace(/_/g, "") : value;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getClientDeltaCap() {
    if (typeof window === "undefined" || !window) {
      return DEFAULT_CLIENT_DELTA_CAP;
    }
    const raw = Object.prototype.hasOwnProperty.call(window, "XP_DELTA_CAP_CLIENT")
      ? window.XP_DELTA_CAP_CLIENT
      : undefined;
    const parsed = parseNumber(raw, DEFAULT_CLIENT_DELTA_CAP);
    if (!Number.isFinite(parsed)) return DEFAULT_CLIENT_DELTA_CAP;
    const normalized = Math.max(0, Math.floor(parsed));
    return normalized || 0;
  }

  function normalizeGameId(value) {
    if (value == null) return "";
    try {
      const text = String(value);
      return text ? text.trim() : "";
    } catch (_) {
      return "";
    }
  }

  function computeComboStepThreshold(multiplier) {
    const stage = Math.max(1, Math.floor(Number(multiplier) || 1));
    if (stage >= COMBO_CAP) return 1;
    const base = 1 + Math.floor((stage - 1) / 3);
    return Math.max(1, Math.min(5, base));
  }

  function createComboState() {
    return {
      mode: "build",
      multiplier: 1,
      points: 0,
      stepThreshold: computeComboStepThreshold(1),
      sustainLeftMs: 0,
      cooldownLeftMs: 0,
      cap: COMBO_CAP,
    };
  }

  function normalizeCombo(raw) {
    const combo = raw && typeof raw === "object" ? raw : {};
    combo.cap = COMBO_CAP;
    if (combo.mode !== "sustain" && combo.mode !== "cooldown") {
      combo.mode = "build";
    }
    combo.multiplier = Math.max(1, Math.min(combo.cap, Math.floor(Number(combo.multiplier) || 1)));
    combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
    combo.points = Math.max(0, Math.min(combo.stepThreshold, Number(combo.points) || 0));
    combo.sustainLeftMs = Math.max(0, Math.min(COMBO_SUSTAIN_MS, Number(combo.sustainLeftMs) || 0));
    combo.cooldownLeftMs = Math.max(0, Math.min(COMBO_COOLDOWN_MS, Number(combo.cooldownLeftMs) || 0));

    if (combo.multiplier >= combo.cap) {
      combo.multiplier = combo.cap;
      combo.points = 0;
      if (combo.mode === "build") {
        combo.mode = combo.sustainLeftMs > 0 ? "sustain" : "cooldown";
      }
    }

    if (combo.mode === "sustain") {
      combo.multiplier = combo.cap;
      if (combo.sustainLeftMs <= 0) {
        combo.mode = "cooldown";
        combo.cooldownLeftMs = Math.max(combo.cooldownLeftMs, COMBO_COOLDOWN_MS);
        combo.sustainLeftMs = 0;
      }
      combo.points = 0;
    }

    if (combo.mode === "cooldown") {
      combo.multiplier = 1;
      combo.points = 0;
      combo.sustainLeftMs = 0;
      if (combo.cooldownLeftMs <= 0) {
        combo.mode = "build";
      }
    }

    if (combo.mode === "build") {
      combo.sustainLeftMs = 0;
      combo.cooldownLeftMs = 0;
      combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
      combo.points = Math.max(0, Math.min(combo.stepThreshold, combo.points));
    }

    return combo;
  }

  const HOST_SLUG_PATTERN = /^(2048|pacman|tetris|t-rex)$/i;

  function __isGameHost() {
    if (typeof window !== "undefined" && window && window.XP_IS_GAME_HOST) return true;
    if (typeof document === "undefined" || !document || !document.body) return false;
    if (typeof document.body.hasAttribute === "function" && document.body.hasAttribute("data-game-host")) return true;
    try {
      const slug = document.body.dataset?.gameSlug
        || (location.pathname.split("/").filter(Boolean).slice(-1)[0] || "");
      return HOST_SLUG_PATTERN.test(slug);
    } catch (_) {
      return false;
    }
  }

  function __isXpHostPage() {
    try {
      if (typeof window !== "undefined" && window && typeof window.XP_HOST_PAGE === "string" && window.XP_HOST_PAGE) {
        if (window.XP_HOST_PAGE.toLowerCase() === "xp") return true;
      }
    } catch (_) {}
    if (typeof document !== "undefined" && document) {
      try {
        if (document.documentElement && typeof document.documentElement.getAttribute === "function") {
          const attr = document.documentElement.getAttribute("data-xp-host");
          if (attr && attr.toLowerCase() === "xp") return true;
        }
      } catch (_) {}
      try {
        if (document.body && document.body.classList && document.body.classList.contains("xp-page-body")) {
          return true;
        }
      } catch (_) {}
      try {
        if (typeof document.querySelector === "function" && document.querySelector(".xp-page")) {
          return true;
        }
      } catch (_) {}
    }
    try {
      const path = typeof location !== "undefined" && location && typeof location.pathname === "string"
        ? location.pathname
        : "";
      if (/\bxp(?:\.html)?$/i.test(path || "")) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function detectHostPage() {
    if (__isGameHost()) return "game";
    if (__isXpHostPage()) return "xp";
    return "default";
  }

  const HOST_PAGE = detectHostPage();

  const MAX_SCORE_DELTA = parseNumber(window && window.XP_SCORE_DELTA_CEILING, DEFAULT_SCORE_DELTA_CEILING);
  const BASELINE_XP_PER_SECOND = parseNumber(window && window.XP_BASELINE_XP_PER_SECOND, 10);
  const TICK_MS = parseNumber(window && window.XP_TICK_MS, 1_000);
  const AWARD_INTERVAL_MS = parseNumber(window && window.XP_AWARD_INTERVAL_MS, TICK_MS);
  const ACTIVE_GRACE_MS = parseNumber(window && window.XP_ACTIVE_GRACE_MS, 300);
  const MIN_EVENTS_PER_TICK = Math.max(1, Math.floor(parseNumber(window && window.XP_MIN_EVENTS_PER_TICK, 1)) || 1);
  const HARD_IDLE_RESET = parseNumber(window && window.XP_HARD_IDLE_RESET, 1) !== 0;
  const ACTIVITY_EXPONENT = parseNumber(window && window.XP_ACTIVITY_EXPONENT, 1.5);
  const MAX_XP_PER_SECOND = parseNumber(window && window.XP_MAX_XP_PER_SECOND, 24);
  const REQUIRE_SCORE_PULSE = parseNumber(window && window.XP_REQUIRE_SCORE, 1) === 1;
  const SCORE_GRACE_MS = parseNumber(window && window.XP_SCORE_GRACE_MS, 8_000);
  const GAME_SURFACE_SELECTOR = (window && window.XP_GAME_SURFACE_SELECTOR) || "#game, canvas, #gameFrame, #frameBox, #frameWrap, [data-game-surface]";
  const BADGE_RECONCILE_INTERVAL_MS = parseNumber(window && window.XP_BADGE_RECONCILE_INTERVAL_MS, 15_000);
  const SESSION_RENDER_MODE = (window && window.XP_SESSION_RENDER_MODE) || "monotonic";
  const FLUSH_INTERVAL_MS = 15_000;
  const FLUSH_THRESHOLD = 50;
  const RUNTIME_CACHE_KEY = "kcswh:xp:regen";
  const FLUSH_ENDPOINT = (typeof window !== "undefined" && window && typeof window.XP_FLUSH_ENDPOINT === "string") ? window.XP_FLUSH_ENDPOINT : null;

  function isGameHost() {
    return HOST_PAGE === "game";
  }

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
    awardTimerId: null,
    pending: null,
    lastResultTs: 0,
    snapshot: null,
    scoreDelta: 0,
    scoreDeltaRemainder: 0,
    lastTrustedInputTs: 0,
    regen: {
      carry: 0,
      momentum: 0,
      pending: 0,
      lastAward: 0,
    },
    combo: createComboState(),
    flush: {
      pending: 0,
      lastSync: 0,
      inflight: null,
    },
    boost: {
      multiplier: 1,
      expiresAt: 0,
      source: null,
    },
    boostTimerId: null,
    debug: {
      lastNoHostLog: 0,
      hardIdleActive: false,
      initLogged: false,
      adminInitLogged: false,
      lastActivityLog: 0,
      lastCapLog: 0,
      lastVisibilityLog: 0,
      lastAwardSkipLog: 0,
      lastUnfreezeLog: 0,
    },
    lastScorePulseTs: 0,
    phase: "idle",
    lastInputAt: 0,
    eventsSinceLastAward: 0,
    scoreDeltaSinceLastAward: 0,
    listenersAttached: false,
    activityWindowFrozen: false,
    isActive: false,
    sessionXp: 0,
    badgeShownXp: 0,
    serverTotalXp: null,
    badgeBaselineXp: 0,
    pendingWindow: null,
    lastSuccessfulWindowEnd: null,
    badgeTimerId: null,
    runBoostTriggered: false,
    boostStartSeen: false,
    boostResetGuardUntil: 0,
    lastBoostDetail: null,
    storedHighScore: null,
    storedHighScoreGameId: null,
    // Derived from cap - totalToday. Server hints are normalized through
    // syncDailyRemainingFromTotals() so this never drifts from the totals.
    dailyRemaining: Infinity,
    nextResetEpoch: 0,
    dayKey: null,
  };

  function ensureComboState() {
    if (!state.combo || typeof state.combo !== "object") {
      state.combo = createComboState();
    }
    return normalizeCombo(state.combo);
  }

  function snapshotCombo() {
    const combo = ensureComboState();
    return {
      mode: combo.mode,
      multiplier: combo.multiplier,
      points: combo.points,
      stepThreshold: combo.stepThreshold,
      sustainLeftMs: combo.sustainLeftMs,
      cooldownLeftMs: combo.cooldownLeftMs,
      cap: combo.cap,
    };
  }

  function computeComboProgress(combo) {
    if (!combo || typeof combo !== "object") return 0;
    if (combo.mode === "sustain") {
      if (COMBO_SUSTAIN_MS <= 0) return 0;
      return Math.max(0, Math.min(1, combo.sustainLeftMs / COMBO_SUSTAIN_MS));
    }
    if (combo.mode === "cooldown") {
      return 0;
    }
    const threshold = combo.stepThreshold > 0 ? combo.stepThreshold : 1;
    return Math.max(0, Math.min(1, combo.points / threshold));
  }

  function advanceCombo(deltaMs, activityRatio, isActive) {
    const combo = ensureComboState();
    const elapsed = Math.max(0, Number(deltaMs) || 0);
    const ratio = Math.max(0, Math.min(1, Number(activityRatio) || 0));

    if (combo.mode === "cooldown") {
      if (elapsed > 0) {
        combo.cooldownLeftMs = Math.max(0, combo.cooldownLeftMs - elapsed);
        if (combo.cooldownLeftMs <= 0) {
          combo.mode = "build";
          combo.multiplier = 1;
          combo.points = 0;
        }
      }
      return normalizeCombo(combo);
    }

    if (combo.mode === "sustain") {
      if (elapsed > 0) {
        combo.sustainLeftMs = Math.max(0, combo.sustainLeftMs - elapsed);
        if (combo.sustainLeftMs <= 0) {
          combo.mode = "cooldown";
          combo.cooldownLeftMs = COMBO_COOLDOWN_MS;
          combo.multiplier = 1;
          combo.points = 0;
        }
      }
      return normalizeCombo(combo);
    }

    if (!isActive) {
      combo.points = Math.max(0, combo.points * 0.5);
      return normalizeCombo(combo);
    }

    if (ratio <= 0) {
      combo.points = 0;
      combo.multiplier = 1;
      return normalizeCombo(combo);
    }

    const scaledGain = ratio * (elapsed > 0 ? Math.max(1, elapsed / AWARD_INTERVAL_MS) : 1);
    if (Number.isFinite(scaledGain) && scaledGain > 0) {
      combo.points = Math.max(0, combo.points + scaledGain);
    }

    while (combo.multiplier < combo.cap && combo.points >= combo.stepThreshold) {
      combo.points -= combo.stepThreshold;
      combo.multiplier += 1;
      combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
    }

    if (combo.multiplier >= combo.cap) {
      combo.multiplier = combo.cap;
      combo.mode = "sustain";
      combo.sustainLeftMs = COMBO_SUSTAIN_MS;
      combo.points = 0;
    }

    return normalizeCombo(combo);
  }

  function isFromGameSurface(ev) {
    try {
      const root = document;
      if (!root) return false;
      const path = (ev && typeof ev.composedPath === "function") ? ev.composedPath() : null;
      const target = (path && path.length) ? path[0] : (ev && ev.target);
      if (!target) return false;
      const isElement = (typeof Element !== "undefined" && target instanceof Element) || (target && target.nodeType === 1);
      if (!isElement) return false;
      if (typeof target.closest === "function" && target.closest(GAME_SURFACE_SELECTOR)) return true;

      if (ev && ev.type === "keydown") {
        const active = root.activeElement;
        if (active && typeof active.closest === "function" && active.closest(GAME_SURFACE_SELECTOR)) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function isDebugAdminEnabled() {
    try {
      if (window && window.KLog && typeof window.KLog.isAdmin === "function") {
        return !!window.KLog.isAdmin();
      }
    } catch (_) {}
    return false;
  }

  function getDebugLogger() {
    try {
      if (!window || !window.KLog || typeof window.KLog.log !== "function") return null;
      return window.KLog;
    } catch (_) {
      return null;
    }
  }

  function ensureDebugRecorderPrimed() {
    const logger = getDebugLogger();
    if (!logger) return false;
    let admin = false;
    if (typeof logger.isAdmin === "function") {
      try {
        admin = !!logger.isAdmin();
      } catch (_) {
        admin = false;
      }
    }
    if (!admin) return false;
    if (typeof logger.start === "function") {
      try {
        const status = typeof logger.status === "function" ? logger.status() : null;
        const level = status && typeof status.level === "number" ? status.level : 0;
        const startedAt = status && typeof status.startedAt === "number" ? status.startedAt : 0;
        if (!Number.isFinite(level) || level <= 0 || !Number.isFinite(startedAt) || startedAt <= 0) {
          logger.start(1);
        }
      } catch (_) {}
    }
    return true;
  }

  function writeDebugEntry(kind, data) {
    const logger = getDebugLogger();
    if (!logger) return false;
    try {
      return logger.log(kind, data || {});
    } catch (_) {
      return false;
    }
  }

  function logDebug(kind, data) {
    try {
      if (!ensureDebugRecorderPrimed()) return false;
      return !!writeDebugEntry(kind, data || {});
    } catch (_) {
      return false;
    }
  }

  function logAwardSkip(reason, extra) {
    const now = Date.now();
    const lastSkip = Number(state.debug.lastAwardSkipLog) || 0;
    if ((now - lastSkip) <= 500) return false;
    state.debug.lastAwardSkipLog = now;
    logDebug("award_skip", Object.assign({ reason }, extra || {}));
    return true;
  }

  function resolvePagePath() {
    try {
      if (typeof location !== "undefined" && location && typeof location.pathname === "string") {
        return location.pathname;
      }
    } catch (_) {}
    return "";
  }

  function emitAdminInitLog() {
    if (!isDebugAdminEnabled()) return;
    if (state.debug.adminInitLogged) return;
    const page = resolvePagePath();
    const logged = logDebug("xp_init", { page, admin: true });
    if (logged && isDebugAdminEnabled()) {
      state.debug.adminInitLogged = true;
    }
  }

  function logBlockNoHost(now) {
    if (!state.running) return;
    const ts = typeof now === "number" ? now : Date.now();
    const last = Number(state.debug.lastNoHostLog) || 0;
    if (ts - last < 2_000) return;
    state.debug.lastNoHostLog = ts;
    logDebug("block_no_host", { running: true });
  }

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

  function zeroTickCounters() {
    state.eventsSinceLastAward = 0;
    state.scoreDeltaSinceLastAward = 0;
  }

  function dropScoreBuffers(reason) {
    state.scoreDelta = 0;
    state.scoreDeltaRemainder = 0;
    state.scoreDeltaSinceLastAward = 0;
    try {
      logDebug("award_drop_buffer", { reason: reason || "unknown" });
    } catch (_) {}
  }

  function markActiveInput(now) {
    if (!state.running) return;
    const ts = typeof now === "number" ? now : Date.now();
    state.lastInputAt = ts;
    state.eventsSinceLastAward = Math.max(0, (state.eventsSinceLastAward || 0) + 1);
    if (state.activityWindowFrozen) {
      state.activityWindowFrozen = false;
      if (state.debug.hardIdleActive) {
        state.debug.hardIdleActive = false;
      }
      const lastLog = Number(state.debug.lastUnfreezeLog) || 0;
      if ((ts - lastLog) > 2_000) {
        state.debug.lastUnfreezeLog = ts;
        logDebug("activity_unfrozen", {});
      }
    }
  }

  function getCurrentActivityRatio(now, delta) {
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    if (!isDocumentVisible()) return 0;
    const windowStart = now - delta;
    const activeUntil = state.activeUntil || 0;
    if (activeUntil <= windowStart) return 0;
    const activeMs = Math.max(0, Math.min(delta, activeUntil - windowStart));
    if (activeMs <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, activeMs / delta));
    return Number.isFinite(ratio) ? ratio : 0;
  }

  function updateMomentum(activityRatio) {
    const ratio = Math.min(1, Math.max(0, Number(activityRatio) || 0));
    const prevMomentum = Number(state.regen.momentum) || 0;
    let nextMomentum = prevMomentum;
    if (ratio >= 0.75) {
      nextMomentum = Math.min(1, prevMomentum + 0.12 + ((ratio - 0.75) * 0.4));
    } else if (ratio >= 0.35) {
      nextMomentum = Math.max(0, prevMomentum * 0.85 + ratio * 0.15);
    } else {
      nextMomentum = Math.max(0, prevMomentum * 0.5);
    }
    state.regen.momentum = nextMomentum;
    return nextMomentum;
  }

  function computeBaseMultiplier(activityRatio) {
    const clamped = Math.min(1, Math.max(0, Number(activityRatio) || 0));
    const base = BASELINE_XP_PER_SECOND * Math.pow(clamped, ACTIVITY_EXPONENT);
    if (!Number.isFinite(base)) return 0;
    return Math.min(MAX_XP_PER_SECOND, Math.max(0, base));
  }

  function applyCombo(multiplier) {
    const base = Number(multiplier) || 0;
    if (base <= 0) return 0;
    const combo = ensureComboState();
    const stage = Math.max(1, Number(combo.multiplier) || 1);
    if (stage <= 1) return base;
    const comboBonus = Math.min(0.75, Math.max(0, stage - 1) * 0.03);
    return base * (1 + comboBonus);
  }

  function clearBoostTimer() {
    if (state.boostTimerId) {
      try { clearTimeout(state.boostTimerId); } catch (_) {}
      state.boostTimerId = null;
    }
  }

  function broadcastBoost(detail) {
    if (!detail || typeof detail !== "object") return;
    const targets = [];
    if (typeof window !== "undefined" && window && typeof window.dispatchEvent === "function") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document && typeof document.dispatchEvent === "function") {
      targets.push(document);
    }
    if (!targets.length) return;
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      try {
        if (typeof CustomEvent === "function") {
          const evt = new CustomEvent("xp:boost", { detail });
          target.dispatchEvent(evt);
          continue;
        }
      } catch (_) {}
      try {
        if (typeof document !== "undefined" && document && typeof document.createEvent === "function") {
          const evt = document.createEvent("CustomEvent");
          evt.initCustomEvent("xp:boost", false, false, detail);
          target.dispatchEvent(evt);
          continue;
        }
      } catch (_) {}
      try { target.dispatchEvent({ type: "xp:boost", detail }); } catch (_) {}
    }
  }

  function emitBoost(multiplier, ttlMs, meta) {
    const numericMultiplier = Number(multiplier);
    const numericTtl = Number(ttlMs);
    const parsedTtl = Number.isFinite(numericTtl) && numericTtl > 0
      ? Math.max(0, Math.floor(numericTtl))
      : 0;
    const hasBoost = Number.isFinite(numericMultiplier) && numericMultiplier > 1;
    const now = Date.now();
    const expiresAt = hasBoost && parsedTtl > 0 ? now + parsedTtl : now;
    let totalSeconds = meta && Object.prototype.hasOwnProperty.call(meta, "totalSeconds")
      ? parseNumber(meta.totalSeconds, NaN)
      : NaN;
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      totalSeconds = parsedTtl > 0 ? Math.floor(parsedTtl / 1000) : DEFAULT_BOOST_SEC;
    } else {
      totalSeconds = Math.max(0, Math.floor(totalSeconds));
    }
    if (totalSeconds > 3600) {
      totalSeconds = 3600;
    }

    const detail = {
      multiplier: hasBoost ? numericMultiplier : 1,
      ttlMs: hasBoost ? parsedTtl : 0,
      expiresAt,
      endsAt: expiresAt,
      totalSeconds,
      schema: 3,
      __xpOrigin: "xp.js",
      __xpInternal: true,
    };

    if (meta && meta.source != null) {
      detail.source = String(meta.source);
    }
    if (meta && meta.gameId) {
      detail.gameId = meta.gameId;
    }

    state.lastBoostDetail = detail;

    broadcastBoost(detail);
  }

  function emitTick(awarded, activityRatio, isActive) {
    if (!window || typeof window.dispatchEvent !== "function") return;
    const comboSnapshot = snapshotCombo();
    const detail = {
      awarded: Math.max(0, Number(awarded) || 0),
      activityRatio: Math.max(0, Number(activityRatio) || 0),
      isActive: !!isActive,
      combo: comboSnapshot,
      progressToNext: computeComboProgress(comboSnapshot),
      mode: comboSnapshot.mode,
    };
    if (state.gameId) {
      detail.gameId = state.gameId;
    }
    const comboMultiplier = Number.isFinite(comboSnapshot.multiplier) && comboSnapshot.multiplier > 0
      ? comboSnapshot.multiplier
      : 1;
    const boostMultiplier = getBoostMultiplierValue();
    if (isDiagEnabled()) {
      try { console.debug("award_tick", { awarded: detail.awarded, combo: comboMultiplier, boost: boostMultiplier }); }
      catch (_) {}
    }
    if (detail.awarded > 0) {
      const overlay = (window && window.XpOverlay) || (window && window.XPOverlay);
      if (overlay && typeof overlay.showBurst === "function") {
        try { overlay.showBurst({ xp: detail.awarded, combo: comboMultiplier, boost: boostMultiplier }); }
        catch (_) {}
      }
    }
    try {
      if (typeof CustomEvent === "function") {
        const evt = new CustomEvent("xp:tick", { detail });
        window.dispatchEvent(evt);
        return;
      }
      if (typeof document !== "undefined" && document && typeof document.createEvent === "function") {
        const legacyEvt = document.createEvent("CustomEvent");
        legacyEvt.initCustomEvent("xp:tick", false, false, detail);
        window.dispatchEvent(legacyEvt);
        return;
      }
      window.dispatchEvent({ type: "xp:tick", detail });
    } catch (_) {
      try {
        window.dispatchEvent({ type: "xp:tick", detail });
      } catch (_) {}
    }
  }

  function resetBoost(meta) {
    const previous = state.boost || { multiplier: 1, expiresAt: 0, source: null, totalSeconds: DEFAULT_BOOST_SEC, gameId: null };
    clearBoostTimer();
    state.boost = { multiplier: 1, expiresAt: 0, source: null, totalSeconds: DEFAULT_BOOST_SEC, gameId: null };
    state.boostStartSeen = false;
    state.lastBoostDetail = null;
    state.boostResetGuardUntil = Date.now() + 125;
    const nextTotalSeconds = meta && Object.prototype.hasOwnProperty.call(meta, "totalSeconds")
      ? Math.max(0, Math.floor(parseNumber(meta.totalSeconds, DEFAULT_BOOST_SEC) || 0))
      : Math.max(0, Math.floor(parseNumber(previous.totalSeconds, DEFAULT_BOOST_SEC) || DEFAULT_BOOST_SEC));
    const payload = {
      source: meta && meta.source != null ? meta.source : previous.source,
      totalSeconds: nextTotalSeconds || DEFAULT_BOOST_SEC,
      gameId: (meta && meta.gameId) || previous.gameId || null,
    };
    if (previous.multiplier !== 1 || previous.expiresAt !== 0 || (previous.source || null) !== null) {
      persistRuntimeState();
    }
    emitBoost(1, 0, payload);
  }

  function scheduleBoostExpiration(expiresAt) {
    clearBoostTimer();
    const target = Number(expiresAt) || 0;
    if (!Number.isFinite(target) || target <= 0) return;
    const delay = Math.max(0, Math.floor(target - Date.now()));
    if (delay <= 0) {
      resetBoost();
      return;
    }
    try {
      state.boostTimerId = setTimeout(() => {
        state.boostTimerId = null;
        if (!state.boost || !state.boost.expiresAt) {
          resetBoost();
          return;
        }
        if (Date.now() >= state.boost.expiresAt) {
          resetBoost();
        } else {
          scheduleBoostExpiration(state.boost.expiresAt);
        }
      }, delay);
    } catch (_) {
      resetBoost();
    }
  }

  function clearExpiredBoost(now) {
    const ts = typeof now === "number" ? now : Date.now();
    if (!state.boost) return;
    if (state.boost.expiresAt && ts > state.boost.expiresAt) {
      resetBoost();
    }
  }

  function getBoostMultiplierValue() {
    const boost = state.boost || {};
    const multiplier = Number(boost.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) return 1;
    return multiplier;
  }

  function applyBoost(multiplier) {
    clearExpiredBoost();
    const base = Number(multiplier) || 0;
    if (base <= 0) return 0;
    const boostMultiplier = Number(state.boost && state.boost.multiplier) || 1;
    if (boostMultiplier <= 1) return base;
    return base * boostMultiplier;
  }

  function resolveScorePulseGameId(gameId) {
    const normalized = normalizeGameId(gameId);
    if (normalized) return normalized;
    const active = normalizeGameId(state.gameId);
    if (active) return active;
    try {
      if (window && window.GameXpBridge && typeof window.GameXpBridge.getCurrentGameId === "function") {
        const bridged = normalizeGameId(window.GameXpBridge.getCurrentGameId());
        if (bridged) return bridged;
      }
    } catch (_) {}
    return null;
  }

  function dispatchNewRecordBoost(gameId) {
    const detail = {
      multiplier: 1.5,
      totalSeconds: DEFAULT_BOOST_SEC,
      ttlMs: DEFAULT_BOOST_SEC * 1000,
      source: "newRecord",
    };
    if (gameId) detail.gameId = gameId;
    try {
      requestBoost(detail);
    } catch (_) {}
  }

  function updateStoredHighScore(gameId, score) {
    let nextHighScore = score;
    try {
      if (window && window.GameXpBridge && typeof window.GameXpBridge.updateHighScoreIfBetter === "function") {
        const result = window.GameXpBridge.updateHighScoreIfBetter(gameId, score);
        if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "highScore")) {
          const parsed = Number(result.highScore);
          if (Number.isFinite(parsed) && parsed >= 0) {
            nextHighScore = Math.max(0, Math.floor(parsed));
          }
        } else if (typeof result === "number" && Number.isFinite(result)) {
          nextHighScore = Math.max(0, Math.floor(result));
        }
      }
    } catch (_) {}
    return nextHighScore;
  }

  function readStoredHighScore(gameId) {
    let stored = state.storedHighScore;
    if (Number.isFinite(stored) && stored >= 0 && state.storedHighScoreGameId === gameId) {
      return Math.max(0, Math.floor(stored));
    }
    stored = 0;
    try {
      if (window && window.GameXpBridge && typeof window.GameXpBridge.getHighScore === "function") {
        const raw = window.GameXpBridge.getHighScore(gameId);
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) {
          stored = Math.max(0, Math.floor(parsed));
        }
      }
    } catch (_) {}
    state.storedHighScore = stored;
    state.storedHighScoreGameId = gameId;
    return stored;
  }

  function handleScorePulse(rawGameId, rawScore) {
    const resolvedGameId = resolveScorePulseGameId(rawGameId);
    const numericScore = Number(rawScore);
    if (!Number.isFinite(numericScore)) return;
    const score = Math.max(0, Math.floor(numericScore));
    if (resolvedGameId && state.storedHighScoreGameId !== resolvedGameId) {
      state.storedHighScore = null;
      state.storedHighScoreGameId = resolvedGameId;
      state.runBoostTriggered = false;
    }
    if (!resolvedGameId) return;
    const prevHigh = readStoredHighScore(resolvedGameId);
    const beatRecord = score > prevHigh;
    if (beatRecord) {
      const updatedHighScore = updateStoredHighScore(resolvedGameId, score);
      state.storedHighScore = updatedHighScore;
      state.storedHighScoreGameId = resolvedGameId;
    }
    if (!beatRecord) return;
    const boostActive = getBoostMultiplierValue() > 1;
    if (state.runBoostTriggered) {
      if (isDiagEnabled()) {
        logDebug("hs_update", { gameId: resolvedGameId, score, prevHigh, boosted: true, activeBoost: boostActive });
      }
      return;
    }
    if (boostActive) {
      if (isDiagEnabled()) {
        logDebug("hs_update", { gameId: resolvedGameId, score, prevHigh, boosted: false, activeBoost: true });
      }
      return;
    }
    state.runBoostTriggered = true;
    dispatchNewRecordBoost(resolvedGameId);
  }

  function accumulateLocalXp(xpDelta) {
    const numeric = Number(xpDelta) || 0;
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    let carry = Number(state.regen.carry) || 0;
    const total = numeric + carry;
    const whole = Math.floor(total);
    carry = total - whole;
    state.regen.carry = Math.max(0, carry);
    if (whole <= 0) return 0;
    state.regen.pending = Math.max(0, (state.regen.pending || 0) + whole);
    state.flush.pending = Math.max(0, (state.flush.pending || 0) + whole);
    return whole;
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

  function syncDailyRemainingFromTotals() {
    const capValue = Number(state.cap);
    if (!Number.isFinite(capValue)) {
      state.dailyRemaining = Infinity;
      return;
    }
    const normalizedCap = Math.max(0, Math.floor(capValue));
    const todayValue = Number(state.totalToday);
    if (Number.isFinite(todayValue)) {
      const normalizedToday = Math.max(0, Math.floor(todayValue));
      const candidate = normalizedCap - normalizedToday;
      state.dailyRemaining = Math.max(0, Math.floor(candidate));
      return;
    }
    state.dailyRemaining = normalizedCap;
  }

  function maybeResetDailyAllowance(now) {
    const resetAt = Number(state.nextResetEpoch) || 0;
    if (!resetAt) return false;
    const ts = typeof now === "number" ? now : Date.now();
    if (ts < resetAt) return false;
    const prevKey = state.dayKey || null;
    state.dayKey = null;
    state.nextResetEpoch = 0;
    state.totalToday = 0;
    state.dailyRemaining = Infinity;
    syncDailyRemainingFromTotals();
    try {
      logDebug("daily_reset", { prevKey, resetAt });
    } catch (_) {}
    saveCache();
    updateBadge();
    return true;
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
      if (typeof parsed.badgeShownXp === "number") state.badgeShownXp = parsed.badgeShownXp;
      if (typeof parsed.serverTotalXp === "number") state.serverTotalXp = parsed.serverTotalXp;
      if (typeof parsed.badgeBaselineXp === "number") state.badgeBaselineXp = parsed.badgeBaselineXp;
      state.lastResultTs = parsed.ts || 0;
      if (typeof parsed.nextReset === "number") {
        const nextReset = Math.floor(parsed.nextReset);
        if (Number.isFinite(nextReset) && nextReset > 0) {
          state.nextResetEpoch = nextReset;
        }
      }
      if (typeof parsed.dayKey === "string" && parsed.dayKey) {
        state.dayKey = parsed.dayKey;
      }
      if (state.serverTotalXp == null && typeof state.totalLifetime === "number") {
        state.serverTotalXp = state.totalLifetime;
      }
      if (typeof state.badgeShownXp !== "number" || Number.isNaN(state.badgeShownXp)) {
        state.badgeShownXp = typeof state.totalLifetime === "number" ? state.totalLifetime : 0;
      }
      if (!Number.isFinite(state.badgeBaselineXp)) {
        if (typeof state.serverTotalXp === "number") {
          state.badgeBaselineXp = state.serverTotalXp;
        } else if (typeof state.badgeShownXp === "number") {
          state.badgeBaselineXp = state.badgeShownXp;
        } else if (typeof state.totalLifetime === "number") {
          state.badgeBaselineXp = state.totalLifetime;
        } else {
          state.badgeBaselineXp = 0;
        }
      }
      syncDailyRemainingFromTotals();
      maybeResetDailyAllowance();
    } catch (_) { /* ignore */ }
  }

  function saveCache() {
    try {
      const payload = {
        totalToday: state.totalToday,
        cap: state.cap,
        totalLifetime: state.totalLifetime,
        badgeShownXp: state.badgeShownXp,
        serverTotalXp: state.serverTotalXp,
        badgeBaselineXp: state.badgeBaselineXp,
        ts: Date.now(),
        nextReset: state.nextResetEpoch || 0,
        dayKey: state.dayKey || null,
      };
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) { /* ignore */ }
  }

  function persistRuntimeState() {
    if (typeof window === "undefined") return;
    try {
      const payload = {
        carry: state.regen.carry || 0,
        momentum: state.regen.momentum || 0,
        combo: snapshotCombo(),
        pending: state.regen.pending || 0,
        flushPending: state.flush.pending || 0,
        lastSync: state.flush.lastSync || 0,
        boost: state.boost,
      };
      window.localStorage.setItem(RUNTIME_CACHE_KEY, JSON.stringify(payload));
    } catch (_) { /* ignore */ }
  }

  function hydrateRuntimeState() {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RUNTIME_CACHE_KEY);
      if (!raw) {
        if (!state.flush.lastSync) state.flush.lastSync = Date.now();
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        if (!state.flush.lastSync) state.flush.lastSync = Date.now();
        return;
      }
      // Back-compat: migrate legacy comboCount -> combo snapshot.
      if (!parsed.combo && Number.isFinite(parsed.comboCount)) {
        const legacy = Math.max(0, Math.floor(Number(parsed.comboCount) || 0));
        const stage = Math.max(1, Math.min(COMBO_CAP, 1 + Math.floor(legacy / 3)));
        parsed.combo = {
          mode: "build",
          multiplier: stage,
          points: 0,
          stepThreshold: computeComboStepThreshold(stage),
          sustainLeftMs: 0,
          cooldownLeftMs: 0,
          cap: COMBO_CAP,
        };
      }
      state.regen.carry = parseNumber(parsed.carry, state.regen.carry || 0) || 0;
      state.regen.momentum = parseNumber(parsed.momentum, state.regen.momentum || 0) || 0;
      state.combo = normalizeCombo(Object.assign(createComboState(), parsed.combo || {}));
      state.regen.pending = Math.max(0, Math.floor(parseNumber(parsed.pending, state.regen.pending || 0) || 0));
      state.flush.pending = Math.max(0, Math.floor(parseNumber(parsed.flushPending, state.flush.pending || 0) || 0));
      state.flush.lastSync = parseNumber(parsed.lastSync, state.flush.lastSync || Date.now()) || Date.now();
      if (parsed.boost && typeof parsed.boost === "object") {
        state.boost = Object.assign({
          multiplier: 1,
          expiresAt: 0,
          source: null,
          totalSeconds: DEFAULT_BOOST_SEC,
          gameId: null,
        }, parsed.boost);
        const rawExpires = Number(state.boost.expiresAt);
        const nowTs = Date.now();
        const originalExpiresAt = Number.isFinite(rawExpires) ? rawExpires : 0;
        let sanitizedExpiresAt = Number.isFinite(rawExpires) ? rawExpires : 0;
        if (sanitizedExpiresAt > 0 && sanitizedExpiresAt < 1e12 && nowTs > 1e12) {
          sanitizedExpiresAt = Math.floor(sanitizedExpiresAt * 1000);
        }
        const maxTtl = DEFAULT_BOOST_SEC * 1000;
        if (sanitizedExpiresAt > 0) {
          const delta = sanitizedExpiresAt - nowTs;
          if (!Number.isFinite(delta) || delta < 0) {
            sanitizedExpiresAt = 0;
          } else if (delta > maxTtl) {
            sanitizedExpiresAt = nowTs + maxTtl;
          }
        }
        state.boost.totalSeconds = Math.max(0, Math.floor(parseNumber(state.boost.totalSeconds, DEFAULT_BOOST_SEC) || DEFAULT_BOOST_SEC));
        state.boost.expiresAt = sanitizedExpiresAt;
        scheduleBoostExpiration(sanitizedExpiresAt || 0);
        let ttl = Math.max(0, Math.floor((Number(state.boost.expiresAt) || 0) - nowTs));
        if (ttl === 0) {
          if ((Number(state.boost.multiplier) || 1) > 1) {
            resetBoost({
              source: state.boost.source,
              totalSeconds: state.boost.totalSeconds,
              gameId: state.boost.gameId || state.gameId || null,
            });
          } else {
            emitBoost(1, 0, {
              source: state.boost.source,
              totalSeconds: state.boost.totalSeconds,
              gameId: state.boost.gameId || state.gameId || null,
            });
          }
        } else {
          emitBoost(state.boost.multiplier, ttl, {
            source: state.boost.source,
            totalSeconds: Number(state.boost.totalSeconds) || DEFAULT_BOOST_SEC,
            gameId: state.boost.gameId || state.gameId || null,
          });
        }
        if (isDiagEnabled() && originalExpiresAt !== state.boost.expiresAt) {
          logDebug("boost_hydrate_repair", {
            expiresAt: state.boost.expiresAt,
            originalExpiresAt,
            ttl,
            now: nowTs,
          });
        }
      }
      ensureComboState();
    } catch (_) {
      if (!state.flush.lastSync) state.flush.lastSync = Date.now();
    }
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

  function resolveBadgeBaseline() {
    if (typeof state.serverTotalXp === "number") {
      return state.serverTotalXp;
    }
    if (Number.isFinite(state.badgeBaselineXp)) {
      return state.badgeBaselineXp;
    }
    if (typeof state.badgeShownXp === "number" && Number.isFinite(state.badgeShownXp)) {
      return state.badgeShownXp;
    }
    if (typeof state.totalLifetime === "number" && Number.isFinite(state.totalLifetime)) {
      return state.totalLifetime;
    }
    return 0;
  }

  function updateBadge() {
    if (!state.badge) return;
    ensureBadgeElements();
    const baseline = resolveBadgeBaseline();
    const session = Math.max(0, Number(state.sessionXp) || 0);
    const priorShown = Math.max(0, Number(state.badgeShownXp) || 0);
    let candidate = baseline + session;
    if (SESSION_RENDER_MODE === "monotonic") {
      candidate = Math.max(priorShown, candidate);
    }
    state.badgeShownXp = candidate;
    state.badgeBaselineXp = Math.max(Number(state.badgeBaselineXp) || 0, baseline);
    state.totalLifetime = Math.max(Number(state.totalLifetime) || 0, candidate);
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

  function handleResponse(data, meta) {
    const mergedMeta = Object.assign({}, meta);
    if (data && typeof data.awarded === "number" && data.awarded > 0) {
      mergedMeta.bump = true;
    }
    applyServerDelta(data, mergedMeta);
    setBadgeLoading(false);
    return data;
  }

  function handleError(err) {
    try {
      const message = err && err.message ? String(err.message).slice(0, 200) : "error";
      logDebug("window_error", { message });
    } catch (_) {}
    if (window.console && console.debug) {
      console.debug("XP window failed", err);
    }
    setBadgeLoading(false);
  }

  function dispatchXpUpdatedEvent() {
    try {
      if (window && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("xp:updated"));
      }
    } catch (_) {}
  }

  function applyServerDelta(data, meta) {
    if (!data || typeof data !== "object") return;
    const keys = Object.keys(data);
    if (!keys.length) return;

    let normalizedCap = null;
    if (typeof data.cap === "number" && Number.isFinite(data.cap)) {
      normalizedCap = Math.max(0, Math.floor(data.cap));
      state.cap = normalizedCap;
    } else if (typeof state.cap === "number" && Number.isFinite(state.cap)) {
      normalizedCap = Math.max(0, Math.floor(state.cap));
    }

    let totalTodayFromPayload = null;
    if (typeof data.totalToday === "number") {
      totalTodayFromPayload = Math.max(0, Math.floor(Number(data.totalToday) || 0));
      state.totalToday = totalTodayFromPayload;
    }

    let remainingFromPayload = null;
    if (typeof data.remaining === "number") {
      remainingFromPayload = Math.max(0, Math.floor(Number(data.remaining) || 0));
    }

    if (totalTodayFromPayload == null && remainingFromPayload != null && normalizedCap != null) {
      const derivedToday = Math.max(0, normalizedCap - remainingFromPayload);
      state.totalToday = derivedToday;
      totalTodayFromPayload = derivedToday;
    }

    syncDailyRemainingFromTotals();
    if (typeof data.dayKey === "string" && data.dayKey) {
      state.dayKey = data.dayKey;
    }
    const nextResetRaw = Object.prototype.hasOwnProperty.call(data, "nextReset")
      ? data.nextReset
      : data.nextResetEpoch;
    if (typeof nextResetRaw === "number") {
      const nextReset = Math.floor(Number(nextResetRaw) || 0);
      if (Number.isFinite(nextReset) && nextReset > 0) {
        state.nextResetEpoch = nextReset;
      }
    }
    maybeResetDailyAllowance();

    const reasonRaw = data.reason || (data.debug && data.debug.reason) || null;
    const reason = typeof reasonRaw === "string" ? reasonRaw.toLowerCase() : null;
    const statusRaw = typeof data.status === "string" ? data.status.toLowerCase() : null;
    const skipTotals = (statusRaw === "statusonly")
      || reason === "too_soon"
      || reason === "insufficient-activity";

    const totalLifetime = (typeof data.totalLifetime === "number") ? data.totalLifetime
      : (typeof data.total === "number" ? data.total : null);

    if (skipTotals || totalLifetime == null) {
      saveCache();
      updateBadge();
      dispatchXpUpdatedEvent();
      return;
    }

    const ok = data.ok === true || statusRaw === "ok" || (!statusRaw && data.awarded != null);
    if (!ok) {
      saveCache();
      updateBadge();
      dispatchXpUpdatedEvent();
      return;
    }

    const sanitizedTotal = Math.max(0, Number(totalLifetime) || 0);
    const previousServer = typeof state.serverTotalXp === "number" ? state.serverTotalXp : null;
    let acked = 0;
    if (previousServer != null) {
      if (sanitizedTotal >= previousServer) {
        acked = sanitizedTotal - previousServer;
        state.serverTotalXp = sanitizedTotal;
      } else {
        state.serverTotalXp = previousServer;
      }
    } else {
      const baseline = Math.max(0, Number(state.badgeBaselineXp) || 0);
      if (sanitizedTotal >= baseline) {
        acked = sanitizedTotal - baseline;
      }
      state.serverTotalXp = sanitizedTotal;
    }

    if (acked > 0) {
      const pendingSession = Math.max(0, Number(state.sessionXp) || 0);
      const toSubtract = Math.min(acked, pendingSession);
      state.sessionXp = Math.max(0, pendingSession - toSubtract);
    }

    state.badgeBaselineXp = Math.max(Number(state.badgeBaselineXp) || 0, state.serverTotalXp || 0);
    state.totalLifetime = Math.max(Number(state.totalLifetime) || 0, state.serverTotalXp || 0);
    state.lastResultTs = Date.now();
    if (meta && meta.bump === true) {
      bumpBadge();
    }
    saveCache();
    updateBadge();
    dispatchXpUpdatedEvent();
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

    // ------------------------------------------------------------
    //  FIX: allow window submission when startSession was never called
    // ------------------------------------------------------------
    let activeGameId = normalizeGameId(state.gameId);

    // Fallback #1 – use the gameId that produced the last high-score pulse
    if (!activeGameId && state.storedHighScoreGameId) {
      activeGameId = normalizeGameId(state.storedHighScoreGameId);
    }

    // Fallback #2 – if a score pulse arrived before startSession, try to
    //             auto-start the session (idempotent)
    if (!activeGameId && state.lastScorePulseTs) {
      const gidFromPulse = resolveScorePulseGameId(null); // uses internal cache
      if (gidFromPulse) {
        activeGameId = gidFromPulse;
        // auto-start (will set state.gameId for future ticks)
        try { startSession(gidFromPulse, { resume: true }); } catch (_) {}
      }
    }

    if (!activeGameId) {
      logDebug("drop_no_gameid", { reason: "no_state_or_stored_gameid" });
      return;
    }

    const payload = {
      gameId: activeGameId,
      windowStart: state.windowStart,
      windowEnd: now,
      visibilitySeconds: visibility,
      inputEvents: inputs,
      chunkMs: CHUNK_MS,
      pointsPerPeriod: 10
    };
    const pendingScore = Math.max(0, Math.floor(Number(state.scoreDelta) || 0));
    if (pendingScore > 0) {
      payload.scoreDelta = pendingScore;
    }
    state.windowStart = now;
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    // Only warn – do **not** abort the flush when we used a fallback
    if (payload.gameId !== state.gameId) {
      logDebug("gameid_fallback_used", {
        stateGameId: state.gameId || null,
        used: payload.gameId,
        source: state.storedHighScoreGameId ? "highScore" : "scorePulse"
      });
    }

    const rawRemaining = getRemainingDaily();
    const numericRemaining = Number.isFinite(rawRemaining)
      ? Math.max(0, Math.floor(rawRemaining))
      : Infinity;
    const hasFiniteRemaining = Number.isFinite(numericRemaining);
    const requestedScore = typeof payload.scoreDelta === "number"
      ? Math.max(0, Math.floor(payload.scoreDelta))
      : 0;

    if (hasFiniteRemaining && numericRemaining <= 0) {
      dropScoreBuffers("daily_cap");
      logAwardSkip("daily_cap", { remaining: 0 });
      return;
    }

    let sendScore = requestedScore;
    const clientCap = getClientDeltaCap();
    const hasClientCap = Number.isFinite(clientCap) && clientCap > 0;
    if (requestedScore > 0 && hasFiniteRemaining && requestedScore > numericRemaining) {
      logDebug("award_preclamp", { want: requestedScore, remaining: numericRemaining });
      sendScore = numericRemaining;
    }
    if (requestedScore > 0 && hasClientCap && sendScore > clientCap) {
      logDebug("award_preclamp", { want: sendScore, capDelta: clientCap });
      sendScore = clientCap;
    }
    if (requestedScore > 0) {
      const leftover = Math.max(0, requestedScore - sendScore);
      state.scoreDelta = leftover;
      state.scoreDeltaSinceLastAward = Math.max(0, (state.scoreDeltaSinceLastAward || 0) - sendScore);
      payload.scoreDelta = sendScore;
      if (sendScore <= 0) {
        dropScoreBuffers("daily_cap");
        logAwardSkip("daily_cap", { remaining: Math.max(0, numericRemaining) });
        return;
      }
    }

    try {
      logDebug("send_window", {
        gameId: payload.gameId,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        visibilitySeconds: payload.visibilitySeconds,
        inputEvents: payload.inputEvents,
        scoreDelta: payload.scoreDelta || 0,
        force: !!force,
      });
    } catch (_) {}
    state.pendingWindow = {
      start: payload.windowStart,
      end: payload.windowEnd,
      inputs: payload.inputEvents,
      visSeconds: payload.visibilitySeconds,
    };

    state.pending = window.XPClient.postWindow(payload)
      .then((data) => {
        try {
          const snap = {
            status: data && data.status,
            reason: data && data.reason,
            scoreDelta: data && data.scoreDelta,
            debug: data && data.debug,
          };
          logDebug("window_result", snap);
        } catch (_) {}
        state.lastSuccessfulWindowEnd = payload.windowEnd;
        state.pendingWindow = null;
        return handleResponse(data, { source: "window" });
      })
      .catch((err) => {
        state.pendingWindow = null;
        handleError(err);
      })
      .finally(() => { state.pending = null; });
  }

  function onAwardTick() {
    const now = Date.now();
    const delta = state.lastTick ? Math.max(0, now - state.lastTick) : 0;
    state.lastTick = now;

    if (!state.running || state.phase !== "running") {
      if (state.flush && state.flush.pending) {
        flushXp(false).catch(() => {});
      }
      return;
    }

    if (!isGameHost()) {
      logBlockNoHost(now);
      zeroTickCounters();
      return;
    }

    if (!isDocumentVisible()) {
      state.phase = "paused";
      if (!state.debug.lastVisibilityLog || (now - state.debug.lastVisibilityLog) > 2_000) {
        state.debug.lastVisibilityLog = now;
        logDebug("block_visibility", { hidden: true });
      }
      resetActivityCounters(now);
      state.activityWindowFrozen = true;
      zeroTickCounters();
      flushXp(true).catch(() => {});
      return;
    }

    state.phase = "running";
    state.visibilitySeconds += delta / 1000;
    if (now <= state.activeUntil) {
      state.activeMs += delta;
    }
    if (state.activeMs >= CHUNK_MS) {
      sendWindow(false);
    }

    const lastTrusted = Number(state.lastTrustedInputTs) || 0;
    if (lastTrusted && (now - lastTrusted) > HARD_IDLE_MS) {
      state.activeUntil = now;
      if (!state.debug.hardIdleActive) {
        state.debug.hardIdleActive = true;
        logDebug("block_hard_idle", { idleMs: now - lastTrusted });
      }
      state.activityWindowFrozen = true;
      state.phase = "paused";
      if (HARD_IDLE_RESET) {
        state.activityWindowFrozen = true;
        resetActivityCounters(now);
        zeroTickCounters();
      } else {
        zeroTickCounters();
      }
    }

    const sinceLastInput = now - (state.lastInputAt || 0);
    const hasRecentInput = sinceLastInput <= ACTIVE_GRACE_MS;
    const events = Number(state.eventsSinceLastAward) || 0;
    const hasEvents = events >= MIN_EVENTS_PER_TICK;
    const scoreDelta = Number(state.scoreDeltaSinceLastAward) || 0;
    const hasScore = scoreDelta > 0;
    const frameDelta = delta || AWARD_INTERVAL_MS;
    let activityRatio = getCurrentActivityRatio(now, frameDelta);
    if (!Number.isFinite(activityRatio) || activityRatio < 0) {
      activityRatio = 0;
    }

    let isActive = false;
    if (hasScore) {
      isActive = true;
    } else if (hasRecentInput && hasEvents) {
      isActive = true;
    }
    if (state.activityWindowFrozen) {
      isActive = false;
    }
    state.isActive = isActive;

    if (!state.debug.lastActivityLog || (now - state.debug.lastActivityLog) > 2_000) {
      state.debug.lastActivityLog = now;
      logDebug("activity", { ratio: Number(activityRatio) || 0, events, sinceLastInput });
    }

    advanceCombo(frameDelta, isActive ? activityRatio : 0, isActive);

    if (!isActive) {
      logAwardSkip(state.activityWindowFrozen ? "frozen" : "inactive", {
        events,
        sinceLastInput,
      });
      zeroTickCounters();
      flushXp(false).catch(() => {});
      emitTick(0, activityRatio, false);
      return;
    }

    if (state.debug.hardIdleActive && !state.activityWindowFrozen) {
      state.debug.hardIdleActive = false;
    }

    const awarded = awardLocalXp(activityRatio);
    zeroTickCounters();
    flushXp(false).catch(() => {});
    emitTick(awarded, activityRatio, true);
    return awarded;
  }

  function ensureTimer() {
    if (state.awardTimerId) return;
    state.lastTick = Date.now();
    state.awardTimerId = window.setInterval(onAwardTick, AWARD_INTERVAL_MS);
  }

  function clearTimer() {
    if (state.awardTimerId) {
      window.clearInterval(state.awardTimerId);
      state.awardTimerId = null;
    }
  }

  function ensureBadgeTimer() {
    if (!window || typeof window.setInterval !== "function") return;
    if (state.badgeTimerId) return;
    if (!Number.isFinite(BADGE_RECONCILE_INTERVAL_MS) || BADGE_RECONCILE_INTERVAL_MS <= 0) return;
    state.badgeTimerId = window.setInterval(() => {
      try {
        reconcileWithServer().catch(() => {});
      } catch (_) {}
    }, BADGE_RECONCILE_INTERVAL_MS);
  }

  function clearBadgeTimer() {
    if (state.badgeTimerId && window && typeof window.clearInterval === "function") {
      window.clearInterval(state.badgeTimerId);
    }
    state.badgeTimerId = null;
  }

  function startSession(gameId) {
    if (!isGameHost()) {
      logDebug("block_no_host", { when: "startSession" });
      return;
    }
    const requestedId = normalizeGameId(gameId);
    const fallbackId = requestedId || normalizeGameId(state.gameId);
    if (!fallbackId) {
      logDebug("xp_start_blocked", { reason: "missing_game_id" });
      return;
    }
    if (state.running && state.gameId === fallbackId) {
      logDebug("xp_start_ignored", { existingGameId: state.gameId || null });
      return;
    }
    if (state.running && state.gameId && state.gameId !== fallbackId) {
      logDebug("xp_restart", { previousGameId: state.gameId || null, nextGameId: fallbackId });
      stopSession({ flush: true });
      if (typeof window !== "undefined" && window && typeof window.setTimeout === "function") {
        window.setTimeout(() => {
          try { startSession(fallbackId); } catch (_) {}
        }, 0);
      }
      return;
    }
    attachBadge();
    hydrateRuntimeState();
    ensureTimer();
    ensureBadgeTimer();

    state.phase = "running";
    state.running = true;
    state.gameId = fallbackId;
    state.windowStart = Date.now();
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.activeUntil = 0;
    state.scoreDelta = 0;
    state.scoreDeltaRemainder = 0;
    state.lastScorePulseTs = 0;
    state.lastInputAt = 0;
    state.lastTrustedInputTs = 0;
    state.eventsSinceLastAward = 0;
    state.scoreDeltaSinceLastAward = 0;
    state.runBoostTriggered = false;
    state.boostStartSeen = false;
    state.boostResetGuardUntil = Date.now() + 250;
    state.lastBoostDetail = null;
    state.storedHighScore = null;
    state.storedHighScoreGameId = null;
    state.activityWindowFrozen = false;
    state.isActive = false;
    state.sessionXp = 0;
    const baseline = resolveBadgeBaseline();
    const currentShown = Number(state.badgeShownXp) || 0;
    state.badgeBaselineXp = Math.max(baseline, currentShown);
    state.pendingWindow = null;
    state.lastSuccessfulWindowEnd = null;
    if (!state.flush.lastSync) state.flush.lastSync = Date.now();
    state.debug.hardIdleActive = false;
    state.debug.lastNoHostLog = 0;
    state.debug.lastActivityLog = 0;
    state.debug.lastCapLog = 0;
    state.debug.lastVisibilityLog = 0;
    state.debug.lastAwardSkipLog = 0;

    clearExpiredBoost();
    if (!state.boostTimerId && state.boost && Number(state.boost.multiplier) > 1) {
      if (state.boost.expiresAt && state.boost.expiresAt > Date.now()) {
        scheduleBoostExpiration(state.boost.expiresAt);
      } else {
        resetBoost();
      }
    }
    logDebug("xp_start", { gameId: state.gameId, isHost: true });
  }

  function stopSession(options) {
    const opts = options || {};
    const wasRunning = state.running === true;
    if (wasRunning) {
      logDebug("xp_stop", { flush: opts.flush !== false });
    }
    /* xp stop flush guard */ if (state.running && opts.flush !== false) {
      const _minInputsGate = Math.max(2, Math.ceil(CHUNK_MS / 4000));
      if (!(state.visibilitySeconds > 1 && state.inputEvents >= _minInputsGate)) {
        // skip network flush if idle
      } else {
      sendWindow(true); }
      flushXp(true).catch(() => {});
    }
    clearTimer();
    clearBadgeTimer();
    clearBoostTimer();
    state.phase = "idle";
    state.running = false;
    state.gameId = null;
    state.activeMs = 0;
    state.visibilitySeconds = 0;
    state.inputEvents = 0;
    state.activeUntil = 0;
    state.scoreDelta = 0;
    state.scoreDeltaRemainder = 0;
    state.eventsSinceLastAward = 0;
    state.scoreDeltaSinceLastAward = 0;
    state.runBoostTriggered = false;
    state.lastBoostDetail = null;
    state.storedHighScore = null;
    state.storedHighScoreGameId = null;
    state.lastInputAt = 0;
    state.lastTrustedInputTs = 0;
    state.activityWindowFrozen = false;
    state.isActive = false;
    state.lastScorePulseTs = 0;
    state.pendingWindow = null;
    state.lastSuccessfulWindowEnd = null;
    state.badgeBaselineXp = Math.max(resolveBadgeBaseline(), Number(state.badgeShownXp) || 0);
    state.sessionXp = 0;
    state.debug.hardIdleActive = false;
    state.debug.lastNoHostLog = 0;
    state.debug.lastActivityLog = 0;
    state.debug.lastCapLog = 0;
    state.debug.lastVisibilityLog = 0;
    updateBadge();
  }

  function nudge(options) {
    if (!state.running) return;
    if (!isGameHost()) {
      logDebug("block_no_host", { when: "nudge" });
      return;
    }
    const now = Date.now();
    state.activeUntil = now + ACTIVE_WINDOW_MS;
    state.inputEvents += 1;
    if (!options || options.skipMark !== true) {
      state.lastTrustedInputTs = now;
      markActiveInput(now);
    }
  }

  function recordTrustedInput() {
    const now = Date.now();
    state.lastTrustedInputTs = now;
    markActiveInput(now);
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
    state.scoreDeltaSinceLastAward = Math.max(0, (state.scoreDeltaSinceLastAward || 0) + toAdd);
    state.lastScorePulseTs = Date.now();
  }

  function pulseBadge() {
    updateBadge();
    bumpBadge();
  }

  function isAtCap() {
    maybeResetDailyAllowance();
    if (state.cap == null) return false;
    if (Number.isFinite(state.dailyRemaining) && state.dailyRemaining <= 0) {
      return true;
    }
    if (typeof state.totalToday !== "number") return false;
    return state.totalToday >= state.cap;
  }

  function awardLocalXp(activityRatio) {
    if (!state.running) return 0;
    if (isAtCap()) {
      const now = Date.now();
      if (!state.debug.lastCapLog || (now - state.debug.lastCapLog) > 2_000) {
        state.debug.lastCapLog = now;
        logDebug("block_cap", {
          totalToday: Number(state.totalToday) || 0,
          cap: state.cap,
        });
      }
      return 0;
    }
    if (REQUIRE_SCORE_PULSE) {
      const now = Date.now();
      if (!state.lastScorePulseTs || (now - state.lastScorePulseTs) > SCORE_GRACE_MS) {
        return 0;
      }
    }
    const baseMultiplier = computeBaseMultiplier(activityRatio);
    const momentum = updateMomentum(activityRatio);
    let xpPerSecond = baseMultiplier * (1 + (momentum * 0.5));
    xpPerSecond = applyCombo(xpPerSecond);
    xpPerSecond = applyBoost(xpPerSecond);
    xpPerSecond = Math.min(MAX_XP_PER_SECOND, Math.max(0, xpPerSecond));
    const xpForTick = xpPerSecond * (AWARD_INTERVAL_MS / 1000);
    const awarded = accumulateLocalXp(xpForTick);
    if (awarded <= 0) return 0;
    state.totalToday = (Number(state.totalToday) || 0) + awarded;
    state.totalLifetime = (Number(state.totalLifetime) || 0) + awarded;
    syncDailyRemainingFromTotals();
    state.regen.lastAward = Date.now();
    state.lastResultTs = state.regen.lastAward;
    state.sessionXp = Math.max(0, (Number(state.sessionXp) || 0) + awarded);
    saveCache();
    persistRuntimeState();
    pulseBadge();
    const emitUpdate = (target) => {
      if (!target || typeof target.dispatchEvent !== "function") return;
      try {
        target.dispatchEvent(new CustomEvent("xp:updated", { detail: { awarded } }));
      } catch (_) {
        try { target.dispatchEvent(new Event("xp:updated")); } catch (_) {}
      }
    };
    if (typeof window !== "undefined") {
      emitUpdate(window);
    }
    if (typeof document !== "undefined") {
      emitUpdate(document);
    }
    logDebug("award", { awarded, activityRatio: Number(activityRatio) || 0 });
    return awarded;
  }

  function shouldFlush(force) {
    if (force) return true;
    if (state.flush.inflight) return false;
    if (!state.flush.pending) return false;
    if (!isDocumentVisible()) return true;
    if (isAtCap()) return true;
    const now = Date.now();
    if (state.flush.pending >= FLUSH_THRESHOLD) return true;
    if (!state.flush.lastSync) return true;
    if ((now - state.flush.lastSync) >= FLUSH_INTERVAL_MS) return true;
    return false;
  }

  function markFlushSuccess(amount) {
    const delta = Math.max(0, Number(amount) || 0);
    if (delta > 0) {
      state.flush.pending = Math.max(0, state.flush.pending - delta);
      state.regen.pending = Math.max(0, state.regen.pending - delta);
    }
    state.flush.lastSync = Date.now();
    persistRuntimeState();
  }

  function flushXp(force) {
    if (state.flush.inflight) {
      return state.flush.inflight;
    }
    if (!shouldFlush(force)) return Promise.resolve(false);
    const pending = Math.max(0, state.flush.pending || 0);
    if (!pending) return Promise.resolve(false);
    const payload = {
      pending,
      totalToday: state.totalToday || 0,
      totalLifetime: state.totalLifetime || 0,
      ts: Date.now(),
    };
    const serialized = JSON.stringify(payload);
    const done = () => { markFlushSuccess(pending); };

    if (!FLUSH_ENDPOINT) {
      done();
      return Promise.resolve(true);
    }

    if (typeof navigator !== "undefined" && navigator && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon(FLUSH_ENDPOINT, serialized);
      if (sent) {
        done();
        return Promise.resolve(true);
      }
    }

    if (typeof fetch !== "function") {
      done();
      return Promise.resolve(true);
    }

    const request = fetch(FLUSH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: serialized,
      keepalive: true,
      credentials: "omit",
    })
      .then(() => { done(); return true; })
      .catch((err) => {
        if (window.console && console.debug) {
          console.debug("XP flush failed", err);
        }
        persistRuntimeState();
        return false;
      })
      .finally(() => { state.flush.inflight = null; });
    state.flush.inflight = request;
    return request;
  }

  // Internal boost setter supports both the new `(multiplier, ttlMs, reason)`
  // signature and legacy detail objects dispatched with `durationMs/source`.
  function requestBoost(multiplierOrDetail, ttlMs, reason) {
    const detail = multiplierOrDetail && typeof multiplierOrDetail === "object" ? multiplierOrDetail : null;

    let rawMultiplier = detail ? detail.multiplier : multiplierOrDetail;
    if (rawMultiplier == null && detail && Object.prototype.hasOwnProperty.call(detail, "mult")) {
      rawMultiplier = detail.mult;
    }
    let rawTtl = detail && Object.prototype.hasOwnProperty.call(detail, "ttlMs") ? detail.ttlMs : ttlMs;
    if (rawTtl == null && detail && Object.prototype.hasOwnProperty.call(detail, "durationMs")) {
      rawTtl = detail.durationMs;
    }
    const rawSecondsLeft = detail && Object.prototype.hasOwnProperty.call(detail, "secondsLeft")
      ? detail.secondsLeft
      : null;
    const rawTotalSeconds = detail && Object.prototype.hasOwnProperty.call(detail, "totalSeconds")
      ? detail.totalSeconds
      : null;
    const rawGameId = detail && Object.prototype.hasOwnProperty.call(detail, "gameId") ? detail.gameId : null;
    let rawSource = detail && Object.prototype.hasOwnProperty.call(detail, "reason") ? detail.reason : reason;
    if (rawSource == null && detail && Object.prototype.hasOwnProperty.call(detail, "source")) {
      rawSource = detail.source;
    }

    const fallbackMultiplier = state.boost && Number(state.boost.multiplier) > 1
      ? state.boost.multiplier
      : 1;
    const parsedMultiplier = parseNumber(rawMultiplier, fallbackMultiplier) || fallbackMultiplier || 1;
    const multiplier = Number.isFinite(parsedMultiplier) ? Math.max(1, parsedMultiplier) : 1;
    const source = rawSource == null ? null : String(rawSource);

    const normalizeSeconds = (value) => {
      if (value == null) return null;
      const parsed = parseNumber(value, NaN);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      return Math.max(0, Math.floor(parsed));
    };

    const now = Date.now();
    const MAX_BOOST_DURATION_MS = 5 * 60 * 1000;
    const MAX_BOOST_SECONDS = Math.floor(MAX_BOOST_DURATION_MS / 1000);

    let secondsLeft = normalizeSeconds(rawSecondsLeft);
    let totalSeconds = normalizeSeconds(rawTotalSeconds);
    const parsedTtl = parseNumber(rawTtl, 0) || 0;
    let ttl = Number.isFinite(parsedTtl) ? Math.max(0, parsedTtl) : 0;
    if (ttl > MAX_BOOST_DURATION_MS) {
      ttl = MAX_BOOST_DURATION_MS;
    }

    if (secondsLeft != null) {
      if (ttl <= 0) ttl = secondsLeft * 1000;
    } else if (ttl > 0) {
      secondsLeft = Math.max(0, Math.floor(ttl / 1000));
    } else {
      secondsLeft = 0;
    }

    if (secondsLeft != null) {
      secondsLeft = Math.min(Math.max(0, secondsLeft), MAX_BOOST_SECONDS);
    }

    if (totalSeconds != null) {
      totalSeconds = Math.max(totalSeconds, secondsLeft != null ? secondsLeft : 0);
    } else if (ttl > 0) {
      totalSeconds = Math.max(secondsLeft != null ? secondsLeft : 0, Math.floor(ttl / 1000));
    } else {
      totalSeconds = Math.max(secondsLeft != null ? secondsLeft : 0, DEFAULT_BOOST_SEC);
    }
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      totalSeconds = Math.max(secondsLeft != null ? secondsLeft : 0, DEFAULT_BOOST_SEC);
    }

    totalSeconds = Math.min(MAX_BOOST_SECONDS, Math.max(secondsLeft != null ? secondsLeft : 0, totalSeconds));
    if (secondsLeft != null) {
      secondsLeft = Math.min(totalSeconds, Math.max(0, secondsLeft));
    }

    if (secondsLeft != null) {
      const secondsMs = secondsLeft * 1000;
      if (secondsLeft > 0 && ttl <= 0) {
        ttl = secondsMs;
      } else if (ttl > secondsMs) {
        ttl = secondsMs;
      }
    }
    if (ttl > MAX_BOOST_DURATION_MS) {
      ttl = MAX_BOOST_DURATION_MS;
    }

    const normalizedGameId = rawGameId != null ? normalizeGameId(rawGameId) : null;

    if (multiplier <= 1) {
      if (!state.boostStartSeen && now < state.boostResetGuardUntil) {
        return;
      }
      if (source === "gameOver" || source === "visibility" || source === "pagehide") {
        state.runBoostTriggered = false;
        if (source === "gameOver") {
          state.storedHighScore = null;
          state.storedHighScoreGameId = null;
        }
      }
      resetBoost({
        source,
        totalSeconds,
        gameId: normalizedGameId,
      });
      return;
    }

    state.boostStartSeen = true;
    state.boostResetGuardUntil = now + 250;

    const ttlForState = ttl > 0 ? ttl : totalSeconds * 1000;
    const expiresAt = now + ttlForState;
    state.boost = {
      multiplier,
      expiresAt,
      source,
      totalSeconds,
      gameId: normalizedGameId || null,
    };

    scheduleBoostExpiration(expiresAt);

    emitBoost(multiplier, Math.max(0, expiresAt - now), {
      source,
      totalSeconds,
      gameId: normalizedGameId || null,
    });

    persistRuntimeState();
  }

  function readFlushStatus() {
    return {
      pending: Math.max(0, state.flush.pending || 0),
      lastSync: state.flush.lastSync || 0,
      inflight: !!state.flush.inflight,
    };
  }

  function setTotals(total, cap) {
    const payload = { ok: true };
    if (typeof total === "number") payload.totalToday = total;
    if (typeof cap === "number") payload.cap = cap;
    if (arguments.length >= 3 && typeof arguments[2] === "number") {
      payload.totalLifetime = arguments[2];
    }
    applyServerDelta(payload, { source: "setTotals" });
  }

  /**
   * Public UI getter that reports the safe remaining allowance for the current day.
   */
  function getRemainingDaily() {
    maybeResetDailyAllowance();
    const capValue = Number(state.cap);
    if (!Number.isFinite(capValue)) return Infinity;
    const remaining = Number(state.dailyRemaining);
    if (Number.isFinite(remaining)) {
      return Math.max(0, Math.floor(remaining));
    }
    if (typeof state.totalToday === "number") {
      const normalizedCap = Math.max(0, Math.floor(capValue));
      const normalizedToday = Math.max(0, Math.floor(Number(state.totalToday) || 0));
      return Math.max(0, normalizedCap - normalizedToday);
    }
    return Infinity;
  }

  /**
   * Public UI getter for the epoch (ms) when the daily cap resets, or 0 when unknown.
   */
  function getNextResetEpoch() {
    maybeResetDailyAllowance();
    const next = Number(state.nextResetEpoch);
    if (!Number.isFinite(next) || next <= 0) return 0;
    return Math.floor(next);
  }

  /**
   * Return a UI-friendly snapshot of XP totals.
   * - totalToday: XP earned during the current day window
   * - cap: daily cap (null when unlimited)
   * - remaining: XP still available before the daily cap hits (null when unknown)
   * - totalXp: lifetime XP from the server
   * - level/xpIntoLevel/xpForNextLevel/xpToNextLevel/progress: level progress helpers
   * - lastSync: epoch ms of the most recent successful server response
   */
  function getSnapshot() {
    maybeResetDailyAllowance();
    const totalLifetime = Math.max(0, Number(state.totalLifetime) || 0);
    state.snapshot = computeLevel(totalLifetime);
    const remaining = getRemainingDaily();
    return {
      totalToday: typeof state.totalToday === "number" ? state.totalToday : 0,
      cap: state.cap != null ? state.cap : null,
      remaining: Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : null,
      totalXp: state.snapshot.totalXp,
      level: state.snapshot.level,
      xpIntoLevel: state.snapshot.xpIntoLevel,
      xpForNextLevel: state.snapshot.xpForNextLevel,
      xpToNextLevel: state.snapshot.xpToNextLevel,
      progress: state.snapshot.progress,
      lastSync: state.lastResultTs || 0,
    };
  }

  function getBoostSnapshot() {
    const boost = state.boost && typeof state.boost === "object" ? state.boost : {};
    const now = Date.now();
    const expiresAtRaw = Number(boost.expiresAt);
    const expiresAt = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0 ? Math.floor(expiresAtRaw) : 0;
    const multRaw = Number(boost.multiplier);
    const multiplier = Number.isFinite(multRaw) && multRaw > 0 ? multRaw : 1;
    const active = !!(expiresAt > now && multiplier > 1);
    const source = typeof boost.source === "string" && boost.source ? boost.source : null;
    return { active, multiplier, expiresAt, source };
  }

  function getComboSnapshot() {
    const snap = snapshotCombo();
    return {
      mode: snap.mode,
      multiplier: snap.multiplier,
      points: snap.points,
      stepThreshold: snap.stepThreshold,
      sustainLeftMs: snap.sustainLeftMs,
      cooldownLeftMs: snap.cooldownLeftMs,
    };
  }

  function reconcileWithServer() {
    const allowPassiveReconcile = HOST_PAGE === "xp";
    if (!allowPassiveReconcile && !state.running && state.phase !== "running") {
      return Promise.resolve(null);
    }
    if (!window.XPClient || typeof window.XPClient.fetchStatus !== "function") {
      return Promise.resolve(null);
    }
    return window.XPClient.fetchStatus()
      .then((data) => {
        applyServerDelta(data, { source: "reconcile" });
        try {
          logDebug("badge_reconcile", {
            badgeShownXp: Number(state.badgeShownXp) || 0,
            serverTotalXp: typeof state.serverTotalXp === "number" ? state.serverTotalXp : null,
            sessionXp: Number(state.sessionXp) || 0,
          });
        } catch (_) {}
        return data;
      })
      .catch((err) => {
        try {
          const message = err && err.message ? String(err.message).slice(0, 200) : "error";
          logDebug("badge_reconcile_error", { message });
        } catch (_) {}
        return null;
      });
  }

  function refreshStatus() {
    if (!window.XPClient || typeof window.XPClient.fetchStatus !== "function") return Promise.resolve(null);
    setBadgeLoading(true);
    if (HOST_PAGE === "xp") {
      return reconcileWithServer()
        .then((data) => {
          setBadgeLoading(false);
          return data;
        })
        .catch((err) => {
          setBadgeLoading(false);
          throw err;
        });
    }
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
    hydrateRuntimeState();
    if (!state.debug.initLogged) {
      state.debug.initLogged = true;
      const page = resolvePagePath();
      const admin = isDebugAdminEnabled();
      const logged = logDebug("xp_init", { page, admin });
      state.debug.adminInitLogged = admin && logged;
    }

    try {
      refreshBadgeFromStorage();
    } catch (_) {}

    if (!isGameHost()) {
      if (state.running === true) {
        try { stopSession({ flush: true }); } catch (_) {}
      }
      return;
    }

    if (typeof document !== "undefined") {
      const handleDomReady = () => {
        try {
          hydrateRuntimeState();
          refreshBadgeFromStorage();
        } catch (_) {}
      };
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
          flushXp(true).catch(() => {});
        } else {
          hydrateRuntimeState();
          refreshBadgeFromStorage();
        }
      }, { passive: true });
    }

    if (typeof window !== "undefined") {
      ensureTimer();

      window.addEventListener("pageshow", () => {
        try {
          hydrateRuntimeState();
          refreshBadgeFromStorage();
        } catch (_) {}
      }, { passive: true });

      window.addEventListener("focus", () => {
        try {
          hydrateRuntimeState();
          refreshBadgeFromStorage();
        } catch (_) {}
      }, { passive: true });

      window.addEventListener("storage", (event) => {
        try {
          if (!event) return;
          if (event.storageArea && event.storageArea !== window.localStorage) return;
          if (event.key && event.key !== CACHE_KEY && event.key !== RUNTIME_CACHE_KEY) return;
          hydrateRuntimeState();
          refreshBadgeFromStorage();
        } catch (_) {}
      });

      window.addEventListener("xp:updated", () => {
        try { refreshBadgeFromStorage(); } catch (_) {}
      });

      window.addEventListener("message", (event) => {
        try {
          if (!event || !event.data || typeof event.data !== "object") return;
          if (event.origin && typeof location !== "undefined" && event.origin !== location.origin) return;
          if (event.data.type !== "game-score") return;
          if (!isGameHost()) return;
          state.lastScorePulseTs = Date.now();
          logDebug("score_pulse", {
            gameId: event.data.gameId || state.gameId || "",
            score: typeof event.data.score === "number" ? event.data.score : undefined,
          });
          handleScorePulse(event.data.gameId, event.data.score);
          try {
            const XP = window && window.XP;
            const running = XP && typeof XP.isRunning === "function" ? !!XP.isRunning() : false;
            if (!running) {
              const gid = resolveScorePulseGameId(event.data.gameId);
              if (gid && XP && typeof XP.startSession === "function") {
                try { window.__GAME_ID__ = gid; } catch (_) {}
                XP.startSession(gid, { resume: true });
                if (isDiagEnabled()) {
                  logDebug("auto_start_from_score_pulse", { gameId: gid });
                }
              }
            }
          } catch (_) {}
        } catch (_) {}
      }, { passive: true });

      window.addEventListener("xp:boost", (event) => {
        try {
          if (!event || !event.detail) return;
          if (event.detail.__xpOrigin === "xp.js") return;
          if (event.detail.__xpInternal) return;
          // Accept both new `{ multiplier, ttlMs, reason }` and legacy
          // `{ multiplier, durationMs, source }` payloads.
          requestBoost(event.detail);
        } catch (_) {}
      });

      window.addEventListener("klog:admin", (event) => {
        try {
          const active = event && event.detail && event.detail.active === true;
          if (!active) {
            state.debug.adminInitLogged = false;
            return;
          }
          emitAdminInitLog();
        } catch (_) {}
      }, { passive: true });

      if (isDebugAdminEnabled()) {
        emitAdminInitLog();
      }

      // Hardened activity bridge (same-origin, visible doc, requires userGesture:true, throttled)
      (function(){
        let __lastNudgeTs = 0;
        window.addEventListener("message", (event) => {
          try {
            if (!event || !event.data) return;
            if (typeof document !== "undefined" && document.hidden) return;
            if (event.origin && typeof location !== "undefined" && event.origin !== location.origin) return;
            if (event.data.type !== "kcswh:activity") return;
            if (!state.running) return;
            if (!isGameHost()) return;
            if (event.data.userGesture !== true) return;

            const now = Date.now();
            let activationIsActive = true;
            if (typeof navigator !== "undefined" && navigator.userActivation) {
              activationIsActive = navigator.userActivation.isActive === true;
            }
            const recentlyTrusted = state.lastTrustedInputTs && (now - state.lastTrustedInputTs) <= ACTIVE_WINDOW_MS;
            if (!activationIsActive && !recentlyTrusted) return;

            if (now - __lastNudgeTs < 100) return; // ~10/sec
            __lastNudgeTs = now;

            try { recordTrustedInput(); } catch (_) {}
            if (typeof nudge === "function") nudge({ skipMark: true });
          } catch (_) {}
        }, { passive: true });
      })();

      // Top-frame input listeners -> nudge (only on real user gestures)
      (function(){
        if (state.listenersAttached) return;
        state.listenersAttached = true;
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
              return true;
            case "wheel":
              return !isLikelyMobile();
            // Explicitly ignore move/hover; too noisy and often synthetic in headless runs
            case "pointermove":
            case "mousemove":
            default:
              return false;
          }
        }

        const baseEvents = ["pointerdown","keydown","touchstart"]; // always track
        const wheelEvents = isLikelyMobile() ? [] : ["wheel"];
        baseEvents.concat(wheelEvents).forEach(evt => {
          try {
            window.addEventListener(evt, (ev) => {
              try {
                if (!isRealUserGesture(ev)) return;
                if (!state.running) return;
                if (!isGameHost()) return;
                if (!isFromGameSurface(ev)) {
                  logDebug("ignore_input_outside_surface", { type: ev && ev.type });
                  return;
                }
                recordTrustedInput();
                if (typeof nudge === "function") nudge({ skipMark: true });
              } catch(_) {}
            }, { passive: true });
          } catch(_) {}
        });
      })();
    }
  }

  init();

  window.XP = Object.assign({}, window.XP || {}, {
    __hostPage: HOST_PAGE,
    startSession,
    stopSession,
    nudge,
    setTotals,
    getRemainingDaily,
    getNextResetEpoch,
    getSnapshot,
    getBoostSnapshot,
    getComboSnapshot,
    refreshStatus,
    addScore,
    awardLocalXp,
    flushXp,
    // Public API: dispatch an event so host integrations remain decoupled.
    requestBoost: function (multiplier, ttlMs, reason) {
      let detail;
      if (multiplier && typeof multiplier === "object") {
        detail = Object.assign({}, multiplier);
        if (detail.multiplier == null && typeof detail.mult === "number") {
          detail.multiplier = detail.mult;
        }
        if (detail.mult == null && typeof detail.multiplier === "number") {
          detail.mult = detail.multiplier;
        }
        if (detail.ttlMs == null && typeof detail.durationMs === "number") {
          detail.ttlMs = detail.durationMs;
        }
        if (detail.durationMs == null && typeof detail.ttlMs === "number") {
          detail.durationMs = detail.ttlMs;
        }
        if (detail.reason == null && typeof detail.source === "string") {
          detail.reason = detail.source;
        }
        if (detail.source == null && typeof detail.reason === "string") {
          detail.source = detail.reason;
        }
      } else {
        detail = {
          multiplier,
          mult: multiplier,
          ttlMs,
          durationMs: ttlMs,
          reason,
          source: reason,
        };
      }
      try {
        const evt = typeof CustomEvent === "function"
          ? new CustomEvent("xp:boost", { detail })
          : null;
        if (evt) {
          window.dispatchEvent(evt);
        } else if (typeof document !== "undefined" && document.createEvent) {
          const legacyEvt = document.createEvent("CustomEvent");
          legacyEvt.initCustomEvent("xp:boost", false, false, detail);
          window.dispatchEvent(legacyEvt);
        } else {
          requestBoost(detail);
        }
      } catch (_) {
        try { requestBoost(detail); } catch (_) {}
      }
    },
    getBoost: function () {
      const boost = state.boost || { multiplier: 1, expiresAt: 0 };
      const multiplier = Number(boost.multiplier);
      const expiresAt = Number(boost.expiresAt);
      return {
        multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
        expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
      };
    },
    getBoostMultiplier: function () {
      return getBoostMultiplierValue();
    },
    getCombo: function () {
      return snapshotCombo();
    },
    // Public probe: surface pending + lastSync while keeping legacy inflight flag.
    getFlushStatus: function () {
      const status = readFlushStatus();
      return {
        pending: status && typeof status.pending === "number" ? status.pending : 0,
        lastSync: status && typeof status.lastSync === "number" ? status.lastSync : 0,
        inflight: !!(status && status.inflight), // legacy flag retained for compatibility
      };
    },
    scoreDeltaCeiling: MAX_SCORE_DELTA,

    isRunning: function(){ try { return !!(typeof state !== 'undefined' ? state.running : (this && this.__running)); } catch(_) { return !!(this && this.__running); } },});
})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : undefined);
// --- XP resume polyfill (idempotent) ---
(function () {
  if (typeof window === 'undefined') return;
  if (!window.XP || window.XP.__hostPage !== 'game') return;
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
          try { window.XP.nudge && window.XP.nudge({ skipMark: true }); } catch (_) {}
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
  if (!window.XP || window.XP.__hostPage !== 'game') return;
  if (!window.XP) return;
  if (window.XP.__xpLifecycleWired) return;
  window.XP.__xpLifecycleWired = true;

  let retryTimer = null;
  const BOOST_RESET_SECONDS = 15;

  function tryCall(fnName, arg) {
    try {
      const XP = window.XP;
      if (!XP || typeof XP[fnName] !== 'function') return false;
      XP[fnName](arg);
      return true;
    } catch (_) { return false; }
  }

  function flushRecorder() {
    try {
      if (window.KLog && typeof window.KLog.flush === 'function') {
        window.KLog.flush(true);
      }
    } catch (_) {}
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
      try { document.dispatchEvent(new Event('xp:visible')); } catch (_) {}
      clearRetry();
    } else {
      retryResume(0);
    }
  }

  function emitLifecycleBoostStop(source) {
    const now = Date.now();
    const detail = {
      multiplier: 1,
      totalSeconds: BOOST_RESET_SECONDS,
      ttlMs: 0,
      expiresAt: now,
      endsAt: now,
      source: source || "visibility",
    };
    const targets = [];
    if (typeof window !== 'undefined' && window && typeof window.dispatchEvent === 'function') {
      targets.push(window);
    }
    if (typeof document !== 'undefined' && document && typeof document.dispatchEvent === 'function') {
      targets.push(document);
    }
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      try {
        if (typeof CustomEvent === 'function') {
          target.dispatchEvent(new CustomEvent('xp:boost', { detail }));
          continue;
        }
      } catch (_) {}
      try {
        if (typeof document !== 'undefined' && document && typeof document.createEvent === 'function') {
          const evt = document.createEvent('CustomEvent');
          evt.initCustomEvent('xp:boost', false, false, detail);
          target.dispatchEvent(evt);
          continue;
        }
      } catch (_) {}
      try { target.dispatchEvent({ type: 'xp:boost', detail }); } catch (_) {}
    }
  }

  function pause(options) {
    const source = options && options.source ? String(options.source) : null;
    var runningNow = false;
    try {
      if (window.XP && typeof window.XP.isRunning === 'function') runningNow = !!window.XP.isRunning();
      else runningNow = !!(typeof state !== 'undefined' ? state.running : false);
    } catch(_) {}
    if (!runningNow) {
      emitLifecycleBoostStop(source);
      return;
    }
    tryCall('stopSession', { flush: true });
    clearRetry();
    emitLifecycleBoostStop(source);
    try { document.dispatchEvent(new Event('xp:hidden')); } catch (_) {}
  }

  function persisted(event){ return !!(event && event.persisted); }

  window.addEventListener('pageshow', (event) => {
    if (!persisted(event)) return;
    try {
      state.runBoostTriggered = false;
      state.boostStartSeen = false;
      state.boostResetGuardUntil = Date.now() + 250;
    } catch (_) {}
    resume();
  }, { passive: true });

  window.addEventListener('pagehide', (event) => {
    flushRecorder();
    if (persisted(event)) return;
    pause({ source: 'pagehide' });
  }, { passive: true });

  window.addEventListener('beforeunload', () => {
    flushRecorder();
    pause({ source: 'pagehide' });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
    else {
      flushRecorder();
      pause({ source: 'visibility' });
    }
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
  } catch (_) {}
})();
