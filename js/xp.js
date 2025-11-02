(function () {
  // Internal state
  var _sessionActive = false;
  var _tickTimer = null;
  var _currentGameId = null;

  // Idempotent ticker
  function startTicker() {
    if (_tickTimer) return;
    _tickTimer = setInterval(tick, 1000);
  }
  function stopTicker() {
    if (_tickTimer) {
      clearInterval(_tickTimer);
      _tickTimer = null;
    }
  }

  // 1s heartbeat: let xpClient listen and decide what to send
  function tick() {
    try {
      if (typeof document !== 'undefined' && document.hidden) return;
      window.dispatchEvent(new CustomEvent('xp:tick', {
        detail: {
          gameId: _currentGameId,
          active: _sessionActive,
          ts: Date.now()
        }
      }));
    } catch (_) {}
  }

  // Public API
  window.XP = window.XP || {};

  // Start a local XP "session" (game page activates this)
  window.XP.startSession = function (opts) {
    opts = opts || {};
    if (_sessionActive) return; // idempotent
    _sessionActive = true;
    if (opts.gameId) _currentGameId = opts.gameId;
    startTicker();
  };

  // Stop session (optionally let client flush if it wants)
  window.XP.stopSession = function (options) {
    options = options || {};
    if (!_sessionActive) return;
    _sessionActive = false;
    stopTicker();
    // The server client may listen for stop and flush on its own schedule.
    try { window.dispatchEvent(new CustomEvent('xp:stop', { detail: { gameId: _currentGameId } })); } catch (_) {}
  };

  // Called when page is restored from bfcache or similar:
  // - If session was active, just ensure ticker is running.
  // - Otherwise, optionally auto-resume on game pages tagged with data-game-id.
  window.XP.resumeSession = function () {
    try {
      if (_sessionActive) {
        startTicker(); // ensure timers are alive
        return;
      }
      var gameEl = (typeof document !== 'undefined') && document.querySelector && document.querySelector('[data-game-id]');
      if (gameEl && typeof window.XP.startSession === 'function') {
        var gid = gameEl.getAttribute('data-game-id') || 'unknown';
        window.XP.startSession({ gameId: gid });
      }
    } catch (_) {}
  };

  // Expose a tiny status helper (optional)
  window.XP.isActive = function () { return !!_sessionActive; };
})();
