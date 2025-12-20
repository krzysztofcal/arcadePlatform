/**
 * Simon - Classic memory game
 * Repeat the pattern of lights and sounds
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'simon';

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

  var playBtn = document.getElementById('play');
  var resetBtn = document.getElementById('reset');
  var overlay = document.getElementById('stateOverlay');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var simonBoard = document.getElementById('simonBoard');
  var buttons = simonBoard.querySelectorAll('.simon-btn');

  var colors = ['green', 'red', 'yellow', 'blue'];
  var frequencies = {
    green: 392,
    red: 329.63,
    yellow: 261.63,
    blue: 220
  };

  var sequence = [];
  var playerIndex = 0;
  var score = 0;
  var best = parseInt(localStorage.getItem('simon_best') || '0', 10);
  var running = false;
  var acceptingInput = false;
  var muted = false;
  var audioCtx = null;

  bestEl.textContent = best;

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('simon', score); } catch (_) {}
    }
  }

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

  function playTone(color, duration) {
    if (muted) return;
    var ctx = initAudio();
    if (!ctx) return;

    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = frequencies[color] || 440;
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      klog('play_tone_error', { error: String(e) });
    }
  }

  function lightUp(color, duration) {
    var btn = simonBoard.querySelector('[data-color="' + color + '"]');
    if (!btn) return;
    btn.classList.add('active');
    playTone(color, duration);
    setTimeout(function() {
      btn.classList.remove('active');
    }, duration);
  }

  function playSequence() {
    acceptingInput = false;
    var i = 0;
    var delay = 600;
    var gap = 200;

    function playNext() {
      if (i >= sequence.length) {
        acceptingInput = true;
        playerIndex = 0;
        return;
      }
      lightUp(sequence[i], delay);
      i++;
      setTimeout(playNext, delay + gap);
    }

    setTimeout(playNext, 500);
  }

  function addToSequence() {
    var color = colors[Math.floor(Math.random() * colors.length)];
    sequence.push(color);
    klog('sequence_add', { length: sequence.length });
    playSequence();
  }

  function handlePlayerInput(color) {
    if (!running || !acceptingInput) return;

    lightUp(color, 200);

    if (color === sequence[playerIndex]) {
      playerIndex++;
      if (playerIndex === sequence.length) {
        score = sequence.length;
        scoreEl.textContent = score;
        reportScore();
        if (score > best) {
          best = score;
          bestEl.textContent = best;
          localStorage.setItem('simon_best', best.toString());
        }
        klog('round_complete', { score: score });
        setTimeout(addToSequence, 800);
      }
    } else {
      gameOver();
    }
  }

  function gameOver() {
    running = false;
    acceptingInput = false;
    klog('game_over', { score: score });
    showOverlay('Game Over!', 'Score: ' + score + ' — Tap play to restart');
  }

  function startGame() {
    sequence = [];
    playerIndex = 0;
    score = 0;
    scoreEl.textContent = '0';
    running = true;
    hideOverlay();
    klog('game_start', {});
    addToSequence();
  }

  function resetGame() {
    sequence = [];
    playerIndex = 0;
    score = 0;
    scoreEl.textContent = '0';
    running = false;
    acceptingInput = false;
    hideOverlay();
    klog('game_reset', {});
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

  playBtn.addEventListener('click', function() {
    initAudio();
    startGame();
  });

  resetBtn.addEventListener('click', resetGame);

  buttons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var color = btn.dataset.color;
      handlePlayerInput(color);
    });
  });

  // Keyboard support
  document.addEventListener('keydown', function(e) {
    var colorMap = {
      '1': 'green',
      '2': 'red',
      '3': 'yellow',
      '4': 'blue',
      'g': 'green',
      'r': 'red',
      'y': 'yellow',
      'b': 'blue'
    };
    var color = colorMap[e.key.toLowerCase()];
    if (color) {
      e.preventDefault();
      handlePlayerInput(color);
    }
  });

  // Register controls with GameShell
  if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
    window.GameShell.registerControls({
      onPause: function() {
        if (running) {
          running = false;
          acceptingInput = false;
          showOverlay('Paused', 'Tap play to resume');
          klog('pause', {});
        }
      },
      onResume: function() {
        if (!running && sequence.length > 0) {
          running = true;
          hideOverlay();
          playSequence();
          klog('resume', {});
        }
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
      gameId: 'simon',
      disableSpacePause: true,
      onMuteChange: function(m) {
        muted = m;
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(m);
      },
      onPauseChange: function(paused) {
        if (window.GameShell && window.GameShell.setPaused) window.GameShell.setPaused(paused);
      },
      isMutedProvider: function() { return muted; },
      isPausedProvider: function() { return !running; },
      isRunningProvider: function() { return running; }
    });
    controls.init();
  });

  klog('init', {});
})();
