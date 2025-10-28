const SIZE = 4;
const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const newGameBtn = document.getElementById("new-game");
let board;
let score = 0;
let best = Number(localStorage.getItem("best-2048")) || 0;
bestEl.textContent = best;

function initBoard() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  score = 0;
  updateScore();
  spawnTile();
  spawnTile();
  drawBoard();
}

function updateScore() {
  scoreEl.textContent = score;
  if (score > best) {
    best = score;
    localStorage.setItem("best-2048", best);
  }
  bestEl.textContent = best;
}

function spawnTile() {
  const empty = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!board[r][c]) empty.push([r, c]);
    }
  }
  if (!empty.length) return;
  const [row, col] = empty[Math.floor(Math.random() * empty.length)];
  board[row][col] = Math.random() < 0.9 ? 2 : 4;
}

function move(direction) {
  let rotated = false;
  let reversed = false;

  switch (direction) {
    case "up":
      board = rotateLeft(board);
      rotated = true;
      break;
    case "down":
      board = rotateRight(board);
      rotated = true;
      break;
    case "right":
      board = board.map((row) => row.slice().reverse());
      reversed = true;
      break;
  }

  const { changed, newBoard } = compress(board);
  board = newBoard;

  if (reversed) {
    board = board.map((row) => row.slice().reverse());
  }
  if (rotated) {
    if (direction === "up") board = rotateRight(board);
    else board = rotateLeft(board);
  }

  if (changed) {
    spawnTile();
    drawBoard();
    if (isGameOver()) showGameOver();
  }
}

function compress(grid) {
  let changed = false;
  const newGrid = grid.map((row) => {
    const filtered = row.filter((n) => n !== 0);
    for (let i = 0; i < filtered.length - 1; i++) {
      if (filtered[i] === filtered[i + 1]) {
        filtered[i] *= 2;
        score += filtered[i];
        filtered.splice(i + 1, 1);
      }
    }
    while (filtered.length < SIZE) filtered.push(0);
    if (!changed && !filtered.every((v, i) => v === row[i])) {
      changed = true;
    }
    return filtered;
  });
  if (changed) updateScore();
  return { changed, newBoard: newGrid };
}

function rotateLeft(grid) {
  return grid[0].map((_, col) => grid.map((row) => row[col])).reverse();
}

function rotateRight(grid) {
  return grid[0].map((_, col) => grid.map((row) => row[col]).reverse());
}

function drawBoard() {
  boardEl.innerHTML = "";
  board.forEach((row) => {
    row.forEach((value) => {
      const tile = document.createElement("div");
      tile.className = "tile";
      if (value) {
        tile.dataset.value = value;
        tile.textContent = value;
      }
      boardEl.appendChild(tile);
    });
  });
}

function isGameOver() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) return false;
      if (c < SIZE - 1 && board[r][c] === board[r][c + 1]) return false;
      if (r < SIZE - 1 && board[r][c] === board[r + 1][c]) return false;
    }
  }
  return true;
}

function showGameOver() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.textContent = "Game over!";
  boardEl.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1500);
}

function handleKey(e) {
  const mapping = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };
  if (mapping[e.key]) {
    e.preventDefault();
    move(mapping[e.key]);
  }
}

document.addEventListener("keydown", handleKey);
newGameBtn.addEventListener("click", initBoard);

let touchStart;
boardEl.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    touchStart = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }
});

boardEl.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) > 30) {
    if (absX > absY) move(dx > 0 ? "right" : "left");
    else move(dy > 0 ? "down" : "up");
  }
  touchStart = null;
});

initBoard();
