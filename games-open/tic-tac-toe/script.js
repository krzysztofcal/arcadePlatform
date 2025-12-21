/**
 * Tic-Tac-Toe - Classic strategy game with AI opponent
 * Beat the AI in this classic game!
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'tic_tac_toe';

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

  var board = document.getElementById('board');
  var cells = board.querySelectorAll('.ttt-cell');
  var statusEl = document.getElementById('status');
  var playBtn = document.getElementById('play');
  var resetBtn = document.getElementById('reset');
  var playerWinsEl = document.getElementById('playerWins');
  var aiWinsEl = document.getElementById('aiWins');
  var drawsEl = document.getElementById('draws');

  var PLAYER = 'X';
  var AI = 'O';
  var WINNING_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];

  var gameBoard = ['', '', '', '', '', '', '', '', ''];
  var currentPlayer = PLAYER;
  var gameActive = true;
  var muted = false;
  var audioCtx = null;

  // Stats
  var playerWins = parseInt(localStorage.getItem('ttt_player_wins') || '0', 10);
  var aiWins = parseInt(localStorage.getItem('ttt_ai_wins') || '0', 10);
  var draws = parseInt(localStorage.getItem('ttt_draws') || '0', 10);

  playerWinsEl.textContent = playerWins;
  aiWinsEl.textContent = aiWins;
  drawsEl.textContent = draws;

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('tic-tac-toe', playerWins); } catch (_) {}
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

  function updateDisplay() {
    cells.forEach(function(cell, index) {
      cell.textContent = gameBoard[index];
      cell.classList.remove('x', 'o', 'winning');
      if (gameBoard[index] === 'X') {
        cell.classList.add('x');
      } else if (gameBoard[index] === 'O') {
        cell.classList.add('o');
      }
    });
  }

  function checkWinner(board, player) {
    for (var i = 0; i < WINNING_COMBOS.length; i++) {
      var combo = WINNING_COMBOS[i];
      if (board[combo[0]] === player && board[combo[1]] === player && board[combo[2]] === player) {
        return combo;
      }
    }
    return null;
  }

  function isBoardFull(board) {
    return board.every(function(cell) { return cell !== ''; });
  }

  function getAvailableMoves(board) {
    var moves = [];
    for (var i = 0; i < board.length; i++) {
      if (board[i] === '') moves.push(i);
    }
    return moves;
  }

  // Minimax AI
  function minimax(board, depth, isMaximizing, alpha, beta) {
    var aiWin = checkWinner(board, AI);
    var playerWin = checkWinner(board, PLAYER);

    if (aiWin) return 10 - depth;
    if (playerWin) return depth - 10;
    if (isBoardFull(board)) return 0;

    if (isMaximizing) {
      var maxEval = -Infinity;
      var moves = getAvailableMoves(board);
      for (var i = 0; i < moves.length; i++) {
        var move = moves[i];
        board[move] = AI;
        var evalScore = minimax(board, depth + 1, false, alpha, beta);
        board[move] = '';
        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      var minEval = Infinity;
      var movesMin = getAvailableMoves(board);
      for (var j = 0; j < movesMin.length; j++) {
        var moveMin = movesMin[j];
        board[moveMin] = PLAYER;
        var evalScoreMin = minimax(board, depth + 1, true, alpha, beta);
        board[moveMin] = '';
        minEval = Math.min(minEval, evalScoreMin);
        beta = Math.min(beta, evalScoreMin);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  function getBestMove() {
    var bestScore = -Infinity;
    var bestMove = -1;
    var moves = getAvailableMoves(gameBoard);

    for (var i = 0; i < moves.length; i++) {
      var move = moves[i];
      gameBoard[move] = AI;
      var score = minimax(gameBoard, 0, false, -Infinity, Infinity);
      gameBoard[move] = '';
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    return bestMove;
  }

  function highlightWinningCells(combo) {
    combo.forEach(function(index) {
      cells[index].classList.add('winning');
    });
  }

  function handlePlayerMove(index) {
    if (!gameActive || gameBoard[index] !== '' || currentPlayer !== PLAYER) return;

    gameBoard[index] = PLAYER;
    updateDisplay();
    playSound(440, 100, 'sine');
    klog('player_move', { index: index });

    var winCombo = checkWinner(gameBoard, PLAYER);
    if (winCombo) {
      highlightWinningCells(winCombo);
      statusEl.textContent = 'You win!';
      gameActive = false;
      playerWins++;
      playerWinsEl.textContent = playerWins;
      localStorage.setItem('ttt_player_wins', playerWins.toString());
      reportScore();
      playSound(523, 150, 'sine');
      playSound(659, 150, 'sine');
      playSound(784, 200, 'sine');
      klog('player_win', { wins: playerWins });
      return;
    }

    if (isBoardFull(gameBoard)) {
      statusEl.textContent = "It's a draw!";
      gameActive = false;
      draws++;
      drawsEl.textContent = draws;
      localStorage.setItem('ttt_draws', draws.toString());
      klog('draw', { draws: draws });
      return;
    }

    currentPlayer = AI;
    statusEl.textContent = 'AI is thinking...';
    setTimeout(makeAIMove, 500);
  }

  function makeAIMove() {
    if (!gameActive) return;

    var move = getBestMove();
    if (move === -1) return;

    gameBoard[move] = AI;
    updateDisplay();
    playSound(330, 100, 'sine');
    klog('ai_move', { index: move });

    var winCombo = checkWinner(gameBoard, AI);
    if (winCombo) {
      highlightWinningCells(winCombo);
      statusEl.textContent = 'AI wins!';
      gameActive = false;
      aiWins++;
      aiWinsEl.textContent = aiWins;
      localStorage.setItem('ttt_ai_wins', aiWins.toString());
      playSound(262, 200, 'sawtooth');
      klog('ai_win', { wins: aiWins });
      return;
    }

    if (isBoardFull(gameBoard)) {
      statusEl.textContent = "It's a draw!";
      gameActive = false;
      draws++;
      drawsEl.textContent = draws;
      localStorage.setItem('ttt_draws', draws.toString());
      klog('draw', { draws: draws });
      return;
    }

    currentPlayer = PLAYER;
    statusEl.textContent = 'Your turn (X)';
  }

  function startNewGame() {
    gameBoard = ['', '', '', '', '', '', '', '', ''];
    currentPlayer = PLAYER;
    gameActive = true;
    statusEl.textContent = 'Your turn (X)';
    updateDisplay();
    klog('game_start', {});
  }

  function resetScore() {
    playerWins = 0;
    aiWins = 0;
    draws = 0;
    playerWinsEl.textContent = '0';
    aiWinsEl.textContent = '0';
    drawsEl.textContent = '0';
    localStorage.setItem('ttt_player_wins', '0');
    localStorage.setItem('ttt_ai_wins', '0');
    localStorage.setItem('ttt_draws', '0');
    startNewGame();
    klog('score_reset', {});
  }

  // Event listeners
  cells.forEach(function(cell, index) {
    cell.addEventListener('click', function() {
      handlePlayerMove(index);
    });
  });

  playBtn.addEventListener('click', function() {
    initAudio();
    startNewGame();
  });

  resetBtn.addEventListener('click', resetScore);

  // Keyboard support
  document.addEventListener('keydown', function(e) {
    if (!gameActive || currentPlayer !== PLAYER) return;
    var key = e.key;
    var keyMap = {
      '1': 0, '2': 1, '3': 2,
      '4': 3, '5': 4, '6': 5,
      '7': 6, '8': 7, '9': 8
    };
    if (keyMap.hasOwnProperty(key)) {
      e.preventDefault();
      handlePlayerMove(keyMap[key]);
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
      gameId: 'tic-tac-toe',
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
  updateDisplay();
  klog('init', {});
})();
