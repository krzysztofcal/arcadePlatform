(function() {
  'use strict';

  if (window.KLog) window.KLog.log('asteroids_init', { timestamp: Date.now() });

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const bestEl = document.getElementById('best');
  const newGameBtn = document.getElementById('new-game');
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnThrust = document.getElementById('btn-thrust');
  const btnShoot = document.getElementById('btn-shoot');

  let game = {
    running: false,
    paused: false,
    muted: false,
    score: 0,
    lives: 3,
    ship: { x: 300, y: 250, angle: 0, vx: 0, vy: 0, thrust: false },
    bullets: [],
    asteroids: [],
    lastShot: 0
  };

  let keys = { left: false, right: false, thrust: false, shoot: false };
  let best = parseInt(localStorage.getItem('asteroids-best') || '0');
  bestEl.textContent = best;

  // Game Shell integration
  window.GameShell = {
    isMuted: function() { return game.muted; },
    isPaused: function() { return game.paused; },
    setMuted: function(muted) {
      game.muted = muted;
      if (window.KLog) window.KLog.log('asteroids_mute', { muted });
    },
    setPaused: function(paused) {
      game.paused = paused;
      if (window.KLog) window.KLog.log('asteroids_pause', { paused });
    }
  };

  function createAsteroids(count) {
    const asteroids = [];
    for (let i = 0; i < count; i++) {
      asteroids.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        size: 3,
        radius: 40
      });
    }
    return asteroids;
  }

  function init() {
    game.running = true;
    game.paused = false;
    game.score = 0;
    game.lives = 3;
    game.ship = { x: 300, y: 250, angle: 0, vx: 0, vy: 0, thrust: false };
    game.bullets = [];
    game.asteroids = createAsteroids(4);
    game.lastShot = 0;

    updateUI();
    if (window.KLog) window.KLog.log('asteroids_start', {});
    gameLoop();
  }

  function updateUI() {
    scoreEl.textContent = game.score;
    livesEl.textContent = game.lives;
    if (game.score > best) {
      best = game.score;
      bestEl.textContent = best;
      localStorage.setItem('asteroids-best', best);
    }
  }

  function shoot() {
    const now = Date.now();
    if (now - game.lastShot < 200) return;
    game.lastShot = now;

    const angle = game.ship.angle;
    game.bullets.push({
      x: game.ship.x,
      y: game.ship.y,
      vx: Math.cos(angle) * 10,
      vy: Math.sin(angle) * 10,
      life: 60
    });
    if (window.KLog) window.KLog.log('asteroids_shoot', { bulletCount: game.bullets.length });
  }

  function breakAsteroid(asteroid) {
    const points = asteroid.size === 3 ? 20 : asteroid.size === 2 ? 50 : 100;
    game.score += points;
    updateUI();

    if (asteroid.size > 1) {
      for (let i = 0; i < 2; i++) {
        game.asteroids.push({
          x: asteroid.x,
          y: asteroid.y,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          size: asteroid.size - 1,
          radius: asteroid.radius / 2
        });
      }
    }

    if (window.KLog) window.KLog.log('asteroids_break', { score: game.score, size: asteroid.size });
  }

  function update() {
    if (game.paused || !game.running) return;

    // Rotate ship
    if (keys.left) game.ship.angle -= 0.1;
    if (keys.right) game.ship.angle += 0.1;

    // Thrust
    if (keys.thrust) {
      game.ship.vx += Math.cos(game.ship.angle) * 0.2;
      game.ship.vy += Math.sin(game.ship.angle) * 0.2;
    }

    // Apply friction
    game.ship.vx *= 0.99;
    game.ship.vy *= 0.99;

    // Move ship
    game.ship.x += game.ship.vx;
    game.ship.y += game.ship.vy;

    // Wrap around screen
    if (game.ship.x < 0) game.ship.x = canvas.width;
    if (game.ship.x > canvas.width) game.ship.x = 0;
    if (game.ship.y < 0) game.ship.y = canvas.height;
    if (game.ship.y > canvas.height) game.ship.y = 0;

    // Shoot
    if (keys.shoot) shoot();

    // Move bullets
    game.bullets = game.bullets.filter(bullet => {
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      bullet.life--;
      return bullet.life > 0 && bullet.x > 0 && bullet.x < canvas.width && bullet.y > 0 && bullet.y < canvas.height;
    });

    // Move asteroids
    game.asteroids.forEach(asteroid => {
      asteroid.x += asteroid.vx;
      asteroid.y += asteroid.vy;

      if (asteroid.x < 0) asteroid.x = canvas.width;
      if (asteroid.x > canvas.width) asteroid.x = 0;
      if (asteroid.y < 0) asteroid.y = canvas.height;
      if (asteroid.y > canvas.height) asteroid.y = 0;
    });

    // Check bullet-asteroid collisions
    game.bullets.forEach((bullet, bIndex) => {
      game.asteroids.forEach((asteroid, aIndex) => {
        const dx = bullet.x - asteroid.x;
        const dy = bullet.y - asteroid.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < asteroid.radius) {
          breakAsteroid(asteroid);
          game.asteroids.splice(aIndex, 1);
          game.bullets.splice(bIndex, 1);
        }
      });
    });

    // Check ship-asteroid collisions
    game.asteroids.forEach((asteroid, aIndex) => {
      const dx = game.ship.x - asteroid.x;
      const dy = game.ship.y - asteroid.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < asteroid.radius + 15) {
        game.lives--;
        game.asteroids.splice(aIndex, 1);
        updateUI();
        if (window.KLog) window.KLog.log('asteroids_hit', { lives: game.lives });
        if (game.lives <= 0) {
          gameOver();
        } else {
          game.ship = { x: 300, y: 250, angle: 0, vx: 0, vy: 0, thrust: false };
        }
      }
    });

    // Check if all asteroids destroyed
    if (game.asteroids.length === 0) {
      game.asteroids = createAsteroids(Math.min(4 + Math.floor(game.score / 500), 10));
      if (window.KLog) window.KLog.log('asteroids_level_clear', { score: game.score });
    }
  }

  function gameOver() {
    game.running = false;
    if (window.KLog) window.KLog.log('asteroids_game_over', { score: game.score });
    alert('Game Over! Score: ' + game.score);
  }

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw ship
    ctx.save();
    ctx.translate(game.ship.x, game.ship.y);
    ctx.rotate(game.ship.angle);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.stroke();
    if (keys.thrust) {
      ctx.strokeStyle = '#f80';
      ctx.beginPath();
      ctx.moveTo(-10, -5);
      ctx.lineTo(-18, 0);
      ctx.lineTo(-10, 5);
      ctx.stroke();
    }
    ctx.restore();

    // Draw bullets
    ctx.fillStyle = '#fff';
    game.bullets.forEach(bullet => {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw asteroids
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    game.asteroids.forEach(asteroid => {
      ctx.beginPath();
      ctx.arc(asteroid.x, asteroid.y, asteroid.radius, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function gameLoop() {
    update();
    draw();
    if (game.running) {
      requestAnimationFrame(gameLoop);
    }
  }

  // Event listeners
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.left = true;
    if (e.key === 'ArrowRight') keys.right = true;
    if (e.key === 'ArrowUp') keys.thrust = true;
    if (e.key === ' ') { e.preventDefault(); keys.shoot = true; }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
    if (e.key === 'ArrowUp') keys.thrust = false;
    if (e.key === ' ') keys.shoot = false;
  });

  btnLeft.addEventListener('mousedown', () => keys.left = true);
  btnLeft.addEventListener('mouseup', () => keys.left = false);
  btnLeft.addEventListener('touchstart', (e) => { e.preventDefault(); keys.left = true; });
  btnLeft.addEventListener('touchend', (e) => { e.preventDefault(); keys.left = false; });

  btnRight.addEventListener('mousedown', () => keys.right = true);
  btnRight.addEventListener('mouseup', () => keys.right = false);
  btnRight.addEventListener('touchstart', (e) => { e.preventDefault(); keys.right = true; });
  btnRight.addEventListener('touchend', (e) => { e.preventDefault(); keys.right = false; });

  btnThrust.addEventListener('mousedown', () => keys.thrust = true);
  btnThrust.addEventListener('mouseup', () => keys.thrust = false);
  btnThrust.addEventListener('touchstart', (e) => { e.preventDefault(); keys.thrust = true; });
  btnThrust.addEventListener('touchend', (e) => { e.preventDefault(); keys.thrust = false; });

  btnShoot.addEventListener('click', () => shoot());
  btnShoot.addEventListener('touchstart', (e) => { e.preventDefault(); shoot(); });

  newGameBtn.addEventListener('click', init);

  // Auto-start
  init();

  // Initialize GameControlsService
  window.addEventListener('load', function() {
    if (!window.GameControlsService) return;
    const controls = window.GameControlsService({
      wrap: document.getElementById('gameWrap'),
      btnMute: document.getElementById('btnMute'),
      btnPause: document.getElementById('btnPause'),
      btnEnterFs: document.getElementById('btnEnterFs'),
      btnExitFs: document.getElementById('btnExitFs'),
      gameId: 'asteroids',
      onMuteChange: function(muted) {
        if (window.GameShell && window.GameShell.setMuted) window.GameShell.setMuted(muted);
      },
      onPauseChange: function(paused) {
        if (window.GameShell && window.GameShell.setPaused) window.GameShell.setPaused(paused);
      },
      isMutedProvider: function() { return window.GameShell && window.GameShell.isMuted ? window.GameShell.isMuted() : false; },
      isPausedProvider: function() { return window.GameShell && window.GameShell.isPaused ? window.GameShell.isPaused() : false; },
      isRunningProvider: function() { return true; }
    });
    controls.init();
    console.log('[ASTEROIDS] GameControlsService initialized from script.js');
  });
})();
