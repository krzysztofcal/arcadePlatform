const SIZE = 4;
const WIN_VALUE = 2048;
const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const newGameBtn = document.getElementById("new-game");
const controls = document.querySelectorAll('.dpad button[data-dir]');

let board = [];
let score = 0;
let best = Number(localStorage.getItem("ah-2048-best")) || 0;
const BEST_AWARDED_KEY = "ah-2048-best-awarded";
let lastAwardedBest = Number(localStorage.getItem(BEST_AWARDED_KEY)) || 0;
let overlayEl = null;
let touchStart = null;

bestEl.textContent = best;

function initBoard() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  score = 0;
  updateScore();
  spawnTile();
  spawnTile();
  drawBoard(true);
  removeOverlay();
}

function updateScore() {
  scoreEl.textContent = score;
  if (typeof window.reportScoreToPortal === "function") {
    try { window.reportScoreToPortal("2048", score); } catch (_error) {}
  }
  if (score > best) {
    const prevBest = best;
    best = score;
    localStorage.setItem("ah-2048-best", best);
    maybeGrantPersonalBest(prevBest);
  }
  bestEl.textContent = best;
}

function maybeGrantPersonalBest(previousBest) {
  const baseline = Math.max(previousBest || 0, lastAwardedBest || 0);
  if (best <= baseline) return;
  let granted = 0;
  const points = window.Points;
  if (points && typeof points.grantPersonalBest === "function") {
    try {
      granted = points.grantPersonalBest("2048", {
        score: best,
        previousBest: baseline
      }) || 0;
    } catch (_error) {
      granted = 0;
    }
  }
  if (granted > 0) {
    lastAwardedBest = best;
    try {
      localStorage.setItem(BEST_AWARDED_KEY, String(best));
    } catch (_error) {
      /* ignore */
    }
  }
}

function randomEmptyCell() {
  const empty = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) empty.push([r, c]);
    }
  }
  if (!empty.length) return null;
  return empty[Math.floor(Math.random() * empty.length)];
}

function spawnTile() {
  const cell = randomEmptyCell();
  if (!cell) return false;
  const [row, col] = cell;
  board[row][col] = Math.random() < 0.9 ? 2 : 4;
  return { row, col };
}

function rotateLeft(grid) {
  return grid[0].map((_, i) => grid.map((row) => row[i])).reverse();
}

function rotateRight(grid) {
  return grid[0].map((_, i) => grid.map((row) => row[i]).reverse());
}

function compress(grid) {
  let changed = false;
  const newGrid = grid.map((row) => {
    const tiles = row.filter((value) => value !== 0);
    for (let i = 0; i < tiles.length - 1; i++) {
      if (tiles[i] === tiles[i + 1]) {
        tiles[i] *= 2;
        score += tiles[i];
        tiles.splice(i + 1, 1);
      }
    }
    while (tiles.length < SIZE) tiles.push(0);
    if (!changed && !tiles.every((value, idx) => value === row[idx])) {
      changed = true;
    }
    return tiles;
  });
  if (changed) updateScore();
  return { changed, grid: newGrid };
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
    case "left":
    default:
      break;
  }

  const { changed, grid } = compress(board);
  board = grid;

  if (reversed) {
    board = board.map((row) => row.slice().reverse());
  }
  if (rotated) {
    board = direction === "up" ? rotateRight(board) : rotateLeft(board);
  }

  if (changed) {
    const spawned = spawnTile();
    drawBoard(false, spawned);
    if (hasWon()) showOverlay("You made it!", "Keep going");
    else if (isGameOver()) showOverlay("No more moves", "Try again");
  }
}

function hasWon() {
  return board.some((row) => row.some((value) => value >= WIN_VALUE));
}

function isGameOver() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const value = board[r][c];
      if (value === 0) return false;
      if (c < SIZE - 1 && value === board[r][c + 1]) return false;
      if (r < SIZE - 1 && value === board[r + 1][c]) return false;
    }
  }
  return true;
}

function drawBoard(initial = false, spawned) {
  boardEl.innerHTML = "";
  board.forEach((row) => {
    row.forEach((value, idx) => {
      const tile = document.createElement("div");
      tile.className = "tile";
      if (value) {
        tile.dataset.value = value;
        tile.textContent = value;
      } else {
        tile.textContent = "";
      }
      boardEl.appendChild(tile);
    });
  });

  if (spawned) {
    const index = spawned.row * SIZE + spawned.col;
    const tile = boardEl.children[index];
    if (tile) tile.classList.add("active");
  } else if (initial) {
    boardEl.querySelectorAll(".tile[data-value]").forEach((tile) => tile.classList.add("active"));
  }
}

function showOverlay(title, subtitle) {
  removeOverlay();
  overlayEl = document.createElement("div");
  overlayEl.className = "overlay-banner";
  overlayEl.innerHTML = `<div><div>${title}</div><div style="font-size:1rem; margin-top:0.5rem; color: rgba(203,213,255,0.75);">${subtitle}</div></div>`;
  boardEl.appendChild(overlayEl);
}

function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function handleKey(event) {
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
  const direction = map[event.key];
  if (direction) {
    event.preventDefault();
    move(direction);
  }
}

document.addEventListener("keydown", handleKey);

controls.forEach((button) => {
  const dir = button.dataset.dir;
  if (!dir) return;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    move(dir);
  });
});

boardEl.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 1) return;
  touchStart = {
    x: event.touches[0].clientX,
    y: event.touches[0].clientY,
  };
}, { passive: true });

boardEl.addEventListener("touchmove", (event) => {
  if (event.touches.length !== 1) return;
  event.preventDefault();
}, { passive: false });

boardEl.addEventListener("touchend", (event) => {
  if (!touchStart || event.changedTouches.length !== 1) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const threshold = 24;
  if (Math.max(absX, absY) > threshold) {
    if (absX > absY) {
      move(dx > 0 ? "right" : "left");
    } else {
      move(dy > 0 ? "down" : "up");
    }
  }
  touchStart = null;
});

newGameBtn.addEventListener("click", initBoard);

initBoard();
