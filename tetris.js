/* ── 상수 ── */
const COLS = 10, ROWS = 20, CELL = 30;

const COLORS = [
  '',          // 0 — 빈 칸
  '#ff4d4d',   // 1 — I
  '#ffad33',   // 2 — O
  '#ffff33',   // 3 — T
  '#33ff66',   // 4 — S
  '#33ccff',   // 5 — Z
  '#8855ff',   // 6 — J
  '#ff55cc',   // 7 — L
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                              // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

/* ── DOM ── */
const boardCanvas = document.getElementById('board');
const ctx = boardCanvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nctx = nextCanvas.getContext('2d');
const overlay = document.getElementById('overlay');
const actionBtn = document.getElementById('action-btn');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');

/* ── 오디오 ── */
let audioCtx = null;

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playLock() {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(120, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(55, audioCtx.currentTime + 0.09);
  g.gain.setValueAtTime(0.28, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + 0.1);
}

function playClear(lines) {
  if (!audioCtx) return;
  const baseFreqs = [0, 440, 523, 659, 880];
  const steps = lines === 4 ? 6 : lines + 1;
  for (let i = 0; i < steps; i++) {
    const t = audioCtx.currentTime + i * 0.06;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(baseFreqs[lines] * Math.pow(1.12, i), t);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.1);
  }
}

function playGameOver() {
  if (!audioCtx) return;
  [440, 370, 311, 220, 165].forEach((freq, i) => {
    const t = audioCtx.currentTime + i * 0.14;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.18);
  });
}

/* ── 상태 ── */
let board, piece, pieceX, pieceY, nextType;
let score, linesCleared, level;
let dropInterval, lastTime, dropCounter;
let paused = false, running = false;
let animId;

/* ── 보드 초기화 ── */
function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomType() { return Math.floor(Math.random() * 7) + 1; }

/* ── 충돌 검사 ── */
function collides(p, ox, oy) {
  for (let r = 0; r < p.length; r++) {
    for (let c = 0; c < p[r].length; c++) {
      if (!p[r][c]) continue;
      const nx = ox + c, ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

/* ── 회전 (시계방향 90°) ── */
function rotate(p) {
  const rows = p.length, cols = p[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = p[r][c];
  return result;
}

/* ── 피스 생성 ── */
function spawnPiece() {
  piece = PIECES[nextType];
  pieceX = Math.floor((COLS - piece[0].length) / 2);
  pieceY = 0;
  nextType = randomType();
  drawNext();
  if (collides(piece, pieceX, pieceY)) gameOver();
}

/* ── 보드에 고정 ── */
function lockPiece() {
  for (let r = 0; r < piece.length; r++)
    for (let c = 0; c < piece[r].length; c++)
      if (piece[r][c] && pieceY + r >= 0)
        board[pieceY + r][pieceX + c] = piece[r][c];
  playLock();
  clearLines();
  spawnPiece();
}

/* ── 줄 제거 ── */
function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (!cleared) return;
  const pts = [0, 100, 300, 500, 800];
  score += (pts[cleared] ?? 800) * level;
  linesCleared += cleared;
  level = Math.floor(linesCleared / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  updateHUD();
  playClear(cleared);
}

/* ── HUD ── */
function updateHUD() {
  scoreEl.textContent = score;
  levelEl.textContent = level;
  linesEl.textContent = linesCleared;
}

/* ── 낙하 ── */
function drop() {
  if (collides(piece, pieceX, pieceY + 1)) {
    lockPiece();
  } else {
    pieceY++;
  }
  dropCounter = 0;
}

/* ── 하드 드롭 ── */
function hardDrop() {
  while (!collides(piece, pieceX, pieceY + 1)) pieceY++;
  lockPiece();
}

/* ── 고스트 Y 계산 ── */
function ghostY() {
  let gy = pieceY;
  while (!collides(piece, pieceX, gy + 1)) gy++;
  return gy;
}

/* ── 게임 루프 ── */
function loop(ts) {
  if (!running) return;
  const dt = ts - (lastTime || ts);
  lastTime = ts;
  if (!paused) {
    dropCounter += dt;
    if (dropCounter >= dropInterval) drop();
  }
  draw();
  animId = requestAnimationFrame(loop);
}

/* ── 렌더링 ── */
function draw() {
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
  drawGrid();
  drawBoard();
  if (piece) {
    drawGhost();
    drawPiece(piece, pieceX, pieceY, ctx, CELL);
  }
}

function drawGrid() {
  ctx.strokeStyle = '#161630';
  ctx.lineWidth = 0.5;
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(COLS * CELL, r * CELL); ctx.stroke();
  }
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, ROWS * CELL); ctx.stroke();
  }
}

function drawBoard() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]) drawCell(ctx, c, r, COLORS[board[r][c]], CELL);
}

