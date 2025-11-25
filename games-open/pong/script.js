const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const newGameBtn = document.getElementById("new-game");
const controls = document.querySelectorAll('.dpad button[data-dir]');

const paddleWidth = 96;
const paddleHeight = 12;
const ballRadius = 8;
const targetScore = 7;

let playerX = (canvas.width - paddleWidth) / 2;
let aiX = (canvas.width - paddleWidth) / 2;
let ballX = canvas.width / 2;
let ballY = canvas.height / 2;
let ballDX = 3;
let ballDY = 3;
let score = 0;
let best = Number(localStorage.getItem("ah-pong-best")) || 0;
let lastXpScore = 0;
let running = false;
let touchStart = null;

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
    try { bridge.start("pong"); } catch (_error) {}
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
    localStorage.setItem("ah-pong-best", best);
  }
  bestEl.textContent = best;
  const delta = Math.max(0, score - lastXpScore);
  if (delta > 0) {
    reportXp(delta);
  }
  lastXpScore = score;
  if (typeof window.reportScoreToPortal === "function") {
    try { window.reportScoreToPortal("pong", score); } catch (_error) {}
  }
}

function resetBall(direction){
  ballX = canvas.width / 2;
  ballY = canvas.height / 2;
  ballDX = (Math.random() > 0.5 ? 1 : -1) * 3;
  ballDY = direction * 3;
}

function resetGame(){
  stopSession();
  score = 0;
  lastXpScore = 0;
  playerX = (canvas.width - paddleWidth) / 2;
  aiX = (canvas.width - paddleWidth) / 2;
  resetBall(1);
  running = true;
  updateScoreDisplay();
  startSession();
}

function setDirection(dir){
  const speed = 28;
  if (dir === "left") playerX = Math.max(0, playerX - speed);
  if (dir === "right") playerX = Math.min(canvas.width - paddleWidth, playerX + speed);
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
  playerX = Math.min(canvas.width - paddleWidth, Math.max(0, playerX + delta * 0.5));
  touchStart = event.touches[0].clientX;
}, { passive: false });

canvas.addEventListener("touchend", () => { touchStart = null; });

function updateAI(){
  const center = aiX + paddleWidth / 2;
  const diff = ballX - center;
  aiX += diff * 0.06;
  aiX = Math.max(0, Math.min(canvas.width - paddleWidth, aiX));
}

function update(){
  if (!running) return;
  updateAI();

  ballX += ballDX;
  ballY += ballDY;

  if (ballX < ballRadius || ballX > canvas.width - ballRadius) {
    ballDX = -ballDX;
  }

  if (ballY < paddleHeight + ballRadius) {
    if (ballX > aiX && ballX < aiX + paddleWidth) {
      ballDY = Math.abs(ballDY);
    }
  }

  if (ballY > canvas.height - paddleHeight - ballRadius) {
    if (ballX > playerX && ballX < playerX + paddleWidth) {
      const hitPoint = (ballX - (playerX + paddleWidth / 2)) / (paddleWidth / 2);
      ballDX = hitPoint * 4;
      ballDY = -Math.abs(ballDY);
    }
  }

  if (ballY < 0) {
    score += 1;
    updateScoreDisplay();
    resetBall(1);
    if (score >= targetScore) {
      endMatch(true);
    }
  }

  if (ballY > canvas.height) {
    endMatch(false);
  }
}

function endMatch(won){
  running = false;
  stopSession();
}

function drawCourt(){
  ctx.fillStyle = "#0b1224";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function draw(){
  drawCourt();
  ctx.fillStyle = "#8ae0ff";
  ctx.fillRect(playerX, canvas.height - paddleHeight - 8, paddleWidth, paddleHeight);
  ctx.fillStyle = "#ff9f43";
  ctx.fillRect(aiX, 8, paddleWidth, paddleHeight);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
  ctx.fill();

  if (!running) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px Poppins, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Round over", canvas.width / 2, canvas.height / 2);
  }
}

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}

newGameBtn.addEventListener("click", () => {
  resetGame();
});

resetGame();
loop();
