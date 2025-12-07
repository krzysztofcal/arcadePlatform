const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const newGameBtn = document.getElementById("new-game");
const controls = document.querySelectorAll('.dpad button[data-dir]');

const paddleWidth = 100;
const paddleHeight = 12;
const ballRadius = 8;
const brickRows = 5;
const brickCols = 10;
const brickWidth = 52;
const brickHeight = 16;
const brickPadding = 6;
const brickOffsetTop = 40;
const brickOffsetLeft = 22;

let paddleX = (canvas.width - paddleWidth) / 2;
let ballX = canvas.width / 2;
let ballY = canvas.height - 40;
let ballDX = 3;
let ballDY = -3.5;
let score = 0;
let best = Number(localStorage.getItem("ah-breakout-best")) || 0;
let lastXpScore = 0;
let bricks = [];
let running = false;
let touchStart = null;
let lives = 3;

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
    try { bridge.start("breakout"); } catch (_error) {}
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
    localStorage.setItem("ah-breakout-best", best);
  }
  bestEl.textContent = best;
  const delta = Math.max(0, score - lastXpScore);
  if (delta > 0) {
    reportXp(delta);
  }
  lastXpScore = score;
  if (typeof window.reportScoreToPortal === "function") {
    try { window.reportScoreToPortal("breakout", score); } catch (_error) {}
  }
}

function buildBricks(){
  bricks = [];
  for (let c = 0; c < brickCols; c++) {
    bricks[c] = [];
    for (let r = 0; r < brickRows; r++) {
      bricks[c][r] = { x: 0, y: 0, alive: true };
    }
  }
}

function resetBall(){
  ballX = canvas.width / 2;
  ballY = canvas.height - 40;
  ballDX = 3;
  ballDY = -3.5;
}

function resetGame(){
  stopSession();
  score = 0;
  lastXpScore = 0;
  lives = 3;
  paddleX = (canvas.width - paddleWidth) / 2;
  resetBall();
  buildBricks();
  updateScoreDisplay();
  running = true;
  startSession();
}

function detectCollisions(){
  for (let c = 0; c < brickCols; c++) {
    for (let r = 0; r < brickRows; r++) {
      const brick = bricks[c][r];
      if (!brick.alive) continue;
      const bx = (c * (brickWidth + brickPadding)) + brickOffsetLeft;
      const by = (r * (brickHeight + brickPadding)) + brickOffsetTop;
      brick.x = bx;
      brick.y = by;
      if (ballX > bx && ballX < bx + brickWidth && ballY > by && ballY < by + brickHeight) {
        brick.alive = false;
        ballDY = -ballDY;
        score += 5;
        updateScoreDisplay();
      }
    }
  }
}

function allBricksCleared(){
  return bricks.every((col) => col.every((brick) => !brick.alive));
}

function update(){
  if (!running) return;
  ballX += ballDX;
  ballY += ballDY;

  if (ballX + ballDX > canvas.width - ballRadius || ballX + ballDX < ballRadius) {
    ballDX = -ballDX;
  }
  if (ballY + ballDY < ballRadius) {
    ballDY = -ballDY;
  } else if (ballY + ballDY > canvas.height - paddleHeight - ballRadius) {
    if (ballX > paddleX && ballX < paddleX + paddleWidth) {
      const hitPoint = (ballX - (paddleX + paddleWidth / 2)) / (paddleWidth / 2);
      ballDX = hitPoint * 4;
      ballDY = -Math.abs(ballDY);
    } else if (ballY > canvas.height - ballRadius) {
      lives -= 1;
      if (lives <= 0) {
        gameOver();
      } else {
        resetBall();
      }
    }
  }

  detectCollisions();
  if (allBricksCleared()) {
    buildBricks();
    ballDY *= 1.05;
    ballDX *= 1.05;
  }
}

function gameOver(){
  running = false;
  stopSession();
}

function drawBricks(){
  for (let c = 0; c < brickCols; c++) {
    for (let r = 0; r < brickRows; r++) {
      const brick = bricks[c][r];
      if (!brick.alive) continue;
      const x = (c * (brickWidth + brickPadding)) + brickOffsetLeft;
      const y = (r * (brickHeight + brickPadding)) + brickOffsetTop;
      ctx.fillStyle = `hsl(${180 + (r * 20)}, 70%, 62%)`;
      ctx.fillRect(x, y, brickWidth, brickHeight);
    }
  }
}

function draw(){
  ctx.fillStyle = "#0c1327";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawBricks();

  ctx.fillStyle = "#8ae0ff";
  ctx.fillRect(paddleX, canvas.height - paddleHeight - 10, paddleWidth, paddleHeight);

  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#cbd5ff";
  ctx.font = "600 16px Poppins, sans-serif";
  ctx.fillText(`Lives: ${lives}`, 16, 20);

  if (!running) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Game over", canvas.width / 2, canvas.height / 2);
  }
}

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}

function setDirection(dir){
  const speed = 26;
  if (dir === "left") paddleX = Math.max(0, paddleX - speed);
  if (dir === "right") paddleX = Math.min(canvas.width - paddleWidth, paddleX + speed);
}

function handleKey(event){
  if (event.key === "ArrowLeft" || event.key === "a") {
    event.preventDefault();
    setDirection("left");
  }
  if (event.key === "ArrowRight" || event.key === "d") {
    event.preventDefault();
    setDirection("right");
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
  touchStart = event.touches[0].clientX;
}, { passive: true });

canvas.addEventListener("touchmove", (event) => {
  if (!touchStart || event.touches.length !== 1) return;
  event.preventDefault();
  const delta = event.touches[0].clientX - touchStart;
  paddleX = Math.min(canvas.width - paddleWidth, Math.max(0, paddleX + delta * 0.4));
  touchStart = event.touches[0].clientX;
}, { passive: false });

canvas.addEventListener("touchend", () => {
  touchStart = null;
});

newGameBtn.addEventListener("click", () => {
  resetGame();
});

resetGame();
loop();

// Register controls with GameShell for parent frame communication
if (window.GameShell && typeof window.GameShell.registerControls === 'function') {
  window.GameShell.registerControls({
    onPause: function() {
      if (running) {
        running = false;
      }
    },
    onResume: function() {
      if (!running && lives > 0) {
        running = true;
      }
    },
    onMute: function() {
      // Breakout has no audio yet
    },
    onUnmute: function() {
      // Breakout has no audio yet
    }
  });
}
