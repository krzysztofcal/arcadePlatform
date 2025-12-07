const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const newGameBtn = document.getElementById("new-game");
const controls = document.querySelectorAll('.dpad button[data-dir]');

const cols = 20;
const rows = 20;
const cellSize = canvas.width / cols;

let snake = [];
let direction = { x: 1, y: 0 };
let nextDirection = { x: 1, y: 0 };
let food = { x: 5, y: 5 };
let score = 0;
let best = Number(localStorage.getItem("ah-snake-best")) || 0;
let running = false;
let lastTime = 0;
let moveDelay = 140;
let touchStart = null;
let lastXpScore = 0;
let pendingStop = false;

bestEl.textContent = best;

function clampDelta(delta){
  const bridge = window && window.GameXpBridge;
  const ceiling = bridge && typeof bridge.getScoreDeltaCeiling === "function" ? bridge.getScoreDeltaCeiling() : null;
  if (!Number.isFinite(ceiling)) return delta;
  return Math.min(delta, ceiling);
}

function reportXp(delta){
  const bridge = window && window.GameXpBridge;
  if (!bridge || typeof bridge.add !== "function") return;
  const amount = clampDelta(Math.max(0, delta));
  if (amount <= 0) return;
  try { bridge.add(amount); } catch (_error) {}
}

function startSession(){
  const bridge = window && window.GameXpBridge;
  if (bridge && typeof bridge.start === "function") {
    try { bridge.start("snake"); } catch (_error) {}
  }
}

function stopSession(){
  const bridge = window && window.GameXpBridge;
  if (bridge && typeof bridge.stop === "function") {
    try { bridge.stop({ flush: true }); } catch (_error) {}
  }
}

function updateScoreDisplay(){
  scoreEl.textContent = score;
  if (score > best) {
    best = score;
    localStorage.setItem("ah-snake-best", best);
  }
  bestEl.textContent = best;
  const delta = Math.max(0, score - lastXpScore);
  if (delta > 0) {
    reportXp(delta);
  }
  lastXpScore = score;
  if (typeof window.reportScoreToPortal === "function") {
    try { window.reportScoreToPortal("snake", score); } catch (_error) {}
  }
}

function resetGame(){
  snake = [
    { x: Math.floor(cols / 2), y: Math.floor(rows / 2) },
    { x: Math.floor(cols / 2) - 1, y: Math.floor(rows / 2) },
    { x: Math.floor(cols / 2) - 2, y: Math.floor(rows / 2) },
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  score = 0;
  lastXpScore = 0;
  pendingStop = false;
  spawnFood();
  updateScoreDisplay();
  draw();
  running = true;
  startSession();
}

function spawnFood(){
  let spot = null;
  while (!spot) {
    const x = Math.floor(Math.random() * cols);
    const y = Math.floor(Math.random() * rows);
    const collision = snake.some((segment) => segment.x === x && segment.y === y);
    if (!collision) {
      spot = { x, y };
    }
  }
  food = spot;
}

function drawGrid(){
  ctx.fillStyle = "#0d1527";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellSize, 0);
    ctx.lineTo(x * cellSize, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellSize);
    ctx.lineTo(canvas.width, y * cellSize);
    ctx.stroke();
  }
}

function drawSnake(){
  snake.forEach((segment, index) => {
    ctx.fillStyle = index === 0 ? "#7fffa2" : "#52d88f";
    ctx.fillRect(segment.x * cellSize + 1, segment.y * cellSize + 1, cellSize - 2, cellSize - 2);
  });
}

function drawFood(){
  ctx.fillStyle = "#ff7b7b";
  ctx.beginPath();
  ctx.arc(food.x * cellSize + cellSize / 2, food.y * cellSize + cellSize / 2, cellSize / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawMessage(text){
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px Poppins, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function draw(){
  drawGrid();
  drawFood();
  drawSnake();
  if (!running) {
    drawMessage(pendingStop ? "Game over" : "Tap start to play");
  }
}

function step(){
  if (!running) return;
  direction = nextDirection;
  const newHead = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
  if (newHead.x < 0 || newHead.x >= cols || newHead.y < 0 || newHead.y >= rows) {
    return gameOver();
  }
  if (snake.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
    return gameOver();
  }
  snake.unshift(newHead);
  if (newHead.x === food.x && newHead.y === food.y) {
    score += 10;
    updateScoreDisplay();
    spawnFood();
  } else {
    snake.pop();
  }
  draw();
}

function gameOver(){
  running = false;
  pendingStop = true;
  draw();
  drawMessage("Game over");
  stopSession();
}

function loop(timestamp){
  if (!lastTime) lastTime = timestamp;
  if (running && timestamp - lastTime >= moveDelay) {
    step();
    lastTime = timestamp;
  }
  requestAnimationFrame(loop);
}

function setDirection(dir){
  if (dir === "up" && direction.y !== 1) nextDirection = { x: 0, y: -1 };
  if (dir === "down" && direction.y !== -1) nextDirection = { x: 0, y: 1 };
  if (dir === "left" && direction.x !== 1) nextDirection = { x: -1, y: 0 };
  if (dir === "right" && direction.x !== -1) nextDirection = { x: 1, y: 0 };
}

function handleKey(event){
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
}

document.addEventListener("keydown", handleKey);

controls.forEach((button) => {
  const dir = button.dataset.dir;
  if (!dir) return;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    setDirection(dir);
  });
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
  const threshold = 20;
  if (Math.max(absX, absY) > threshold) {
    if (absX > absY) {
      setDirection(dx > 0 ? "right" : "left");
    } else {
      setDirection(dy > 0 ? "down" : "up");
    }
  }
  touchStart = null;
});

newGameBtn.addEventListener("click", resetGame);

resetGame();
requestAnimationFrame(loop);

// Register controls with GameShell for parent frame communication
if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
  window.GameShell.registerControls({
    onPause: function() {
      if (running) {
        running = false;
        drawMessage("Paused");
      }
    },
    onResume: function() {
      if (!running && !pendingStop) {
        running = true;
        draw();
      }
    },
    onMute: function() {
      // Snake has no audio yet
    },
    onUnmute: function() {
      // Snake has no audio yet
    }
  });
}
