(function() {
  'use strict';

  if (window.KLog) window.KLog.log('space_invaders_init', { timestamp: Date.now() });

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const bestEl = document.getElementById('best');
  const newGameBtn = document.getElementById('new-game');
  const btnLeft = document.getElementById('btn-left');
  const btnShoot = document.getElementById('btn-shoot');
  const btnRight = document.getElementById('btn-right');

  let game = {
    running: false,
    paused: false,
    muted: false,
    score: 0,
    lives: 3,
    level: 1,
    player: { x: 270, y: 450, width: 40, height: 30, speed: 5 },
    bullets: [],
    invaders: [],
    invaderBullets: [],
    shields: [],
    invaderSpeed: 1,
    invaderDirection: 1,
    lastShot: 0,
    animFrame: 0
  };

  let keys = { left: false, right: false, shoot: false };
  let best = parseInt(localStorage.getItem('space-invaders-best') || '0');
  bestEl.textContent = best;

  // Game Shell integration
  window.GameShell = {
    isMuted: function() { return game.muted; },
    isPaused: function() { return game.paused; },
    setMuted: function(muted) {
      game.muted = muted;
      if (window.KLog) window.KLog.log('space_invaders_mute', { muted });
    },
    setPaused: function(paused) {
      game.paused = paused;
      if (window.KLog) window.KLog.log('space_invaders_pause', { paused });
    }
  };

  function createInvaders() {
    const invaders = [];
    const rows = 5;
    const cols = 11;
    const spacing = 50;
    const offsetX = 50;
    const offsetY = 50;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        invaders.push({
          x: offsetX + col * spacing,
          y: offsetY + row * spacing,
          width: 30,
          height: 30,
          alive: true,
          type: row < 2 ? 3 : row < 4 ? 2 : 1
        });
      }
    }
    return invaders;
  }

  function createShields() {
    const shields = [];
    const shieldY = 380;
    for (let i = 0; i < 4; i++) {
      shields.push({
        x: 80 + i * 140,
        y: shieldY,
        width: 60,
        height: 40,
        health: 5
      });
    }
    return shields;
  }

  function init() {
    game.running = true;
    game.paused = false;
    game.score = 0;
    game.lives = 3;
    game.level = 1;
    game.player = { x: 270, y: 450, width: 40, height: 30, speed: 5 };
    game.bullets = [];
    game.invaderBullets = [];
    game.invaders = createInvaders();
    game.shields = createShields();
    game.invaderSpeed = 1;
    game.invaderDirection = 1;
    game.lastShot = 0;
    game.animFrame = 0;

    updateUI();
    if (window.KLog) window.KLog.log('space_invaders_start', { level: game.level });
    gameLoop();
  }

  function updateUI() {
    scoreEl.textContent = game.score;
    livesEl.textContent = game.lives;
    if (game.score > best) {
      best = game.score;
      bestEl.textContent = best;
      localStorage.setItem('space-invaders-best', best);
    }
  }

  function shoot() {
    const now = Date.now();
    if (now - game.lastShot < 300) return;
    game.lastShot = now;
    game.bullets.push({
      x: game.player.x + game.player.width / 2 - 2,
      y: game.player.y,
      width: 4,
      height: 15,
      speed: 7
    });
    if (window.KLog) window.KLog.log('space_invaders_shoot', { bulletCount: game.bullets.length });
  }

  function invaderShoot() {
    const aliveInvaders = game.invaders.filter(inv => inv.alive);
    if (aliveInvaders.length === 0) return;

    if (Math.random() < 0.15) {
      const invader = aliveInvaders[Math.floor(Math.random() * aliveInvaders.length)];
      game.invaderBullets.push({
        x: invader.x + invader.width / 2 - 2,
        y: invader.y + invader.height,
        width: 4,
        height: 15,
        speed: 3
      });
    }
  }

  function update() {
    if (game.paused || !game.running) return;

    // Move player
    if (keys.left && game.player.x > 0) {
      game.player.x -= game.player.speed;
    }
    if (keys.right && game.player.x < canvas.width - game.player.width) {
      game.player.x += game.player.speed;
    }
    if (keys.shoot) {
      shoot();
    }

    // Move bullets
    game.bullets = game.bullets.filter(bullet => {
      bullet.y -= bullet.speed;
      return bullet.y > 0;
    });

    game.invaderBullets = game.invaderBullets.filter(bullet => {
      bullet.y += bullet.speed;
      return bullet.y < canvas.height;
    });

    // Move invaders
    game.animFrame++;
    if (game.animFrame % 30 === 0) {
      let hitEdge = false;
      game.invaders.forEach(inv => {
        if (!inv.alive) return;
        inv.x += game.invaderSpeed * game.invaderDirection;
        if (inv.x <= 0 || inv.x >= canvas.width - inv.width) {
          hitEdge = true;
        }
      });

      if (hitEdge) {
        game.invaderDirection *= -1;
        game.invaders.forEach(inv => {
          if (inv.alive) inv.y += 20;
        });
      }

      invaderShoot();
    }

    // Check bullet collisions with invaders
    game.bullets.forEach((bullet, bIndex) => {
      game.invaders.forEach((inv, iIndex) => {
        if (!inv.alive) return;
        if (bullet.x < inv.x + inv.width &&
            bullet.x + bullet.width > inv.x &&
            bullet.y < inv.y + inv.height &&
            bullet.y + bullet.height > inv.y) {
          inv.alive = false;
          game.bullets.splice(bIndex, 1);
          game.score += inv.type * 10;
          updateUI();
          if (window.KLog) window.KLog.log('space_invaders_hit', { score: game.score, type: inv.type });
        }
      });
    });

    // Check bullet collisions with shields
    [...game.bullets, ...game.invaderBullets].forEach((bullet, bIndex) => {
      game.shields.forEach((shield, sIndex) => {
        if (shield.health <= 0) return;
        if (bullet.x < shield.x + shield.width &&
            bullet.x + bullet.width > shield.x &&
            bullet.y < shield.y + shield.height &&
            bullet.y + bullet.height > shield.y) {
          shield.health--;
          if (game.bullets.includes(bullet)) {
            game.bullets.splice(bIndex, 1);
          } else {
            game.invaderBullets.splice(bIndex, 1);
          }
        }
      });
    });

    // Check invader bullet hits player
    game.invaderBullets.forEach((bullet, bIndex) => {
      if (bullet.x < game.player.x + game.player.width &&
          bullet.x + bullet.width > game.player.x &&
          bullet.y < game.player.y + game.player.height &&
          bullet.y + bullet.height > game.player.y) {
        game.lives--;
        game.invaderBullets.splice(bIndex, 1);
        updateUI();
        if (window.KLog) window.KLog.log('space_invaders_hit_player', { lives: game.lives });
        if (game.lives <= 0) {
          gameOver();
        }
      }
    });

    // Check if all invaders destroyed
    const aliveInvaders = game.invaders.filter(inv => inv.alive);
    if (aliveInvaders.length === 0) {
      nextLevel();
    }

    // Check if invaders reached bottom
    aliveInvaders.forEach(inv => {
      if (inv.y + inv.height >= game.player.y) {
        gameOver();
      }
    });
  }

  function nextLevel() {
    game.level++;
    game.invaders = createInvaders();
    game.shields = createShields();
    game.invaderSpeed += 0.5;
    game.bullets = [];
    game.invaderBullets = [];
    if (window.KLog) window.KLog.log('space_invaders_level_up', { level: game.level });
  }

  function gameOver() {
    game.running = false;
    if (window.KLog) window.KLog.log('space_invaders_game_over', { score: game.score, level: game.level });
    alert('Game Over! Score: ' + game.score);
  }

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw player
    ctx.fillStyle = '#0f0';
    ctx.fillRect(game.player.x, game.player.y, game.player.width, game.player.height);

    // Draw bullets
    ctx.fillStyle = '#fff';
    game.bullets.forEach(bullet => {
      ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });

    // Draw invader bullets
    ctx.fillStyle = '#f00';
    game.invaderBullets.forEach(bullet => {
      ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });

    // Draw invaders
    game.invaders.forEach(inv => {
      if (!inv.alive) return;
      if (inv.type === 3) ctx.fillStyle = '#f0f';
      else if (inv.type === 2) ctx.fillStyle = '#0ff';
      else ctx.fillStyle = '#ff0';
      ctx.fillRect(inv.x, inv.y, inv.width, inv.height);
    });

    // Draw shields
    ctx.fillStyle = '#0f0';
    game.shields.forEach(shield => {
      if (shield.health > 0) {
        ctx.globalAlpha = shield.health / 5;
        ctx.fillRect(shield.x, shield.y, shield.width, shield.height);
        ctx.globalAlpha = 1;
      }
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
    if (e.key === ' ') { e.preventDefault(); keys.shoot = true; }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
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

  btnShoot.addEventListener('click', () => shoot());
  btnShoot.addEventListener('touchstart', (e) => { e.preventDefault(); shoot(); });

  newGameBtn.addEventListener('click', init);

  // Auto-start
  init();
})();
