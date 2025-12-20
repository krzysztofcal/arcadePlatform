/**
 * Hangman - Classic word guessing game
 * Guess the word before you run out of tries!
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'hangman';

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

  // Word list with hints
  var WORDS = [
    { word: 'JAVASCRIPT', hint: 'Programming language for the web' },
    { word: 'PYTHON', hint: 'Snake-named programming language' },
    { word: 'COMPUTER', hint: 'Electronic device for processing data' },
    { word: 'KEYBOARD', hint: 'Input device with keys' },
    { word: 'MONITOR', hint: 'Display screen' },
    { word: 'BROWSER', hint: 'Software to access the internet' },
    { word: 'NETWORK', hint: 'Connected computers' },
    { word: 'DATABASE', hint: 'Organized collection of data' },
    { word: 'ALGORITHM', hint: 'Step-by-step procedure' },
    { word: 'FUNCTION', hint: 'Reusable block of code' },
    { word: 'VARIABLE', hint: 'Named storage location' },
    { word: 'INTERFACE', hint: 'Point of interaction' },
    { word: 'DEVELOPER', hint: 'Person who writes code' },
    { word: 'SOFTWARE', hint: 'Programs and applications' },
    { word: 'HARDWARE', hint: 'Physical computer components' },
    { word: 'INTERNET', hint: 'Global computer network' },
    { word: 'WEBSITE', hint: 'Collection of web pages' },
    { word: 'SECURITY', hint: 'Protection from threats' },
    { word: 'PROGRAMMING', hint: 'Writing computer code' },
    { word: 'ARCADE', hint: 'Place with video games' },
    { word: 'PUZZLE', hint: 'Problem to solve' },
    { word: 'CHALLENGE', hint: 'Test of skill' },
    { word: 'VICTORY', hint: 'Winning result' },
    { word: 'ADVENTURE', hint: 'Exciting journey' },
    { word: 'TREASURE', hint: 'Valuable hidden thing' }
  ];

  var BODY_PARTS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  var MAX_TRIES = 6;

  var wordDisplayEl = document.getElementById('wordDisplay');
  var keyboardEl = document.getElementById('keyboard');
  var hintDisplayEl = document.getElementById('hintDisplay');
  var triesLeftEl = document.getElementById('triesLeft');
  var overlay = document.getElementById('stateOverlay');
  var overlayTitle = document.getElementById('overlayTitle');
  var overlaySubtitle = document.getElementById('overlaySubtitle');
  var playBtn = document.getElementById('play');
  var hintBtn = document.getElementById('hint');
  var winsEl = document.getElementById('wins');
  var streakEl = document.getElementById('streak');
  var bestEl = document.getElementById('best');

  var currentWord = '';
  var currentHint = '';
  var guessedLetters = [];
  var wrongGuesses = 0;
  var gameActive = false;
  var hintUsed = false;
  var muted = false;
  var audioCtx = null;

  // Stats
  var wins = parseInt(localStorage.getItem('hangman_wins') || '0', 10);
  var streak = parseInt(localStorage.getItem('hangman_streak') || '0', 10);
  var bestStreak = parseInt(localStorage.getItem('hangman_best') || '0', 10);

  winsEl.textContent = wins;
  streakEl.textContent = streak;
  bestEl.textContent = bestStreak;

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('hangman', wins); } catch (_) {}
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
      gain.gain.value = 0.15;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      klog('play_sound_error', { error: String(e) });
    }
  }

  function createKeyboard() {
    keyboardEl.innerHTML = '';
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    letters.forEach(function(letter) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key-btn';
      btn.textContent = letter;
      btn.dataset.letter = letter;
      btn.addEventListener('click', function() {
        guessLetter(letter);
      });
      keyboardEl.appendChild(btn);
    });
  }

  function updateWordDisplay() {
    var display = '';
    for (var i = 0; i < currentWord.length; i++) {
      var letter = currentWord[i];
      if (guessedLetters.indexOf(letter) !== -1) {
        display += '<span class="letter revealed">' + letter + '</span>';
      } else {
        display += '<span class="letter">_</span>';
      }
    }
    wordDisplayEl.innerHTML = display;
  }

  function updateHangman() {
    BODY_PARTS.forEach(function(part, index) {
      var el = document.getElementById(part);
      if (index < wrongGuesses) {
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    });
    triesLeftEl.textContent = MAX_TRIES - wrongGuesses;
  }

  function isWordGuessed() {
    for (var i = 0; i < currentWord.length; i++) {
      if (guessedLetters.indexOf(currentWord[i]) === -1) {
        return false;
      }
    }
    return true;
  }

  function guessLetter(letter) {
    if (!gameActive || guessedLetters.indexOf(letter) !== -1) return;

    guessedLetters.push(letter);
    var keyBtn = keyboardEl.querySelector('[data-letter="' + letter + '"]');

    if (currentWord.indexOf(letter) !== -1) {
      // Correct guess
      if (keyBtn) keyBtn.classList.add('correct');
      playSound(523, 100, 'sine');
      updateWordDisplay();
      klog('correct_guess', { letter: letter });

      if (isWordGuessed()) {
        gameWin();
      }
    } else {
      // Wrong guess
      if (keyBtn) keyBtn.classList.add('wrong');
      wrongGuesses++;
      playSound(200, 150, 'sawtooth');
      updateHangman();
      klog('wrong_guess', { letter: letter, wrongGuesses: wrongGuesses });

      if (wrongGuesses >= MAX_TRIES) {
        gameLose();
      }
    }

    if (keyBtn) keyBtn.disabled = true;
  }

  function gameWin() {
    gameActive = false;
    wins++;
    streak++;
    if (streak > bestStreak) {
      bestStreak = streak;
      localStorage.setItem('hangman_best', bestStreak.toString());
    }
    winsEl.textContent = wins;
    streakEl.textContent = streak;
    bestEl.textContent = bestStreak;
    localStorage.setItem('hangman_wins', wins.toString());
    localStorage.setItem('hangman_streak', streak.toString());
    reportScore();
    playSound(523, 100, 'sine');
    playSound(659, 100, 'sine');
    playSound(784, 150, 'sine');
    showOverlay('You Win!', 'The word was: ' + currentWord);
    klog('game_win', { word: currentWord, streak: streak });
  }

  function gameLose() {
    gameActive = false;
    streak = 0;
    streakEl.textContent = streak;
    localStorage.setItem('hangman_streak', '0');
    playSound(200, 300, 'sawtooth');
    showOverlay('Game Over', 'The word was: ' + currentWord);
    klog('game_lose', { word: currentWord });
  }

  function showOverlay(title, subtitle) {
    overlay.hidden = false;
    overlayTitle.textContent = title;
    overlaySubtitle.textContent = subtitle;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function showHint() {
    if (hintUsed || !gameActive) return;
    hintUsed = true;
    hintDisplayEl.textContent = 'Hint: ' + currentHint;
    hintDisplayEl.classList.add('visible');
    hintBtn.disabled = true;
    playSound(440, 100, 'sine');
    klog('hint_used', { hint: currentHint });
  }

  function startGame() {
    // Pick random word
    var wordObj = WORDS[Math.floor(Math.random() * WORDS.length)];
    currentWord = wordObj.word;
    currentHint = wordObj.hint;
    guessedLetters = [];
    wrongGuesses = 0;
    gameActive = true;
    hintUsed = false;

    createKeyboard();
    updateWordDisplay();
    updateHangman();
    hideOverlay();
    hintDisplayEl.textContent = '';
    hintDisplayEl.classList.remove('visible');
    hintBtn.disabled = false;

    klog('game_start', { wordLength: currentWord.length });
  }

  // Event listeners
  playBtn.addEventListener('click', function() {
    initAudio();
    startGame();
  });

  hintBtn.addEventListener('click', showHint);

  // Keyboard support
  document.addEventListener('keydown', function(e) {
    if (!gameActive) return;
    var letter = e.key.toUpperCase();
    if (/^[A-Z]$/.test(letter)) {
      e.preventDefault();
      guessLetter(letter);
    }
  });

  // Register controls with GameShell
  if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
    window.GameShell.registerControls({
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
      gameId: 'hangman',
      onMuteChange: function(m) {
        muted = m;
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(m);
      },
      onPauseChange: function() {},
      isMutedProvider: function() { return muted; },
      isPausedProvider: function() { return false; },
      isRunningProvider: function() { return gameActive; }
    });
    controls.init();
  });

  // Initial setup
  createKeyboard();
  klog('init', {});
})();
