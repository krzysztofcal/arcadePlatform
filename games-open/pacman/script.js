const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const tileSize = 16;
const cols = 28;
const rows = 26;

const level = [
  "############################",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#o####.#####.##.#####.####o#",
  "#.####.#####.##.#####.####.#",
  "#..........................#",
  "#.####.##.########.##.####.#",
  "#.####.##.########.##.####.#",
  "#......##....##....##......#",
  "######.#####.##.#####.######",
  "#    #.#####.##.#####.#    #",
  "#    #.##          ##.#    #",
  "#####.##.###GGGG###.##.#####",
  "#o.......#        #.......o#",
  "######.##.########.##.######",
  "#    #.## ######## ##.#    #",
  "#    #.## ######## ##.#    #",
  "######.## ######## ##.######",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#o..##................##..o#",
  "###.##.##.########.##.##.###",
  "#......##....##....##......#",
  "#.##########.##.##########.#",
  "#........P.................#",
  "############################",
];

const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const startBtn = document.getElementById("start");
const pauseBtn = document.getElementById("pause");
const resetBtn = document.getElementById("reset");
const overlay = document.getElementById("gameOverlay");
const pacpad = document.getElementById("pacpad");

const pellets = new Set();
const energizers = new Set();
const initialPellets = [];
const initialEnergizers = [];
const walls = [];
const ghosts = [];
const ghostDefaults = [];

const pacman = {
  tileX: 13,
  tileY: 23,
  dir: { x: 0, y: 0 },
  nextDir: { x: 0, y: 0 },
  progress: 0,
  speed: 6,
  lives: 3,
};

let pacmanSpawn = { x: pacman.tileX, y: pacman.tileY };
let score = 0;
let running = false;
let paused = false;
let lastTime = 0;
let pelletTotal = 0;
let touchStart = null;

parseLevel();
resetGame();
showOverlay("Ready!", "Press start to play");

startBtn.addEventListener("click", () => {
  if (!running) {
    running = true;
    paused = false;
    hideOverlay();
  } else if (paused) {
    paused = false;
    hideOverlay();
  }
});

pauseBtn.addEventListener("click", () => {
  if (!running) return;
  paused = !paused;
  if (paused) {
    showOverlay("Paused", "Tap start to resume");
  } else {
    hideOverlay();
  }
});

resetBtn.addEventListener("click", () => {
  resetGame();
  running = false;
  paused = false;
  showOverlay("Reset", "Press start to play");
});

pacpad.addEventListener("pointerdown", (event) => {
  const dir = event.target.dataset.dir;
  if (!dir) return;
  event.preventDefault();
  setDirection(dir);
});

canvas.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 1) return;
  touchStart = {
    x: event.touches[0].clientX,
    y: event.touches[0].clientY,
  };
}, { passive: true });

canvas.addEventListener("touchmove", (event) => {
  if (event.touches.length !== 1) return;
  event.preventDefault();
}, { passive: false });

canvas.addEventListener("touchend", (event) => {
  if (!touchStart || event.changedTouches.length !== 1) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) > 18) {
    if (absX > absY) {
      setDirection(dx > 0 ? "right" : "left");
    } else {
      setDirection(dy > 0 ? "down" : "up");
    }
  }
  touchStart = null;
});

document.addEventListener("keydown", (event) => {
  const map = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    s: "down",
    a: "left",
    d: "right",
  };
  const dir = map[event.key];
  if (dir) {
    event.preventDefault();
    setDirection(dir);
  }
});

function setDirection(name) {
  const mapping = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const dir = mapping[name];
  if (!dir) return;
  pacman.nextDir = dir;
  if (!running) {
    running = true;
    paused = false;
    hideOverlay();
  }
}

function parseLevel() {
  for (let y = 0; y < rows; y++) {
    walls[y] = [];
    for (let x = 0; x < cols; x++) {
      const char = level[y][x];
      if (char === "#") {
        walls[y][x] = true;
      } else {
        walls[y][x] = false;
        if (char === ".") initialPellets.push({ x, y });
        else if (char === "o") initialEnergizers.push({ x, y });
        else if (char === "P") {
          pacman.tileX = x;
          pacman.tileY = y;
          pacmanSpawn = { x, y };
        } else if (char === "G") {
          if (ghostDefaults.length < 4) {
            ghostDefaults.push({ x, y });
          }
        }
      }
    }
  }
  ghostDefaults.forEach((pos, index) => {
    ghosts.push({
      tileX: pos.x,
      tileY: pos.y,
      dir: { x: 0, y: 0 },
      progress: 0,
      speed: 4 + index * 0.5,
      frightened: 0,
      color: ["#f97316", "#22d3ee", "#f472b6", "#4ade80"][index % 4],
    });
  });
  resetPellets();
}

