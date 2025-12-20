/**
 * Connect Four - Classic two-player strategy game
 * Drop discs to connect four in a row
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'connect_four';

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

  var ROWS = 6;
  var COLS = 7;

  var playBtn = document.getElementById('play');
  var overlay = document.getElementById('stateOverlay');
  var boardEl = document.getElementById('board');
  var turnIndicator = document.getElementById('turnIndicator');
  var redWinsEl = document.getElementById('redWins');
  var yellowWinsEl = document.getElementById('yellowWins');

  var board = [];
  var currentPlayer = 'red';
  var gameOver = false;
  var redWins = 0;
  var yellowWins = 0;
  var muted = false;
  var audioCtx = null;

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

  function playSound(freq, duration) {
    if (muted) return;
    var ctx = initAudio();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.2;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      klog('play_sound_error', { error: String(e) });
    }
  }

  function createBoard() {
    board = [];
    for (var r = 0; r < ROWS; r++) {
      board[r] = [];
      for (var c = 0; c < COLS; c++) {
        board[r][c] = null;
      }
    }
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    for (var c = 0; c < COLS; c++) {
      var colEl = document.createElement('div');
      colEl.className = 'c4-col';
      colEl.dataset.col = c;

      for (var r = 0; r < ROWS; r++) {
        var cell = document.createElement('div');
        cell.className = 'c4-cell';
        cell.dataset.row = r;
        cell.dataset.col = c;

        var disc = document.createElement('div');
        disc.className = 'c4-disc';
        if (board[r][c]) {
          disc.classList.add(board[r][c]);
        }
        cell.appendChild(disc);
        colEl.appendChild(cell);
      }

      colEl.addEventListener('click', handleColumnClick);
      boardEl.appendChild(colEl);
    }
  }

  function handleColumnClick(e) {
    if (gameOver) return;

    var col = parseInt(e.currentTarget.dataset.col, 10);
    dropDisc(col);
  }

  function dropDisc(col) {
    // Find the lowest empty row in this column
    var row = -1;
    for (var r = ROWS - 1; r >= 0; r--) {
      if (!board[r][col]) {
        row = r;
        break;
      }
    }

    if (row === -1) return; // Column is full

    board[row][col] = currentPlayer;
    playSound(currentPlayer === 'red' ? 440 : 520, 100);
    klog('disc_drop', { player: currentPlayer, row: row, col: col });

    renderBoard();

    if (checkWin(row, col)) {
      gameOver = true;
      if (currentPlayer === 'red') {
        redWins++;
        redWinsEl.textContent = redWins;
      } else {
        yellowWins++;
        yellowWinsEl.textContent = yellowWins;
      }
      showOverlay((currentPlayer === 'red' ? 'Red' : 'Yellow') + ' Wins!', 'Click New Game to play again');
      playSound(880, 300);
      klog('game_win', { winner: currentPlayer });
      reportScore();
      return;
    }

    if (checkDraw()) {
      gameOver = true;
      showOverlay('Draw!', 'Click New Game to play again');
      klog('game_draw', {});
      return;
    }

    currentPlayer = currentPlayer === 'red' ? 'yellow' : 'red';
    updateTurnIndicator();
  }

  function checkWin(row, col) {
    var player = board[row][col];
    return checkDirection(row, col, 0, 1, player) ||  // horizontal
           checkDirection(row, col, 1, 0, player) ||  // vertical
           checkDirection(row, col, 1, 1, player) ||  // diagonal
           checkDirection(row, col, 1, -1, player);   // anti-diagonal
  }

  function checkDirection(row, col, dRow, dCol, player) {
    var count = 1;

    // Check positive direction
    var r = row + dRow;
    var c = col + dCol;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      count++;
      r += dRow;
      c += dCol;
    }

    // Check negative direction
    r = row - dRow;
    c = col - dCol;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      count++;
      r -= dRow;
      c -= dCol;
    }

    return count >= 4;
  }

  function checkDraw() {
    for (var c = 0; c < COLS; c++) {
      if (!board[0][c]) return false;
    }
    return true;
  }

  function updateTurnIndicator() {
    var disc = turnIndicator.querySelector('.disc');
    var text = turnIndicator.querySelector('span:last-child');
    disc.className = 'disc ' + currentPlayer;
    text.textContent = (currentPlayer === 'red' ? 'Red' : 'Yellow') + "'s turn";
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

  function resetGame() {
    createBoard();
    renderBoard();
    currentPlayer = 'red';
    gameOver = false;
    hideOverlay();
    updateTurnIndicator();
    klog('game_reset', {});
  }

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try {
        window.reportScoreToPortal('connect-four', redWins + yellowWins);
      } catch (_) {}
    }
  }

  // Keyboard support for column selection
  document.addEventListener('keydown', function(e) {
    if (gameOver) return;
    var key = parseInt(e.key, 10);
    if (key >= 1 && key <= 7) {
      e.preventDefault();
      dropDisc(key - 1);
    }
  });

  playBtn.addEventListener('click', function() {
    initAudio();
    resetGame();
  });

  // Register controls with GameShell
  if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
    window.GameShell.registerControls({
      onPause: function() {
        // Connect Four doesn't need pause
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
      gameId: 'connect-four',
      disableSpacePause: true,
      onMuteChange: function(m) {
        muted = m;
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(m);
      },
      onPauseChange: function(paused) {
        if (window.GameShell && window.GameShell.setPaused) window.GameShell.setPaused(paused);
      },
      isMutedProvider: function() { return muted; },
      isPausedProvider: function() { return gameOver; },
      isRunningProvider: function() { return !gameOver; }
    });
    controls.init();
  });

  // Initialize
  resetGame();
  klog('init', {});
})();
