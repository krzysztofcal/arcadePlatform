const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const resetBtn = document.getElementById("reset");
const overlay = document.getElementById("stateOverlay");
const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const dpad = document.getElementById("dpad");

const COLS = 10;
const ROWS = 20;
const SCALE = canvas.width / COLS;
ctx.scale(SCALE, SCALE);

const colors = {
  I: "#22d3ee",
  J: "#38bdf8",
  L: "#fb923c",
  O: "#facc15",
  S: "#4ade80",
  T: "#a855f7",
  Z: "#f87171",
};

const arena = createMatrix(COLS, ROWS);
const player = {
  pos: { x: 0, y: 0 },
  matrix: null,
  score: 0,
  lines: 0,
  level: 1,
};

function reportScore(){
  if (typeof window.reportScoreToPortal === "function") {
    try { window.reportScoreToPortal("tetris", player.score); } catch (_error) {}
  }
}

let lastTime = 0;
let dropCounter = 0;
let dropInterval = 800;
let running = false;
let pendingGameOver = false;
let touchStart = null;

const bag = [];

playBtn.addEventListener("click", () => {
  if (pendingGameOver) {
    resetGame();
  }
  running = true;
  pendingGameOver = false;
  hideOverlay();
});

pauseBtn.addEventListener("click", () => {
  if (!running) return;
  running = false;
  showOverlay("Paused", "Tap play to resume");
});

resetBtn.addEventListener("click", () => {
  resetGame();
});

dpad.addEventListener("pointerdown", (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  event.preventDefault();
  triggerAction(action);
});

canvas.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 1) return;
  touchStart = {
    x: event.touches[0].clientX,
    y: event.touches[0].clientY,
    time: performance.now(),
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
  const elapsed = performance.now() - touchStart.time;
  touchStart = null;
  if (Math.max(absX, absY) < 24) {
    triggerAction("rotate");
    return;
  }
  if (absX > absY) {
    triggerAction(dx > 0 ? "right" : "left");
  } else {
    if (dy > 0) {
      if (elapsed < 180) triggerAction("hard");
      else triggerAction("soft");
    } else {
      triggerAction("rotate");
    }
  }
});

document.addEventListener("keydown", (event) => {
  const map = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowDown: "soft",
    ArrowUp: "rotate",
    w: "rotate",
    a: "left",
    d: "right",
    s: "soft",
    " ": "hard",
  };
  const action = map[event.key];
  if (action) {
    event.preventDefault();
    triggerAction(action);
  }
});

function triggerAction(action) {
  if (pendingGameOver) return;
  switch (action) {
    case "left":
      playerMove(-1);
      break;
    case "right":
      playerMove(1);
      break;
    case "rotate":
      playerRotate(1);
      break;
    case "soft":
      softDrop();
      break;
    case "hard":
      hardDrop();
      break;
  }
}

function createMatrix(w, h) {
  return Array.from({ length: h }, () => Array(w).fill(0));
}

function createPiece(type) {
  switch (type) {
    case "T":
      return [
        [0, type, 0],
        [type, type, type],
        [0, 0, 0],
      ];
    case "O":
      return [
        [type, type],
        [type, type],
      ];
    case "L":
      return [
        [0, 0, type],
        [type, type, type],
        [0, 0, 0],
      ];
    case "J":
      return [
        [type, 0, 0],
        [type, type, type],
        [0, 0, 0],
      ];
    case "I":
      return [
        [0, 0, 0, 0],
        [type, type, type, type],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
    case "S":
      return [
        [0, type, type],
        [type, type, 0],
        [0, 0, 0],
      ];
    case "Z":
      return [
        [type, type, 0],
        [0, type, type],
        [0, 0, 0],
      ];
  }
}

function nextPiece() {
  if (!bag.length) {
    bag.push(..."IJLOSTZ".split(""));
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

function collide(arena, player) {
  const { matrix, pos } = player;
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      const value = matrix[y][x];
      if (!value) continue;
      const offsetX = x + pos.x;
      const offsetY = y + pos.y;
      if (offsetX < 0 || offsetX >= arena[0].length || offsetY >= arena.length) {
        return true;
      }
      if (offsetY < 0) continue;
      if (arena[offsetY][offsetX]) return true;
    }
  }
  return false;
}

function merge(arena, player) {
  player.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      const boardY = y + player.pos.y;
      if (boardY < 0) return;
      arena[boardY][x + player.pos.x] = value;
    });
  });
}