function resetPellets() {
  pellets.clear();
  energizers.clear();
  initialPellets.forEach(({ x, y }) => pellets.add(`${x},${y}`));
  initialEnergizers.forEach(({ x, y }) => energizers.add(`${x},${y}`));
  pelletTotal = pellets.size + energizers.size;
}

function resetGame() {
  score = 0;
  pacman.lives = 3;
  pacman.dir = { x: 0, y: 0 };
  pacman.nextDir = { x: 0, y: 0 };
  pacman.progress = 0;
  pacman.tileX = pacmanSpawn.x;
  pacman.tileY = pacmanSpawn.y;
  ghosts.forEach((ghost, idx) => {
    const spawn = ghostDefaults[idx] || ghostDefaults[0];
    ghost.tileX = spawn.x;
    ghost.tileY = spawn.y;
    ghost.dir = { x: 0, y: 0 };
    ghost.progress = 0;
    ghost.frightened = 0;
  });
  resetPellets();
  scoreEl.textContent = score;
  livesEl.textContent = pacman.lives;
}

function update(delta) {
  movePacman(delta);
  ghosts.forEach((ghost) => moveGhost(ghost, delta));
  ghosts.forEach(checkCollision);
  if (!pelletTotal) {
    running = false;
    showOverlay("You win!", "Press reset to play again");
  }
}

function movePacman(delta) {
  if (pacman.progress === 0) {
    if (pacman.nextDir && canMove(pacman.tileX, pacman.tileY, pacman.nextDir)) {
      pacman.dir = { ...pacman.nextDir };
    }
    if (!canMove(pacman.tileX, pacman.tileY, pacman.dir)) {
      pacman.dir = { x: 0, y: 0 };
    }
  }
  if (pacman.dir.x === 0 && pacman.dir.y === 0) return;

  pacman.progress += pacman.speed * delta;
  if (pacman.progress >= 1) {
    pacman.tileX = wrap(pacman.tileX + pacman.dir.x, cols);
    pacman.tileY = wrap(pacman.tileY + pacman.dir.y, rows);
    pacman.progress = 0;
    eatPellet(pacman.tileX, pacman.tileY);
  }
}

function moveGhost(ghost, delta) {
  if (ghost.progress === 0) {
    const options = shuffle([
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]).filter((dir) => {
      if (ghost.dir && dir.x === -ghost.dir.x && dir.y === -ghost.dir.y) return false;
      return canMove(ghost.tileX, ghost.tileY, dir);
    });
    ghost.dir = options[0] || { x: -ghost.dir.x, y: -ghost.dir.y } || { x: 0, y: 0 };
  }
  if (ghost.dir.x === 0 && ghost.dir.y === 0) return;

  ghost.progress += (ghost.frightened > 0 ? ghost.speed * 0.6 : ghost.speed) * delta;
  if (ghost.progress >= 1) {
    ghost.tileX = wrap(ghost.tileX + ghost.dir.x, cols);
    ghost.tileY = wrap(ghost.tileY + ghost.dir.y, rows);
    ghost.progress = 0;
  }
  if (ghost.frightened > 0) {
    ghost.frightened = Math.max(0, ghost.frightened - delta);
  }
}

function canMove(x, y, dir) {
  if (!dir) return false;
  const nx = wrap(x + dir.x, cols);
  const ny = wrap(y + dir.y, rows);
  return !walls[ny][nx];
}

function eatPellet(x, y) {
  const key = `${x},${y}`;
  if (pellets.has(key)) {
    pellets.delete(key);
    pelletTotal--;
    score += 10;
  } else if (energizers.has(key)) {
    energizers.delete(key);
    pelletTotal--;
    score += 50;
    ghosts.forEach((ghost) => (ghost.frightened = 6));
  }
  scoreEl.textContent = score;
}

