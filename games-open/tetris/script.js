const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scale = 24;
const rows = 20;
const cols = 10;
ctx.scale(scale, scale);

const colors = {
  T: "#a855f7",
  O: "#facc15",
  L: "#fb923c",
  J: "#38bdf8",
  I: "#22d3ee",
  S: "#4ade80",
  Z: "#f87171",
};

const arena = createMatrix(cols, rows);
const player = {
  pos: { x: 0, y: 0 },
  matrix: null,
  score: 0,
  lines: 0,
};

let dropCounter = 0;
let dropInterval = 800;
let lastTime = 0;

const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");

document.getElementById("restart").addEventListener("click", reset);
document.addEventListener("keydown", handleKey);

reset();
update();

function createMatrix(w, h) {
  const matrix = [];
  while (h--) {
    matrix.push(new Array(w).fill(0));
  }
  return matrix;
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

const bag = [];
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
  const [m, o] = [player.matrix, player.pos];
  for (let y = 0; y < m.length; ++y) {
    for (let x = 0; x < m[y].length; ++x) {
      if (m[y][x] && (arena[y + o.y] && arena[y + o.y][x + o.x]) !== 0) {
        return true;
      }
    }
  }
  return false;
}

function merge(arena, player) {
  player.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        arena[y + player.pos.y][x + player.pos.x] = value;
      }
    });
  });
}

function arenaSweep() {
  outer: for (let y = arena.length - 1; y >= 0; --y) {
    for (let x = 0; x < arena[y].length; ++x) {
      if (!arena[y][x]) continue outer;
    }
    const row = arena.splice(y, 1)[0].fill(0);
    arena.unshift(row);
    ++y;
    player.score += 100;
    player.lines += 1;
    dropInterval = Math.max(120, dropInterval - 10);
  }
  updateScore();
}

function drawMatrix(matrix, offset) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      ctx.fillStyle = colors[value];
      ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = "rgba(15,23,42,0.4)";
      ctx.strokeRect(x + offset.x, y + offset.y, 1, 1);
    });
  });
}

function draw() {
  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMatrix(arena, { x: 0, y: 0 });
  drawMatrix(player.matrix, player.pos);
}

function playerDrop() {
  player.pos.y++;
  if (collide(arena, player)) {
    player.pos.y--;
    merge(arena, player);
    arenaSweep();
    playerReset();
  }
  dropCounter = 0;
}

function playerMove(dir) {
  player.pos.x += dir;
  if (collide(arena, player)) {
    player.pos.x -= dir;
  }
}

function playerReset() {
  const piece = nextPiece();
  player.matrix = createPiece(piece);
  player.pos.y = 0;
  player.pos.x = ((arena[0].length / 2) | 0) - ((player.matrix[0].length / 2) | 0);
  if (collide(arena, player)) {
    arena.forEach((row) => row.fill(0));
    player.score = 0;
    player.lines = 0;
    dropInterval = 800;
    updateScore();
  }
}

function playerRotate(dir) {
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

function rotate(matrix, dir) {
  for (let y = 0; y < matrix.length; ++y) {
    for (let x = 0; x < y; ++x) {
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
  }
  if (dir > 0) {
    matrix.forEach((row) => row.reverse());
  } else {
    matrix.reverse();
  }
}

function handleKey(event) {
  switch (event.key) {
    case "ArrowLeft":
    case "a":
    case "A":
      playerMove(-1);
      break;
    case "ArrowRight":
    case "d":
    case "D":
      playerMove(1);
      break;
    case "ArrowDown":
    case "s":
    case "S":
      playerDrop();
      break;
    case "ArrowUp":
    case "w":
    case "W":
      playerRotate(1);
      break;
    case " ":
      while (!collide(arena, player)) {
        player.pos.y++;
      }
      player.pos.y--;
      merge(arena, player);
      arenaSweep();
      playerReset();
      dropCounter = 0;
      break;
  }
}

function update(time = 0) {
  const delta = time - lastTime;
  lastTime = time;
  dropCounter += delta;
  if (dropCounter > dropInterval) {
    playerDrop();
  }
  draw();
  requestAnimationFrame(update);
}

function updateScore() {
  scoreEl.textContent = player.score;
  linesEl.textContent = player.lines;
}

function reset() {
  arena.forEach((row) => row.fill(0));
  player.score = 0;
  player.lines = 0;
  dropInterval = 800;
  updateScore();
  playerReset();
}
