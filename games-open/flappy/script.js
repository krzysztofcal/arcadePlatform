const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const startBtn = document.getElementById("start");
const resetBtn = document.getElementById("reset");
const flapBtn = document.getElementById("flap");

const birdX = 80;
const gravity = 0.35;
const flapStrength = -6;
const pipeWidth = 60;
const pipeGap = 150;
const pipeSpacing = 210;
const pipeSpeed = 2.3;

let birdY = canvas.height / 2;
let birdVel = 0;
let pipes = [];
let score = 0;
let best = Number(localStorage.getItem("ah-flappy-best")) || 0;
let lastXpScore = 0;
let running = false;
let lastFrame = 0;
let pendingStop = false;
let animTime = 0;

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
    try { bridge.start("flappy"); } catch (_error) {}
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
    localStorage.setItem("ah-flappy-best", best);
  }
  bestEl.textContent = best;
  const delta = Math.max(0, score - lastXpScore);
  if (delta > 0) {
    reportXp(delta);
  }
  lastXpScore = score;
  if (typeof window.reportScoreToPortal === "function") {
    try { window.reportScoreToPortal("flappy", score); } catch (_error) {}
  }
}

function resetGame(){
  birdY = canvas.height / 2;
  birdVel = 0;
  pipes = [];
  score = 0;
  lastXpScore = 0;
  running = false;
  pendingStop = false;
  updateScoreDisplay();
  draw();
}

function startGame(){
  running = true;
  pendingStop = false;
  startSession();
}

function spawnPipe(){
  const margin = 90;
  const gapY = Math.max(margin, Math.min(canvas.height - margin - pipeGap, Math.random() * (canvas.height - pipeGap)));
  pipes.push({ x: canvas.width, gapY, scored: false });
}

function flap(){
  birdVel = flapStrength;
}

function update(delta){
  if (!running) return;
  birdVel += gravity;
  birdY += birdVel;
  if (birdY < 0 || birdY > canvas.height - 24) {
    return gameOver();
  }

  if (!pipes.length || (canvas.width - (pipes[pipes.length - 1].x + pipeWidth)) >= pipeSpacing) {
    spawnPipe();
  }

  pipes.forEach((pipe) => {
    pipe.x -= pipeSpeed * delta;
    if (!pipe.scored && pipe.x + pipeWidth < birdX) {
      pipe.scored = true;
      score += 1;
      updateScoreDisplay();
    }
  });

  pipes = pipes.filter((pipe) => pipe.x + pipeWidth > 0);

  for (let i = 0; i < pipes.length; i++) {
    const pipe = pipes[i];
    if (birdX + 18 > pipe.x && birdX < pipe.x + pipeWidth) {
      if (birdY < pipe.gapY || birdY + 24 > pipe.gapY + pipeGap) {
        return gameOver();
      }
    }
  }
}

function gameOver(){
  running = false;
  pendingStop = true;
  stopSession();
}

function drawBackground(){
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#7dd1ff");
  gradient.addColorStop(1, "#2d60c4");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawBird(){
  const flap = Math.sin(animTime * 8);
  const bodyRadiusX = 16;
  const bodyRadiusY = 12;

  ctx.save();
  ctx.translate(birdX, birdY);
  ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;

  const bodyGradient = ctx.createLinearGradient(-bodyRadiusX, -bodyRadiusY, bodyRadiusX, bodyRadiusY);
  bodyGradient.addColorStop(0, "#ffe16a");
  bodyGradient.addColorStop(1, "#ffb92d");
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyRadiusX, bodyRadiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f6d255";
  ctx.beginPath();
  ctx.ellipse(2, 2, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(-6, -2 + flap * 3);
  ctx.rotate(-Math.PI / 6 + flap * 0.35);
  ctx.fillStyle = "#ffcf45";
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.quadraticCurveTo(6, -4, 12, 6);
  ctx.quadraticCurveTo(4, 10, -4, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#f79e2d";
  ctx.beginPath();
  ctx.moveTo(12, 2);
  ctx.lineTo(20, 6);
  ctx.lineTo(12, 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffb92d";
  ctx.beginPath();
  ctx.moveTo(-10, -2);
  ctx.lineTo(-18, 0);
  ctx.lineTo(-12, 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(6, -4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(7, -5, 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f07167";
  ctx.beginPath();
  ctx.moveTo(-2, -8);
  ctx.lineTo(2, -12);
  ctx.lineTo(6, -8);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawPipes(){
  ctx.fillStyle = "#5ef08a";
  pipes.forEach((pipe) => {
    ctx.fillRect(pipe.x, 0, pipeWidth, pipe.gapY);
    ctx.fillRect(pipe.x, pipe.gapY + pipeGap, pipeWidth, canvas.height - (pipe.gapY + pipeGap));
  });
}

function drawMessage(text){
  ctx.fillStyle = "rgba(11, 16, 32, 0.6)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px Poppins, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function draw(){
  drawBackground();
  drawPipes();
  drawBird();
  if (!running) {
    drawMessage(pendingStop ? "Game over" : "Tap start to play");
  }
}

function loop(timestamp){
  if (!lastFrame) lastFrame = timestamp;
  const delta = Math.min(1.6, (timestamp - lastFrame) / 16.6667);
  animTime += delta;
  update(delta);
  draw();
  lastFrame = timestamp;
  requestAnimationFrame(loop);
}

function handleKey(event){
  if (event.code === "Space" || event.code === "ArrowUp") {
    event.preventDefault();
    flap();
    if (!running) startGame();
  }
}

document.addEventListener("keydown", handleKey);

canvas.addEventListener("pointerdown", () => {
  flap();
  if (!running) startGame();
});

flapBtn.addEventListener("click", () => {
  flap();
  if (!running) startGame();
});

startBtn.addEventListener("click", () => {
  if (!running) {
    startGame();
  }
});

resetBtn.addEventListener("click", () => {
  resetGame();
  stopSession();
});

resetGame();
requestAnimationFrame(loop);
