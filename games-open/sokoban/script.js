/**
 * Sokoban - Classic Japanese puzzle game
 * Push boxes onto the target spots
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'sokoban';

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

  // Level format: # = wall, @ = player, $ = box, . = target, + = player on target, * = box on target, space = floor
  var LEVELS = [
    // Level 1 - Simple intro
    [
      '  #####',
      '###   #',
      '#.@$  #',
      '### $.#',
      '#.##$ #',
      '# # . ##',
      '#$ *$$.#',
      '#   .  #',
      '########'
    ],
    // Level 2
    [
      '####',
      '# .#',
      '#  ###',
      '#*@  #',
      '#  $ #',
      '#  ###',
      '####'
    ],
    // Level 3
    [
      '  ####',
      '  #  ####',
      '  #     #',
      '  # #   #',
      '### ### #',
      '#       #',
      '# @$ #  #',
      '###### ##',
      '     # .#',
      '     ####'
    ],
    // Level 4
    [
      '#######',
      '#     #',
      '# .$. #',
      '# $.$ #',
      '# .$. #',
      '#  @  #',
      '#######'
    ],
    // Level 5
    [
      '  ######',
      '  #    #',
      '  # ## ##',
      '### ## .#',
      '#  $ $ .#',
      '# @## ###',
      '## ## #',
      ' #    #',
      ' ######'
    ]
  ];

  var WALL = '#';
  var PLAYER = '@';
  var PLAYER_ON_TARGET = '+';
  var BOX = '$';
  var BOX_ON_TARGET = '*';
  var TARGET = '.';
  var FLOOR = ' ';

  var undoBtn = document.getElementById('undo');
  var resetBtn = document.getElementById('reset');
  var prevLevelBtn = document.getElementById('prevLevel');
  var nextLevelBtn = document.getElementById('nextLevel');
  var overlay = document.getElementById('stateOverlay');
  var levelEl = document.getElementById('level');
  var movesEl = document.getElementById('moves');
  var pushesEl = document.getElementById('pushes');
  var sokobanGrid = document.getElementById('sokobanGrid');
  var dpad = document.getElementById('dpad');

  var currentLevel = 0;
  var grid = [];
  var playerPos = { x: 0, y: 0 };
  var moves = 0;
  var pushes = 0;
  var history = [];
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

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('sokoban', (currentLevel + 1) * 100); } catch (_) {}
    }
  }

  function parseLevel(levelData) {
    grid = [];
    var maxWidth = 0;
    levelData.forEach(function(row) {
      if (row.length > maxWidth) maxWidth = row.length;
    });

    for (var y = 0; y < levelData.length; y++) {
      grid[y] = [];
      for (var x = 0; x < maxWidth; x++) {
        var char = levelData[y][x] || FLOOR;
        grid[y][x] = char;
        if (char === PLAYER || char === PLAYER_ON_TARGET) {
          playerPos = { x: x, y: y };
        }
      }
    }
  }

  function renderGrid() {
    sokobanGrid.innerHTML = '';
    sokobanGrid.style.gridTemplateColumns = 'repeat(' + grid[0].length + ', 1fr)';

    for (var y = 0; y < grid.length; y++) {
      for (var x = 0; x < grid[y].length; x++) {
        var cell = document.createElement('div');
        cell.className = 'sokoban-cell';
        var char = grid[y][x];

        switch (char) {
          case WALL:
            cell.classList.add('wall');
            break;
          case PLAYER:
            cell.classList.add('floor', 'player');
            break;
          case PLAYER_ON_TARGET:
            cell.classList.add('target', 'player');
            break;
          case BOX:
            cell.classList.add('floor', 'box');
            break;
          case BOX_ON_TARGET:
            cell.classList.add('target', 'box-on-target');
            break;
          case TARGET:
            cell.classList.add('target');
            break;
          case FLOOR:
            cell.classList.add('floor');
            break;
          default:
            cell.classList.add('empty');
        }

        sokobanGrid.appendChild(cell);
      }
    }
  }

  function getCell(x, y) {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) {
      return WALL;
    }
    return grid[y][x];
  }

  function setCell(x, y, value) {
    grid[y][x] = value;
  }

  function isWalkable(char) {
    return char === FLOOR || char === TARGET;
  }

  function isBox(char) {
    return char === BOX || char === BOX_ON_TARGET;
  }

  function move(dx, dy) {
    var newX = playerPos.x + dx;
    var newY = playerPos.y + dy;
    var targetCell = getCell(newX, newY);

    if (targetCell === WALL) return false;

    var pushed = false;

    if (isBox(targetCell)) {
      var boxNewX = newX + dx;
      var boxNewY = newY + dy;
      var boxTargetCell = getCell(boxNewX, boxNewY);

      if (!isWalkable(boxTargetCell)) return false;

      // Save state for undo
      history.push({
        playerPos: { x: playerPos.x, y: playerPos.y },
        grid: grid.map(function(row) { return row.slice(); }),
        moves: moves,
        pushes: pushes
      });

      // Move box
      setCell(boxNewX, boxNewY, boxTargetCell === TARGET ? BOX_ON_TARGET : BOX);
      setCell(newX, newY, targetCell === BOX_ON_TARGET ? TARGET : FLOOR);
      pushed = true;
      pushes++;
    } else if (!isWalkable(targetCell)) {
      return false;
    } else {
      // Save state for undo (without push)
      history.push({
        playerPos: { x: playerPos.x, y: playerPos.y },
        grid: grid.map(function(row) { return row.slice(); }),
        moves: moves,
        pushes: pushes
      });
    }

    // Move player
    var currentCell = getCell(playerPos.x, playerPos.y);
    setCell(playerPos.x, playerPos.y, currentCell === PLAYER_ON_TARGET ? TARGET : FLOOR);
    targetCell = getCell(newX, newY);
    setCell(newX, newY, targetCell === TARGET ? PLAYER_ON_TARGET : PLAYER);

    playerPos.x = newX;
    playerPos.y = newY;
    moves++;

    playSound(pushed ? 300 : 440, 50);
    updateStats();
    renderGrid();

    if (checkWin()) {
      levelComplete();
    }

    klog('move', { dx: dx, dy: dy, pushed: pushed, moves: moves, pushes: pushes });
    return true;
  }

  function undo() {
    if (history.length === 0) return;

    var state = history.pop();
    playerPos = state.playerPos;
    grid = state.grid;
    moves = state.moves;
    pushes = state.pushes;

    updateStats();
    renderGrid();
    playSound(220, 50);
    klog('undo', { moves: moves, pushes: pushes });
  }

  function checkWin() {
    for (var y = 0; y < grid.length; y++) {
      for (var x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === BOX) return false;
        if (grid[y][x] === TARGET) return false;
        if (grid[y][x] === PLAYER_ON_TARGET) return false;
      }
    }
    return true;
  }

  function levelComplete() {
    klog('level_complete', { level: currentLevel + 1, moves: moves, pushes: pushes });
    reportScore();
    playSound(660, 200);
    setTimeout(function() {
      playSound(880, 300);
    }, 200);
    showOverlay('Level Complete!', 'Moves: ' + moves + ' — Pushes: ' + pushes);
  }

  function loadLevel(index) {
    if (index < 0) index = LEVELS.length - 1;
    if (index >= LEVELS.length) index = 0;
    currentLevel = index;

    parseLevel(LEVELS[currentLevel]);
    history = [];
    moves = 0;
    pushes = 0;

    updateStats();
    renderGrid();
    hideOverlay();
    klog('level_load', { level: currentLevel + 1 });
  }

  function updateStats() {
    levelEl.textContent = currentLevel + 1;
    movesEl.textContent = moves;
    pushesEl.textContent = pushes;
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

  // Event listeners
  undoBtn.addEventListener('click', undo);
  resetBtn.addEventListener('click', function() { loadLevel(currentLevel); });
  prevLevelBtn.addEventListener('click', function() { loadLevel(currentLevel - 1); });
  nextLevelBtn.addEventListener('click', function() { loadLevel(currentLevel + 1); });

  dpad.addEventListener('pointerdown', function(e) {
    var action = e.target.dataset.action;
    if (!action) return;
    e.preventDefault();

    switch (action) {
      case 'up': move(0, -1); break;
      case 'down': move(0, 1); break;
      case 'left': move(-1, 0); break;
      case 'right': move(1, 0); break;
      case 'undo': undo(); break;
    }
  });

  document.addEventListener('keydown', function(e) {
    var moved = false;
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        moved = move(0, -1);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        moved = move(0, 1);
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        moved = move(-1, 0);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        moved = move(1, 0);
        break;
      case 'z':
      case 'Z':
      case 'Backspace':
        undo();
        e.preventDefault();
        return;
      case 'r':
      case 'R':
        loadLevel(currentLevel);
        e.preventDefault();
        return;
    }
    if (moved) e.preventDefault();
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
      gameId: 'sokoban',
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
      isRunningProvider: function() { return true; }
    });
    controls.init();
  });

  // Initialize
  loadLevel(0);
  klog('init', {});
})();
