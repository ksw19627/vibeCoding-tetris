/* ── 이미 로그인된 경우 게임으로 ── */
if (localStorage.getItem('tetris_user_id') && localStorage.getItem('tetris_token')) {
  window.location.replace('/game.html');
}

const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.]+$/;
const MEDALS   = ['🥇', '🥈', '🥉', '4', '5', '6', '7', '8', '9', '10'];

/* ── 탭 전환 ── */
function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login')   .classList.toggle('active',  isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-form')   .classList.toggle('hidden',  !isLogin);
  document.getElementById('register-form').classList.toggle('hidden',   isLogin);
  clearError();
}

/* ── 오류 표시 ── */
function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
}

function clearError() {
  document.getElementById('error-msg').textContent = '';
}

function shakeInputs(formId) {
  document.querySelectorAll(`#${formId} .input-field`).forEach(el => {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  });
}

/* ── localStorage 저장 후 게임으로 이동 ── */
function saveSessionAndRedirect(data) {
  localStorage.setItem('tetris_user_id', data.user_id);
  localStorage.setItem('tetris_email',   data.email);
  localStorage.setItem('tetris_nickname', data.nickname || '');
  localStorage.setItem('tetris_token',   data.token);
  window.location.replace('/game.html');
}

/* ── 로그인 폼 ── */
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearError();
  const btn      = e.target.querySelector('.auth-btn');
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res  = await fetch('/api/users/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      saveSessionAndRedirect(data);
    } else {
      showError(data.detail || '로그인 실패');
      shakeInputs('login-form');
    }
  } catch (_) {
    showError('서버에 연결할 수 없습니다.');
    shakeInputs('login-form');
  } finally {
    btn.disabled = false;
    btn.textContent = 'LOGIN';
  }
});

/* ── 회원가입 폼 ── */
document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearError();
  const btn      = e.target.querySelector('.auth-btn');
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const nickname = document.getElementById('reg-nickname').value.trim() || null;

  if (!EMAIL_RE.test(email)) {
    showError('올바른 이메일 형식이 아닙니다.');
    shakeInputs('register-form');
    return;
  }
  if (password.length < 6) {
    showError('비밀번호는 6자 이상이어야 합니다.');
    shakeInputs('register-form');
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res  = await fetch('/api/users/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, nickname }),
    });
    const data = await res.json();

    if (res.status === 201) {
      /* 자동 로그인 */
      const loginRes  = await fetch('/api/users/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const loginData = await loginRes.json();
      if (loginRes.ok) {
        saveSessionAndRedirect(loginData);
      }
    } else if (res.status === 409) {
      showError('이미 사용 중인 이메일입니다.');
      shakeInputs('register-form');
    } else {
      const detail = data.detail;
      const msg = Array.isArray(detail)
        ? detail.map(e => e.msg).join(', ')
        : (detail || '회원가입 실패');
      showError(msg);
      shakeInputs('register-form');
    }
  } catch (_) {
    showError('서버에 연결할 수 없습니다.');
    shakeInputs('register-form');
  } finally {
    btn.disabled = false;
    btn.textContent = 'REGISTER';
  }
});

/* ── 랭킹 마퀴 ── */
async function fetchRankings() {
  try {
    const res  = await fetch('/api/rankings?limit=10');
    const data = await res.json();
    renderMarquee(data);
  } catch (_) { /* 조용히 실패 */ }
}

function renderMarquee(entries) {
  const track = document.getElementById('marquee-track');
  if (!entries || entries.length === 0) {
    track.innerHTML = '<div class="rank-placeholder">첫 번째 기록의 주인공이 되어보세요!</div>';
    return;
  }

  track.innerHTML = '';

  /* 항목 하나당 차지할 높이(%) 계산: 트랙 높이 140px 기준 */
  const itemH    = 100 / entries.length; /* 퍼센트 단위 */
  const duration = entries.length * 2.2; /* 전체 사이클 (초) */

  entries.forEach((e, i) => {
    const el   = document.createElement('div');
    el.className   = 'marquee-item';
    el.dataset.rank = e.rank;

    const name     = e.nickname || e.email.split('@')[0];
    const medal    = MEDALS[e.rank - 1] || e.rank;
    const scoreStr = e.best_score.toLocaleString();

    el.innerHTML = `
      <span class="m-rank">${medal}</span>
      <span class="m-name" title="${e.email}">${name}</span>
      <span class="m-score">${scoreStr}</span>
    `;

    /* 각 항목이 순서대로 위로 흘러올라가도록 딜레이 설정 */
    const delay  = -(duration - i * (duration / entries.length));
    el.style.top            = `${i * itemH}%`;
    el.style.animationName       = 'floatUp';
    el.style.animationDuration   = `${duration}s`;
    el.style.animationDelay      = `${delay}s`;
    el.style.animationIterationCount = 'infinite';
    el.style.animationTimingFunction = 'linear';

    track.appendChild(el);
  });
}

/* ── 초기 실행 ── */
fetchRankings();
setInterval(fetchRankings, 30_000);
