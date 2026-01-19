/**
 * Server-Side XP Calculation Client
 *
 * This module sends game events to the server for XP calculation,
 * eliminating client-side XP manipulation.
 *
 * Usage:
 *   1. Enable server-side calculation: window.XP_SERVER_CALC = true
 *   2. The module integrates with existing XP system
 *   3. Game events are batched and sent to /calculate-xp endpoint
 *
 * The server calculates XP based on:
 *   - Activity (input events, visibility)
 *   - Score changes
 *   - Game-specific events
 *   - Server-tracked combo state
 */
(function (window) {
  'use strict';

  // Configuration
  const ENDPOINT = (typeof window !== 'undefined' && window && typeof window.XP_CALC_ENDPOINT === 'string')
    ? window.XP_CALC_ENDPOINT
    : '/.netlify/functions/calculate-xp';

  const WINDOW_MS = 10_000;  // Send events every 10 seconds
  const MIN_WINDOW_MS = 5_000;  // Minimum window before sending
  const MAX_EVENTS_PER_WINDOW = 50;  // Cap game events per request

  function shouldUseServerCalc(win) {
    const host = win && win.location && win.location.hostname;
    if (!host) return false;

    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host === 'play.kcswh.pl' || host === 'landing.kcswh.pl') return true;
    if (typeof host === 'string' && host.endsWith('.netlify.app')) return true;

    return false;
  }

  // State
  const state = {
    enabled: false,
    initialized: false,
    userId: null,
    sessionId: null,
    gameId: null,

    // Current window tracking
    windowStart: 0,
    inputEvents: 0,
    visibilitySeconds: 0,
    scoreDelta: 0,
    gameEvents: [],
    lastScore: 0,

    // Timing
    timerId: null,
    lastSend: 0,
    pending: false,

    // Callbacks
    onXpAwarded: null,
    onError: null,
  };

  // Visibility tracking
  let visibilityStart = 0;
  let isVisible = true;

  function parseNumber(value, fallback) {
    if (value == null) return fallback;
    const sanitized = typeof value === 'string' ? value.replace(/_/g, '') : value;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  /**
   * Check if server-side calculation is enabled
   */
  function isEnabled() {
    if (typeof window === 'undefined' || !window) return false;

    // Can be enabled via:
    // 1. window.XP_SERVER_CALC = true
    // 2. URL param: ?xpserver=1
    // 3. localStorage: xp:serverCalc = "1"

    if (window.XP_SERVER_CALC === true) return true;

    try {
      if (typeof location !== 'undefined' && location && typeof location.search === 'string') {
        if (/\bxpserver=1\b/.test(location.search)) return true;
      }
    } catch (_) {}

    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        if (localStorage.getItem('xp:serverCalc') === '1') return true;
      }
    } catch (_) {}

    return false;
  }

  function initServerCalc(win, doc, config = {}) {
    try {
      const enable = shouldUseServerCalc(win);
      if (win) {
        win.XP_SERVER_CALC = enable;
      }
      if (win && win.console && typeof win.console.debug === 'function') {
        win.console.debug('[xp] Server calc auto-config', {
          host: win && win.location && win.location.hostname,
          XP_SERVER_CALC: enable,
        });
      }
    } catch (err) {
      if (win && win.console && typeof win.console.error === 'function') {
        win.console.error('[xp] Failed to init server calc', err);
      }
      if (win) win.XP_SERVER_CALC = false;
    }

    if (config && config.autoInit === true && win && win.XpServerCalc && typeof win.XpServerCalc.init === 'function') {
      try {
        win.XpServerCalc.init({});
      } catch (_) {}
    }
  }

  /**
   * Initialize server-side XP calculation
   */
  function init(options = {}) {
    if (state.initialized) {
      console.warn('[XP-ServerCalc] Already initialized');
      return state;
    }

    state.enabled = isEnabled();
    if (!state.enabled) {
      if (window.console && console.debug) {
        console.debug('[XP-ServerCalc] Server-side calculation not enabled');
      }
      return state;
    }

    state.userId = options.userId || null;
    state.sessionId = options.sessionId || null;
    state.gameId = options.gameId || 'default';
    state.onXpAwarded = options.onXpAwarded || null;
    state.onError = options.onError || null;

    // Start tracking
    state.windowStart = Date.now();
    state.inputEvents = 0;
    state.visibilitySeconds = 0;
    state.scoreDelta = 0;
    state.gameEvents = [];
    state.lastScore = 0;

    // Setup visibility tracking
    setupVisibilityTracking();

    // Setup input event tracking
    setupInputTracking();

    // Start periodic sending
    startSendLoop();

    state.initialized = true;

    if (window.console && console.log) {
      console.log('[XP-ServerCalc] Initialized for game:', state.gameId);
    }

    return state;
  }

  /**
   * Update session info (called when XP system starts session)
   */
  function setSession(userId, sessionId, gameId) {
    state.userId = userId;
    state.sessionId = sessionId;
    if (gameId) state.gameId = gameId;
  }

  /**
   * Track visibility changes for activity calculation
   */
  function setupVisibilityTracking() {
    if (typeof document === 'undefined' || !document) return;

    isVisible = !document.hidden;
    if (isVisible) {
      visibilityStart = Date.now();
    }

    document.addEventListener('xp:hidden', function () {
      if (!isVisible) return;
      if (visibilityStart > 0) {
        const visibleMs = Date.now() - visibilityStart;
        state.visibilitySeconds += visibleMs / 1000;
      }
      isVisible = false;
      visibilityStart = 0;
    }, { passive: true });

    document.addEventListener('xp:visible', function () {
      if (isVisible) return;
      isVisible = true;
      visibilityStart = Date.now();
    }, { passive: true });
      // Note: beforeunload handling is done in core.js to comply with lifecycle guards
  }

  /**
   * Track input events
   */
  function setupInputTracking() {
    if (typeof document === 'undefined' || !document) return;

    const inputEvents = ['keydown', 'pointerdown', 'touchstart', 'wheel', 'mousedown'];
    let lastInputTime = 0;
    const INPUT_THROTTLE_MS = 50; // Throttle to prevent spam

    function onInput(e) {
      const now = Date.now();
      if (now - lastInputTime < INPUT_THROTTLE_MS) return;
      lastInputTime = now;
      state.inputEvents++;
    }

    inputEvents.forEach(function (eventType) {
      document.addEventListener(eventType, onInput, { passive: true, capture: true });
    });
  }

  /**
   * Record a score update from the game
   */
  function recordScore(newScore) {
    const score = parseNumber(newScore, 0);
    if (score <= 0) return;

    if (state.lastScore > 0 && score > state.lastScore) {
      const delta = score - state.lastScore;
      state.scoreDelta += delta;
    }
    state.lastScore = score;
  }

  /**
   * Record a specific game event
   * @param {string} type - Event type (e.g., 'line_clear', 'tile_merge')
   * @param {number|object} value - Event value or data
   */
  function recordEvent(type, value) {
    if (!type || typeof type !== 'string') return;
    if (state.gameEvents.length >= MAX_EVENTS_PER_WINDOW) return;

    state.gameEvents.push({
      type: type.trim().toLowerCase(),
      value: typeof value === 'number' ? value : (value?.value || 0),
      ts: Date.now(),
    });
  }

  /**
   * Start the periodic send loop
   */
  function startSendLoop() {
    if (state.timerId) {
      clearInterval(state.timerId);
    }

    state.timerId = setInterval(function () {
      sendWindow();
    }, WINDOW_MS);
  }

  /**
   * Stop the send loop
   */
  function stopSendLoop() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  /**
   * Send the current window to the server
   */
  function sendWindow(options = {}) {
    const force = options.force === true;
    const sync = options.sync === true;

    if (!state.enabled || !state.initialized) return Promise.resolve(null);
    if (!state.userId || !state.sessionId) return Promise.resolve(null);
    if (state.pending && !force) return Promise.resolve(null);

    const now = Date.now();
    const windowMs = now - state.windowStart;

    // Don't send if window is too short (unless forced)
    if (!force && windowMs < MIN_WINDOW_MS) {
      return Promise.resolve(null);
    }

    // Finalize visibility for current window
    if (isVisible && visibilityStart > 0) {
      const visibleMs = now - visibilityStart;
      state.visibilitySeconds += visibleMs / 1000;
      visibilityStart = now; // Reset for next window
    }

    // Skip if no activity
    if (!force && state.inputEvents === 0 && state.scoreDelta === 0 && state.gameEvents.length === 0) {
      // Reset window but don't send
      resetWindow();
      return Promise.resolve(null);
    }

    // Build payload
    const payload = {
      userId: state.userId,
      sessionId: state.sessionId,
      gameId: state.gameId,
      windowStart: state.windowStart,
      windowEnd: now,
      inputEvents: state.inputEvents,
      visibilitySeconds: Math.round(state.visibilitySeconds * 100) / 100,
      scoreDelta: state.scoreDelta,
      gameEvents: state.gameEvents.slice(0, MAX_EVENTS_PER_WINDOW),
    };

    // Get current boost if available
    if (typeof window !== 'undefined' && window && window.XP && window.XP.getState) {
      try {
        const xpState = window.XP.getState();
        if (xpState && xpState.boost && xpState.boost.multiplier > 1) {
          payload.boostMultiplier = xpState.boost.multiplier;
        }
      } catch (_) {}
    }

    // Reset window for next batch
    resetWindow();

    state.pending = true;

    // Use sendBeacon for sync (unload) requests
    if (sync && typeof navigator !== 'undefined' && navigator && typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon(ENDPOINT, JSON.stringify(payload));
      state.pending = false;
      return Promise.resolve(sent ? { sent: true } : null);
    }

    // Use fetch for normal requests
    if (typeof fetch !== 'function') {
      state.pending = false;
      return Promise.resolve(null);
    }

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .then(function (result) {
        state.pending = false;
        state.lastSend = Date.now();

        if (result && result.ok) {
          // Notify callback of awarded XP
          if (state.onXpAwarded && typeof state.onXpAwarded === 'function') {
            state.onXpAwarded({
              awarded: result.awarded || 0,
              calculated: result.calculated || 0,
              totalToday: result.totalToday || 0,
              totalLifetime: result.totalLifetime || 0,
              remaining: result.remaining || 0,
              combo: result.combo || null,
              reason: result.reason,
            });
          }

          // Also dispatch event for other listeners
          if (typeof window !== 'undefined' && window && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('xp:server-awarded', {
              detail: result,
            }));
          }
        }

        return result;
      })
      .catch(function (err) {
        state.pending = false;

        if (window.console && console.error) {
          console.error('[XP-ServerCalc] Send failed:', err);
        }

        if (state.onError && typeof state.onError === 'function') {
          state.onError(err);
        }

        return null;
      });
  }

  /**
   * Reset window state for next batch
   */
  function resetWindow() {
    state.windowStart = Date.now();
    state.inputEvents = 0;
    state.visibilitySeconds = 0;
    state.scoreDelta = 0;
    state.gameEvents = [];
    visibilityStart = isVisible ? Date.now() : 0;
  }

  /**
   * Cleanup and stop tracking
   */
  function destroy() {
    stopSendLoop();
    state.initialized = false;
    state.enabled = false;
  }

  /**
   * Force enable server-side calculation
   */
  function enable() {
    if (typeof window !== 'undefined' && window) {
      window.XP_SERVER_CALC = true;
    }
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem('xp:serverCalc', '1');
      }
    } catch (_) {}
    state.enabled = true;
  }

  /**
   * Disable server-side calculation
   */
  function disable() {
    if (typeof window !== 'undefined' && window) {
      window.XP_SERVER_CALC = false;
    }
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem('xp:serverCalc');
      }
    } catch (_) {}
    state.enabled = false;
  }

  /**
   * Get current state (for debugging)
   */
  function getState() {
    return {
      enabled: state.enabled,
      initialized: state.initialized,
      userId: state.userId,
      sessionId: state.sessionId,
      gameId: state.gameId,
      windowStart: state.windowStart,
      inputEvents: state.inputEvents,
      visibilitySeconds: state.visibilitySeconds,
      scoreDelta: state.scoreDelta,
      gameEventsCount: state.gameEvents.length,
      lastSend: state.lastSend,
      pending: state.pending,
    };
  }

  // Export
  window.XpServerCalc = {
    isEnabled: isEnabled,
    init: init,
    setSession: setSession,
    recordScore: recordScore,
    recordEvent: recordEvent,
    sendWindow: sendWindow,
    getState: getState,
    enable: enable,
    disable: disable,
    destroy: destroy,
    shouldUseServerCalc: shouldUseServerCalc,
    initServerCalc: initServerCalc,
  };

  try {
    if (typeof window !== 'undefined') {
      initServerCalc(window, typeof document !== 'undefined' ? document : undefined, {});
    }
  } catch (_) {}

})(typeof window !== 'undefined' ? window : this);
