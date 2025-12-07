/**
 * Game Shell - Common utilities for all games-open games
 * Handles XP nudging, session management, and control messages from parent frame
 */
(function () {
  'use strict';

  var LOG_PREFIX = 'game_shell';

  /**
   * klog helper - logs to KLog if available, otherwise console
   */
  function klog(kind, data) {
    var payload = data || {};
    try {
      if (typeof window !== 'undefined' && window.KLog && typeof window.KLog.log === 'function') {
        window.KLog.log(LOG_PREFIX + '_' + kind, payload);
        return;
      }
    } catch (_) {}
    try {
      if (typeof console !== 'undefined' && console && typeof console.log === 'function') {
        console.log('[' + LOG_PREFIX + '] ' + kind + ':', payload);
      }
    } catch (_) {}
  }

  // Game control state
  var gameState = {
    paused: false,
    muted: false,
    slug: ''
  };

  // Registered callbacks
  var callbacks = {
    onPause: null,
    onResume: null,
    onMute: null,
    onUnmute: null
  };

  function nudge() {
    if (window.XP && typeof window.XP.nudge === "function") {
      try { window.XP.nudge(); } catch (_) { /* noop */ }
    }
  }

  function start(slug) {
    if (!window.XP) return;
    try { window.XP.stopSession({ flush: true }); } catch (_) { /* noop */ }
    if (typeof window.XP.startSession === "function") {
      try { window.XP.startSession(slug); } catch (_) { /* noop */ }
    }
  }

  /**
   * Handle control messages from parent frame
   */
  function handleControlMessage(event) {
    if (!event.data || event.data.type !== 'kcswh:game-control') return;

    var action = event.data.action;
    klog('control_message', { action: action, data: event.data });

    switch (action) {
      case 'mute':
        gameState.muted = !!event.data.muted;
        if (gameState.muted) {
          if (callbacks.onMute) {
            try { callbacks.onMute(); } catch (err) {
              klog('mute_error', { error: String(err) });
            }
          }
        } else {
          if (callbacks.onUnmute) {
            try { callbacks.onUnmute(); } catch (err) {
              klog('unmute_error', { error: String(err) });
            }
          }
        }
        klog('mute_change', { muted: gameState.muted });
        break;

      case 'pause':
        gameState.paused = !!event.data.paused;
        if (gameState.paused) {
          if (callbacks.onPause) {
            try { callbacks.onPause(); } catch (err) {
              klog('pause_error', { error: String(err) });
            }
          }
        } else {
          if (callbacks.onResume) {
            try { callbacks.onResume(); } catch (err) {
              klog('resume_error', { error: String(err) });
            }
          }
        }
        klog('pause_change', { paused: gameState.paused });
        break;

      default:
        klog('unknown_action', { action: action });
    }
  }

  /**
   * Register game control callbacks
   * @param {object} opts - Callback options
   * @param {function} opts.onPause - Called when game should pause
   * @param {function} opts.onResume - Called when game should resume
   * @param {function} opts.onMute - Called when game should mute
   * @param {function} opts.onUnmute - Called when game should unmute
   */
  function registerControls(opts) {
    opts = opts || {};
    if (typeof opts.onPause === 'function') callbacks.onPause = opts.onPause;
    if (typeof opts.onResume === 'function') callbacks.onResume = opts.onResume;
    if (typeof opts.onMute === 'function') callbacks.onMute = opts.onMute;
    if (typeof opts.onUnmute === 'function') callbacks.onUnmute = opts.onUnmute;
    klog('controls_registered', {});
  }

  /**
   * Get current control state
   */
  function getState() {
    return {
      paused: gameState.paused,
      muted: gameState.muted
    };
  }

  /**
   * Check if game is paused
   */
  function isPaused() {
    return gameState.paused;
  }

  /**
   * Check if game is muted
   */
  function isMuted() {
    return gameState.muted;
  }

  function init() {
    if (typeof document === "undefined") return;
    var slug = document.body?.dataset?.gameSlug || document.body?.dataset?.gameId || "game";
    gameState.slug = slug;

    try {
      if (slug) window.__GAME_ID__ = slug;
    } catch (_) {}
    start(slug);

    // Listen for control messages from parent frame
    window.addEventListener('message', handleControlMessage);

    // XP nudge listeners
    var passive = { passive: true };
    window.addEventListener("keydown", nudge, passive);
    window.addEventListener("pointerdown", nudge, passive);
    window.addEventListener("touchstart", nudge, passive);

    klog('init', { slug: slug });
  }

  // Expose public API
  window.GameShell = {
    registerControls: registerControls,
    getState: getState,
    isPaused: isPaused,
    isMuted: isMuted,
    nudge: nudge
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