function arenaSweep() {
  let cleared = 0;
  outer: for (let y = arena.length - 1; y >= 0; y--) {
    for (let x = 0; x < arena[y].length; x++) {
      if (!arena[y][x]) continue outer;
    }
    const row = arena.splice(y, 1)[0].fill(0);
    arena.unshift(row);
    cleared++;
    y++;
  }
  if (cleared) {
    const scores = [0, 100, 300, 500, 800];
    player.score += scores[cleared] * player.level;
    player.lines += cleared;
    updateLevel();
  }
}

function updateLevel() {
  player.level = Math.floor(player.lines / 10) + 1;
  dropInterval = Math.max(120, 800 - (player.level - 1) * 70);
  updateScore();
}

function drawMatrix(matrix, offset) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      ctx.fillStyle = colors[value] || "#fff";
      ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
      ctx.lineWidth = 0.05;
      ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
    });
  });
}

function draw() {
  ctx.fillStyle = "rgba(6, 10, 24, 0.95)";
  ctx.fillRect(0, 0, canvas.width / SCALE, canvas.height / SCALE);
  drawMatrix(arena, { x: 0, y: 0 });
  if (player.matrix) drawMatrix(player.matrix, player.pos);
}

function playerReset() {
  player.matrix = createPiece(nextPiece());
  player.pos.y = -1;
  player.pos.x = ((arena[0].length / 2) | 0) - ((player.matrix[0].length / 2) | 0);
  if (collide(arena, player)) {
    merge(arena, player);
    running = false;
    pendingGameOver = true;
    showOverlay("Game over", "Tap play to restart");
    if (window.GameXpBridge && typeof window.GameXpBridge.gameOver === "function") {
      try { window.GameXpBridge.gameOver({ score: player.score, gameId: "tetris" }); } catch (_error) {}
    }
  }
}

function playerMove(dir) {
  if (!player.matrix) return;
  player.pos.x += dir;
  if (collide(arena, player)) {
    player.pos.x -= dir;
  }
}

function rotate(matrix, dir) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < y; x++) {
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
  }
  if (dir > 0) matrix.forEach((row) => row.reverse());
  else matrix.reverse();
}

function playerRotate(dir) {
  if (!player.matrix) return;
  const pos = player.pos.x;
  let offset = 1;
  rotate(player.matrix, dir);
  while (collide(arena, player)) {
    player.pos.x += offset;
    offset = -(offset + (offset > 0 ? 1 : -1));
    if (offset > player.matrix[0].length) {
      rotate(player.matrix, -dir);
      player.pos.x = pos;
      return;
    }
  }
}

function softDrop() {
  if (!running) return;
  player.pos.y++;
  if (collide(arena, player)) {
    player.pos.y--;
    merge(arena, player);
    arenaSweep();
    playerReset();
  }
  dropCounter = 0;
}

function hardDrop() {
  if (!player.matrix) return;
  while (!collide(arena, player)) {
    player.pos.y++;
  }
  player.pos.y--;
  merge(arena, player);
  arenaSweep();
  playerReset();
  dropCounter = 0;
  if (!running) updateScore();
}

function updateScore() {
  scoreEl.textContent = player.score;
  linesEl.textContent = player.lines;
  levelEl.textContent = player.level;
  reportScore();
}

function resetGame() {
  arena.forEach((row) => row.fill(0));
  player.score = 0;
  player.lines = 0;
  player.level = 1;
  dropInterval = 800;
  pendingGameOver = false;
  running = true;
  hideOverlay();
  updateScore();
  playerReset();
}

function showOverlay(title, subtitle) {
  overlay.hidden = false;
  overlay.innerHTML = `<div>${title}</div><div style="font-size:1rem; margin-top:0.5rem; color: rgba(203,213,255,0.7);">${subtitle}</div>`;
}

function hideOverlay() {
  overlay.hidden = true;
}

function update(time = 0) {
  const delta = time - lastTime;
  lastTime = time;
  if (running && !pendingGameOver) {
    dropCounter += delta;
    if (dropCounter > dropInterval) {
      softDrop();
    }
  }
  draw();
  requestAnimationFrame(update);
}

resetGame();
update();
