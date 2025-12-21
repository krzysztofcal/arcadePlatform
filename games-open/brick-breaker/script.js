/**
 * Brick Breaker - Classic arcade brick breaking game
 * Break all the bricks with the ball!
 */
(function() {
  'use strict';

  var LOG_PREFIX = 'brick_breaker';

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

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var playBtn = document.getElementById('play');
  var resetBtn = document.getElementById('reset');
  var overlay = document.getElementById('stateOverlay');
  var scoreEl = document.getElementById('score');
  var livesEl = document.getElementById('lives');
  var bestEl = document.getElementById('best');

  // Game settings
  var PADDLE_WIDTH = 80;
  var PADDLE_HEIGHT = 12;
  var BALL_RADIUS = 8;
  var BRICK_ROWS = 5;
  var BRICK_COLS = 8;
  var BRICK_WIDTH = 54;
  var BRICK_HEIGHT = 18;
  var BRICK_PADDING = 4;
  var BRICK_OFFSET_TOP = 40;
  var BRICK_OFFSET_LEFT = 12;

  // Game state
  var paddleX = (canvas.width - PADDLE_WIDTH) / 2;
  var ballX = canvas.width / 2;
  var ballY = canvas.height - 40;
  var ballDX = 4;
  var ballDY = -4;
  var score = 0;
  var lives = 3;
  var best = parseInt(localStorage.getItem('brick_breaker_best') || '0', 10);
  var running = false;
  var paused = false;
  var muted = false;
  var bricks = [];
  var level = 1;
  var animationId = null;
  var audioCtx = null;

  // Brick colors by row
  var BRICK_COLORS = [
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#22c55e', // green
    '#3b82f6'  // blue
  ];

  bestEl.textContent = best;

  function reportScore() {
    if (typeof window.reportScoreToPortal === 'function') {
      try { window.reportScoreToPortal('brick-breaker', score); } catch (_) {}
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
      osc.type = type || 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.1;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {
      klog('play_sound_error', { error: String(e) });
    }
  }

  function initBricks() {
    bricks = [];
    for (var r = 0; r < BRICK_ROWS; r++) {
      bricks[r] = [];
      for (var c = 0; c < BRICK_COLS; c++) {
        bricks[r][c] = { x: 0, y: 0, status: 1 };
      }
    }
  }

  function drawBricks() {
    for (var r = 0; r < BRICK_ROWS; r++) {
      for (var c = 0; c < BRICK_COLS; c++) {
        if (bricks[r][c].status === 1) {
          var brickX = c * (BRICK_WIDTH + BRICK_PADDING) + BRICK_OFFSET_LEFT;
          var brickY = r * (BRICK_HEIGHT + BRICK_PADDING) + BRICK_OFFSET_TOP;
          bricks[r][c].x = brickX;
          bricks[r][c].y = brickY;

          ctx.fillStyle = BRICK_COLORS[r % BRICK_COLORS.length];
          ctx.beginPath();
          ctx.roundRect(brickX, brickY, BRICK_WIDTH, BRICK_HEIGHT, 4);
          ctx.fill();

          // Highlight
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.beginPath();
          ctx.roundRect(brickX, brickY, BRICK_WIDTH, BRICK_HEIGHT / 2, [4, 4, 0, 0]);
          ctx.fill();
        }
      }
    }
  }

  function drawPaddle() {
    var gradient = ctx.createLinearGradient(paddleX, canvas.height - PADDLE_HEIGHT - 10, paddleX, canvas.height - 10);
    gradient.addColorStop(0, '#60a5fa');
    gradient.addColorStop(1, '#3b82f6');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(paddleX, canvas.height - PADDLE_HEIGHT - 10, PADDLE_WIDTH, PADDLE_HEIGHT, 6);
    ctx.fill();
  }

  function drawBall() {
    ctx.beginPath();
    ctx.arc(ballX, ballY, BALL_RADIUS, 0, Math.PI * 2);
    var gradient = ctx.createRadialGradient(ballX - 2, ballY - 2, 0, ballX, ballY, BALL_RADIUS);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.closePath();
  }

  function collisionDetection() {
    for (var r = 0; r < BRICK_ROWS; r++) {
      for (var c = 0; c < BRICK_COLS; c++) {
        var b = bricks[r][c];
        if (b.status === 1) {
          if (ballX > b.x && ballX < b.x + BRICK_WIDTH && ballY > b.y && ballY < b.y + BRICK_HEIGHT) {
            ballDY = -ballDY;
            b.status = 0;
            score += 10 * level;
            scoreEl.textContent = score;
            reportScore();
            playSound(600, 50, 'square');
            klog('brick_hit', { score: score, level: level });

            // Check if all bricks are cleared
            var allCleared = true;
            for (var rr = 0; rr < BRICK_ROWS; rr++) {
              for (var cc = 0; cc < BRICK_COLS; cc++) {
                if (bricks[rr][cc].status === 1) {
                  allCleared = false;
                  break;
                }
              }
              if (!allCleared) break;
            }
            if (allCleared) {
              levelUp();
            }
          }
        }
      }
    }
  }

  function levelUp() {
    level++;
    klog('level_up', { level: level });
    playSound(800, 100, 'sine');
    playSound(1000, 100, 'sine');
    initBricks();
    resetBall();
    ballDX *= 1.1;
    ballDY *= 1.1;
  }

  function resetBall() {
    ballX = canvas.width / 2;
    ballY = canvas.height - 40;
    ballDX = (Math.random() > 0.5 ? 1 : -1) * (4 + level * 0.5);
    ballDY = -(4 + level * 0.5);
    paddleX = (canvas.width - PADDLE_WIDTH) / 2;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    var bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGradient.addColorStop(0, '#0f172a');
    bgGradient.addColorStop(1, '#1e293b');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawBricks();
    drawPaddle();
    drawBall();

    if (!running || paused) return;

    collisionDetection();

    // Ball wall collision
    if (ballX + ballDX > canvas.width - BALL_RADIUS || ballX + ballDX < BALL_RADIUS) {
      ballDX = -ballDX;
      playSound(300, 30, 'sine');
    }
    if (ballY + ballDY < BALL_RADIUS) {
      ballDY = -ballDY;
      playSound(300, 30, 'sine');
    } else if (ballY + ballDY > canvas.height - BALL_RADIUS - PADDLE_HEIGHT - 10) {
      // Paddle collision
      if (ballX > paddleX && ballX < paddleX + PADDLE_WIDTH) {
        // Calculate bounce angle based on where ball hits paddle
        var hitPos = (ballX - paddleX) / PADDLE_WIDTH;
        var angle = (hitPos - 0.5) * Math.PI / 3; // -60 to 60 degrees
        var speed = Math.sqrt(ballDX * ballDX + ballDY * ballDY);
        ballDX = speed * Math.sin(angle);
        ballDY = -Math.abs(speed * Math.cos(angle));
        playSound(400, 30, 'sine');
      } else if (ballY + ballDY > canvas.height - BALL_RADIUS) {
        // Ball missed
        lives--;
        livesEl.textContent = lives;
        playSound(150, 200, 'sawtooth');
        klog('life_lost', { lives: lives });

        if (lives <= 0) {
          gameOver();
          return;
        }
        resetBall();
      }
    }

    ballX += ballDX;
    ballY += ballDY;

    animationId = requestAnimationFrame(draw);
  }

  function gameOver() {
    running = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem('brick_breaker_best', best.toString());
    }
    klog('game_over', { score: score, level: level });
    showOverlay('Game Over!', 'Score: ' + score + ' — Tap play to restart');
  }

  function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    scoreEl.textContent = '0';
    livesEl.textContent = '3';
    running = true;
    paused = false;
    initBricks();
    resetBall();
    ballDX = 4;
    ballDY = -4;
    hideOverlay();
    klog('game_start', {});
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    draw();
  }

  function resetGame() {
    running = false;
    paused = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    score = 0;
    lives = 3;
    level = 1;
    scoreEl.textContent = '0';
    livesEl.textContent = '3';
    initBricks();
    resetBall();
    ballDX = 4;
    ballDY = -4;
    hideOverlay();
    draw();
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

  // Controls
  var leftPressed = false;
  var rightPressed = false;

  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      leftPressed = true;
      e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      rightPressed = true;
      e.preventDefault();
    }
  });

  document.addEventListener('keyup', function(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      leftPressed = false;
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      rightPressed = false;
    }
  });

  // Mouse/touch control
  canvas.addEventListener('mousemove', function(e) {
    var relativeX = e.clientX - canvas.getBoundingClientRect().left;
    if (relativeX > PADDLE_WIDTH / 2 && relativeX < canvas.width - PADDLE_WIDTH / 2) {
      paddleX = relativeX - PADDLE_WIDTH / 2;
    }
  });

  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    var touch = e.touches[0];
    var relativeX = touch.clientX - canvas.getBoundingClientRect().left;
    if (relativeX > PADDLE_WIDTH / 2 && relativeX < canvas.width - PADDLE_WIDTH / 2) {
      paddleX = relativeX - PADDLE_WIDTH / 2;
    }
  }, { passive: false });

  // Paddle movement update
  setInterval(function() {
    if (!running || paused) return;
    if (leftPressed && paddleX > 0) {
      paddleX -= 7;
    }
    if (rightPressed && paddleX < canvas.width - PADDLE_WIDTH) {
      paddleX += 7;
    }
  }, 16);

  playBtn.addEventListener('click', function() {
    initAudio();
    if (paused) {
      paused = false;
      hideOverlay();
      draw();
    } else {
      startGame();
    }
  });

  resetBtn.addEventListener('click', resetGame);

  // Register controls with GameShell
  if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
    window.GameShell.registerControls({
      onPause: function() {
        if (running && !paused) {
          paused = true;
          showOverlay('Paused', 'Tap play to resume');
          klog('pause', {});
        }
      },
      onResume: function() {
        if (running && paused) {
          paused = false;
          hideOverlay();
          draw();
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
      canvas: canvas,
      btnMute: document.getElementById('btnMute'),
      btnPause: document.getElementById('btnPause'),
      btnEnterFs: document.getElementById('btnEnterFs'),
      btnExitFs: document.getElementById('btnExitFs'),
      gameId: 'brick-breaker',
      onMuteChange: function(m) {
        muted = m;
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(m);
      },
      onPauseChange: function(p) {
        if (p && running && !paused) {
          paused = true;
          showOverlay('Paused', 'Tap play to resume');
        } else if (!p && running && paused) {
          paused = false;
          hideOverlay();
          draw();
        }
        if (window.GameShell && window.GameShell.setPaused) window.GameShell.setPaused(p);
      },
      isMutedProvider: function() { return muted; },
      isPausedProvider: function() { return paused; },
      isRunningProvider: function() { return running; }
    });
    controls.init();
  });

  // Initial draw
  initBricks();
  draw();
  klog('init', {});
})();