function checkCollision(ghost) {
  const pacX = pacman.tileX + pacman.dir.x * pacman.progress;
  const pacY = pacman.tileY + pacman.dir.y * pacman.progress;
  const ghostX = ghost.tileX + ghost.dir.x * ghost.progress;
  const ghostY = ghost.tileY + ghost.dir.y * ghost.progress;
  const dist = Math.hypot(pacX - ghostX, pacY - ghostY);
  if (dist < 0.5) {
    if (ghost.frightened > 0) {
      score += 200;
      const idx = ghosts.indexOf(ghost);
      const spawn = ghostDefaults[idx] || ghostDefaults[0];
      ghost.tileX = spawn.x;
      ghost.tileY = spawn.y;
      ghost.progress = 0;
      ghost.dir = { x: 0, y: 0 };
      ghost.frightened = 0;
    } else {
      loseLife();
    }
    scoreEl.textContent = score;
  }
}

function loseLife() {
  pacman.lives -= 1;
  livesEl.textContent = pacman.lives;
  if (pacman.lives <= 0) {
    running = false;
    showOverlay("Game over", "Press reset to try again");
    return;
  }
  pacman.tileX = pacmanSpawn.x;
  pacman.tileY = pacmanSpawn.y;
  pacman.dir = { x: 0, y: 0 };
  pacman.nextDir = { x: 0, y: 0 };
  pacman.progress = 0;
  ghosts.forEach((ghost, idx) => {
    const spawn = ghostDefaults[idx] || ghostDefaults[0];
    ghost.tileX = spawn.x;
    ghost.tileY = spawn.y;
    ghost.dir = { x: 0, y: 0 };
    ghost.progress = 0;
    ghost.frightened = 0;
  });
}

function wrap(value, max) {
  if (value < 0) return max - 1;
  if (value >= max) return 0;
  return value;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMaze();
  drawPellets();
  drawGhosts();
  drawPacman();
}

function drawMaze() {
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (walls[y][x]) {
        ctx.fillStyle = "rgba(30, 64, 175, 0.35)";
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        ctx.strokeRect(x * tileSize + 2, y * tileSize + 2, tileSize - 4, tileSize - 4);
      }
    }
  }
}

function drawPellets() {
  pellets.forEach((key) => {
    const [x, y] = key.split(",").map(Number);
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(x * tileSize + tileSize / 2, y * tileSize + tileSize / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  energizers.forEach((key) => {
    const [x, y] = key.split(",").map(Number);
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(x * tileSize + tileSize / 2, y * tileSize + tileSize / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPacman() {
  const x = (pacman.tileX + pacman.dir.x * pacman.progress) * tileSize + tileSize / 2;
  const y = (pacman.tileY + pacman.dir.y * pacman.progress) * tileSize + tileSize / 2;
  ctx.fillStyle = "#fde047";
  const angle = Math.atan2(pacman.dir.y, pacman.dir.x);
  const mouth = pacman.dir.x === 0 && pacman.dir.y === 0 ? 0.2 : 0.28;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, tileSize / 2 - 1, angle + mouth, angle - mouth + Math.PI * 2, false);
  ctx.fill();
}

function drawGhosts() {
  ghosts.forEach((ghost) => {
    const x = (ghost.tileX + ghost.dir.x * ghost.progress) * tileSize + tileSize / 2;
    const y = (ghost.tileY + ghost.dir.y * ghost.progress) * tileSize + tileSize / 2;
    ctx.fillStyle = ghost.frightened > 0 ? "#38bdf8" : ghost.color;
    ctx.beginPath();
    ctx.arc(x, y - 4, tileSize / 2 - 2, Math.PI, 0);
    ctx.lineTo(x + tileSize / 2 - 2, y + tileSize / 2 - 2);
    ctx.lineTo(x - tileSize / 2 + 2, y + tileSize / 2 - 2);
    ctx.closePath();
    ctx.fill();
  });
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function showOverlay(title, subtitle = "") {
  overlay.hidden = false;
  overlay.innerHTML = `<div>${title}</div>${subtitle ? `<div style="font-size:1rem; margin-top:0.5rem; color: rgba(203,213,255,0.7);">${subtitle}</div>` : ""}`;
}

function hideOverlay() {
  overlay.hidden = true;
}

function loop(time) {
  const delta = (time - lastTime) / 1000;
  lastTime = time;
  if (running && !paused) {
    update(delta);
  }
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
