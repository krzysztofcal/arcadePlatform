/**
 * Whac-A-Mole - Classic arcade reaction game
 * Whack the moles as fast as you can!
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'whac_a_mole';

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

  var GAME_DURATION = 30;
  var MIN_POPUP_TIME = 400;
  var MAX_POPUP_TIME = 1200;
  var MIN_INTERVAL = 500;
  var MAX_INTERVAL = 1500;

  var playBtn = document.getElementById('play');
  var overlay = document.getElementById('stateOverlay');
  var scoreEl = document.getElementById('score');
  var timeEl = document.getElementById('time');
  var bestEl = document.getElementById('best');
  var moleGrid = document.getElementById('moleGrid');
  var holes = moleGrid.querySelectorAll('.mole-hole');

  var score = 0;
  var timeLeft = GAME_DURATION;
  var best = parseInt(localStorage.getItem('whac_a_mole_best') || '0', 10);
  var running = false;
  var paused = false;
  var muted = false;
  var gameInterval = null;
  var timerInterval = null;
  var moleTimeouts = [];
  var audioCtx = null;

  bestEl.textContent = best;

  function initAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        klog('audio_init_error', { error: String(e) });
      }
    }
    return audioCtx;
  }

  function playSound(freq, duration, type) {
    if (muted) return;
    var ctx = initAudio();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.2;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      klog('play_sound_error', { error: String(e) });
    }
  }

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('whac-a-mole', score); } catch (_) {}
    }
  }

  function getRandomHole() {
    var index = Math.floor(Math.random() * holes.length);
    return holes[index];
  }

  function getRandomTime(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
  }

  function popUpMole() {
    if (!running || paused) return;

    var hole = getRandomHole();
    var mole = hole.querySelector('.mole');
    var popupTime = getRandomTime(MIN_POPUP_TIME, MAX_POPUP_TIME);

    hole.classList.add('active');
    mole.classList.add('up');

    var hideTimeout = setTimeout(function() {
      hole.classList.remove('active');
      mole.classList.remove('up');
      mole.classList.remove('whacked');
    }, popupTime);

    moleTimeouts.push(hideTimeout);

    var nextInterval = getRandomTime(MIN_INTERVAL, MAX_INTERVAL);
    gameInterval = setTimeout(popUpMole, nextInterval);
  }

  function whackMole(e) {
    if (!running || paused) return;

    var hole = e.currentTarget;
    var mole = hole.querySelector('.mole');

    if (!mole.classList.contains('up') || mole.classList.contains('whacked')) {
      return;
    }

    mole.classList.add('whacked');
    score++;
    scoreEl.textContent = score;
    playSound(600, 80, 'square');
    klog('mole_whacked', { score: score });

    setTimeout(function() {
      hole.classList.remove('active');
      mole.classList.remove('up');
      mole.classList.remove('whacked');
    }, 100);
  }

  function updateTimer() {
    if (!running || paused) return;

    timeLeft--;
    timeEl.textContent = timeLeft;

    if (timeLeft <= 0) {
      endGame();
    }
  }

  function startGame() {
    score = 0;
    timeLeft = GAME_DURATION;
    scoreEl.textContent = '0';
    timeEl.textContent = timeLeft;
    running = true;
    paused = false;
    hideOverlay();

    // Clear any existing moles
    holes.forEach(function(hole) {
      hole.classList.remove('active');
      var mole = hole.querySelector('.mole');
      mole.classList.remove('up', 'whacked');
    });

    klog('game_start', {});

    timerInterval = setInterval(updateTimer, 1000);
    popUpMole();
  }

  function endGame() {
    running = false;
    clearInterval(timerInterval);
    clearTimeout(gameInterval);
    moleTimeouts.forEach(function(t) { clearTimeout(t); });
    moleTimeouts = [];

    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem('whac_a_mole_best', best.toString());
    }

    reportScore();
    playSound(300, 200, 'sawtooth');
    klog('game_over', { score: score, best: best });
    showOverlay('Game Over!', 'Score: ' + score + ' — Tap play to restart');
  }

  function showOverlay(title, subtitle) {
    overlay.hidden = false;
    overlay.innerHTML = '';
    var titleDiv = document.createElement('div');
    titleDiv.textContent = title;
    overlay.appendChild(titleDiv);
    if (subtitle) {
      var subtitleDiv = document.createElement('div');
      subtitleDiv.style.fontSize = '1rem';
      subtitleDiv.style.marginTop = '0.5rem';
      subtitleDiv.style.color = 'rgba(203,213,255,0.7)';
      subtitleDiv.textContent = subtitle;
      overlay.appendChild(subtitleDiv);
    }
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function pauseGame() {
    if (!running) return;
    paused = true;
    clearTimeout(gameInterval);
    klog('pause', {});
    showOverlay('Paused', 'Tap play to resume');
  }

  function resumeGame() {
    if (!running || !paused) return;
    paused = false;
    hideOverlay();
    popUpMole();
    klog('resume', {});
  }

  // Event listeners
  playBtn.addEventListener('click', function() {
    initAudio();
    if (paused) {
      resumeGame();
    } else {
      startGame();
    }
  });

  holes.forEach(function(hole) {
    hole.addEventListener('click', whackMole);
    hole.addEventListener('touchstart', function(e) {
      e.preventDefault();
      whackMole({ currentTarget: hole });
    }, { passive: false });
  });

  // Keyboard support (1-9 for holes)
  document.addEventListener('keydown', function(e) {
    if (!running || paused) return;
    var key = parseInt(e.key, 10);
    if (key >= 1 && key <= 9) {
      e.preventDefault();
      var hole = holes[key - 1];
      if (hole) {
        whackMole({ currentTarget: hole });
      }
    }
  });

  // Register controls with GameShell
  if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
    window.GameShell.registerControls({
      onPause: function() {
        pauseGame();
      },
      onResume: function() {
        resumeGame();
      },
      onMute: function() {
        muted = true;
        klog('mute', { muted: true });
      },
      onUnmute: function() {
        muted = false;
        klog('mute', { muted: false });
      }
    });
  }

  // Game Controls Service integration
  window.addEventListener('load', function() {
    if (!window.GameControlsService) return;
    var controls = window.GameControlsService({
      wrap: document.getElementById('gameWrap'),
      btnMute: document.getElementById('btnMute'),
      btnPause: document.getElementById('btnPause'),
      btnEnterFs: document.getElementById('btnEnterFs'),
      btnExitFs: document.getElementById('btnExitFs'),
      gameId: 'whac-a-mole',
      disableSpacePause: true,
      onMuteChange: function(m) {
        muted = m;
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(m);
      },
      onPauseChange: function(p) {
        if (p) {
          pauseGame();
        } else {
          resumeGame();
        }
        if (window.GameShell && window.GameShell.setPaused) window.GameShell.setPaused(p);
      },
      isMutedProvider: function() { return muted; },
      isPausedProvider: function() { return paused; },
      isRunningProvider: function() { return running; }
    });
    controls.init();
  });

  klog('init', {});
})();
