/**
 * GameControlsService - Standardized game control buttons for all game pages
 * Provides mute, pause, and fullscreen functionality with consistent UI and logging.
 */
(function(){
  'use strict';

  var LOG_PREFIX = 'game_controls';

  /**
   * klog helper - logs to KLog if available, otherwise console
   * @param {string} kind - Log event kind
   * @param {object} data - Log data payload
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

  /**
   * GameControlsService factory
   * @param {object} opts - Configuration options
   * @param {HTMLElement} opts.wrap - Game wrapper element (for fullscreen)
   * @param {HTMLElement} opts.canvas - Canvas element (optional)
   * @param {HTMLElement} opts.btnMute - Mute toggle button
   * @param {HTMLElement} opts.btnPause - Pause toggle button
   * @param {HTMLElement} opts.btnEnterFs - Enter fullscreen button
   * @param {HTMLElement} opts.btnExitFs - Exit fullscreen button
   * @param {HTMLElement} opts.overlayExit - Overlay exit button (optional)
   * @param {function} opts.onMuteChange - Callback when mute state changes (receives isMuted boolean)
   * @param {function} opts.onPauseChange - Callback when pause state changes (receives isPaused boolean)
   * @param {function} opts.onFullscreenChange - Callback when fullscreen state changes (receives isFullscreen boolean)
   * @param {function} opts.onActivity - Activity nudge callback (for XP)
   * @param {function} opts.isMutedProvider - Function that returns current mute state
   * @param {function} opts.isPausedProvider - Function that returns current pause state
   * @param {function} opts.isRunningProvider - Function that returns whether game is running
   * @param {string} opts.gameId - Game identifier for logging
   * @param {number} opts.aspect - Aspect ratio for fullscreen (optional)
   * @param {number} opts.reserved - Reserved space for UI elements (optional)
   * @param {function} opts.onResizeRequest - Callback when resize is needed (optional)
   * @param {boolean} opts.disableSpacePause - If true, disables Space key for pause (for games that use Space for gameplay)
   * @returns {object} GameControlsService instance
   */
  function GameControlsService(opts) {
    opts = opts || {};

    var wrap = opts.wrap;
    var canvas = opts.canvas;
    var btnMute = opts.btnMute;
    var btnPause = opts.btnPause;
    var btnEnterFs = opts.btnEnterFs;
    var btnExitFs = opts.btnExitFs;
    var overlayExit = opts.overlayExit;
    var onMuteChange = opts.onMuteChange;
    var onPauseChange = opts.onPauseChange;
    var onFullscreenChange = opts.onFullscreenChange;
    var onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : function(){};
    var isMutedProvider = typeof opts.isMutedProvider === 'function' ? opts.isMutedProvider : function(){ return false; };
    var isPausedProvider = typeof opts.isPausedProvider === 'function' ? opts.isPausedProvider : function(){ return false; };
    var isRunningProvider = typeof opts.isRunningProvider === 'function' ? opts.isRunningProvider : function(){ return true; };
    var gameId = opts.gameId || 'unknown';
    var aspect = opts.aspect || (16/9);
    var reserved = opts.reserved;
    var onResizeRequest = opts.onResizeRequest;
    var disableSpacePause = !!opts.disableSpacePause;

    var analytics = window.Analytics;
    var pendingFsAction = null;
    var lastFsState = false;
    var cleanupFns = [];

    /**
     * Check if fullscreen is currently active
     */
    function isFullscreenActive() {
      if (!wrap) return false;
      return document.fullscreenElement === wrap || document.webkitFullscreenElement === wrap;
    }

    /**
     * Enter fullscreen mode
     */
    function enterFullscreen() {
      if (!wrap) return;
      pendingFsAction = { trigger: 'button', requested: 'enter' };
      klog('fullscreen_enter_request', { gameId: gameId });
      if (wrap.requestFullscreen) {
        wrap.requestFullscreen();
      } else if (wrap.webkitRequestFullscreen) {
        wrap.webkitRequestFullscreen();
      }
    }

    /**
     * Exit fullscreen mode
     */
    function exitFullscreen() {
      pendingFsAction = { trigger: 'button', requested: 'exit' };
      klog('fullscreen_exit_request', { gameId: gameId });
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }

    /**
     * Toggle fullscreen mode
     */
    function toggleFullscreen() {
      onActivity();
      if (isFullscreenActive()) {
        exitFullscreen();
      } else {
        enterFullscreen();
      }
    }

    /**
     * Compute reserved pixel height for fullscreen layout
     */
    function computeReserved() {
      if (typeof reserved === 'number' && isFinite(reserved)) return reserved;
      var total = 0;
      try {
        if (!wrap) return 120;
        var pad = getComputedStyle(wrap);
        var padV = (parseFloat(pad.paddingTop) || 0) + (parseFloat(pad.paddingBottom) || 0);
        total += padV;
        var measure = function(sel) {
          wrap.querySelectorAll(sel).forEach(function(el) {
            if (el !== canvas) {
              var r = el.getBoundingClientRect();
              total += r.height;
            }
          });
        };
        measure('.stats');
        measure('.controls-row');
        measure('.titleBar');
        var status = wrap.querySelector('#status');
        if (status) {
          var r = status.getBoundingClientRect();
          total += r.height;
        }
        total += 20; // buffer
      } catch (_) {}
      return Math.max(120, Math.min(window.innerHeight * 0.6, total));
    }

    /**
     * Fit canvas to fullscreen dimensions
     */
    function fitFullscreen() {
      if (!canvas) return;
      if (!isFullscreenActive()) {
        canvas.style.width = '100%';
        if (onResizeRequest) requestAnimationFrame(onResizeRequest);
        return;
      }
      if (!wrap) return;
      var wrapRect = wrap.getBoundingClientRect();
      var maxW = wrapRect.width - 20;
      var reservedPx = computeReserved();
      var maxHforCanvas = Math.max(200, (window.innerHeight - reservedPx));
      var fitWidth = Math.min(maxW, Math.floor(maxHforCanvas * aspect));
      canvas.style.width = fitWidth + 'px';
      if (onResizeRequest) requestAnimationFrame(onResizeRequest);
    }

    /**
     * Sync fullscreen button visibility
     */
    function syncFullscreenButtons() {
      var isFs = isFullscreenActive();
      if (btnEnterFs) btnEnterFs.style.display = isFs ? 'none' : '';
      if (btnExitFs) btnExitFs.style.display = isFs ? '' : 'none';
      if (wrap) wrap.classList.toggle('fsActive', isFs);
      fitFullscreen();

      if (lastFsState !== isFs) {
        klog('fullscreen_change', { gameId: gameId, state: isFs ? 'enter' : 'exit', trigger: pendingFsAction ? pendingFsAction.trigger : 'system' });

        if (analytics && analytics.fullscreenToggle) {
          var payload = {
            state: isFs ? 'enter' : 'exit',
            slug: gameId,
            page: 'game'
          };
          if (pendingFsAction) {
            if (pendingFsAction.trigger) payload.trigger = pendingFsAction.trigger;
            if (pendingFsAction.requested) payload.requested = pendingFsAction.requested;
          } else {
            payload.trigger = 'system';
          }
          analytics.fullscreenToggle(payload);
        }

        if (onFullscreenChange) {
          try { onFullscreenChange(isFs); } catch (_) {}
        }

        lastFsState = isFs;
      }
      pendingFsAction = null;
    }

    /**
     * Update mute button UI
     */
    function updateMuteUI() {
      if (!btnMute) return;
      var muted = isMutedProvider();
      btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      btnMute.title = muted ? 'Unmute' : 'Mute';
      btnMute.textContent = muted ? '🔈' : '🔇';
    }

    /**
     * Toggle mute state
     */
    function toggleMute() {
      onActivity();
      var wasMuted = isMutedProvider();
      var newMuted = !wasMuted;

      klog('mute_toggle', { gameId: gameId, muted: newMuted });

      if (onMuteChange) {
        try { onMuteChange(newMuted); } catch (_) {}
      }

      updateMuteUI();
    }

    /**
     * Update pause button UI
     */
    function updatePauseUI() {
      if (!btnPause) return;
      var paused = isPausedProvider();
      var running = isRunningProvider();
      btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
      btnPause.title = paused ? 'Resume' : 'Pause';
      btnPause.textContent = paused ? '▶' : '⏸';
      btnPause.disabled = !running;
    }

    /**
     * Toggle pause state
     */
    function togglePause() {
      onActivity();
      if (!isRunningProvider()) return;

      var wasPaused = isPausedProvider();
      var newPaused = !wasPaused;

      klog('pause_toggle', { gameId: gameId, paused: newPaused });

      if (onPauseChange) {
        try { onPauseChange(newPaused); } catch (_) {}
      }

      updatePauseUI();
    }

    /**
     * Handle keyboard shortcuts
     */
    function handleKeydown(e) {
      if (e.code === 'KeyM') {
        toggleMute();
      }
      if (e.code === 'Space' && !disableSpacePause && isRunningProvider()) {
        e.preventDefault();
        togglePause();
      }
      if (e.code === 'KeyF') {
        toggleFullscreen();
      }
    }

    /**
     * Initialize the service and bind event handlers
     */
    function init() {
      klog('init', { gameId: gameId });

      // Fullscreen buttons
      if (btnEnterFs) {
        var enterHandler = function(e) { e.preventDefault(); enterFullscreen(); };
        btnEnterFs.addEventListener('click', enterHandler);
        cleanupFns.push(function() { btnEnterFs.removeEventListener('click', enterHandler); });
      }
      if (btnExitFs) {
        var exitHandler = function(e) { e.preventDefault(); exitFullscreen(); };
        btnExitFs.addEventListener('click', exitHandler);
        cleanupFns.push(function() { btnExitFs.removeEventListener('click', exitHandler); });
      }
      if (overlayExit) {
        var overlayHandler = function(e) { e.preventDefault(); exitFullscreen(); };
        overlayExit.addEventListener('click', overlayHandler);
        cleanupFns.push(function() { overlayExit.removeEventListener('click', overlayHandler); });
      }

      // Mute button
      if (btnMute) {
        var muteHandler = function() { toggleMute(); };
        btnMute.addEventListener('click', muteHandler);
        cleanupFns.push(function() { btnMute.removeEventListener('click', muteHandler); });
      }

      // Pause button
      if (btnPause) {
        var pauseHandler = function() { togglePause(); };
        btnPause.addEventListener('click', pauseHandler);
        cleanupFns.push(function() { btnPause.removeEventListener('click', pauseHandler); });
      }

      // Fullscreen change events
      var fsChangeHandler = syncFullscreenButtons;
      document.addEventListener('fullscreenchange', fsChangeHandler);
      document.addEventListener('webkitfullscreenchange', fsChangeHandler);
      cleanupFns.push(function() {
        document.removeEventListener('fullscreenchange', fsChangeHandler);
        document.removeEventListener('webkitfullscreenchange', fsChangeHandler);
      });

      // Resize handler
      var resizeHandler = function() { fitFullscreen(); };
      window.addEventListener('resize', resizeHandler);
      cleanupFns.push(function() { window.removeEventListener('resize', resizeHandler); });

      // Keyboard shortcuts
      window.addEventListener('keydown', handleKeydown);
      cleanupFns.push(function() { window.removeEventListener('keydown', handleKeydown); });

      // Initial UI sync
      syncFullscreenButtons();
      updateMuteUI();
      updatePauseUI();
    }

    /**
     * Cleanup all event listeners
     */
    function destroy() {
      klog('destroy', { gameId: gameId });
      cleanupFns.forEach(function(fn) {
        try { fn(); } catch (_) {}
      });
      cleanupFns.length = 0;
    }

    return {
      init: init,
      destroy: destroy,
      toggleMute: toggleMute,
      togglePause: togglePause,
      toggleFullscreen: toggleFullscreen,
      enterFullscreen: enterFullscreen,
      exitFullscreen: exitFullscreen,
      isFullscreenActive: isFullscreenActive,
      updateMuteUI: updateMuteUI,
      updatePauseUI: updatePauseUI,
      syncFullscreenButtons: syncFullscreenButtons,
      fitFullscreen: fitFullscreen
    };
  }

  window.GameControlsService = GameControlsService;
})();
