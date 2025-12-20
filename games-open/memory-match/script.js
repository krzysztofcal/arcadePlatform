/**
 * Memory Match - Classic card matching puzzle game
 * Find all matching pairs of cards
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'memory_match';

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

  var SYMBOLS = ['🎮', '🎯', '🎲', '🎪', '🎨', '🎭', '🎵', '🎸'];
  var TOTAL_PAIRS = 8;

  var playBtn = document.getElementById('play');
  var overlay = document.getElementById('stateOverlay');
  var movesEl = document.getElementById('moves');
  var pairsEl = document.getElementById('pairs');
  var bestEl = document.getElementById('best');
  var memoryGrid = document.getElementById('memoryGrid');

  var cards = [];
  var flippedCards = [];
  var matchedPairs = 0;
  var moves = 0;
  var best = localStorage.getItem('memory_match_best');
  var isLocked = false;
  var muted = false;
  var audioCtx = null;

  if (best) {
    bestEl.textContent = best;
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
      try { window.reportScoreToPortal('memory-match', matchedPairs * 10); } catch (_) {}
    }
  }

  function shuffle(array) {
    var currentIndex = array.length;
    var randomIndex;
    while (currentIndex !== 0) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
      var temp = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temp;
    }
    return array;
  }

  function createCards() {
    var cardSymbols = [];
    SYMBOLS.forEach(function(symbol) {
      cardSymbols.push(symbol, symbol);
    });
    shuffle(cardSymbols);

    cards = cardSymbols.map(function(symbol, index) {
      return {
        id: index,
        symbol: symbol,
        isFlipped: false,
        isMatched: false
      };
    });
  }

  function renderCards() {
    memoryGrid.innerHTML = '';
    cards.forEach(function(card, index) {
      var cardEl = document.createElement('div');
      cardEl.className = 'memory-card';
      if (card.isFlipped || card.isMatched) {
        cardEl.classList.add('flipped');
      }
      if (card.isMatched) {
        cardEl.classList.add('matched');
      }
      cardEl.dataset.index = index;

      var front = document.createElement('div');
      front.className = 'card-front';
      front.textContent = '?';

      var back = document.createElement('div');
      back.className = 'card-back';
      back.textContent = card.symbol;

      cardEl.appendChild(front);
      cardEl.appendChild(back);

      cardEl.addEventListener('click', function() {
        flipCard(index);
      });

      memoryGrid.appendChild(cardEl);
    });
  }

  function flipCard(index) {
    if (isLocked) return;
    var card = cards[index];

    if (card.isFlipped || card.isMatched) return;
    if (flippedCards.length >= 2) return;

    card.isFlipped = true;
    flippedCards.push(card);
    playSound(440, 50);
    renderCards();

    klog('card_flip', { index: index, symbol: card.symbol });

    if (flippedCards.length === 2) {
      moves++;
      movesEl.textContent = moves;
      checkMatch();
    }
  }

  function checkMatch() {
    isLocked = true;
    var card1 = flippedCards[0];
    var card2 = flippedCards[1];

    if (card1.symbol === card2.symbol) {
      card1.isMatched = true;
      card2.isMatched = true;
      matchedPairs++;
      pairsEl.textContent = matchedPairs + '/' + TOTAL_PAIRS;
      playSound(660, 150);
      klog('match_found', { symbol: card1.symbol, pairs: matchedPairs });

      flippedCards = [];
      isLocked = false;
      renderCards();

      if (matchedPairs === TOTAL_PAIRS) {
        gameWon();
      }
    } else {
      playSound(220, 100, 'square');
      setTimeout(function() {
        card1.isFlipped = false;
        card2.isFlipped = false;
        flippedCards = [];
        isLocked = false;
        renderCards();
      }, 800);
    }
  }

  function gameWon() {
    klog('game_won', { moves: moves });

    if (!best || moves < parseInt(best, 10)) {
      best = moves.toString();
      bestEl.textContent = best;
      localStorage.setItem('memory_match_best', best);
    }

    reportScore();
    playSound(880, 300);

    setTimeout(function() {
      showOverlay('You Win!', 'Completed in ' + moves + ' moves');
    }, 300);
  }

  function startGame() {
    createCards();
    flippedCards = [];
    matchedPairs = 0;
    moves = 0;
    isLocked = false;
    movesEl.textContent = '0';
    pairsEl.textContent = '0/' + TOTAL_PAIRS;
    hideOverlay();
    renderCards();
    klog('game_start', {});
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

  // Keyboard support
  document.addEventListener('keydown', function(e) {
    var key = parseInt(e.key, 10);
    if (key >= 1 && key <= 9) {
      e.preventDefault();
      flipCard(key - 1);
    } else if (e.key === '0') {
      e.preventDefault();
      flipCard(9);
    }
  });

  // Register controls with GameShell
  if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
    window.GameShell.registerControls({
      onPause: function() {
        klog('pause', {});
      },
      onResume: function() {
        klog('resume', {});
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
      gameId: 'memory-match',
      disableSpacePause: true,
      onMuteChange: function(m) {
        muted = m;
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(m);
      },
      onPauseChange: function(paused) {
        if (window.GameShell && window.GameShell.setPaused) window.GameShell.setPaused(paused);
      },
      isMutedProvider: function() { return muted; },
      isPausedProvider: function() { return false; },
      isRunningProvider: function() { return matchedPairs < TOTAL_PAIRS; }
    });
    controls.init();
  });

  // Initialize
  startGame();
  klog('init', {});
})();
