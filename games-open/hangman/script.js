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

  // Word lists with hints and categories
  var WORDS_EN = [
    { word: 'JAVASCRIPT', hint: 'Programming language for the web', category: 'Technology' },
    { word: 'PYTHON', hint: 'Snake-named programming language', category: 'Technology' },
    { word: 'COMPUTER', hint: 'Electronic device for processing data', category: 'Technology' },
    { word: 'KEYBOARD', hint: 'Input device with keys', category: 'Technology' },
    { word: 'MONITOR', hint: 'Display screen', category: 'Technology' },
    { word: 'BROWSER', hint: 'Software to access the internet', category: 'Technology' },
    { word: 'NETWORK', hint: 'Connected computers', category: 'Technology' },
    { word: 'DATABASE', hint: 'Organized collection of data', category: 'Technology' },
    { word: 'ALGORITHM', hint: 'Step-by-step procedure', category: 'Technology' },
    { word: 'FUNCTION', hint: 'Reusable block of code', category: 'Technology' },
    { word: 'VARIABLE', hint: 'Named storage location', category: 'Technology' },
    { word: 'INTERFACE', hint: 'Point of interaction', category: 'Technology' },
    { word: 'DEVELOPER', hint: 'Person who writes code', category: 'Technology' },
    { word: 'SOFTWARE', hint: 'Programs and applications', category: 'Technology' },
    { word: 'HARDWARE', hint: 'Physical computer components', category: 'Technology' },
    { word: 'INTERNET', hint: 'Global computer network', category: 'Technology' },
    { word: 'WEBSITE', hint: 'Collection of web pages', category: 'Technology' },
    { word: 'SECURITY', hint: 'Protection from threats', category: 'Technology' },
    { word: 'PROGRAMMING', hint: 'Writing computer code', category: 'Technology' },
    { word: 'ARCADE', hint: 'Place with video games', category: 'Entertainment' },
    { word: 'PUZZLE', hint: 'Problem to solve', category: 'Games' },
    { word: 'CHALLENGE', hint: 'Test of skill', category: 'Games' },
    { word: 'VICTORY', hint: 'Winning result', category: 'Positive emotions' },
    { word: 'ADVENTURE', hint: 'Exciting journey', category: 'Positive emotions' },
    { word: 'TREASURE', hint: 'Valuable hidden thing', category: 'Positive emotions' }
  ];

  // Polish emotionally positive words with categories
  var WORDS_PL = [
    // Positive emotions / Pozytywne emocje
    { word: 'RADOŚĆ', hint: 'Uczucie szczęścia i zadowolenia', category: 'Pozytywne emocje' },
    { word: 'MIŁOŚĆ', hint: 'Najsilniejsze uczucie do drugiej osoby', category: 'Pozytywne emocje' },
    { word: 'SZCZĘŚCIE', hint: 'Stan pełnej satysfakcji życiowej', category: 'Pozytywne emocje' },
    { word: 'NADZIEJA', hint: 'Wiara w lepszą przyszłość', category: 'Pozytywne emocje' },
    { word: 'SPOKÓJ', hint: 'Stan wewnętrznej harmonii', category: 'Pozytywne emocje' },
    { word: 'WDZIĘCZNOŚĆ', hint: 'Uczucie dziękczynienia', category: 'Pozytywne emocje' },
    { word: 'ENTUZJAZM', hint: 'Pełen energii i zapału', category: 'Pozytywne emocje' },
    { word: 'HARMONIA', hint: 'Równowaga i zgodność', category: 'Pozytywne emocje' },
    { word: 'OPTYMIZM', hint: 'Pozytywne nastawienie do życia', category: 'Pozytywne emocje' },
    { word: 'UŚMIECH', hint: 'Wyraz radości na twarzy', category: 'Pozytywne emocje' },

    // Family and relationships / Rodzina i relacje
    { word: 'RODZINA', hint: 'Najbliżsi ludzie w życiu', category: 'Rodzina i relacje' },
    { word: 'PRZYJAŹŃ', hint: 'Bliska więź między ludźmi', category: 'Rodzina i relacje' },
    { word: 'ZAUFANIE', hint: 'Wiara w drugą osobę', category: 'Rodzina i relacje' },
    { word: 'WSPARCIE', hint: 'Pomoc od bliskich osób', category: 'Rodzina i relacje' },
    { word: 'BLISKOŚĆ', hint: 'Uczucie bycia razem', category: 'Rodzina i relacje' },

    // Success and achievement / Sukces i osiągnięcia
    { word: 'SUKCES', hint: 'Osiągnięcie zamierzonego celu', category: 'Sukces i osiągnięcia' },
    { word: 'ZWYCIĘSTWO', hint: 'Wygrana w rywalizacji', category: 'Sukces i osiągnięcia' },
    { word: 'MARZENIE', hint: 'Cel do którego dążymy', category: 'Sukces i osiągnięcia' },
    { word: 'ODWAGA', hint: 'Brak lęku przed wyzwaniami', category: 'Sukces i osiągnięcia' },
    { word: 'DETERMINACJA', hint: 'Silna wola działania', category: 'Sukces i osiągnięcia' },
    { word: 'PRZYGODA', hint: 'Ekscytujące doświadczenie', category: 'Sukces i osiągnięcia' },

    // Nature / Natura
    { word: 'SŁOŃCE', hint: 'Gwiazda dająca ciepło i światło', category: 'Natura' },
    { word: 'TĘCZA', hint: 'Kolorowy łuk na niebie po deszczu', category: 'Natura' },
    { word: 'WIOSNA', hint: 'Pora roku gdy wszystko budzi się do życia', category: 'Natura' },
    { word: 'KWIATY', hint: 'Piękne rośliny ozdobne', category: 'Natura' },
    { word: 'MORZE', hint: 'Wielki zbiornik słonej wody', category: 'Natura' },
    { word: 'GÓRY', hint: 'Wysokie wzniesienia terenu', category: 'Natura' },

    // Health and wellbeing / Zdrowie i dobrostan
    { word: 'ZDROWIE', hint: 'Stan dobrego samopoczucia', category: 'Zdrowie i dobrostan' },
    { word: 'ENERGIA', hint: 'Siła do działania', category: 'Zdrowie i dobrostan' },
    { word: 'RELAKS', hint: 'Odpoczynek i regeneracja', category: 'Zdrowie i dobrostan' },
    { word: 'WOLNOŚĆ', hint: 'Możliwość samodzielnego decydowania', category: 'Zdrowie i dobrostan' },

    // Creativity / Kreatywność
    { word: 'MUZYKA', hint: 'Sztuka dźwięków', category: 'Kreatywność' },
    { word: 'ZABAWA', hint: 'Radosne spędzanie czasu', category: 'Kreatywność' },
    { word: 'TANIEC', hint: 'Ruch w rytm muzyki', category: 'Kreatywność' },
    { word: 'KSIĄŻKA', hint: 'Źródło wiedzy i rozrywki', category: 'Kreatywność' },

    // Sport / Sport
    { word: 'PIŁKA', hint: 'Używana w wielu grach sportowych', category: 'Sport' },
    { word: 'BIEG', hint: 'Szybkie przemieszczanie się na nogach', category: 'Sport' },
    { word: 'MECZ', hint: 'Sportowe spotkanie drużyn', category: 'Sport' }
  ];

  // Current language and active word list
  var currentLang = 'en';
  var WORDS = WORDS_EN;

  var BODY_PARTS = ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  var MAX_TRIES = 6;

  var wordDisplayEl = document.getElementById('wordDisplay');
  var keyboardEl = document.getElementById('keyboard');
  var hintDisplayEl = document.getElementById('hintDisplay');
  var categoryDisplayEl = document.getElementById('categoryDisplay');
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
  var currentCategory = '';
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

  // Keyboard layouts for different languages
  var KEYBOARD_EN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var KEYBOARD_PL = 'AĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ'.split('');

  function createKeyboard() {
    keyboardEl.innerHTML = '';
    var letters = currentLang === 'pl' ? KEYBOARD_PL : KEYBOARD_EN;
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

  function getWinMessage() {
    return currentLang === 'pl' ? 'Wygrałeś!' : 'You Win!';
  }

  function getLoseMessage() {
    return currentLang === 'pl' ? 'Koniec gry' : 'Game Over';
  }

  function getWordWasMessage() {
    return currentLang === 'pl' ? 'Słowo to: ' : 'The word was: ';
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
    showOverlay(getWinMessage(), getWordWasMessage() + currentWord);
    klog('game_win', { word: currentWord, streak: streak });
  }

  function gameLose() {
    gameActive = false;
    streak = 0;
    streakEl.textContent = streak;
    localStorage.setItem('hangman_streak', '0');
    playSound(200, 300, 'sawtooth');
    showOverlay(getLoseMessage(), getWordWasMessage() + currentWord);
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

  function getHintLabel() {
    return currentLang === 'pl' ? 'Podpowiedź: ' : 'Hint: ';
  }

  function showHint() {
    if (hintUsed || !gameActive) return;
    hintUsed = true;
    hintDisplayEl.textContent = getHintLabel() + currentHint;
    hintDisplayEl.classList.add('visible');
    hintBtn.disabled = true;
    playSound(440, 100, 'sine');
    klog('hint_used', { hint: currentHint });
  }

  function updateLanguage() {
    // Get language from i18n system
    if (window.I18N && typeof window.I18N.getLang === 'function') {
      currentLang = window.I18N.getLang();
    } else {
      // Fallback detection
      var params = new URLSearchParams(location.search);
      var p = params.get('lang');
      if (p === 'pl' || p === 'en') {
        currentLang = p;
      } else {
        var ls = localStorage.getItem('lang');
        if (ls === 'pl' || ls === 'en') {
          currentLang = ls;
        } else {
          var nav = (navigator.language || 'en').toLowerCase();
          currentLang = nav.startsWith('pl') ? 'pl' : 'en';
        }
      }
    }
    WORDS = currentLang === 'pl' ? WORDS_PL : WORDS_EN;
  }

  function getCategoryLabel() {
    return currentLang === 'pl' ? 'Kategoria' : 'Category';
  }

  function updateCategoryDisplay() {
    if (categoryDisplayEl) {
      categoryDisplayEl.textContent = getCategoryLabel() + ': ' + currentCategory;
      categoryDisplayEl.classList.add('visible');
    }
  }

  function startGame() {
    // Update language before starting
    updateLanguage();

    // Pick random word from current language's word list
    var wordObj = WORDS[Math.floor(Math.random() * WORDS.length)];
    currentWord = wordObj.word;
    currentHint = wordObj.hint;
    currentCategory = wordObj.category;
    guessedLetters = [];
    wrongGuesses = 0;
    gameActive = true;
    hintUsed = false;

    createKeyboard();
    updateWordDisplay();
    updateHangman();
    updateCategoryDisplay();
    hideOverlay();
    hintDisplayEl.textContent = '';
    hintDisplayEl.classList.remove('visible');
    hintBtn.disabled = false;

    klog('game_start', { wordLength: currentWord.length, lang: currentLang });
  }

  // Event listeners
  playBtn.addEventListener('click', function() {
    initAudio();
    startGame();
  });

  hintBtn.addEventListener('click', showHint);

  // Keyboard support - includes Polish characters
  var VALID_LETTERS_EN = /^[A-Z]$/;
  var VALID_LETTERS_PL = /^[A-ZĄĆĘŁŃÓŚŹŻ]$/;

  document.addEventListener('keydown', function(e) {
    if (!gameActive) return;
    var letter = e.key.toUpperCase();
    var validPattern = currentLang === 'pl' ? VALID_LETTERS_PL : VALID_LETTERS_EN;
    if (validPattern.test(letter)) {
      e.preventDefault();
      guessLetter(letter);
    }
  });

  // Listen for language changes and restart game with new language
  document.addEventListener('langchange', function(e) {
    var newLang = e.detail && e.detail.lang;
    if (newLang && newLang !== currentLang) {
      currentLang = newLang;
      WORDS = currentLang === 'pl' ? WORDS_PL : WORDS_EN;
      // Start new game with new language
      startGame();
      klog('lang_change', { lang: currentLang });
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

  // Initial setup - detect language and auto-start the game
  updateLanguage();
  startGame();
  klog('init', { lang: currentLang });
})();
