(function() {
  'use strict';

  if (window.KLog) window.KLog.log('missile_command_init', { timestamp: Date.now() });

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const citiesEl = document.getElementById('cities');
  const bestEl = document.getElementById('best');
  const newGameBtn = document.getElementById('new-game');
  const btnFireLeft = document.getElementById('btn-fire-left');
  const btnFireCenter = document.getElementById('btn-fire-center');
  const btnFireRight = document.getElementById('btn-fire-right');

  const BATTERY_POSITIONS = [
    { x: 50, y: 480 },
    { x: 290, y: 480 },
    { x: 530, y: 480 }
  ];

  let game = {
    running: false,
    paused: false,
    muted: false,
    score: 0,
    wave: 1,
    batteries: [],
    cities: [],
    enemyMissiles: [],
    playerMissiles: [],
    explosions: [],
    lastSpawn: 0,
    spawnDelay: 1500,
    missilesThisWave: 0,
    missileTargetForWave: 10,
    waveComplete: false
  };

  let best = parseInt(localStorage.getItem('missile-command-best') || '0');
  bestEl.textContent = best;

  // Game Shell integration
  window.GameShell = {
    isMuted: function() { return game.muted; },
    isPaused: function() { return game.paused; },
    setMuted: function(muted) {
      game.muted = muted;
      if (window.KLog) window.KLog.log('missile_command_mute', { muted });
    },
    setPaused: function(paused) {
      game.paused = paused;
      if (window.KLog) window.KLog.log('missile_command_pause', { paused });
    }
  };

  function createBatteries() {
    return BATTERY_POSITIONS.map((pos, index) => ({
      x: pos.x,
      y: pos.y,
      ammo: 30,
      active: true,
      id: index
    }));
  }

  function createCities() {
    const cities = [];
    const positions = [150, 200, 250, 330, 380, 430];
    positions.forEach(x => {
      cities.push({
        x: x,
        y: 470,
        width: 30,
        height: 20,
        alive: true
      });
    });
    return cities;
  }

  function init() {
    game.running = true;
    game.paused = false;
    game.score = 0;
    game.wave = 1;
    game.batteries = createBatteries();
    game.cities = createCities();
    game.enemyMissiles = [];
    game.playerMissiles = [];
    game.explosions = [];
    game.lastSpawn = Date.now();
    game.spawnDelay = 1500;
    game.missilesThisWave = 0;
    game.missileTargetForWave = 10;
    game.waveComplete = false;

    updateUI();
    if (window.KLog) window.KLog.log('missile_command_start', { wave: game.wave });
    gameLoop();
  }

  function updateUI() {
    scoreEl.textContent = game.score;
    const aliveCities = game.cities.filter(c => c.alive).length;
    citiesEl.textContent = aliveCities;
    if (game.score > best) {
      best = game.score;
      bestEl.textContent = best;
      localStorage.setItem('missile-command-best', best);
    }
  }

  function spawnEnemyMissile() {
    const targetX = Math.random() * canvas.width;
    const targetY = 470;
    const startX = Math.random() * canvas.width;
    const angle = Math.atan2(targetY, targetX - startX);

    game.enemyMissiles.push({
      x: startX,
      y: 0,
      targetX: targetX,
      targetY: targetY,
      speed: 1 + Math.random() * 0.5,
      angle: angle,
      trail: []
    });
  }

  function fireMissile(targetX, targetY, batteryIndex) {
    const battery = game.batteries[batteryIndex];
    if (!battery.active || battery.ammo <= 0) return;

    battery.ammo--;
    const dx = targetX - battery.x;
    const dy = targetY - battery.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = 5;

    game.playerMissiles.push({
      x: battery.x,
      y: battery.y,
      targetX: targetX,
      targetY: targetY,
      vx: (dx / distance) * speed,
      vy: (dy / distance) * speed,
      trail: []
    });

    if (window.KLog) window.KLog.log('missile_command_fire', {
      battery: batteryIndex,
      ammo: battery.ammo,
      targetX: Math.round(targetX),
      targetY: Math.round(targetY)
    });
  }

  function createExplosion(x, y, maxRadius = 40, isPlayer = false) {
    game.explosions.push({
      x: x,
      y: y,
      radius: 0,
      maxRadius: maxRadius,
      growing: true,
      age: 0,
      maxAge: isPlayer ? 60 : 30,
      isPlayer: isPlayer
    });
  }

  function update() {
    if (game.paused || !game.running) return;

    const now = Date.now();

    // Spawn enemy missiles (only if we haven't spawned all for this wave)
    if (!game.waveComplete && game.missilesThisWave < game.missileTargetForWave &&
        now - game.lastSpawn > game.spawnDelay) {
      spawnEnemyMissile();
      game.missilesThisWave++;
      game.lastSpawn = now;

      // Mark wave as complete when all missiles spawned
      if (game.missilesThisWave >= game.missileTargetForWave) {
        game.waveComplete = true;
      }
    }

    // Update enemy missiles
    game.enemyMissiles = game.enemyMissiles.filter(missile => {
      missile.trail.push({ x: missile.x, y: missile.y });
      if (missile.trail.length > 15) missile.trail.shift();

      const dx = missile.targetX - missile.x;
      const dy = missile.targetY - missile.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < missile.speed) {
        createExplosion(missile.targetX, missile.targetY, 30, false);

        // Check if missile hit a city
        game.cities.forEach(city => {
          if (city.alive &&
              Math.abs(missile.targetX - city.x - city.width/2) < city.width/2 &&
              Math.abs(missile.targetY - city.y - city.height/2) < city.height/2) {
            city.alive = false;
            if (window.KLog) window.KLog.log('missile_command_city_destroyed', {
              citiesRemaining: game.cities.filter(c => c.alive).length
            });
            updateUI();
          }
        });

        return false;
      }

      missile.x += (dx / distance) * missile.speed;
      missile.y += (dy / distance) * missile.speed;
      return true;
    });

    // Update player missiles
    game.playerMissiles = game.playerMissiles.filter(missile => {
      missile.trail.push({ x: missile.x, y: missile.y });
      if (missile.trail.length > 10) missile.trail.shift();

      missile.x += missile.vx;
      missile.y += missile.vy;

      const dx = missile.targetX - missile.x;
      const dy = missile.targetY - missile.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 5) {
        createExplosion(missile.targetX, missile.targetY, 40, true);
        return false;
      }

      return missile.y > 0 && missile.y < canvas.height;
    });

    // Update explosions
    game.explosions = game.explosions.filter(exp => {
      exp.age++;

      if (exp.growing && exp.radius < exp.maxRadius) {
        exp.radius += 2;
      } else {
        exp.growing = false;
        exp.radius = Math.max(0, exp.radius - 1);
      }

      // Check collision with enemy missiles
      if (exp.isPlayer) {
        game.enemyMissiles = game.enemyMissiles.filter(missile => {
          const dx = missile.x - exp.x;
          const dy = missile.y - exp.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < exp.radius) {
            game.score += 25;
            updateUI();
            createExplosion(missile.x, missile.y, 30, false);
            if (window.KLog) window.KLog.log('missile_command_hit', { score: game.score });
            return false;
          }
          return true;
        });
      }

      return exp.age < exp.maxAge;
    });

    // Check if wave is complete (all missiles spawned and cleared)
    if (game.waveComplete &&
        game.enemyMissiles.length === 0 &&
        game.explosions.filter(e => !e.isPlayer).length === 0) {
      const aliveCities = game.cities.filter(c => c.alive).length;
      if (aliveCities === 0) {
        gameOver();
      } else {
        // Advance to next wave
        game.waveComplete = false;
        setTimeout(() => {
          if (game.running) nextWave();
        }, 1000);
      }
    }

    // Check if all cities destroyed
    const aliveCities = game.cities.filter(c => c.alive).length;
    if (aliveCities === 0 && game.running) {
      gameOver();
    }
  }

  function nextWave() {
    game.wave++;
    game.score += game.cities.filter(c => c.alive).length * 100;
    game.score += game.batteries.reduce((sum, b) => sum + b.ammo, 0) * 5;

    // Replenish batteries
    game.batteries.forEach(b => {
      if (b.active) b.ammo = 30;
    });

    game.spawnDelay = Math.max(500, 1500 - game.wave * 100);
    game.lastSpawn = Date.now();
    game.missilesThisWave = 0;
    game.missileTargetForWave = Math.min(10 + game.wave * 2, 30);
    game.waveComplete = false;

    updateUI();
    if (window.KLog) window.KLog.log('missile_command_wave_complete', {
      wave: game.wave,
      score: game.score
    });
  }

  function gameOver() {
    game.running = false;
    if (window.KLog) window.KLog.log('missile_command_game_over', {
      score: game.score,
      wave: game.wave
    });
    setTimeout(() => {
      alert('Game Over! Score: ' + game.score + ' | Wave: ' + game.wave);
    }, 100);
  }

  function draw() {
    // Clear canvas with starfield effect
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw ground
    ctx.fillStyle = '#654321';
    ctx.fillRect(0, 480, canvas.width, 20);

    // Draw batteries
    game.batteries.forEach(battery => {
      if (battery.active) {
        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        ctx.arc(battery.x, battery.y, 8, 0, Math.PI * 2);
        ctx.fill();

        // Draw ammo count
        ctx.fillStyle = '#fff';
        ctx.font = '10px Poppins';
        ctx.textAlign = 'center';
        ctx.fillText(battery.ammo, battery.x, battery.y + 20);
      }
    });

    // Draw cities
    game.cities.forEach(city => {
      if (city.alive) {
        ctx.fillStyle = '#0099ff';
        ctx.fillRect(city.x, city.y, city.width, city.height);
      } else {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(city.x, city.y + 15, city.width, 5);
      }
    });

    // Draw enemy missiles
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    game.enemyMissiles.forEach(missile => {
      // Draw trail
      ctx.beginPath();
      missile.trail.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.lineTo(missile.x, missile.y);
      ctx.stroke();

      // Draw missile head
      ctx.fillStyle = '#ff0000';
      ctx.beginPath();
      ctx.arc(missile.x, missile.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw player missiles
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    game.playerMissiles.forEach(missile => {
      // Draw trail
      ctx.beginPath();
      missile.trail.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.lineTo(missile.x, missile.y);
      ctx.stroke();

      // Draw missile head
      ctx.fillStyle = '#00ff00';
      ctx.beginPath();
      ctx.arc(missile.x, missile.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw explosions
    game.explosions.forEach(exp => {
      const alpha = 1 - (exp.age / exp.maxAge);
      ctx.fillStyle = exp.isPlayer ?
        `rgba(255, 255, 0, ${alpha * 0.6})` :
        `rgba(255, 100, 0, ${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = exp.isPlayer ?
        `rgba(255, 200, 0, ${alpha})` :
        `rgba(255, 50, 0, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Draw wave info
    ctx.fillStyle = '#fff';
    ctx.font = '14px Poppins';
    ctx.textAlign = 'right';
    ctx.fillText('Wave ' + game.wave, canvas.width - 10, 20);
  }

  function gameLoop() {
    update();
    draw();
    if (game.running) {
      requestAnimationFrame(gameLoop);
    }
  }

  // Get closest battery to target
  function getClosestBattery(targetX) {
    let closestIndex = 0;
    let closestDistance = Math.abs(BATTERY_POSITIONS[0].x - targetX);

    BATTERY_POSITIONS.forEach((pos, index) => {
      const distance = Math.abs(pos.x - targetX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    return closestIndex;
  }

  // Canvas click handler
  canvas.addEventListener('click', (e) => {
    if (!game.running || game.paused) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const batteryIndex = getClosestBattery(x);
    fireMissile(x, y, batteryIndex);
  });

  // Button handlers
  btnFireLeft.addEventListener('click', () => {
    if (!game.running || game.paused) return;
    const targetX = 150;
    const targetY = 250;
    fireMissile(targetX, targetY, 0);
  });

  btnFireCenter.addEventListener('click', () => {
    if (!game.running || game.paused) return;
    const targetX = 300;
    const targetY = 250;
    fireMissile(targetX, targetY, 1);
  });

  btnFireRight.addEventListener('click', () => {
    if (!game.running || game.paused) return;
    const targetX = 450;
    const targetY = 250;
    fireMissile(targetX, targetY, 2);
  });

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
      gameId: 'missile-command',
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
  });
})();
