const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const resetBtn = document.getElementById("reset-board");

const rows = 10;
const cols = 10;
const mines = 15;

let grid = [];
let revealedSafe = 0;
let best = Number(localStorage.getItem("ah-mines-best")) || 0;
let lastXpScore = 0;
let gameOver = false;
let started = false;
let minesPlaced = false;

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
    try { bridge.start("minesweeper"); } catch (_error) {}
  }
}

function stopSession(){
  const bridge = window && window.GameXpBridge;
  if (bridge && typeof bridge.stop === "function") {
    try { bridge.stop({ flush: true }); } catch (_error) {}
  }
}

function updateScoreDisplay(){
  scoreEl.textContent = revealedSafe;
  if (revealedSafe > best) {
    best = revealedSafe;
    localStorage.setItem("ah-mines-best", best);
  }
  bestEl.textContent = best;
  const delta = Math.max(0, revealedSafe - lastXpScore);
  if (delta > 0) {
    reportXp(delta);
  }
  lastXpScore = revealedSafe;
  if (typeof window.reportScoreToPortal === "function") {
    try { window.reportScoreToPortal("minesweeper", revealedSafe); } catch (_error) {}
  }
}

function createGrid(){
  grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
    bomb: false,
    flagged: false,
    revealed: false,
    count: 0,
  })));
}

function placeMines(excludeRow, excludeCol){
  let placed = 0;
  while (placed < mines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if (grid[r][c].bomb || (r === excludeRow && c === excludeCol)) continue;
    grid[r][c].bomb = true;
    placed += 1;
  }
}

function forEachNeighbor(r, c, cb){
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      cb(nr, nc);
    }
  }
}

function calculateCounts(){
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].bomb) continue;
      let count = 0;
      forEachNeighbor(r, c, (nr, nc) => { if (grid[nr][nc].bomb) count += 1; });
      grid[r][c].count = count;
    }
  }
}

function renderBoard(){
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "mine-tile";
      tile.dataset.row = r;
      tile.dataset.col = c;
      tile.addEventListener("click", handleReveal);
      tile.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        toggleFlag(r, c);
      });
      boardEl.appendChild(tile);
    });
  });
}

function resetGame(){
  createGrid();
  minesPlaced = false;
  revealedSafe = 0;
  lastXpScore = 0;
  gameOver = false;
  started = false;
  updateScoreDisplay();
  renderBoard();
  stopSession();
}

function revealCell(r, c){
  const cell = grid[r][c];
  if (cell.revealed || cell.flagged || gameOver) return;
  if (!started) {
    started = true;
    if (!minesPlaced) {
      placeMines(r, c);
      calculateCounts();
      minesPlaced = true;
    }
    startSession();
  }
  cell.revealed = true;
  const tile = boardEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (!tile) return;
  tile.classList.add("revealed");

  if (cell.bomb) {
    tile.classList.add("bomb");
    tile.textContent = "💥";
    endGame(false);
    return;
  }

  revealedSafe += 1;
  updateScoreDisplay();

  if (cell.count > 0) {
    tile.textContent = cell.count;
  } else {
    forEachNeighbor(r, c, (nr, nc) => revealCell(nr, nc));
  }

  if (revealedSafe >= (rows * cols) - mines) {
    endGame(true);
  }
}

function toggleFlag(r, c){
  const cell = grid[r][c];
  if (cell.revealed || gameOver) return;
  cell.flagged = !cell.flagged;
  const tile = boardEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (!tile) return;
  tile.classList.toggle("flagged", cell.flagged);
  tile.textContent = cell.flagged ? "🚩" : "";
}

function handleReveal(event){
  const tile = event.currentTarget;
  const r = Number(tile.dataset.row);
  const c = Number(tile.dataset.col);
  revealCell(r, c);
}

function endGame(won){
  gameOver = true;
  grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      const tile = boardEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
      if (!tile) return;
      if (cell.bomb) {
        tile.classList.add("bomb");
        tile.textContent = "💣";
      }
      if (cell.flagged && !cell.bomb) {
        tile.textContent = "✖";
      }
    });
  });
  stopSession();
}

resetBtn.addEventListener("click", resetGame);

resetGame();