function drawGhost() {
  const gy = ghostY();
  if (gy === pieceY) return;
  for (let r = 0; r < piece.length; r++)
    for (let c = 0; c < piece[r].length; c++)
      if (piece[r][c]) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.fillRect((pieceX + c) * CELL + 1, (gy + r) * CELL + 1, CELL - 2, CELL - 2);
        ctx.strokeRect((pieceX + c) * CELL + 1, (gy + r) * CELL + 1, CELL - 2, CELL - 2);
      }
}

function drawPiece(p, ox, oy, context, size) {
  for (let r = 0; r < p.length; r++)
    for (let c = 0; c < p[r].length; c++)
      if (p[r][c]) drawCell(context, ox + c, oy + r, COLORS[p[r][c]], size);
}

function drawCell(context, x, y, color, size) {
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = 'rgba(255,255,255,0.28)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.fillStyle = 'rgba(0,0,0,0.22)';
  context.fillRect(x * size + 1, y * size + size - 5, size - 2, 4);
}

/* ── 다음 피스 미리보기 ── */
function drawNext() {
  nctx.fillStyle = '#0d0d1a';
  nctx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  const p = PIECES[nextType];
  const size = 24;
  const ox = Math.floor((nextCanvas.width / size - p[0].length) / 2);
  const oy = Math.floor((nextCanvas.height / size - p.length) / 2);
  for (let r = 0; r < p.length; r++)
    for (let c = 0; c < p[r].length; c++)
      if (p[r][c]) drawCell(nctx, ox + c, oy + r, COLORS[p[r][c]], size);
}

/* ── 게임 시작 / 재시작 ── */
function startGame() {
  initAudio();
  board = createBoard();
  score = 0; linesCleared = 0; level = 1;
  dropInterval = 1000; dropCounter = 0; lastTime = 0;
  paused = false; running = true;
  nextType = randomType();
  spawnPiece();
  updateHUD();
  overlay.style.display = 'none';
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

/* ── 게임 오버 ── */
function gameOver() {
  running = false;
  cancelAnimationFrame(animId);
  playGameOver();
  overlay.innerHTML = `
    <p class="overlay-title">GAME OVER</p>
    <p class="overlay-sub">SCORE: ${score}</p>
    <button class="btn" id="action-btn">RESTART</button>
  `;
  overlay.style.display = 'flex';
  document.getElementById('action-btn').addEventListener('click', startGame);
}

/* ── 키 입력 ── */
document.addEventListener('keydown', e => {
  if (!running) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!paused && !collides(piece, pieceX - 1, pieceY)) pieceX--;
      break;
    case 'ArrowRight':
      if (!paused && !collides(piece, pieceX + 1, pieceY)) pieceX++;
      break;
    case 'ArrowDown':
      if (!paused) drop();
      break;
    case 'ArrowUp': {
      if (paused) break;
      const rotated = rotate(piece);
      for (const offset of [0, -1, 1, -2, 2]) {
        if (!collides(rotated, pieceX + offset, pieceY)) {
          piece = rotated; pieceX += offset; break;
        }
      }
      break;
    }
    case 'Space':
      e.preventDefault();
      if (!paused) hardDrop();
      break;
    case 'KeyP':
      paused = !paused;
      if (!paused) lastTime = 0;
      break;
  }
  if (!paused) draw();
});

/* ── 시작 버튼 ── */
actionBtn.addEventListener('click', startGame);
