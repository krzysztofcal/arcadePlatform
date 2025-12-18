(function() {
  'use strict';

  if (window.KLog) window.KLog.log('galaga_init', { timestamp: Date.now() });

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
    wave: 1,
    player: { x: 280, y: 460, width: 30, height: 20, speed: 5 },
    bullets: [],
    enemies: [],
    divingEnemies: [],
    enemyBullets: [],
    animFrame: 0,
    lastShot: 0,
    enemiesKilledThisWave: 0,
    totalEnemiesThisWave: 0
  };

  let keys = { left: false, right: false, shoot: false };
  let best = parseInt(localStorage.getItem('galaga-best') || '0');
  bestEl.textContent = best;

  // Game Shell integration
  window.GameShell = {
    isMuted: function() { return game.muted; },
    isPaused: function() { return game.paused; },
    setMuted: function(muted) {
      game.muted = muted;
      if (window.KLog) window.KLog.log('galaga_mute', { muted });
    },
    setPaused: function(paused) {
      game.paused = paused;
      if (window.KLog) window.KLog.log('galaga_pause', { paused });
    }
  };

  function createEnemies(wave) {
    const enemies = [];
    const rows = 4;
    const cols = 8;
    const spacing = 60;
    const offsetX = 80;
    const offsetY = 60;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        enemies.push({
          x: offsetX + col * spacing,
          y: offsetY + row * spacing,
          baseX: offsetX + col * spacing,
          baseY: offsetY + row * spacing,
          width: 28,
          height: 28,
          alive: true,
          inFormation: true,
          type: row < 2 ? 'boss' : 'fighter',
          diving: false,
          divePhase: 0,
          returnPhase: 0
        });
      }
    }
    return enemies;
  }

  function init() {
    game.running = true;
    game.paused = false;
    game.score = 0;
    game.lives = 3;
    game.wave = 1;
    game.player = { x: 280, y: 460, width: 30, height: 20, speed: 5 };
    game.bullets = [];
    game.enemyBullets = [];
    game.enemies = createEnemies(game.wave);
    game.divingEnemies = [];
    game.animFrame = 0;
    game.lastShot = 0;
    game.enemiesKilledThisWave = 0;
    game.totalEnemiesThisWave = game.enemies.length;

    updateUI();
    if (window.KLog) window.KLog.log('galaga_start', { wave: game.wave });
    gameLoop();
  }

  function updateUI() {
    scoreEl.textContent = game.score;
    livesEl.textContent = game.lives;
    if (game.score > best) {
      best = game.score;
      bestEl.textContent = best;
      localStorage.setItem('galaga-best', best);
    }
  }

  function shoot() {
    const now = Date.now();
    if (now - game.lastShot < 250) return;
    game.lastShot = now;
    game.bullets.push({
      x: game.player.x + game.player.width / 2 - 2,
      y: game.player.y,
      width: 4,
      height: 12,
      speed: 8
    });
    if (window.KLog) window.KLog.log('galaga_shoot', { bulletCount: game.bullets.length });
  }

  function startDive() {
    const formationEnemies = game.enemies.filter(e => e.alive && e.inFormation && !e.diving);
    if (formationEnemies.length === 0) return;

    if (Math.random() < 0.015) {
      const enemy = formationEnemies[Math.floor(Math.random() * formationEnemies.length)];
      enemy.diving = true;
      enemy.inFormation = false;
      enemy.divePhase = 0;
      enemy.diveStartX = enemy.x;
      enemy.diveStartY = enemy.y;
      enemy.targetX = game.player.x;
      game.divingEnemies.push(enemy);
    }
  }

  function updateDivingEnemy(enemy) {
    if (!enemy.diving) return;

    enemy.divePhase += 0.05;

    if (enemy.returnPhase > 0) {
      // Returning to formation
      enemy.returnPhase += 0.03;
      const t = Math.min(enemy.returnPhase, 1);
      enemy.x = enemy.returnStartX + (enemy.baseX - enemy.returnStartX) * t;
      enemy.y = enemy.returnStartY + (enemy.baseY - enemy.returnStartY) * t;

      if (enemy.returnPhase >= 1) {
        enemy.diving = false;
        enemy.inFormation = true;
        enemy.returnPhase = 0;
        enemy.divePhase = 0;
        enemy.x = enemy.baseX;
        enemy.y = enemy.baseY;
        const index = game.divingEnemies.indexOf(enemy);
        if (index > -1) game.divingEnemies.splice(index, 1);
      }
    } else {
      // Dive bomb pattern
      const progress = enemy.divePhase;
      const amplitude = 80;
      const targetY = canvas.height + 50;

      if (progress < Math.PI) {
        // Swooping down
        enemy.x = enemy.diveStartX + Math.sin(progress * 2) * amplitude + (enemy.targetX - enemy.diveStartX) * (progress / Math.PI);
        enemy.y = enemy.diveStartY + (targetY - enemy.diveStartY) * (progress / Math.PI);
      } else {
        // Start returning
        enemy.returnPhase = 0.01;
        enemy.returnStartX = enemy.x;
        enemy.returnStartY = -30;
        enemy.y = enemy.returnStartY;
      }

      // Shoot during dive
      if (Math.random() < 0.03 && enemy.y < canvas.height) {
        game.enemyBullets.push({
          x: enemy.x + enemy.width / 2 - 2,
          y: enemy.y + enemy.height,
          width: 4,
          height: 10,
          speed: 4
        });
      }
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

    game.enemyBullets = game.enemyBullets.filter(bullet => {
      bullet.y += bullet.speed;
      return bullet.y < canvas.height;
    });

    // Animate formation enemies
    game.animFrame++;
    if (game.animFrame % 60 === 0) {
      game.enemies.forEach(enemy => {
        if (enemy.alive && enemy.inFormation) {
          enemy.x = enemy.baseX + Math.sin(game.animFrame / 30) * 10;
        }
      });
    }

    // Start random dives
    startDive();

    // Update diving enemies
    game.divingEnemies.forEach(updateDivingEnemy);

    // Check bullet collisions with enemies
    game.bullets.forEach((bullet, bIndex) => {
      game.enemies.forEach((enemy, eIndex) => {
        if (!enemy.alive) return;
        if (bullet.x < enemy.x + enemy.width &&
            bullet.x + bullet.width > enemy.x &&
            bullet.y < enemy.y + enemy.height &&
            bullet.y + bullet.height > enemy.y) {
          enemy.alive = false;
          game.bullets.splice(bIndex, 1);
          const points = enemy.type === 'boss' ? 150 : 100;
          game.score += points;
          game.enemiesKilledThisWave++;
          updateUI();
          if (window.KLog) window.KLog.log('galaga_hit', { score: game.score, type: enemy.type, points });
        }
      });
    });

    // Check enemy bullet hits player
    game.enemyBullets.forEach((bullet, bIndex) => {
      if (bullet.x < game.player.x + game.player.width &&
          bullet.x + bullet.width > game.player.x &&
          bullet.y < game.player.y + game.player.height &&
          bullet.y + bullet.height > game.player.y) {
        game.lives--;
        game.enemyBullets.splice(bIndex, 1);
        updateUI();
        if (window.KLog) window.KLog.log('galaga_hit_player', { lives: game.lives });
        if (game.lives <= 0) {
          gameOver();
        }
      }
    });

    // Check enemy collision with player
    game.enemies.forEach(enemy => {
      if (!enemy.alive) return;
      if (enemy.x < game.player.x + game.player.width &&
          enemy.x + enemy.width > game.player.x &&
          enemy.y < game.player.y + game.player.height &&
          enemy.y + enemy.height > game.player.y) {
        game.lives--;
        enemy.alive = false;
        updateUI();
        if (window.KLog) window.KLog.log('galaga_collision', { lives: game.lives });
        if (game.lives <= 0) {
          gameOver();
        }
      }
    });

    // Check if wave complete
    if (game.enemiesKilledThisWave >= game.totalEnemiesThisWave) {
      nextWave();
    }
  }

  function nextWave() {
    game.wave++;
    game.enemies = createEnemies(game.wave);
    game.divingEnemies = [];
    game.bullets = [];
    game.enemyBullets = [];
    game.enemiesKilledThisWave = 0;
    game.totalEnemiesThisWave = game.enemies.length;
    if (window.KLog) window.KLog.log('galaga_wave_complete', { wave: game.wave });
  }

  function gameOver() {
    game.running = false;
    if (window.KLog) window.KLog.log('galaga_game_over', { score: game.score, wave: game.wave });
    alert('Game Over! Score: ' + game.score + ' | Wave: ' + game.wave);
  }

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw player
    ctx.fillStyle = '#0f0';
    ctx.beginPath();
    ctx.moveTo(game.player.x + game.player.width / 2, game.player.y);
    ctx.lineTo(game.player.x, game.player.y + game.player.height);
    ctx.lineTo(game.player.x + game.player.width, game.player.y + game.player.height);
    ctx.closePath();
    ctx.fill();

    // Draw bullets
    ctx.fillStyle = '#fff';
    game.bullets.forEach(bullet => {
      ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });

    // Draw enemy bullets
    ctx.fillStyle = '#ff0';
    game.enemyBullets.forEach(bullet => {
      ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });

    // Draw enemies
    game.enemies.forEach(enemy => {
      if (!enemy.alive) return;

      if (enemy.type === 'boss') {
        ctx.fillStyle = '#f0f';
      } else {
        ctx.fillStyle = '#0ff';
      }

      // Draw simple enemy shape
      ctx.beginPath();
      ctx.arc(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, enemy.width / 2, 0, Math.PI * 2);
      ctx.fill();

      // Draw wings
      ctx.fillRect(enemy.x, enemy.y + enemy.height / 2 - 2, enemy.width, 4);
    });

    // Draw wave indicator
    ctx.fillStyle = '#fff';
    ctx.font = '14px Poppins, sans-serif';
    ctx.fillText('Wave ' + game.wave, 10, 20);
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
