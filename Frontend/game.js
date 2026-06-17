/* ── 세션 가드 ── */
const SESSION_USER_ID = parseInt(localStorage.getItem('tetris_user_id') || '0');
const SESSION_TOKEN   = localStorage.getItem('tetris_token') || '';
if (!SESSION_USER_ID || !SESSION_TOKEN) {
  window.location.replace('/');
  throw new Error('로그인이 필요합니다.');
}

/* 플레이어 이름 표시 */
(function () {
  const nickname = localStorage.getItem('tetris_nickname');
  const email    = localStorage.getItem('tetris_email') || '';
  const display  = nickname || email.split('@')[0];
  document.getElementById('player-name').textContent = display;
})();

/* ── 상수 ── */
const COLS = 10, ROWS = 20, CELL = 30;

const COLORS = [
  '',
  '#ff4d4d',
  '#ffad33',
  '#ffff33',
  '#33ff66',
  '#33ccff',
  '#8855ff',
  '#ff55cc',
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  [[2,2],[2,2]],
  [[0,3,0],[3,3,3],[0,0,0]],
  [[0,4,4],[4,4,0],[0,0,0]],
  [[5,5,0],[0,5,5],[0,0,0]],
  [[6,0,0],[6,6,6],[0,0,0]],
  [[0,0,7],[7,7,7],[0,0,0]],
];

/* ── DOM ── */
const boardCanvas = document.getElementById('board');
const ctx         = boardCanvas.getContext('2d');
const nextCanvas  = document.getElementById('next-canvas');
const nctx        = nextCanvas.getContext('2d');
const overlay     = document.getElementById('overlay');
const actionBtn   = document.getElementById('action-btn');
const scoreEl     = document.getElementById('score');
const levelEl     = document.getElementById('level');
const linesEl     = document.getElementById('lines');

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
let rankingTimer = null;

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
  piece  = PIECES[nextType];
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
  showClearText(cleared);
}

/* ── 줄 제거 텍스트 + 음성 ── */
const CLEAR_MESSAGES = ['', 'GOOD!', 'Excellent!!', 'BRAVO!!!', 'BRAVO!!!'];
const CLEAR_CLASSES  = ['', 'good', 'excellent', 'bravo', 'bravo'];

let clearPopupTimer = null;

function showClearText(cleared) {
  const popup = document.getElementById('clear-popup');
  const msg   = CLEAR_MESSAGES[Math.min(cleared, 4)];
  const cls   = CLEAR_CLASSES [Math.min(cleared, 4)];

  /* 애니메이션 리셋 */
  popup.className = 'clear-popup';
  popup.textContent = msg;
  void popup.offsetWidth;
  popup.classList.add('show', cls);

  clearTimeout(clearPopupTimer);
  clearPopupTimer = setTimeout(() => { popup.className = 'clear-popup'; }, 1150);

  speak(msg);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u   = new SpeechSynthesisUtterance(text);
  u.lang    = 'en-US';
  u.rate    = 1.1;
  u.pitch   = 1.3;
  u.volume  = 1.0;
  window.speechSynthesis.speak(u);
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
        ctx.fillStyle   = 'rgba(255,255,255,0.06)';
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth   = 1;
        ctx.fillRect  ((pieceX + c) * CELL + 1, (gy + r) * CELL + 1, CELL - 2, CELL - 2);
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
  const p    = PIECES[nextType];
  const size = 24;
  const ox   = Math.floor((nextCanvas.width  / size - p[0].length) / 2);
  const oy   = Math.floor((nextCanvas.height / size - p.length)    / 2);
  for (let r = 0; r < p.length; r++)
    for (let c = 0; c < p[r].length; c++)
      if (p[r][c]) drawCell(nctx, ox + c, oy + r, COLORS[p[r][c]], size);
}

/* ── 랭킹 API ── */
async function fetchLiveRankings() {
  try {
    const res  = await fetch('/api/rankings?limit=3');
    const data = await res.json();
    renderLiveRankings(data);
  } catch (_) { /* 네트워크 오류 시 무시 */ }
}

function renderLiveRankings(entries) {
  const container = document.getElementById('live-rankings');
  if (!entries || entries.length === 0) {
    container.innerHTML = '<div class="rank-empty">아직 기록이 없습니다</div>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  container.innerHTML = entries.map(e => {
    const name   = e.nickname || e.email.split('@')[0];
    const isMe   = e.user_id === SESSION_USER_ID;
    const cls    = `rank-row rank-${e.rank}${isMe ? ' rank-row--me' : ''}`;
    const scoreStr = e.best_score.toLocaleString();
    return `<div class="${cls}">
      <span class="rank-medal">${medals[e.rank - 1] || e.rank}</span>
      <span class="rank-name" title="${e.email}">${name}</span>
      <span class="rank-score">${scoreStr}</span>
    </div>`;
  }).join('');
}

function startRankingPolling() {
  stopRankingPolling();
  fetchLiveRankings();
  rankingTimer = setInterval(fetchLiveRankings, 15_000);
}

function stopRankingPolling() {
  if (rankingTimer) { clearInterval(rankingTimer); rankingTimer = null; }
}

