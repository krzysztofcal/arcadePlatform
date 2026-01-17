/**
 * Freedoom boot script - initializes game controls and XP system
 * Consolidated from inline scripts for CSP maintainability
 */
(function() {
  'use strict';

  // Game ID for XP and tracking
  window.__GAME_ID__ = 'freedoom';

  // Activity notifier for parent frame
  var allowedOrigin = location.origin;
  function notifyActive() {
    try { parent.postMessage({ type: 'kcswh:activity', userGesture: true }, allowedOrigin); } catch (_e) {}
  }
  addEventListener('keydown', notifyActive, { passive: true });
  addEventListener('pointerdown', notifyActive, { passive: true });
  setInterval(notifyActive, 5000);

  // GameControlsService initialization
  window.addEventListener('load', function() {
    if (!window.GameControlsService) return;
    var controls = window.GameControlsService({
      wrap: document.getElementById('gameWrap'),
      btnMute: document.getElementById('btnMute'),
      btnPause: document.getElementById('btnPause'),
      btnEnterFs: document.getElementById('btnEnterFs'),
      btnExitFs: document.getElementById('btnExitFs'),
      gameId: 'freedoom',
      disableSpacePause: true,
      onMuteChange: function(muted) {
        if (window.FreedoomGame && window.FreedoomGame.setMuted) window.FreedoomGame.setMuted(muted);
      },
      onPauseChange: function(paused) {
        if (window.FreedoomGame && window.FreedoomGame.setPaused) window.FreedoomGame.setPaused(paused);
      },
      isMutedProvider: function() { return window.FreedoomGame && window.FreedoomGame.isMuted ? window.FreedoomGame.isMuted() : false; },
      isPausedProvider: function() { return window.FreedoomGame && window.FreedoomGame.isPaused ? window.FreedoomGame.isPaused() : false; },
      isRunningProvider: function() { return window.FreedoomGame && window.FreedoomGame.isRunning ? window.FreedoomGame.isRunning() : false; }
    });
    controls.init();
  });

  // XP auto boot
  if (!window.__xpAutoBooted) {
    window.__xpAutoBooted = true;
    var tries = 0;
    function boot() {
      var bridge = window.GameXpBridge;
      if (bridge && typeof bridge.auto === 'function') {
        bridge.auto();
        return;
      }
      if (tries++ >= 5) return;
      window.setTimeout(boot, Math.min(50 * tries, 200));
    }
    if (document.readyState === 'complete') {
      boot();
    } else {
      window.addEventListener('DOMContentLoaded', boot, { once: true });
      window.addEventListener('load', boot, { once: true });
    }
  }
})();
