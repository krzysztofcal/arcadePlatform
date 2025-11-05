/* XP client runtime: score-first, time fallback (1 Hz) */
'use strict';

(function (window, document) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const XP_ENDPOINT = '/.netlify/functions/award-xp';
  const TICK_MS = 1000;
  const ACTIVE_GRACE_MS = 1500;
  const CACHE_KEY = 'xp:totals-v2';

  // --- MMO-like floating +XP animation ----------------------------------
  const styleId = 'xp-fx-style';
  if (!document.getElementById(styleId)) {
    const css = `
    .xp-fx-layer{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647}
    .xp-fx{position:absolute;font-weight:800;font-size:20px;
      text-shadow:0 2px 6px rgba(0,0,0,.6);
      animation:xp-pop 900ms ease-out forwards;will-change:transform,opacity}
    @keyframes xp-pop{
      0%{transform:translateY(0) scale(0.9);opacity:0}
      12%{opacity:1}
      40%{transform:translateY(-20px) scale(1.05)}
      70%{transform:translateY(-36px) scale(1.0)}
      100%{transform:translateY(-46px) scale(0.98);opacity:0}
    }
    @media (prefers-reduced-motion: reduce){
      .xp-fx{animation:xp-pop 300ms ease-out forwards}
    }`;
    const s = document.createElement('style');
    s.id = styleId; s.textContent = css;
    document.head.appendChild(s);
    const layer = document.createElement('div');
    layer.className = 'xp-fx-layer'; layer.id = 'xpFxLayer';
    document.body.appendChild(layer);
  }

  function showXpFx(text, anchorEl) {
    const layer = document.getElementById('xpFxLayer'); if (!layer) return;
    const el = document.createElement('div');
    el.className = 'xp-fx';
    el.textContent = text || '+1 XP';
    let x = window.innerWidth * 0.85, y = window.innerHeight * 0.2;
    if (anchorEl) {
      try {
        const r = anchorEl.getBoundingClientRect();
        x = r.right - 10; y = r.top + 10;
      } catch (_) { /* ignore positioning errors */ }
    }
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 48))}px`;
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 48))}px`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // --- shared state ------------------------------------------------------
  const state = {
    badge: null,
    labelEl: null,
    cap: null,
    totalToday: 0,
    totalLifetime: 0,
    snapshot: null,
    lastResultTs: 0,
    running: false,
    timerId: null,
    pending: null,
    session: null,
    lastInputAt: 0,
    lastSessionConfig: null,
  };

  function computeLevel(totalXp) {
    const total = Math.max(0, Number(totalXp) || 0);
    let level = 1;
    let requirement = 100;
    let accumulated = 0;
    while (total >= accumulated + requirement) {
      accumulated += requirement;
      level += 1;
      requirement = Math.max(1, Math.ceil(requirement * 1.1));
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
      if (!parsed || typeof parsed !== 'object') return;
      if (typeof parsed.totalToday === 'number') state.totalToday = parsed.totalToday;
      if (typeof parsed.totalLifetime === 'number') state.totalLifetime = parsed.totalLifetime;
      if (parsed.cap != null && typeof parsed.cap === 'number') state.cap = parsed.cap;
      if (typeof parsed.lastResultTs === 'number') state.lastResultTs = parsed.lastResultTs;
    } catch (_) { /* ignore */ }
  }

  function saveCache() {
    try {
      const payload = {
        totalToday: state.totalToday,
        totalLifetime: state.totalLifetime,
        cap: state.cap,
        lastResultTs: state.lastResultTs,
      };
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) { /* ignore */ }
  }

  function ensureBadgeElements() {
    if (!state.badge) return;
    if (!state.labelEl || !state.badge.contains(state.labelEl)) {
      state.labelEl = state.badge.querySelector('.xp-badge__label');
      if (!state.labelEl) {
        state.labelEl = document.createElement('span');
        state.labelEl.className = 'xp-badge__label';
        state.badge.textContent = '';
        state.badge.appendChild(state.labelEl);
      }
    }
  }

  function setBadgeLoading(isLoading) {
    if (!state.badge) return;
    state.badge.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    state.badge.classList.toggle('xp-badge--loading', !!isLoading);
  }

  function bumpBadge() {
    if (!state.badge) return;
    state.badge.classList.remove('xp-badge--bump');
    void state.badge.offsetWidth;
    state.badge.classList.add('xp-badge--bump');
  }

  function updateBadge() {
    if (!state.badge) return;
    ensureBadgeElements();
    const snapshot = state.snapshot || computeLevel(state.totalLifetime || 0);
    state.snapshot = snapshot;
    const totalText = snapshot.totalXp.toLocaleString();
    state.labelEl.textContent = `Lvl ${snapshot.level}, ${totalText} XP`;
    setBadgeLoading(false);
  }

  function attachBadge() {
    if (state.badge) return;
    state.badge = document.getElementById('xpBadge');
    if (!state.badge) return;
    ensureBadgeElements();
    loadCache();
    state.snapshot = computeLevel(state.totalLifetime || 0);
    updateBadge();
    state.badge.addEventListener('animationend', (event) => {
      if (event.animationName === 'xp-badge-bump') {
        state.badge.classList.remove('xp-badge--bump');
      }
    });
  }

  function ensureTimer() {
    if (state.timerId) return;
    state.timerId = window.setInterval(() => tick(false), 200);
  }

  function clearTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function markActivity() {
    state.lastInputAt = performance.now();
  }

  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, markActivity, { passive: true });
  });

  function isActiveNow() {
    if (document.visibilityState !== 'visible') return false;
    return (performance.now() - state.lastInputAt) <= ACTIVE_GRACE_MS;
  }

  function ensureDeviceId() {
    try {
      const k = 'xp_device_id';
      let id = window.localStorage.getItem(k);
      if (!id) {
        id = 'dev:' + Math.random().toString(36).slice(2) + ':' + Date.now();
        window.localStorage.setItem(k, id);
      }
      return id;
    } catch (_) {
      return 'dev:anon';
    }
  }

  function handleAwardResponse(data, anchorEl) {
    if (!data || typeof data !== 'object') {
      setBadgeLoading(false);
      return;
    }
    if (typeof data.cap === 'number') state.cap = data.cap;
    if (typeof data.totalToday === 'number') state.totalToday = data.totalToday;
    if (typeof data.totalLifetime === 'number') state.totalLifetime = data.totalLifetime;
    let awarded = 0;
    if (typeof data.awardedXp === 'number') {
      awarded = data.awardedXp;
      if (awarded > 0 && typeof data.totalToday !== 'number') {
        state.totalToday = (state.totalToday || 0) + awarded;
      }
      if (awarded > 0 && typeof data.totalLifetime !== 'number') {
        state.totalLifetime = (state.totalLifetime || 0) + awarded;
      }
    }
    if (data.bestScore != null && state.session && state.session.mode === 'score') {
      state.session.bestSeen = Math.max(state.session.bestSeen, Number(data.bestScore) || 0);
    }
    if (awarded > 0) {
      state.snapshot = computeLevel(state.totalLifetime || 0);
      state.lastResultTs = Date.now();
      saveCache();
      updateBadge();
      bumpBadge();
      showXpFx(`+${awarded} XP`, anchorEl || (state.session ? state.session.anchor : null));
    } else {
      updateBadge();
    }
    setBadgeLoading(false);
  }

  function handleAwardError(err) {
    if (window.console && console.debug) {
      console.debug('[xp] award failed', err);
    }
    setBadgeLoading(false);
  }

  function sendAward(payload, anchorEl) {
    if (state.pending) return;
    const userId = ensureDeviceId();
    state.pending = fetch(XP_ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => handleAwardResponse(data, anchorEl))
      .catch(handleAwardError)
      .finally(() => {
        state.pending = null;
      });
  }

  function tick(force) {
    if (!state.running || !state.session) return;
    const session = state.session;
    const now = performance.now();
    const sinceLast = session.lastSentAt ? (now - session.lastSentAt) : Infinity;
    if (sinceLast < (TICK_MS - 5)) {
      if (!force) return;
      // Even when flushing, respect the 1 Hz cadence.
      return;
    }

    if (session.mode === 'score') {
      if (typeof session.scoreGetter !== 'function') return;
      const score = Number(session.scoreGetter() || 0);
      if (!Number.isFinite(score) || score < 0) return;
      if (score <= session.bestSeen) return;
      if (!isActiveNow()) return;
      session.bestSeen = score;
      session.lastSentAt = now;
      sendAward({ gameId: session.gameId, mode: 'score', score, active: true }, session.anchor);
    } else {
      if (!isActiveNow()) return;
      session.lastSentAt = now;
      sendAward({ gameId: session.gameId, mode: 'time', active: true }, session.anchor);
    }
  }

  function startSession(gameId, opts) {
    const options = opts || {};
    attachBadge();
    ensureTimer();
    markActivity();
    const mode = options.mode === 'score' && typeof options.scoreGetter === 'function' ? 'score' : 'time';
    state.session = {
      gameId: gameId || 'game',
      mode,
      scoreGetter: mode === 'score' ? options.scoreGetter : null,
      anchor: options.anchor || null,
      bestSeen: 0,
      lastSentAt: 0,
    };
    state.lastSessionConfig = { gameId: state.session.gameId, opts: options };
    state.running = true;
    state.lastInputAt = performance.now();
    tick(true);
  }

  function stopSession(options) {
    const opts = options || {};
    if (!state.running) return;
    if (opts.flush !== false) {
      tick(true);
    }
    state.running = false;
    state.session = null;
    clearTimer();
  }

  function resumeSession() {
    if (state.running) return;
    if (!state.lastSessionConfig) return;
    startSession(state.lastSessionConfig.gameId, state.lastSessionConfig.opts || {});
  }

  function nudge() {
    markActivity();
  }

  function setTotals(total, cap, lifetime) {
    if (typeof total === 'number') state.totalToday = total;
    if (typeof cap === 'number') state.cap = cap;
    if (typeof lifetime === 'number') state.totalLifetime = lifetime;
    state.snapshot = computeLevel(state.totalLifetime || 0);
    updateBadge();
    saveCache();
  }

  function getSnapshot() {
    const snapshot = state.snapshot || computeLevel(state.totalLifetime || 0);
    return {
      totalToday: typeof state.totalToday === 'number' ? state.totalToday : 0,
      cap: state.cap != null ? state.cap : null,
      totalXp: snapshot.totalXp,
      level: snapshot.level,
      xpIntoLevel: snapshot.xpIntoLevel,
      xpForNextLevel: snapshot.xpForNextLevel,
      xpToNextLevel: snapshot.xpToNextLevel,
      progress: snapshot.progress,
      lastSync: state.lastResultTs || 0,
    };
  }

  function refreshStatus() {
    attachBadge();
    setBadgeLoading(false);
    return Promise.resolve(getSnapshot());
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachBadge, { once: true });
    } else {
      attachBadge();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        markActivity();
      }
    });
  }

  init();

  const XP = Object.assign({}, window.XP || {}, {
    startSession,
    stopSession,
    resumeSession,
    nudge,
    setTotals,
    getSnapshot,
    refreshStatus,
    isRunning: () => !!state.running,
  });

  window.XP = XP;

  window.xp = {
    init(gameId, options) {
      startSession(gameId, options || {});
      return {
        stop: () => stopSession({ flush: true }),
        getBestSeen: () => (state.session ? state.session.bestSeen : 0),
      };
    }
  };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);

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
          try { window.XP.nudge && window.XP.nudge(); } catch (_) {}
          return;
        }
        var gid = window.XP.__lastGameId || undefined;
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
    const isRunning = !!(window.XP && typeof window.XP.isRunning === 'function' && window.XP.isRunning());
    if (isRunning) return;
    const ok = tryCall('resumeSession') || tryCall('nudge');
    if (ok) {
      try { document.dispatchEvent(new Event('xp:visible')); } catch (_) {}
      clearRetry();
    } else {
      retryResume(0);
    }
  }

  function pause() {
    const isRunning = !!(window.XP && typeof window.XP.isRunning === 'function' && window.XP.isRunning());
    if (!isRunning) return;
    tryCall('stopSession', { flush: true });
    clearRetry();
    try { document.dispatchEvent(new Event('xp:hidden')); } catch (_) {}
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
  } catch (_) {}
})();
