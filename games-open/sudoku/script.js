/**
 * Sudoku - Classic number puzzle game
 * Fill the grid with numbers 1-9
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'sudoku';

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

  var boardEl = document.getElementById('board');
  var numberPad = document.getElementById('numberPad');
  var overlay = document.getElementById('stateOverlay');
  var playBtn = document.getElementById('play');
  var checkBtn = document.getElementById('check');
  var difficultyEl = document.getElementById('difficulty');
  var errorsEl = document.getElementById('errors');
  var winsEl = document.getElementById('wins');
  var difficultyBtns = document.querySelectorAll('.diff-btn');

  var grid = [];
  var solution = [];
  var initialGrid = [];
  var selectedCell = null;
  var errors = 0;
  var wins = parseInt(localStorage.getItem('sudoku_wins') || '0', 10);
  var currentDifficulty = 'easy';
  var muted = false;
  var audioCtx = null;

  // Cells to remove based on difficulty
  var DIFFICULTY_LEVELS = {
    easy: 35,
    medium: 45,
    hard: 55
  };

  winsEl.textContent = wins;

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('sudoku', wins); } catch (_) {}
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

  // Sudoku generator
  function isValid(board, row, col, num) {
    // Check row
    for (var c = 0; c < 9; c++) {
      if (board[row][c] === num) return false;
    }
    // Check column
    for (var r = 0; r < 9; r++) {
      if (board[r][col] === num) return false;
    }
    // Check 3x3 box
    var boxRow = Math.floor(row / 3) * 3;
    var boxCol = Math.floor(col / 3) * 3;
    for (var br = 0; br < 3; br++) {
      for (var bc = 0; bc < 3; bc++) {
        if (board[boxRow + br][boxCol + bc] === num) return false;
      }
    }
    return true;
  }

  function solveSudoku(board) {
    for (var row = 0; row < 9; row++) {
      for (var col = 0; col < 9; col++) {
        if (board[row][col] === 0) {
          var nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
          for (var i = 0; i < nums.length; i++) {
            var num = nums[i];
            if (isValid(board, row, col, num)) {
              board[row][col] = num;
              if (solveSudoku(board)) {
                return true;
              }
              board[row][col] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  function generatePuzzle(difficulty) {
    // Create empty board
    var board = [];
    for (var r = 0; r < 9; r++) {
      board[r] = [];
      for (var c = 0; c < 9; c++) {
        board[r][c] = 0;
      }
    }

    // Solve to get a complete valid board
    solveSudoku(board);

    // Copy as solution
    solution = [];
    for (var sr = 0; sr < 9; sr++) {
      solution[sr] = board[sr].slice();
    }

    // Remove cells based on difficulty
    var cellsToRemove = DIFFICULTY_LEVELS[difficulty];
    var removed = 0;
    var attempts = 0;
    var maxAttempts = 200;

    while (removed < cellsToRemove && attempts < maxAttempts) {
      var row = Math.floor(Math.random() * 9);
      var col = Math.floor(Math.random() * 9);
      if (board[row][col] !== 0) {
        board[row][col] = 0;
        removed++;
      }
      attempts++;
    }

    // Copy as initial grid (for tracking which cells are editable)
    initialGrid = [];
    for (var ir = 0; ir < 9; ir++) {
      initialGrid[ir] = board[ir].slice();
    }

    return board;
  }

  function createBoard() {
    boardEl.innerHTML = '';
    for (var row = 0; row < 9; row++) {
      for (var col = 0; col < 9; col++) {
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'sudoku-cell';
        cell.dataset.row = row;
        cell.dataset.col = col;

        if (grid[row][col] !== 0) {
          cell.textContent = grid[row][col];
          if (initialGrid[row][col] !== 0) {
            cell.classList.add('given');
          }
        }

        // Add border styling for 3x3 boxes
        if (col % 3 === 0 && col !== 0) cell.classList.add('border-left');
        if (row % 3 === 0 && row !== 0) cell.classList.add('border-top');

        cell.addEventListener('click', function() {
          selectCell(this);
        });

        boardEl.appendChild(cell);
      }
    }
  }

  function selectCell(cellEl) {
    // Deselect previous
    var prevSelected = boardEl.querySelector('.selected');
    if (prevSelected) prevSelected.classList.remove('selected');

    // Clear highlights
    var highlighted = boardEl.querySelectorAll('.highlighted, .same-number');
    highlighted.forEach(function(el) {
      el.classList.remove('highlighted', 'same-number');
    });

    var row = parseInt(cellEl.dataset.row, 10);
    var col = parseInt(cellEl.dataset.col, 10);

    // Can't select given cells
    if (initialGrid[row][col] !== 0) {
      selectedCell = null;
      return;
    }

    selectedCell = { row: row, col: col, element: cellEl };
    cellEl.classList.add('selected');

    // Highlight same row, column, and box
    var cells = boardEl.querySelectorAll('.sudoku-cell');
    var boxRow = Math.floor(row / 3) * 3;
    var boxCol = Math.floor(col / 3) * 3;

    cells.forEach(function(c) {
      var r = parseInt(c.dataset.row, 10);
      var cc = parseInt(c.dataset.col, 10);
      if (r === row || cc === col ||
          (r >= boxRow && r < boxRow + 3 && cc >= boxCol && cc < boxCol + 3)) {
        c.classList.add('highlighted');
      }
      // Highlight same numbers
      if (grid[row][col] !== 0 && grid[r][cc] === grid[row][col]) {
        c.classList.add('same-number');
      }
    });

    playSound(400, 30, 'sine');
  }

  function enterNumber(num) {
    if (!selectedCell) return;

    var row = selectedCell.row;
    var col = selectedCell.col;

    // Can't edit given cells
    if (initialGrid[row][col] !== 0) return;

    grid[row][col] = num;

    selectedCell.element.textContent = num === 0 ? '' : num;
    selectedCell.element.classList.remove('error', 'correct');

    if (num !== 0) {
      if (num === solution[row][col]) {
        selectedCell.element.classList.add('correct');
        playSound(600, 50, 'sine');
      } else {
        selectedCell.element.classList.add('error');
        errors++;
        errorsEl.textContent = errors;
        playSound(200, 100, 'sawtooth');
        klog('error', { row: row, col: col, entered: num, expected: solution[row][col] });
      }
    }

    // Re-highlight after entering
    selectCell(selectedCell.element);
    checkWin();
  }

  function checkWin() {
    for (var row = 0; row < 9; row++) {
      for (var col = 0; col < 9; col++) {
        if (grid[row][col] !== solution[row][col]) {
          return false;
        }
      }
    }
    // Win!
    wins++;
    winsEl.textContent = wins;
    localStorage.setItem('sudoku_wins', wins.toString());
    reportScore();
    overlay.hidden = false;
    playSound(523, 100, 'sine');
    playSound(659, 100, 'sine');
    playSound(784, 100, 'sine');
    playSound(1047, 200, 'sine');
    klog('game_win', { difficulty: currentDifficulty, errors: errors });
    return true;
  }

  function checkPuzzle() {
    var cells = boardEl.querySelectorAll('.sudoku-cell');
    cells.forEach(function(cell) {
      var row = parseInt(cell.dataset.row, 10);
      var col = parseInt(cell.dataset.col, 10);
      if (initialGrid[row][col] === 0 && grid[row][col] !== 0) {
        cell.classList.remove('error', 'correct');
        if (grid[row][col] === solution[row][col]) {
          cell.classList.add('correct');
        } else {
          cell.classList.add('error');
        }
      }
    });
    playSound(500, 50, 'sine');
    klog('check_puzzle', {});
  }

  function startGame(difficulty) {
    currentDifficulty = difficulty || currentDifficulty;
    difficultyEl.textContent = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
    errors = 0;
    errorsEl.textContent = '0';
    selectedCell = null;
    overlay.hidden = true;

    // Update difficulty buttons
    difficultyBtns.forEach(function(btn) {
      btn.classList.remove('active');
      if (btn.dataset.difficulty === currentDifficulty) {
        btn.classList.add('active');
      }
    });

    grid = generatePuzzle(currentDifficulty);
    createBoard();
    klog('game_start', { difficulty: currentDifficulty });
  }

  // Event listeners
  playBtn.addEventListener('click', function() {
    initAudio();
    startGame();
  });

  checkBtn.addEventListener('click', checkPuzzle);

  difficultyBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      initAudio();
      startGame(btn.dataset.difficulty);
    });
  });

  // Number pad
  numberPad.querySelectorAll('.num-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var num = parseInt(btn.dataset.num, 10);
      enterNumber(num);
    });
  });

  // Keyboard input
  document.addEventListener('keydown', function(e) {
    if (!selectedCell) return;

    var key = e.key;
    if (key >= '1' && key <= '9') {
      e.preventDefault();
      enterNumber(parseInt(key, 10));
    } else if (key === 'Backspace' || key === 'Delete' || key === '0') {
      e.preventDefault();
      enterNumber(0);
    } else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      navigateCell(key);
    }
  });

  function navigateCell(direction) {
    if (!selectedCell) return;

    var row = selectedCell.row;
    var col = selectedCell.col;

    switch (direction) {
      case 'ArrowUp':    row = Math.max(0, row - 1); break;
      case 'ArrowDown':  row = Math.min(8, row + 1); break;
      case 'ArrowLeft':  col = Math.max(0, col - 1); break;
      case 'ArrowRight': col = Math.min(8, col + 1); break;
    }

    var newCell = boardEl.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
    if (newCell) selectCell(newCell);
  }

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
      gameId: 'sudoku',
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

  // Initial setup
  startGame('easy');
  klog('init', {});
})();
