/**
 * Solitaire - Classic Klondike card game
 * Build foundations from Ace to King by suit
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'solitaire';

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

  var SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  var SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var stockEl = document.getElementById('stock');
  var wasteEl = document.getElementById('waste');
  var overlay = document.getElementById('stateOverlay');
  var confirmModal = document.getElementById('confirmModal');
  var confirmYesBtn = document.getElementById('confirmYes');
  var confirmNoBtn = document.getElementById('confirmNo');
  var playBtn = document.getElementById('play');
  var undoBtn = document.getElementById('undo');
  var movesEl = document.getElementById('moves');
  var scoreEl = document.getElementById('score');
  var winsEl = document.getElementById('wins');

  var stock = [];
  var waste = [];
  var foundations = [[], [], [], []];
  var tableau = [[], [], [], [], [], [], []];
  var selectedCard = null;
  var selectedPile = null;
  var selectedIndex = null;
  var moves = 0;
  var score = 0;
  var wins = parseInt(localStorage.getItem('solitaire_wins') || '0', 10);
  var history = [];
  var muted = false;
  var audioCtx = null;

  winsEl.textContent = wins;

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('solitaire', score); } catch (_) {}
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
      gain.gain.value = 0.1;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      klog('play_sound_error', { error: String(e) });
    }
  }

  function createDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) {
        deck.push({
          suit: SUITS[s],
          rank: RANKS[r],
          value: r,
          faceUp: false
        });
      }
    }
    return deck;
  }

  function shuffle(deck) {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = deck[i];
      deck[i] = deck[j];
      deck[j] = temp;
    }
    return deck;
  }

  function isRed(suit) {
    return suit === 'hearts' || suit === 'diamonds';
  }

  function canPlaceOnTableau(card, targetPile) {
    if (targetPile.length === 0) {
      return card.rank === 'K';
    }
    var topCard = targetPile[targetPile.length - 1];
    return topCard.faceUp &&
           isRed(card.suit) !== isRed(topCard.suit) &&
           card.value === topCard.value - 1;
  }

  function canPlaceOnFoundation(card, foundationIndex) {
    var foundation = foundations[foundationIndex];
    if (foundation.length === 0) {
      return card.rank === 'A';
    }
    var topCard = foundation[foundation.length - 1];
    return card.suit === topCard.suit && card.value === topCard.value + 1;
  }

  function createCardElement(card, pileType, pileIndex, cardIndex) {
    var el = document.createElement('div');
    el.className = 'card' + (card.faceUp ? ' face-up' : ' face-down');
    el.dataset.pileType = pileType;
    el.dataset.pileIndex = pileIndex;
    el.dataset.cardIndex = cardIndex;

    if (card.faceUp) {
      el.classList.add(isRed(card.suit) ? 'red' : 'black');
      el.innerHTML = '<span class="card-rank">' + card.rank + '</span>' +
                     '<span class="card-suit">' + SUIT_SYMBOLS[card.suit] + '</span>';
    }

    el.addEventListener('click', function(e) {
      e.stopPropagation();
      handleCardClick(card, pileType, pileIndex, cardIndex);
    });

    return el;
  }

  function render() {
    // Render stock
    stockEl.innerHTML = '';
    if (stock.length > 0) {
      stockEl.classList.remove('empty');
      var stockCard = document.createElement('div');
      stockCard.className = 'card face-down';
      stockEl.appendChild(stockCard);
    } else {
      stockEl.classList.add('empty');
      var refreshIcon = document.createElement('div');
      refreshIcon.className = 'refresh-icon';
      refreshIcon.textContent = '↻';
      stockEl.appendChild(refreshIcon);
    }

    // Render waste
    wasteEl.innerHTML = '';
    if (waste.length > 0) {
      var topWaste = waste[waste.length - 1];
      topWaste.faceUp = true;
      wasteEl.appendChild(createCardElement(topWaste, 'waste', 0, waste.length - 1));
    }

    // Render foundations
    for (var f = 0; f < 4; f++) {
      var foundEl = document.getElementById('foundation-' + f);
      foundEl.innerHTML = '';
      if (foundations[f].length > 0) {
        var topFound = foundations[f][foundations[f].length - 1];
        foundEl.appendChild(createCardElement(topFound, 'foundation', f, foundations[f].length - 1));
      } else {
        var placeholder = document.createElement('div');
        placeholder.className = 'foundation-placeholder';
        placeholder.textContent = SUIT_SYMBOLS[SUITS[f]];
        foundEl.appendChild(placeholder);
      }
    }

    // Render tableau
    for (var t = 0; t < 7; t++) {
      var tabEl = document.getElementById('tableau-' + t);
      tabEl.innerHTML = '';
      for (var c = 0; c < tableau[t].length; c++) {
        var cardEl = createCardElement(tableau[t][c], 'tableau', t, c);
        cardEl.style.top = (c * 25) + 'px';
        tabEl.appendChild(cardEl);
      }
      tabEl.style.minHeight = Math.max(120, tableau[t].length * 25 + 90) + 'px';
    }

    movesEl.textContent = moves;
    scoreEl.textContent = score;
  }

  function saveState() {
    history.push({
      stock: JSON.parse(JSON.stringify(stock)),
      waste: JSON.parse(JSON.stringify(waste)),
      foundations: JSON.parse(JSON.stringify(foundations)),
      tableau: JSON.parse(JSON.stringify(tableau)),
      moves: moves,
      score: score
    });
    if (history.length > 50) history.shift();
  }

  function undo() {
    if (history.length === 0) return;
    var state = history.pop();
    stock = state.stock;
    waste = state.waste;
    foundations = state.foundations;
    tableau = state.tableau;
    moves = state.moves;
    score = state.score;
    selectedCard = null;
    selectedPile = null;
    selectedIndex = null;
    render();
    playSound(300, 50, 'sine');
    klog('undo', {});
  }

  function handleStockClick() {
    saveState();
    if (stock.length > 0) {
      var card = stock.pop();
      card.faceUp = true;
      waste.push(card);
      playSound(400, 50, 'sine');
    } else if (waste.length > 0) {
      while (waste.length > 0) {
        var c = waste.pop();
        c.faceUp = false;
        stock.push(c);
      }
      playSound(300, 100, 'sine');
    }
    moves++;
    render();
    klog('stock_click', { stockSize: stock.length, wasteSize: waste.length });
  }

  function handleCardClick(card, pileType, pileIndex, cardIndex) {
    if (!card.faceUp && pileType === 'tableau') {
      // Can't select face-down cards in tableau
      return;
    }

    if (selectedCard) {
      // Try to move selected card(s)
      if (pileType === 'tableau') {
        tryMoveToTableau(pileIndex);
      } else if (pileType === 'foundation') {
        tryMoveToFoundation(pileIndex);
      } else {
        // Deselect
        clearSelection();
      }
    } else {
      // Select card
      if (pileType === 'waste' && cardIndex === waste.length - 1) {
        selectCard(card, pileType, pileIndex, cardIndex);
      } else if (pileType === 'tableau' && card.faceUp) {
        selectCard(card, pileType, pileIndex, cardIndex);
      } else if (pileType === 'foundation') {
        selectCard(card, pileType, pileIndex, cardIndex);
      }
    }
  }

  function selectCard(card, pileType, pileIndex, cardIndex) {
    selectedCard = card;
    selectedPile = { type: pileType, index: pileIndex };
    selectedIndex = cardIndex;
    render();
    highlightSelected();
    playSound(500, 30, 'sine');
  }

  function clearSelection() {
    selectedCard = null;
    selectedPile = null;
    selectedIndex = null;
    render();
  }

  function highlightSelected() {
    if (!selectedPile) return;
    var selector = '';
    if (selectedPile.type === 'waste') {
      selector = '#waste .card';
    } else if (selectedPile.type === 'foundation') {
      selector = '#foundation-' + selectedPile.index + ' .card';
    } else if (selectedPile.type === 'tableau') {
      selector = '#tableau-' + selectedPile.index + ' .card[data-card-index="' + selectedIndex + '"]';
      // Also highlight cards below
      var tabEl = document.getElementById('tableau-' + selectedPile.index);
      var cards = tabEl.querySelectorAll('.card');
      cards.forEach(function(c) {
        var idx = parseInt(c.dataset.cardIndex, 10);
        if (idx >= selectedIndex) {
          c.classList.add('selected');
        }
      });
      return;
    }
    var el = document.querySelector(selector);
    if (el) el.classList.add('selected');
  }

  function tryMoveToTableau(targetIndex) {
    var targetPile = tableau[targetIndex];

    if (selectedPile.type === 'waste') {
      if (canPlaceOnTableau(selectedCard, targetPile)) {
        saveState();
        targetPile.push(waste.pop());
        moves++;
        score += 5;
        playSound(600, 50, 'sine');
        klog('move_waste_to_tableau', { target: targetIndex });
      }
    } else if (selectedPile.type === 'foundation') {
      if (canPlaceOnTableau(selectedCard, targetPile)) {
        saveState();
        targetPile.push(foundations[selectedPile.index].pop());
        moves++;
        score = Math.max(0, score - 15);
        playSound(600, 50, 'sine');
        klog('move_foundation_to_tableau', { source: selectedPile.index, target: targetIndex });
      }
    } else if (selectedPile.type === 'tableau' && selectedPile.index !== targetIndex) {
      var sourcePile = tableau[selectedPile.index];
      var cardsToMove = sourcePile.slice(selectedIndex);

      if (canPlaceOnTableau(cardsToMove[0], targetPile)) {
        saveState();
        tableau[selectedPile.index] = sourcePile.slice(0, selectedIndex);
        for (var i = 0; i < cardsToMove.length; i++) {
          targetPile.push(cardsToMove[i]);
        }
        // Flip the new top card
        if (tableau[selectedPile.index].length > 0) {
          var newTop = tableau[selectedPile.index][tableau[selectedPile.index].length - 1];
          if (!newTop.faceUp) {
            newTop.faceUp = true;
            score += 5;
          }
        }
        moves++;
        playSound(600, 50, 'sine');
        klog('move_tableau_to_tableau', { source: selectedPile.index, target: targetIndex, count: cardsToMove.length });
      }
    }

    clearSelection();
    checkWin();
  }

  function tryMoveToFoundation(foundationIndex) {
    if (selectedPile.type === 'waste') {
      if (canPlaceOnFoundation(selectedCard, foundationIndex)) {
        saveState();
        foundations[foundationIndex].push(waste.pop());
        moves++;
        score += 10;
        playSound(700, 50, 'sine');
        klog('move_waste_to_foundation', { foundation: foundationIndex });
      }
    } else if (selectedPile.type === 'tableau') {
      var sourcePile = tableau[selectedPile.index];
      var card = sourcePile[sourcePile.length - 1];
      if (selectedIndex === sourcePile.length - 1 && canPlaceOnFoundation(card, foundationIndex)) {
        saveState();
        foundations[foundationIndex].push(sourcePile.pop());
        // Flip new top card
        if (sourcePile.length > 0) {
          var newTop = sourcePile[sourcePile.length - 1];
          if (!newTop.faceUp) {
            newTop.faceUp = true;
            score += 5;
          }
        }
        moves++;
        score += 10;
        playSound(700, 50, 'sine');
        klog('move_tableau_to_foundation', { source: selectedPile.index, foundation: foundationIndex });
      }
    }

    clearSelection();
    checkWin();
  }

  function handleEmptyTableauClick(index) {
    if (!selectedCard) return;
    tryMoveToTableau(index);
  }

  function handleFoundationClick(index) {
    if (!selectedCard) return;
    tryMoveToFoundation(index);
  }

  function checkWin() {
    var totalInFoundations = 0;
    for (var i = 0; i < 4; i++) {
      totalInFoundations += foundations[i].length;
    }
    if (totalInFoundations === 52) {
      wins++;
      winsEl.textContent = wins;
      localStorage.setItem('solitaire_wins', wins.toString());
      reportScore();
      overlay.hidden = false;
      playSound(523, 100, 'sine');
      playSound(659, 100, 'sine');
      playSound(784, 100, 'sine');
      playSound(1047, 200, 'sine');
      klog('game_win', { moves: moves, score: score });
    }
  }

  function startGame() {
    var deck = shuffle(createDeck());

    stock = [];
    waste = [];
    foundations = [[], [], [], []];
    tableau = [[], [], [], [], [], [], []];
    history = [];
    moves = 0;
    score = 0;
    selectedCard = null;
    selectedPile = null;
    selectedIndex = null;

    // Deal to tableau
    for (var t = 0; t < 7; t++) {
      for (var c = 0; c <= t; c++) {
        var card = deck.pop();
        if (c === t) card.faceUp = true;
        tableau[t].push(card);
      }
    }

    // Rest goes to stock
    stock = deck;

    overlay.hidden = true;
    render();
    klog('game_start', {});
  }

  // Event listeners
  stockEl.addEventListener('click', handleStockClick);

  for (var t = 0; t < 7; t++) {
    (function(index) {
      var el = document.getElementById('tableau-' + index);
      el.addEventListener('click', function(e) {
        if (e.target === el) {
          handleEmptyTableauClick(index);
        }
      });
    })(t);
  }

  for (var f = 0; f < 4; f++) {
    (function(index) {
      var el = document.getElementById('foundation-' + index);
      el.addEventListener('click', function(e) {
        if (e.target === el || e.target.classList.contains('foundation-placeholder')) {
          handleFoundationClick(index);
        }
      });
    })(f);
  }

  playBtn.addEventListener('click', function() {
    initAudio();
    // Check if a game is in progress (moves have been made)
    if (moves > 0) {
      confirmModal.hidden = false;
      klog('confirm_new_game_shown', {});
    } else {
      startGame();
    }
  });

  confirmYesBtn.addEventListener('click', function() {
    confirmModal.hidden = true;
    startGame();
    klog('confirm_new_game_yes', {});
  });

  confirmNoBtn.addEventListener('click', function() {
    confirmModal.hidden = true;
    klog('confirm_new_game_no', {});
  });

  undoBtn.addEventListener('click', undo);

  // Double-click to auto-move to foundation
  document.getElementById('board').addEventListener('dblclick', function(e) {
    var cardEl = e.target.closest('.card.face-up');
    if (!cardEl) return;

    var pileType = cardEl.dataset.pileType;
    var pileIndex = parseInt(cardEl.dataset.pileIndex, 10);
    var cardIndex = parseInt(cardEl.dataset.cardIndex, 10);

    var card, sourcePile;
    if (pileType === 'waste') {
      if (cardIndex !== waste.length - 1) return;
      card = waste[waste.length - 1];
      sourcePile = waste;
    } else if (pileType === 'tableau') {
      sourcePile = tableau[pileIndex];
      if (cardIndex !== sourcePile.length - 1) return;
      card = sourcePile[sourcePile.length - 1];
    } else {
      return;
    }

    // Try to move to foundation
    for (var f = 0; f < 4; f++) {
      if (canPlaceOnFoundation(card, f)) {
        saveState();
        foundations[f].push(sourcePile.pop());
        if (pileType === 'tableau' && sourcePile.length > 0) {
          var newTop = sourcePile[sourcePile.length - 1];
          if (!newTop.faceUp) {
            newTop.faceUp = true;
            score += 5;
          }
        }
        moves++;
        score += 10;
        playSound(700, 50, 'sine');
        clearSelection();
        checkWin();
        klog('auto_move_to_foundation', { foundation: f });
        return;
      }
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
      gameId: 'solitaire',
      onMuteChange: function(m) {
        muted = m;
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(m);
      },
      onPauseChange: function() {},
      isMutedProvider: function() { return muted; },
      isPausedProvider: function() { return false; },
      isRunningProvider: function() { return true; }
    });
    controls.init();
  });

  // Initial render
  startGame();
  klog('init', {});
})();
