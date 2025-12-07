/**
 * T-Rex Runner - Arcade Hub Edition
 * Supports fullscreen, pause, mute, and XP integration
 */
(function () {
  'use strict';

  var LOG_PREFIX = 'trex_game';

  /**
   * klog helper - logs to KLog if available, otherwise console
   */
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

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var WORLD_WIDTH = 600;
  var WORLD_HEIGHT = 200;
  var scoreEl = document.getElementById('score');
  var hiScoreEl = document.getElementById('hi-score');
  var restartBtn = document.getElementById('restart');
  var statusEl = document.getElementById('status');

  // Control elements
  var gameWrap = document.getElementById('gameWrap');
  var btnMute = document.getElementById('btnMute');
  var btnPause = document.getElementById('btnPause');
  var btnEnterFs = document.getElementById('btnEnterFs');
  var btnExitFs = document.getElementById('btnExitFs');
  var overlayExit = document.getElementById('overlayExit');
  var centerOverlay = document.getElementById('centerOverlay');
  var bigStartBtn = document.getElementById('bigStartBtn');
  var gameOverOverlay = document.getElementById('gameOverOverlay');
  var statsPoints = document.getElementById('statsPoints');
  var statsHiScore = document.getElementById('statsHiScore');
  var replayBtn = document.getElementById('replayBtn');

  var GROUND_Y = 170;
  var GRAVITY = 2000;
  var JUMP_VELOCITY = -680;
  var INITIAL_SPEED = 360;
  var XP_GAME_ID = 't-rex';
  var ASPECT_RATIO = 3; // 600:200 = 3:1

  var state = {
    running: false,
    paused: false,
    muted: false,
    lastTime: 0,
    speed: INITIAL_SPEED,
    spawnTimer: 0,
    spawnInterval: 1.6,
    score: 0,
    hiScore: Number(localStorage.getItem('trex-hi') || '0'),
    dino: { x: 60, y: GROUND_Y, width: 44, height: 48, vy: 0, isJumping: false },
    obstacles: [],
    clouds: [],
    startTs: 0
  };

  // Load muted state from localStorage
  try {
    state.muted = localStorage.getItem('trex-muted') === 'true';
  } catch (_) {}

  var lastScorePulse = 0;
  var controls = null;

  function formatScore(value) { return value.toString().padStart(5, '0'); }

  function getBridge() {
    var bridge = window.GameXpBridge;
    return bridge && typeof bridge === 'object' ? bridge : null;
  }

  function notifyScorePulse(totalScore) {
    var payload = { type: 'game-score', gameId: XP_GAME_ID, score: totalScore };
    var origin = (window.location && window.location.origin) ? window.location.origin : '*';
    try { window.postMessage(payload, origin); } catch (_) {}
    if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
      try { window.parent.postMessage(payload, origin); } catch (_) {}
    }
  }

  function addScoreDelta(delta) {
    if (!delta || !Number.isFinite(delta) || delta <= 0) return;
    var bridge = getBridge();
    if (bridge && typeof bridge.add === 'function') {
      try { bridge.add(delta); } catch (_) {}
    }
  }

  function nudgeXP() {
    var bridge = getBridge();
    if (bridge && typeof bridge.nudge === 'function') {
      try { bridge.nudge(); } catch (_) {}
    }
  }

  function setupCanvas() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = WORLD_WIDTH * dpr;
    canvas.height = WORLD_HEIGHT * dpr;
    canvas.style.width = '100%';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  function reset() {
    klog('reset', {});
    state.running = false;
    state.paused = false;
    state.lastTime = 0;
    state.speed = INITIAL_SPEED;
    state.spawnTimer = 0;
    state.spawnInterval = 1.6;
    state.score = 0;
    state.dino.y = GROUND_Y;
    state.dino.vy = 0;
    state.dino.isJumping = false;
    state.obstacles.length = 0;
    state.clouds.length = 0;
    lastScorePulse = 0;
    spawnCloud();
    spawnCloud();
    render();
    updateScoreboard();
    updateStatus();
    if (controls) controls.updatePauseUI();
  }

  function start() {
    if (state.running) return;
    klog('start', {});
    state.running = true;
    state.paused = false;
    state.lastTime = performance.now();
    state.startTs = performance.now();
    if (centerOverlay) centerOverlay.classList.add('hidden');
    if (gameOverOverlay) gameOverOverlay.classList.add('hidden');
    updateStatus();
    if (controls) controls.updatePauseUI();
    requestAnimationFrame(loop);
  }

  function jump() {
    nudgeXP();
    if (!state.running) {
      reset();
      start();
    }
    if (state.dino.isJumping || state.paused) return;
    state.dino.isJumping = true;
    state.dino.vy = JUMP_VELOCITY;
    klog('jump', { score: Math.floor(state.score) });
  }

  function togglePause(newPaused) {
    if (!state.running) return;
    state.paused = typeof newPaused === 'boolean' ? newPaused : !state.paused;
    klog('pause_change', { paused: state.paused });
    updateStatus();
    if (!state.paused) {
      state.lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function toggleMute(newMuted) {
    state.muted = typeof newMuted === 'boolean' ? newMuted : !state.muted;
    klog('mute_change', { muted: state.muted });
    try {
      localStorage.setItem('trex-muted', state.muted ? 'true' : 'false');
    } catch (_) {}
  }

  function updateStatus() {
    if (!statusEl) return;
    if (!state.running) {
      statusEl.textContent = '';
    } else if (state.paused) {
      statusEl.textContent = 'PAUSED - Press Space to resume';
    } else {
      statusEl.textContent = 'Press Space/↑ or tap to jump';
    }
  }

  function loop(ts) {
    if (!state.running || state.paused) return;
    var dt = Math.min((ts - state.lastTime) / 1000, 0.035);
    state.lastTime = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    state.speed += dt * 12;
    state.spawnTimer += dt;
    if (state.spawnTimer > state.spawnInterval) {
      state.spawnTimer = 0;
      state.spawnInterval = Math.max(1.0, 1.8 - state.speed / 900);
      spawnObstacle();
    }
    var d = state.dino;
    d.vy += GRAVITY * dt;
    d.y += d.vy * dt;
    if (d.y >= GROUND_Y) {
      d.y = GROUND_Y;
      d.vy = 0;
      d.isJumping = false;
    }
    state.obstacles.forEach(function(ob) { ob.x -= state.speed * dt; });
    state.obstacles = state.obstacles.filter(function(ob) { return ob.x + ob.width > -10; });
    state.clouds.forEach(function(c) { c.x -= c.speed * dt; });
    if (state.clouds.length < 3) spawnCloud();
    state.clouds = state.clouds.filter(function(c) { return c.x + c.width > 0; });
    detectCollision();
    state.score += dt * 12;
    if (Math.floor(state.score) % 100 === 0) { state.speed += 5; }
    updateScoreboard();
    var wholeScore = Math.max(0, Math.floor(state.score));
    if (wholeScore > lastScorePulse) {
      var delta = wholeScore - lastScorePulse;
      lastScorePulse = wholeScore;
      notifyScorePulse(wholeScore);
      addScoreDelta(delta);
    }
  }

  function detectCollision() {
    var d = state.dino;
    var dLeft = d.x;
    var dRight = d.x + d.width;
    var dBottom = d.y;
    var dTop = d.y - d.height;
    for (var i = 0; i < state.obstacles.length; i++) {
      var ob = state.obstacles[i];
      var oLeft = ob.x;
      var oRight = ob.x + ob.width;
      var oTop = ob.y;
      var oBottom = ob.y + ob.height;
      if (dLeft < oRight && dRight > oLeft && dTop < oBottom && dBottom > oTop) {
        gameOver();
        break;
      }
    }
  }

  function gameOver() {
    klog('game_over', { score: Math.floor(state.score), hiScore: state.hiScore });
    state.running = false;
    state.paused = false;
    if (state.score > state.hiScore) {
      state.hiScore = Math.floor(state.score);
      localStorage.setItem('trex-hi', state.hiScore.toString());
    }
    updateScoreboard();
    updateStatus();
    if (controls) controls.updatePauseUI();

    // Show game over overlay
    if (statsPoints) statsPoints.textContent = formatScore(Math.floor(state.score));
    if (statsHiScore) statsHiScore.textContent = formatScore(Math.floor(state.hiScore));
    if (gameOverOverlay) gameOverOverlay.classList.remove('hidden');
    if (centerOverlay) centerOverlay.classList.add('hidden');

    drawGameOver();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5f6fb';
    ctx.font = '24px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Game Over', WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 10);
    ctx.font = '16px "Courier New", monospace';
    ctx.fillText('Press restart or jump to try again', WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 14);
    ctx.restore();
  }

  function spawnObstacle() {
    var h = 40 + Math.random() * 40;
    var w = 20 + Math.random() * 20;
    state.obstacles.push({ x: WORLD_WIDTH + Math.random() * 60, y: GROUND_Y + 2 - h, width: w, height: h });
  }

  function spawnCloud() {
    state.clouds.push({
      x: WORLD_WIDTH + Math.random() * 200,
      y: 20 + Math.random() * 60,
      width: 60 + Math.random() * 40,
      height: 20 + Math.random() * 10,
      speed: 30 + Math.random() * 20
    });
  }

  function updateScoreboard() {
    if (scoreEl) scoreEl.textContent = formatScore(Math.floor(state.score));
    if (hiScoreEl) hiScoreEl.textContent = formatScore(Math.floor(state.hiScore));
  }

  function render() {
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    var grad = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
    grad.addColorStop(0, '#15223c');
    grad.addColorStop(1, '#0b0e19');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#23324d';
    ctx.fillRect(0, GROUND_Y + 10, WORLD_WIDTH, 3);
    ctx.fillStyle = '#2f3e5f';
    ctx.fillRect(0, GROUND_Y + 13, WORLD_WIDTH, 2);
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    state.clouds.forEach(function(c) { drawRoundedRect(c.x, c.y, c.width, c.height, 10); });
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    drawEllipse(state.dino.x + state.dino.width / 2, GROUND_Y + 12, 26, 6);
    drawDino();
    ctx.fillStyle = '#7cf58e';
    state.obstacles.forEach(function(ob) { drawCactus(ob.x, ob.y, ob.width, ob.height); });

    // Draw pause overlay
    if (state.paused && state.running) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '24px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
      ctx.restore();
    }
  }

  function drawDino() {
    var d = state.dino;
    ctx.save();
    ctx.translate(d.x, d.y - d.height);
    ctx.fillStyle = '#9df785';
    drawRoundedRect(0, 12, 36, 28, 6);
    drawRoundedRect(24, 0, 18, 16, 6);
    drawRoundedRect(6, 32, 14, 18, 6);
    drawRoundedRect(22, 32, 14, 18, 6);
    ctx.fillStyle = '#17202d';
    ctx.fillRect(30, 6, 6, 6);
    ctx.restore();
  }

  function drawCactus(x, y, w, h) {
    var seg = Math.max(10, w * 0.4);
    ctx.save();
    ctx.translate(x, y);
    drawRoundedRect(0, 0, w, h, w * 0.2);
    ctx.fillRect(w / 2 - seg / 2, h * 0.25, seg, h * 0.35);
    ctx.fillRect(w * 0.1, h * 0.4, seg * 0.7, h * 0.2);
    ctx.fillRect(w - seg * 0.7 - w * 0.1, h * 0.55, seg * 0.7, h * 0.2);
    ctx.restore();
  }

  function drawRoundedRect(x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawEllipse(cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function handleKeydown(e) {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (state.paused) {
        togglePause(false);
        return;
      }
      if (!state.running) {
        reset();
      }
      jump();
    } else if (e.code === 'Enter') {
      e.preventDefault();
      reset();
      start();
      nudgeXP();
    }
  }

  function handlePointer(e) {
    e.preventDefault();
    if (state.paused) {
      togglePause(false);
      return;
    }
    if (!state.running) {
      reset();
    }
    jump();
  }

  // Initialize game controls
  function initControls() {
    if (!window.GameControlsService) {
      klog('error', { message: 'GameControlsService not available' });
      return;
    }

    controls = window.GameControlsService({
      wrap: gameWrap,
      canvas: canvas,
      btnMute: btnMute,
      btnPause: btnPause,
      btnEnterFs: btnEnterFs,
      btnExitFs: btnExitFs,
      overlayExit: overlayExit,
      gameId: XP_GAME_ID,
      aspect: ASPECT_RATIO,
      disableSpacePause: true, // T-Rex uses Space for jump
      onMuteChange: function(muted) {
        toggleMute(muted);
      },
      onPauseChange: function(paused) {
        togglePause(paused);
      },
      onFullscreenChange: function(isFs) {
        klog('fullscreen_change', { fullscreen: isFs });
        setupCanvas();
        render();
      },
      onActivity: nudgeXP,
      isMutedProvider: function() { return state.muted; },
      isPausedProvider: function() { return state.paused; },
      isRunningProvider: function() { return state.running; },
      onResizeRequest: function() {
        setupCanvas();
        render();
      }
    });

    controls.init();
    klog('controls_initialized', { gameId: XP_GAME_ID });
  }

  // Event listeners
  restartBtn.addEventListener('click', function() {
    nudgeXP();
    reset();
    start();
  });

  if (bigStartBtn) {
    bigStartBtn.addEventListener('click', function() {
      nudgeXP();
      reset();
      start();
    });
  }

  if (replayBtn) {
    replayBtn.addEventListener('click', function() {
      nudgeXP();
      reset();
      start();
    });
  }

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', function() {
    setupCanvas();
    render();
  });
  canvas.addEventListener('pointerdown', handlePointer);
  canvas.addEventListener('touchstart', handlePointer, { passive: false });

  // XP visibility events
  document.addEventListener('xp:hidden', function() {
    if (state.running && !state.paused) {
      togglePause(true);
    }
  });
  document.addEventListener('xp:visible', function() {
    // Don't auto-resume, let user manually resume
  });

  // Initialize
  klog('init', { gameId: XP_GAME_ID });
  setupCanvas();
  reset();

  // Show start overlay on load
  if (centerOverlay) centerOverlay.classList.remove('hidden');
  if (gameOverOverlay) gameOverOverlay.classList.add('hidden');

  // Wait for DOM and services to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initControls);
  } else {
    // Small delay to ensure services are loaded
    setTimeout(initControls, 50);
  }
})();
