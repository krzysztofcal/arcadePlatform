(function() {
  'use strict';

  if (window.KLog) window.KLog.log('frogger_init', { timestamp: Date.now() });

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const bestEl = document.getElementById('best');
  const newGameBtn = document.getElementById('new-game');
  const btnLeft = document.getElementById('btn-left');
  const btnUp = document.getElementById('btn-up');
  const btnDown = document.getElementById('btn-down');
  const btnRight = document.getElementById('btn-right');

  const GRID_SIZE = 50;
  const CANVAS_WIDTH = 500;
  const CANVAS_HEIGHT = 600;

  let game = {
    running: false,
    paused: false,
    muted: false,
    score: 0,
    lives: 3,
    level: 1,
    frog: { x: 225, y: 550, size: 40 },
    cars: [],
    logs: [],
    animFrame: 0
  };

  let keys = { left: false, right: false, up: false, down: false };
  let best = parseInt(localStorage.getItem('frogger-best') || '0');
  bestEl.textContent = best;

  // Game Shell integration
  window.GameShell = {
    isMuted: function() { return game.muted; },
    isPaused: function() { return game.paused; },
    setMuted: function(muted) {
      game.muted = muted;
      if (window.KLog) window.KLog.log('frogger_mute', { muted });
    },
    setPaused: function(paused) {
      game.paused = paused;
      if (window.KLog) window.KLog.log('frogger_pause', { paused });
    }
  };

  function createCars(level) {
    const cars = [];
    const baseSpeed = 1 + (level - 1) * 0.3;

    // Row 1 - Cars moving right
    for (let i = 0; i < 3; i++) {
      cars.push({
        x: i * 200,
        y: 500,
        width: 80,
        height: 40,
        speed: baseSpeed * 1.2,
        color: '#ff0000'
      });
    }

    // Row 2 - Cars moving left
    for (let i = 0; i < 2; i++) {
      cars.push({
        x: i * 250,
        y: 450,
        width: 100,
        height: 40,
        speed: -baseSpeed * 0.8,
        color: '#ff6600'
      });
    }

    // Row 3 - Cars moving right
    for (let i = 0; i < 4; i++) {
      cars.push({
        x: i * 150,
        y: 400,
        width: 60,
        height: 40,
        speed: baseSpeed * 1.5,
        color: '#ffff00'
      });
    }

    // Row 4 - Cars moving left
    for (let i = 0; i < 3; i++) {
      cars.push({
        x: i * 180,
        y: 350,
        width: 90,
        height: 40,
        speed: -baseSpeed,
        color: '#ff00ff'
      });
    }

    return cars;
  }

  function createLogs(level) {
    const logs = [];
    const baseSpeed = 0.8 + (level - 1) * 0.2;

    // Row 1 - Logs moving right
    for (let i = 0; i < 3; i++) {
      logs.push({
        x: i * 200,
        y: 250,
        width: 120,
        height: 40,
        speed: baseSpeed,
        color: '#8b4513'
      });
    }

    // Row 2 - Logs moving left
    for (let i = 0; i < 2; i++) {
      logs.push({
        x: i * 280,
        y: 200,
        width: 150,
        height: 40,
        speed: -baseSpeed * 0.7,
        color: '#a0522d'
      });
    }

    // Row 3 - Logs moving right
    for (let i = 0; i < 4; i++) {
      logs.push({
        x: i * 140,
        y: 150,
        width: 100,
        height: 40,
        speed: baseSpeed * 1.2,
        color: '#8b4513'
      });
    }

    // Row 4 - Logs moving left
    for (let i = 0; i < 3; i++) {
      logs.push({
        x: i * 200,
        y: 100,
        width: 130,
        height: 40,
        speed: -baseSpeed * 0.9,
        color: '#a0522d'
      });
    }

    return logs;
  }

  function init() {
    game.running = true;
    game.paused = false;
    game.score = 0;
    game.lives = 3;
    game.level = 1;
    game.frog = { x: 225, y: 550, size: 40 };
    game.cars = createCars(game.level);
    game.logs = createLogs(game.level);
    game.animFrame = 0;

    updateUI();
    if (window.KLog) window.KLog.log('frogger_start', { level: game.level });
    gameLoop();
  }

  function updateUI() {
    scoreEl.textContent = game.score;
    livesEl.textContent = game.lives;
    if (game.score > best) {
      best = game.score;
      bestEl.textContent = best;
      localStorage.setItem('frogger-best', best);
    }
  }

  function moveFrog(dx, dy) {
    const newX = game.frog.x + dx;
    const newY = game.frog.y + dy;

    // Keep frog within bounds
    if (newX >= 0 && newX <= CANVAS_WIDTH - game.frog.size) {
      game.frog.x = newX;
    }
    if (newY >= 0 && newY <= CANVAS_HEIGHT - game.frog.size) {
      game.frog.y = newY;

      // Award points for moving forward
      if (dy < 0) {
        game.score += 10;
        updateUI();
      }
    }

    // Check if frog reached the goal
    if (game.frog.y < 50) {
      game.score += 100;
      updateUI();
      resetFrogPosition();
      if (window.KLog) window.KLog.log('frogger_level_complete', { score: game.score, level: game.level });

      // Check for level up
      if (game.score >= game.level * 500) {
        nextLevel();
      }
    }
  }

  function resetFrogPosition() {
    game.frog.x = 225;
    game.frog.y = 550;
  }

  function checkCollisions() {
    const frogCenterX = game.frog.x + game.frog.size / 2;
    const frogCenterY = game.frog.y + game.frog.size / 2;

    // Check car collisions
    for (const car of game.cars) {
      if (frogCenterX > car.x &&
          frogCenterX < car.x + car.width &&
          frogCenterY > car.y &&
          frogCenterY < car.y + car.height) {
        hitByObstacle();
        return;
      }
    }

    // Check if frog is in river area (y between 100 and 300)
    if (frogCenterY >= 100 && frogCenterY <= 300) {
      let onLog = false;

      for (const log of game.logs) {
        if (frogCenterX > log.x &&
            frogCenterX < log.x + log.width &&
            frogCenterY > log.y &&
            frogCenterY < log.y + log.height) {
          onLog = true;
          // Move frog with the log
          game.frog.x += log.speed;

          // Check if frog went off screen while on log
          if (game.frog.x < -game.frog.size || game.frog.x > CANVAS_WIDTH) {
            hitByObstacle();
            return;
          }
          break;
        }
      }

      // Frog drowned if not on a log
      if (!onLog) {
        hitByObstacle();
        return;
      }
    }
  }

  function hitByObstacle() {
    game.lives--;
    updateUI();
    resetFrogPosition();
    if (window.KLog) window.KLog.log('frogger_hit', { lives: game.lives });

    if (game.lives <= 0) {
      gameOver();
    }
  }

  function nextLevel() {
    game.level++;
    game.cars = createCars(game.level);
    game.logs = createLogs(game.level);
    resetFrogPosition();
    if (window.KLog) window.KLog.log('frogger_level_up', { level: game.level });
  }

  function gameOver() {
    game.running = false;
    if (window.KLog) window.KLog.log('frogger_game_over', { score: game.score, level: game.level });
    alert('Game Over! Score: ' + game.score);
  }

  function update() {
    if (game.paused || !game.running) return;

    game.animFrame++;

    // Handle keyboard input for smooth movement
    if (keys.left) {
      moveFrog(-5, 0);
    }
    if (keys.right) {
      moveFrog(5, 0);
    }
    if (keys.up) {
      moveFrog(0, -5);
    }
    if (keys.down) {
      moveFrog(0, 5);
    }

    // Move cars
    game.cars.forEach(car => {
      car.x += car.speed;

      // Wrap around screen
      if (car.speed > 0 && car.x > CANVAS_WIDTH) {
        car.x = -car.width;
      } else if (car.speed < 0 && car.x < -car.width) {
        car.x = CANVAS_WIDTH;
      }
    });

    // Move logs
    game.logs.forEach(log => {
      log.x += log.speed;

      // Wrap around screen
      if (log.speed > 0 && log.x > CANVAS_WIDTH) {
        log.x = -log.width;
      } else if (log.speed < 0 && log.x < -log.width) {
        log.x = CANVAS_WIDTH;
      }
    });

    checkCollisions();
  }

  function draw() {
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw safe zones
    ctx.fillStyle = '#228b22';
    ctx.fillRect(0, 550, CANVAS_WIDTH, 50); // Start zone
    ctx.fillRect(0, 0, CANVAS_WIDTH, 50);   // Goal zone
    ctx.fillRect(0, 300, CANVAS_WIDTH, 50); // Middle safe zone

    // Draw road
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 350, CANVAS_WIDTH, 200);

    // Draw river
    ctx.fillStyle = '#4169e1';
    ctx.fillRect(0, 100, CANVAS_WIDTH, 200);

    // Draw cars
    game.cars.forEach(car => {
      ctx.fillStyle = car.color;
      ctx.fillRect(car.x, car.y, car.width, car.height);
      // Add simple car details
      ctx.fillStyle = '#000';
      ctx.fillRect(car.x + 10, car.y + 5, car.width - 20, car.height - 10);
    });

    // Draw logs
    game.logs.forEach(log => {
      ctx.fillStyle = log.color;
      ctx.fillRect(log.x, log.y, log.width, log.height);
      // Add wood texture lines
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(log.x, log.y + (i + 1) * log.height / 4);
        ctx.lineTo(log.x + log.width, log.y + (i + 1) * log.height / 4);
        ctx.stroke();
      }
    });

    // Draw frog
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(
      game.frog.x + game.frog.size / 2,
      game.frog.y + game.frog.size / 2,
      game.frog.size / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Draw frog eyes
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(game.frog.x + 15, game.frog.y + 15, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(game.frog.x + 25, game.frog.y + 15, 5, 0, Math.PI * 2);
    ctx.fill();

    // Draw level indicator
    ctx.fillStyle = '#fff';
    ctx.font = '16px Poppins, sans-serif';
    ctx.fillText('Level: ' + game.level, 10, 30);
  }

  function gameLoop() {
    update();
    draw();
    if (game.running) {
      requestAnimationFrame(gameLoop);
    }
  }

  // Keyboard event listeners
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); keys.left = true; }
    if (e.key === 'ArrowRight') { e.preventDefault(); keys.right = true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); keys.up = true; }
    if (e.key === 'ArrowDown') { e.preventDefault(); keys.down = true; }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
    if (e.key === 'ArrowUp') keys.up = false;
    if (e.key === 'ArrowDown') keys.down = false;
  });

  // Button controls
  btnLeft.addEventListener('mousedown', () => keys.left = true);
  btnLeft.addEventListener('mouseup', () => keys.left = false);
  btnLeft.addEventListener('touchstart', (e) => { e.preventDefault(); keys.left = true; });
  btnLeft.addEventListener('touchend', (e) => { e.preventDefault(); keys.left = false; });

  btnRight.addEventListener('mousedown', () => keys.right = true);
  btnRight.addEventListener('mouseup', () => keys.right = false);
  btnRight.addEventListener('touchstart', (e) => { e.preventDefault(); keys.right = true; });
  btnRight.addEventListener('touchend', (e) => { e.preventDefault(); keys.right = false; });

  btnUp.addEventListener('mousedown', () => keys.up = true);
  btnUp.addEventListener('mouseup', () => keys.up = false);
  btnUp.addEventListener('touchstart', (e) => { e.preventDefault(); keys.up = true; });
  btnUp.addEventListener('touchend', (e) => { e.preventDefault(); keys.up = false; });

  btnDown.addEventListener('mousedown', () => keys.down = true);
  btnDown.addEventListener('mouseup', () => keys.down = false);
  btnDown.addEventListener('touchstart', (e) => { e.preventDefault(); keys.down = true; });
  btnDown.addEventListener('touchend', (e) => { e.preventDefault(); keys.down = false; });

  newGameBtn.addEventListener('click', init);

  // Auto-start
  init();
})();