/* ── 점수 저장 API ── */
async function postScore(s, lv, ln) {
  try {
    await fetch('/api/scores', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SESSION_TOKEN}`,
      },
      body: JSON.stringify({ user_id: SESSION_USER_ID, score: s, level: lv, lines: ln }),
    });
  } catch (_) { /* 저장 실패 시 게임은 계속 */ }
}

/* ── 게임 시작 / 재시작 ── */
function startGame() {
  initAudio();
  board        = createBoard();
  score        = 0; linesCleared = 0; level = 1;
  dropInterval = 1000; dropCounter = 0; lastTime = 0;
  paused       = false; running = true;
  nextType     = randomType();
  spawnPiece();
  updateHUD();
  overlay.style.display = 'none';
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
  startRankingPolling();
}

/* ── 게임오버 일본어 남성 음성 ── */
function speakGameOver() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const voices = window.speechSynthesis.getVoices();
  const jaVoice = voices.find(v =>
    v.lang.startsWith('ja') && /male|man/i.test(v.name)
  ) || voices.find(v => v.lang.startsWith('ja'));

  function shout(text, delay, rate, pitch) {
    const u  = new SpeechSynthesisUtterance(text);
    u.lang   = 'ja-JP';
    u.rate   = rate;
    u.pitch  = pitch;
    u.volume = 1.0;
    if (jaVoice) u.voice = jaVoice;
    setTimeout(() => window.speechSynthesis.speak(u), delay);
  }

  /* "ゲームッ…" → 잠깐의 간격 → "オーバー！！！" 로 두 번에 나눠 외침 */
  shout('ゲームッ',   0,   0.75, 0.55);
  shout('オーバー！', 220, 0.65, 0.50);
}

/* ── 게임 오버 ── */
function gameOver() {
  running = false;
  cancelAnimationFrame(animId);
  playGameOver();
  stopRankingPolling();
  speakGameOver();

  overlay.innerHTML = `
    <p class="overlay-title">GAME OVER</p>
    <p class="overlay-sub">SCORE: ${score.toLocaleString()}</p>
    <p class="overlay-sub" style="color:#5555aa;font-size:0.4rem">점수 저장 중...</p>
  `;
  overlay.style.display = 'flex';

  postScore(score, level, linesCleared).finally(() => {
    fetchLiveRankings();
    overlay.innerHTML = `
      <p class="overlay-title">GAME OVER</p>
      <p class="overlay-sub">SCORE: ${score.toLocaleString()}</p>
      <button class="btn" id="action-btn">RESTART</button>
    `;
    document.getElementById('action-btn').addEventListener('click', startGame);
  });
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

/* ── 터치 입력 (모바일 지원) ── */
let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
const SWIPE_THRESHOLD  = 30;
const TAP_MAX_DISTANCE = 10;
const TAP_MAX_DURATION = 200;

boardCanvas.addEventListener('touchstart', e => {
  if (!running || paused) return;
  e.preventDefault();
  touchStartX    = e.touches[0].clientX;
  touchStartY    = e.touches[0].clientY;
  touchStartTime = Date.now();
}, { passive: false });

boardCanvas.addEventListener('touchend', e => {
  if (!running || paused) return;
  e.preventDefault();
  const dx   = e.changedTouches[0].clientX - touchStartX;
  const dy   = e.changedTouches[0].clientY - touchStartY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const dt   = Date.now() - touchStartTime;

  if (dist < TAP_MAX_DISTANCE && dt < TAP_MAX_DURATION) {
    /* 탭 → 회전 */
    const rotated = rotate(piece);
    for (const offset of [0, -1, 1, -2, 2]) {
      if (!collides(rotated, pieceX + offset, pieceY)) {
        piece = rotated; pieceX += offset; break;
      }
    }
  } else if (dist >= SWIPE_THRESHOLD) {
    if (Math.abs(dx) > Math.abs(dy)) {
      /* 수평 스와이프 → 이동 */
      const dir = dx > 0 ? 1 : -1;
      if (!collides(piece, pieceX + dir, pieceY)) pieceX += dir;
    } else if (dy > 0) {
      /* 아래 스와이프 → 하드드롭 */
      hardDrop();
    }
  }
  draw();
}, { passive: false });

/* ── 모바일 버튼 이벤트 ── */
function addTouchBtn(id, action) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('touchstart', e => {
    e.preventDefault();
    if (running && !paused) { action(); draw(); }
  }, { passive: false });
  el.addEventListener('click', () => {
    if (running && !paused) { action(); draw(); }
  });
}

addTouchBtn('touch-left',   () => { if (!collides(piece, pieceX - 1, pieceY)) pieceX--; });
addTouchBtn('touch-right',  () => { if (!collides(piece, pieceX + 1, pieceY)) pieceX++; });
addTouchBtn('touch-drop',   () => hardDrop());
addTouchBtn('touch-rotate', () => {
  const rotated = rotate(piece);
  for (const offset of [0, -1, 1, -2, 2]) {
    if (!collides(rotated, pieceX + offset, pieceY)) {
      piece = rotated; pieceX += offset; break;
    }
  }
});

/* ── 시작 버튼 ── */
actionBtn.addEventListener('click', startGame);

/* ── 로그아웃 버튼 ── */
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.clear();
  window.location.replace('/');
});

/* ── 최초 랭킹 로드 ── */
fetchLiveRankings();
