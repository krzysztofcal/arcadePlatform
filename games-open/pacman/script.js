(function() {
  "use strict";

  var canvas = document.getElementById("board");
  var ctx = canvas.getContext("2d");
  var tileSize = 16;
  var cols = 28;
  var rows = 26;
  var scoreEl = document.getElementById("score");
  var livesEl = document.getElementById("lives");
  var startBtn = document.getElementById("start");
  var pauseBtn = document.getElementById("pause");
  var resetBtn = document.getElementById("reset");
  var overlay = document.getElementById("gameOverlay");
  var pad = document.getElementById("pacpad");
  var walls = [];
  var pellets = new Set();
  var energizers = new Set();
  var enemyDefaults = [
    { x: 13, y: 11 },
    { x: 14, y: 11 },
    { x: 13, y: 12 },
    { x: 14, y: 12 }
  ];
  var playerSpawn = { x: 13, y: 22 };
  var player = {
    tileX: playerSpawn.x,
    tileY: playerSpawn.y,
    dir: { x: 0, y: 0 },
    nextDir: { x: 0, y: 0 },
    progress: 0,
    speed: 6.5,
    lives: 3
  };
  var enemies = [];
  var score = 0;
  var pelletTotal = 0;
  var running = false;
  var paused = false;
  var lastTime = 0;
  var touchStart = null;
  var directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  buildMaze();
  resetGame();
  showOverlay("Ready", "Press start to play");
  requestAnimationFrame(loop);

  startBtn.addEventListener("click", function() {
    if (!running) {
      running = true;
      paused = false;
      hideOverlay();
    } else if (paused) {
      paused = false;
      hideOverlay();
    }
  });

  pauseBtn.addEventListener("click", function() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      showOverlay("Paused", "Tap start to resume");
    } else {
      hideOverlay();
    }
  });

  resetBtn.addEventListener("click", function() {
    resetGame();
    running = false;
    paused = false;
    showOverlay("Reset", "Press start to play");
  });

  pad.addEventListener("pointerdown", function(event) {
    var dir = event.target.dataset.dir;
    if (!dir) return;
    event.preventDefault();
    setDirection(dir);
  });

  canvas.addEventListener("touchstart", function(event) {
    if (event.touches.length !== 1) return;
    touchStart = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY
    };
  }, { passive: true });

  canvas.addEventListener("touchmove", function(event) {
    if (event.touches.length !== 1) return;
    event.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchend", function(event) {
    if (!touchStart || event.changedTouches.length !== 1) return;
    var dx = event.changedTouches[0].clientX - touchStart.x;
    var dy = event.changedTouches[0].clientY - touchStart.y;
    var absX = Math.abs(dx);
    var absY = Math.abs(dy);
    if (Math.max(absX, absY) > 18) {
      setDirection(absX > absY ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    }
    touchStart = null;
  });

  document.addEventListener("keydown", function(event) {
    var map = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
      W: "up",
      S: "down",
      A: "left",
      D: "right"
    };
    var dir = map[event.key];
    if (!dir) return;
    event.preventDefault();
    setDirection(dir);
  });

  function buildMaze() {
    var y;
    var x;
    for (y = 0; y < rows; y += 1) {
      walls[y] = [];
      for (x = 0; x < cols; x += 1) {
        walls[y][x] = y === 0 || y === rows - 1 || x === 0 || x === cols - 1;
      }
    }

    addWallRect(3, 3, 4, 2);
    addWallRect(10, 3, 3, 2);
    addWallRect(15, 3, 3, 2);
    addWallRect(21, 3, 4, 2);
    addWallRect(3, 7, 4, 2);
    addWallRect(10, 7, 8, 2);
    addWallRect(21, 7, 4, 2);
    addWallRect(8, 11, 4, 4);
    addWallRect(16, 11, 4, 4);
    addWallRect(3, 17, 4, 2);
    addWallRect(10, 17, 8, 2);
    addWallRect(21, 17, 4, 2);
    addWallRect(3, 21, 4, 2);
    addWallRect(10, 21, 3, 2);
    addWallRect(15, 21, 3, 2);
    addWallRect(21, 21, 4, 2);

    addWallLine(1, 13, 5, 13);
    addWallLine(22, 13, 26, 13);
    addWallLine(13, 1, 13, 4);
    addWallLine(14, 1, 14, 4);

    openTile(playerSpawn.x, playerSpawn.y);
    enemyDefaults.forEach(function(pos) { openTile(pos.x, pos.y); });
    verifyConnectedMaze();
    seedPellets();
  }

  function addWallRect(x, y, width, height) {
    var yy;
    var xx;
    for (yy = y; yy < y + height; yy += 1) {
      for (xx = x; xx < x + width; xx += 1) {
        walls[yy][xx] = true;
      }
    }
  }

  function addWallLine(x1, y1, x2, y2) {
    var x = x1;
    var y = y1;
    var dx = x2 === x1 ? 0 : (x2 > x1 ? 1 : -1);
    var dy = y2 === y1 ? 0 : (y2 > y1 ? 1 : -1);
    while (true) {
      walls[y][x] = true;
      if (x === x2 && y === y2) break;
      x += dx;
      y += dy;
    }
  }

  function openTile(x, y) {
    walls[y][x] = false;
  }

  function seedPellets() {
    pellets.clear();
    energizers.clear();
    for (var y = 1; y < rows - 1; y += 1) {
      for (var x = 1; x < cols - 1; x += 1) {
        if (walls[y][x] || isSpawnTile(x, y)) continue;
        pellets.add(tileKey(x, y));
      }
    }
    [
      { x: 1, y: 1 },
      { x: cols - 2, y: 1 },
      { x: 1, y: rows - 2 },
      { x: cols - 2, y: rows - 2 }
    ].forEach(function(pos) {
      var key = tileKey(pos.x, pos.y);
      if (!walls[pos.y][pos.x]) {
        pellets.delete(key);
        energizers.add(key);
      }
    });
    pelletTotal = pellets.size + energizers.size;
  }

  function verifyConnectedMaze() {
    var start = null;
    var floorCount = 0;
    var y;
    var x;
    for (y = 0; y < rows; y += 1) {
      for (x = 0; x < cols; x += 1) {
        if (!walls[y][x]) {
          floorCount += 1;
          if (!start) start = { x: x, y: y };
        }
      }
    }
    var seen = flood(start);
    if (seen.size !== floorCount && window.KLog && typeof window.KLog.warn === "function") {
      window.KLog.warn("maze-muncher", "maze connectivity check failed", { reachable: seen.size, floor: floorCount });
    }
  }

  function flood(start) {
    var queue = [start];
    var seen = new Set([tileKey(start.x, start.y)]);
    for (var i = 0; i < queue.length; i += 1) {
      var current = queue[i];
      directions.forEach(function(dir) {
        var nx = current.x + dir.x;
        var ny = current.y + dir.y;
        var key = tileKey(nx, ny);
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || walls[ny][nx] || seen.has(key)) return;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      });
    }
    return seen;
  }

  function isSpawnTile(x, y) {
    if (x === playerSpawn.x && y === playerSpawn.y) return true;
    return enemyDefaults.some(function(pos) { return pos.x === x && pos.y === y; });
  }

  function resetGame() {
    score = 0;
    player.lives = 3;
    player.tileX = playerSpawn.x;
    player.tileY = playerSpawn.y;
    player.dir = { x: 0, y: 0 };
    player.nextDir = { x: 0, y: 0 };
    player.progress = 0;
    enemies = enemyDefaults.map(function(pos, index) {
      return {
        tileX: pos.x,
        tileY: pos.y,
        dir: { x: 0, y: 0 },
        progress: 0,
        speed: 4.1 + index * 0.25,
        vulnerable: 0,
        color: ["#fb7185", "#38bdf8", "#f59e0b", "#34d399"][index]
      };
    });
    seedPellets();
    livesEl.textContent = player.lives;
    updateScoreDisplay();
  }

  function setDirection(name) {
    var mapping = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };
    if (!mapping[name]) return;
    player.nextDir = mapping[name];
    if (!running) {
      running = true;
      paused = false;
      hideOverlay();
    }
  }

  function update(delta) {
    movePlayer(delta);
    enemies.forEach(function(enemy) { moveEnemy(enemy, delta); });
    enemies.forEach(checkCollision);
    if (pelletTotal === 0) {
      running = false;
      showOverlay("Maze cleared", "Press reset to play again");
    }
  }

  function movePlayer(delta) {
    if (player.progress === 0) {
      if (canMove(player.tileX, player.tileY, player.nextDir)) {
        player.dir = { x: player.nextDir.x, y: player.nextDir.y };
      }
      if (!canMove(player.tileX, player.tileY, player.dir)) {
        player.dir = { x: 0, y: 0 };
      }
    }
    if (player.dir.x === 0 && player.dir.y === 0) return;
    player.progress += player.speed * delta;
    while (player.progress >= 1) {
      player.tileX += player.dir.x;
      player.tileY += player.dir.y;
      player.progress -= 1;
      eatPellet(player.tileX, player.tileY);
      if (!canMove(player.tileX, player.tileY, player.dir)) {
        player.progress = 0;
        break;
      }
    }
  }

  function moveEnemy(enemy, delta) {
    if (enemy.progress === 0) {
      enemy.dir = chooseEnemyDirection(enemy);
    }
    if (enemy.dir.x === 0 && enemy.dir.y === 0) return;
    enemy.progress += (enemy.vulnerable > 0 ? enemy.speed * 0.62 : enemy.speed) * delta;
    while (enemy.progress >= 1) {
      enemy.tileX += enemy.dir.x;
      enemy.tileY += enemy.dir.y;
      enemy.progress -= 1;
      if (!canMove(enemy.tileX, enemy.tileY, enemy.dir)) {
        enemy.progress = 0;
        break;
      }
    }
    if (enemy.vulnerable > 0) {
      enemy.vulnerable = Math.max(0, enemy.vulnerable - delta);
    }
  }

  function chooseEnemyDirection(enemy) {
    var target = enemy.vulnerable > 0 ? farthestNeighbor(enemy) : nextStepToward(enemy, player.tileX, player.tileY);
    if (target) return target;
    var options = directions.filter(function(dir) { return canMove(enemy.tileX, enemy.tileY, dir); });
    return options[Math.floor(Math.random() * options.length)] || { x: 0, y: 0 };
  }

  function nextStepToward(enemy, targetX, targetY) {
    var origin = { x: enemy.tileX, y: enemy.tileY };
    var targetKey = tileKey(targetX, targetY);
    var queue = [origin];
    var seen = new Set([tileKey(origin.x, origin.y)]);
    var parent = Object.create(null);
    for (var i = 0; i < queue.length; i += 1) {
      var current = queue[i];
      if (tileKey(current.x, current.y) === targetKey) break;
      directions.forEach(function(dir) {
        var nx = current.x + dir.x;
        var ny = current.y + dir.y;
        var key = tileKey(nx, ny);
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || walls[ny][nx] || seen.has(key)) return;
        seen.add(key);
        parent[key] = tileKey(current.x, current.y);
        queue.push({ x: nx, y: ny });
      });
    }
    if (!seen.has(targetKey)) return null;
    var stepKey = targetKey;
    var originKey = tileKey(origin.x, origin.y);
    while (parent[stepKey] && parent[stepKey] !== originKey) {
      stepKey = parent[stepKey];
    }
    var step = parseKey(stepKey);
    return { x: step.x - origin.x, y: step.y - origin.y };
  }

  function farthestNeighbor(enemy) {
    var options = directions.filter(function(dir) { return canMove(enemy.tileX, enemy.tileY, dir); });
    var best = null;
    var bestDistance = -1;
    options.forEach(function(dir) {
      var nx = enemy.tileX + dir.x;
      var ny = enemy.tileY + dir.y;
      var distance = Math.abs(nx - player.tileX) + Math.abs(ny - player.tileY);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = dir;
      }
    });
    return best;
  }

  function canMove(x, y, dir) {
    if (!dir) return false;
    var nx = x + dir.x;
    var ny = y + dir.y;
    return nx >= 0 && nx < cols && ny >= 0 && ny < rows && !walls[ny][nx];
  }

  function eatPellet(x, y) {
    var key = tileKey(x, y);
    if (pellets.has(key)) {
      pellets.delete(key);
      pelletTotal -= 1;
      score += 10;
    } else if (energizers.has(key)) {
      energizers.delete(key);
      pelletTotal -= 1;
      score += 50;
      enemies.forEach(function(enemy) { enemy.vulnerable = 7; });
    }
    updateScoreDisplay();
  }

  function checkCollision(enemy) {
    var playerX = player.tileX + player.dir.x * player.progress;
    var playerY = player.tileY + player.dir.y * player.progress;
    var enemyX = enemy.tileX + enemy.dir.x * enemy.progress;
    var enemyY = enemy.tileY + enemy.dir.y * enemy.progress;
    if (Math.hypot(playerX - enemyX, playerY - enemyY) >= 0.55) return;
    if (enemy.vulnerable > 0) {
      score += 200;
      resetEnemy(enemy);
      updateScoreDisplay();
      return;
    }
    loseLife();
  }

  function resetEnemy(enemy) {
    var index = enemies.indexOf(enemy);
    var spawn = enemyDefaults[index] || enemyDefaults[0];
    enemy.tileX = spawn.x;
    enemy.tileY = spawn.y;
    enemy.dir = { x: 0, y: 0 };
    enemy.progress = 0;
    enemy.vulnerable = 0;
  }

  function loseLife() {
    player.lives -= 1;
    livesEl.textContent = player.lives;
    if (player.lives <= 0) {
      running = false;
      showOverlay("Game over", "Press reset to try again");
      return;
    }
    player.tileX = playerSpawn.x;
    player.tileY = playerSpawn.y;
    player.dir = { x: 0, y: 0 };
    player.nextDir = { x: 0, y: 0 };
    player.progress = 0;
    enemies.forEach(resetEnemy);
  }

  function updateScoreDisplay() {
    scoreEl.textContent = score;
    if (typeof window.reportScoreToPortal === "function") {
      try { window.reportScoreToPortal("pacman", score); } catch (_error) {}
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMaze();
    drawPellets();
    drawEnemies();
    drawPlayer();
  }

  function drawMaze() {
    ctx.fillStyle = "#050816";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var y = 0; y < rows; y += 1) {
      for (var x = 0; x < cols; x += 1) {
        if (!walls[y][x]) continue;
        var px = x * tileSize;
        var py = y * tileSize;
        var gradient = ctx.createLinearGradient(px, py, px + tileSize, py + tileSize);
        gradient.addColorStop(0, "#1d4ed8");
        gradient.addColorStop(1, "#0f766e");
        ctx.fillStyle = gradient;
        ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
      }
    }
  }

  function drawPellets() {
    pellets.forEach(function(key) {
      var pos = parseKey(key);
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(pos.x * tileSize + tileSize / 2, pos.y * tileSize + tileSize / 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    energizers.forEach(function(key) {
      var pos = parseKey(key);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(pos.x * tileSize + tileSize / 2, pos.y * tileSize + tileSize / 2, 5.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPlayer() {
    var x = (player.tileX + player.dir.x * player.progress) * tileSize + tileSize / 2;
    var y = (player.tileY + player.dir.y * player.progress) * tileSize + tileSize / 2;
    var angle = player.dir.x === 0 && player.dir.y === 0 ? 0 : Math.atan2(player.dir.y, player.dir.x);
    var mouth = player.dir.x === 0 && player.dir.y === 0 ? 0.18 : 0.32;
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, tileSize / 2 - 1.5, angle + mouth, angle - mouth + Math.PI * 2, false);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(x + 2, y - 4, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemies() {
    enemies.forEach(function(enemy) {
      var x = (enemy.tileX + enemy.dir.x * enemy.progress) * tileSize + tileSize / 2;
      var y = (enemy.tileY + enemy.dir.y * enemy.progress) * tileSize + tileSize / 2;
      ctx.fillStyle = enemy.vulnerable > 0 ? "#60a5fa" : enemy.color;
      ctx.beginPath();
      ctx.roundRect(x - 6, y - 7, 12, 14, 4);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(x - 2.5, y - 2, 1.7, 0, Math.PI * 2);
      ctx.arc(x + 2.5, y - 2, 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function showOverlay(title, subtitle) {
    overlay.hidden = false;
    overlay.textContent = "";
    var titleEl = document.createElement("div");
    titleEl.textContent = title;
    overlay.appendChild(titleEl);
    if (subtitle) {
      var subtitleEl = document.createElement("div");
      subtitleEl.className = "overlay-subtitle";
      subtitleEl.textContent = subtitle;
      overlay.appendChild(subtitleEl);
    }
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function loop(time) {
    var delta = Math.min((time - lastTime) / 1000 || 0, 0.05);
    lastTime = time;
    if (running && !paused) update(delta);
    draw();
    requestAnimationFrame(loop);
  }

  function tileKey(x, y) {
    return x + "," + y;
  }

  function parseKey(key) {
    var parts = key.split(",");
    return { x: Number(parts[0]), y: Number(parts[1]) };
  }

  if (window.GameShell && typeof window.GameShell.registerControls === "function") {
    window.GameShell.registerControls({
      onPause: function() {
        if (running && !paused) {
          paused = true;
          showOverlay("Paused", "Tap start to resume");
        }
      },
      onResume: function() {
        if (paused) {
          paused = false;
          hideOverlay();
        }
      },
      onMute: function() {},
      onUnmute: function() {}
    });
  }
}());
