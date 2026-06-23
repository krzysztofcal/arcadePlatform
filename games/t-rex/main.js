/**
 * Arcade Hub adapter for wayou/t-rex-runner.
 *
 * The active game engine is the vendored upstream file:
 * games/t-rex/vendor/wayou-t-rex-runner/index.js
 */
(function () {
  'use strict';

  var LOG_PREFIX = 'trex_game';
  var XP_GAME_ID = 't-rex';
  var SCORE_POLL_MS = 100;
  var runner = null;
  var fullscreen = null;
  var scoreEl = document.getElementById('score');
  var hiScoreEl = document.getElementById('hi-score');
  var restartBtn = document.getElementById('restart');
  var statusEl = document.getElementById('status');
  var gameWrap = document.getElementById('gameWrap');
  var gameSurface = document.getElementById('game');
  var btnMute = document.getElementById('btnMute');
  var btnPause = document.getElementById('btnPause');
  var btnEnterFs = document.getElementById('btnEnterFs');
  var btnExitFs = document.getElementById('btnExitFs');
  var overlayExit = document.getElementById('overlayExit');
  var centerOverlay = document.getElementById('centerOverlay');
  var bigStartBtn = document.getElementById('bigStartBtn');
  var gameOverOverlay = document.getElementById('gameOverOverlay');
  var statsPoints = document.getElementById('statsPoints');
  var statsHiScore = document.getElementById('statsHiScore');
  var replayBtn = document.getElementById('replayBtn');
  var lastScorePulse = 0;
  var lastKnownScore = 0;
  var lastCrashed = false;
  var muted = false;

  try {
    muted = localStorage.getItem('trex-muted') === 'true';
  } catch (_) {}

  function klog(kind, data) {
    try {
      if (window.KLog && typeof window.KLog.log === 'function') {
        window.KLog.log(LOG_PREFIX + '_' + kind, data || {});
      }
    } catch (_) {}
  }

  function formatScore(value) {
    return String(Math.max(0, value || 0)).padStart(5, '0');
  }

  function getBridge() {
    var bridge = window.GameXpBridge;
    return bridge && typeof bridge === 'object' ? bridge : null;
  }

  function notifyScorePulse(totalScore) {
    var payload = { type: 'game-score', gameId: XP_GAME_ID, score: totalScore };
    var origin = window.location && window.location.origin ? window.location.origin : '*';
    try { window.postMessage(payload, origin); } catch (_) {}
    if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
      try { window.parent.postMessage(payload, origin); } catch (_) {}
    }
  }

  function addScoreDelta(delta) {
    var bridge = getBridge();
    if (bridge && typeof bridge.add === 'function' && delta > 0) {
      try { bridge.add(delta); } catch (_) {}
    }
  }

  function nudgeXP() {
    var bridge = getBridge();
    if (bridge && typeof bridge.nudge === 'function') {
      try { bridge.nudge(); } catch (_) {}
    }
  }

  function getScore() {
    if (!runner) return 0;
    if (runner.distanceMeter && typeof runner.distanceMeter.getActualDistance === 'function') {
      return runner.distanceMeter.getActualDistance(Math.ceil(runner.distanceRan || 0));
    }
    return Math.ceil(runner.distanceRan || 0);
  }

  function getHighScore() {
    if (!runner) return 0;
    if (runner.distanceMeter && typeof runner.distanceMeter.getActualDistance === 'function') {
      return runner.distanceMeter.getActualDistance(Math.ceil(runner.highestScore || 0));
    }
    return Math.ceil(runner.highestScore || 0);
  }

  function syncMuteButton() {
    if (!btnMute) return;
    btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btnMute.textContent = muted ? '🔊' : '🔇';
  }

  function syncPauseButton() {
    if (!btnPause) return;
    var paused = !!(runner && runner.paused && !runner.crashed);
    btnPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }

  function updateStatus() {
    if (!statusEl) return;
    if (!runner) {
      statusEl.textContent = 'Loading...';
    } else if (runner.crashed) {
      statusEl.textContent = 'Game over - press Restart or Space';
    } else if (runner.paused && runner.activated) {
      statusEl.textContent = 'Paused - press Space to resume';
    } else {
      statusEl.textContent = 'Press Space/Up or tap to jump';
    }
  }

  function updateScoreboard() {
    var score = getScore();
    var highScore = Math.max(getHighScore(), score);
    if (scoreEl) scoreEl.textContent = formatScore(score);
    if (hiScoreEl) hiScoreEl.textContent = formatScore(highScore);
    if (score > lastScorePulse) {
      notifyScorePulse(score);
      addScoreDelta(score - lastScorePulse);
      lastScorePulse = score;
    }
    lastKnownScore = score;
  }

  function showStartOverlay(show) {
    if (centerOverlay) centerOverlay.classList.toggle('hidden', !show);
  }

  function showGameOverOverlay(show) {
    if (!gameOverOverlay) return;
    gameOverOverlay.classList.toggle('hidden', !show);
    if (show) {
      if (statsPoints) statsPoints.textContent = formatScore(lastKnownScore);
      if (statsHiScore) statsHiScore.textContent = formatScore(Math.max(getHighScore(), lastKnownScore));
    }
  }

  function startRunner() {
    if (!runner) return;
    nudgeXP();
    if (runner.crashed) {
      runner.restart();
    } else if (!runner.playing) {
      runner.onKeyDown({
        type: 'keydown',
        keyCode: 32,
        target: document.body,
        preventDefault: function () {}
      });
    }
    showStartOverlay(false);
    showGameOverOverlay(false);
    klog('start', { score: getScore() });
  }

  function restartRunner() {
    if (!runner) return;
    nudgeXP();
    lastScorePulse = 0;
    if (runner.crashed || runner.activated) {
      runner.restart();
    } else {
      startRunner();
    }
    showStartOverlay(false);
    showGameOverOverlay(false);
    klog('restart', {});
  }

  function togglePause(forcePaused) {
    if (!runner || runner.crashed || !runner.activated) return;
    var shouldPause = typeof forcePaused === 'boolean' ? forcePaused : !runner.paused;
    if (shouldPause && runner.playing) {
      runner.stop();
    } else if (!shouldPause && runner.paused) {
      runner.play();
    }
    syncPauseButton();
    updateStatus();
    klog('pause_change', { paused: !!runner.paused });
  }

  function toggleMute(forceMuted) {
    muted = typeof forceMuted === 'boolean' ? forceMuted : !muted;
    try {
      localStorage.setItem('trex-muted', muted ? 'true' : 'false');
    } catch (_) {}
    syncMuteButton();
    klog('mute_change', { muted: muted });
  }

  function patchRunnerAudio() {
    if (!window.Runner || !window.Runner.prototype) return;
    window.Runner.prototype.setArcadeMode = function () {
      if (this.containerEl) this.containerEl.style.transform = '';
    };
    window.Runner.prototype.setArcadeModeContainerScale = function () {
      if (this.containerEl) this.containerEl.style.transform = '';
    };
    window.Runner.prototype.loadSounds = function () {
      this.soundFx = {};
    };
    window.Runner.prototype.playSound = function (soundBuffer) {
      if (muted || !soundBuffer || !this.audioContext) return;
      var sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = soundBuffer;
      sourceNode.connect(this.audioContext.destination);
      sourceNode.start(0);
    };
  }

  function pollRunner() {
    if (!runner && window.Runner && window.Runner.instance_) {
      runner = window.Runner.instance_;
      klog('upstream_ready', {
        source: 'wayou/t-rex-runner',
        commit: '5455bfa408ec6b707c7300ff194b7390733a766d'
      });
      showStartOverlay(true);
    }

    if (runner) {
      updateScoreboard();
      updateStatus();
      syncPauseButton();
      showStartOverlay(!runner.activated && !runner.playing && !runner.crashed);
      if (!runner.crashed) showGameOverOverlay(false);
      if (runner.crashed && !lastCrashed) {
        klog('game_over', { score: lastKnownScore, hiScore: getHighScore() });
        showGameOverOverlay(true);
      }
      if (!runner.crashed) {
        lastCrashed = false;
      } else {
        lastCrashed = true;
      }
    }

    window.setTimeout(pollRunner, SCORE_POLL_MS);
  }

  function initFullscreen() {
    if (!window.FullscreenService || !gameWrap || !gameSurface || !btnEnterFs || !btnExitFs || !overlayExit) return;
    fullscreen = window.FullscreenService({
      wrap: gameWrap,
      canvas: gameSurface,
      btnEnter: btnEnterFs,
      btnExit: btnExitFs,
      overlayExit: overlayExit,
      aspect: 4,
      analyticsContext: { gameId: XP_GAME_ID },
      onResizeRequest: function () {
        if (runner && typeof runner.adjustDimensions === 'function') runner.adjustDimensions();
      }
    });
    fullscreen.init();
  }

  function bindEvents() {
    if (restartBtn) restartBtn.addEventListener('click', restartRunner);
    if (bigStartBtn) bigStartBtn.addEventListener('click', startRunner);
    if (replayBtn) replayBtn.addEventListener('click', restartRunner);
    if (btnPause) btnPause.addEventListener('click', function () { togglePause(); });
    if (btnMute) btnMute.addEventListener('click', function () { toggleMute(); });
    document.addEventListener('keydown', function (event) {
      if (event.repeat) return;
      if (event.code === 'Space' || event.code === 'ArrowUp') nudgeXP();
      if (event.code === 'KeyP') {
        event.preventDefault();
        togglePause();
      }
    });
    document.addEventListener('xp:hidden', function () { togglePause(true); });
  }

  patchRunnerAudio();
  bindEvents();
  initFullscreen();
  syncMuteButton();
  showStartOverlay(true);
  showGameOverOverlay(false);
  pollRunner();
})();
