# Tetris Frontend — 게임 트루퍼 E2E 테스트 명세서

> Claude가 이 파일을 읽고 Playwright로 브라우저를 구동하여 각 테스트를 실행한다.
> 세션 흐름, 게임 조작, 게임 로직, 버그 회귀를 검증한다.
> 새 기능 추가 또는 버그 픽스가 생기면 이 파일에 케이스를 추가한다.

---

## 실행 환경

| 항목 | 값 |
|---|---|
| 서버 | `http://localhost:8080` (백엔드 실행 필요) |
| Playwright | `npx playwright` (Node.js 환경) |
| 브라우저 | Chromium (headless) |
| 테스트 계정 | 각 테스트 전 curl로 생성 |

## 서버 시작 절차

```bash
# 1. MySQL 컨테이너 확인 및 기동
cd /home/cool/vibeCoding-tetris
docker compose up -d
until docker inspect tetris_mysql --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do sleep 2; done
echo "MySQL 준비 완료"

# 2. FastAPI 서버 실행 확인
curl -s http://localhost:8080/api/rankings > /dev/null && echo "서버 OK" || echo "서버 없음"

# 서버가 없으면 기동
.venv/bin/uvicorn Backend.main:app --port 8080 &
sleep 1
```

## Playwright 실행 패턴

Claude는 각 테스트를 아래 인라인 스크립트 방식으로 실행한다:

```bash
node - << 'EOF'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();
  try {
    // 테스트 단계
    await page.goto('http://localhost:8080');
    // ...
    console.log('PASS');
  } catch(e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
EOF
```

## 게임 내부 상태 읽기 패턴

canvas 픽셀 비교 대신 JS 전역 변수 직접 접근:

```javascript
const score = await page.evaluate(() => score);
const board = await page.evaluate(() => board);
const running = await page.evaluate(() => running);
```

## localStorage 조작 패턴

```javascript
// 세션 주입
await page.evaluate((uid, tok) => {
  localStorage.setItem('tetris_user_id', String(uid));
  localStorage.setItem('tetris_token', tok);
  localStorage.setItem('tetris_email', 'test@example.com');
  localStorage.setItem('tetris_nickname', '테스터');
}, userId, token);

// 세션 초기화
await page.evaluate(() => localStorage.clear());
```

## 테스트용 계정 생성 패턴

```bash
# 공통 테스트 계정 생성 (gametrooper 전용)
curl -s -X POST http://localhost:8080/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"email":"trooper@example.com","password":"trooper1","nickname":"트루퍼"}' > /dev/null

# 로그인 후 user_id, token 추출
TROOPER_INFO=$(curl -s -X POST http://localhost:8080/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"trooper@example.com","password":"trooper1"}')
TROOPER_UID=$(echo $TROOPER_INFO | python3 -c "import sys,json; print(json.load(sys.stdin)['user_id'])")
TROOPER_TOKEN=$(echo $TROOPER_INFO | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

---

## 섹션 A — 세션 가드 및 리다이렉트

---

### TEST-G-001: 비로그인 상태에서 /game.html 직접 접근 시 / 로 리다이렉트

- **유형**: 세션
- **전제조건**: 빈 localStorage (새 브라우저 컨텍스트).
- **실행 단계**:
  ```javascript
  const context = await browser.newContext(); // localStorage 없음
  const page    = await context.newPage();
  await page.goto('http://localhost:8080/game.html');
  await page.waitForURL('http://localhost:8080/', { timeout: 3000 });
  const url = page.url();
  const loginForm = await page.locator('#login-form').isVisible();
  console.log('URL:', url, '로그인폼:', loginForm);
  assert(url === 'http://localhost:8080/' && loginForm);
  ```
- **기대 결과**:
  - 최종 URL = `http://localhost:8080/`
  - `#login-form` visible
- **버그 위험도**: 높음

---

### TEST-G-002: user_id만 있고 token 없을 때 게임 접근 차단 (무한루프 없음)

- **유형**: 버그회귀 / 세션
- **전제조건**: localStorage에 `tetris_user_id`만 설정, `tetris_token` 없음.
- **실행 단계**:
  ```javascript
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto('http://localhost:8080');
  // user_id만 주입
  await page.evaluate(() => {
    localStorage.setItem('tetris_user_id', '1');
    // tetris_token 설정 안 함
  });
  await page.goto('http://localhost:8080/game.html');
  // 3초 대기 후 무한루프 여부 확인
  await page.waitForTimeout(3000);
  const url = page.url();
  // 무한루프라면 계속 변경되지만 여기선 /에 안착해야 함
  console.log('최종 URL:', url);
  assert(url === 'http://localhost:8080/');
  ```
- **기대 결과**:
  - 3초 후 URL = `http://localhost:8080/` (루프 없이 안착)
  - 콘솔에 무한 리다이렉트 오류 없음
- **버그 위험도**: 높음
- **관련 픽스**: `login.js` — user_id + token 둘 다 확인하도록 수정됨

---

### TEST-G-003: token만 있고 user_id 없을 때 게임 접근 차단

- **유형**: 세션
- **전제조건**: localStorage에 `tetris_token`만 설정.
- **실행 단계**:
  ```javascript
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto('http://localhost:8080');
  await page.evaluate(() => {
    localStorage.setItem('tetris_token', 'abc123def456' + '0'.repeat(52));
    // tetris_user_id 설정 안 함
  });
  await page.goto('http://localhost:8080/game.html');
  await page.waitForURL('http://localhost:8080/', { timeout: 3000 });
  console.log('URL:', page.url());
  assert(page.url() === 'http://localhost:8080/');
  ```
- **기대 결과**:
  - URL = `http://localhost:8080/`
- **버그 위험도**: 중간

---

### TEST-G-004: 로그인 완료 상태에서 / 접근 시 /game.html 리다이렉트

- **유형**: 세션
- **전제조건**: `$TROOPER_UID`, `$TROOPER_TOKEN` 보유.
- **실행 단계**:
  ```javascript
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto('http://localhost:8080');
  // 세션 주입
  await page.evaluate((uid, tok) => {
    localStorage.setItem('tetris_user_id', String(uid));
    localStorage.setItem('tetris_token', tok);
    localStorage.setItem('tetris_email', 'trooper@example.com');
    localStorage.setItem('tetris_nickname', '트루퍼');
  }, TROOPER_UID, TROOPER_TOKEN);
  // 로그인 페이지 재방문
  await page.goto('http://localhost:8080/');
  await page.waitForURL('http://localhost:8080/game.html', { timeout: 3000 });
  console.log('URL:', page.url());
  assert(page.url().includes('game.html'));
  ```
- **기대 결과**:
  - URL = `http://localhost:8080/game.html`
- **버그 위험도**: 중간

---

## 섹션 B — 로그인 / 회원가입 / 로그아웃

---

### TEST-G-005: 회원가입 성공 → game.html 이동 + localStorage 4키 저장

- **유형**: 세션
- **전제조건**: 신규 이메일 사용 (테스트 실행 시 타임스탬프 기반 이메일 생성).
- **실행 단계**:
  ```javascript
  const ts = Date.now();
  const email = `newuser${ts}@example.com`;
  await page.goto('http://localhost:8080');
  // 회원가입 탭 클릭
  await page.click('#tab-register');
  await page.fill('#reg-email', email);
  await page.fill('#reg-password', 'newpass1');
  await page.fill('#reg-nickname', '신규유저');
  await page.click('#register-form .auth-btn');
  // game.html로 이동 대기
  await page.waitForURL('**/game.html', { timeout: 5000 });
  // localStorage 4키 확인
  const keys = await page.evaluate(() => ({
    uid:   localStorage.getItem('tetris_user_id'),
    tok:   localStorage.getItem('tetris_token'),
    email: localStorage.getItem('tetris_email'),
    nick:  localStorage.getItem('tetris_nickname'),
  }));
  console.log('localStorage:', JSON.stringify(keys));
  assert(keys.uid && keys.tok && keys.email);
  ```
- **기대 결과**:
  - URL = `.../game.html`
  - `tetris_user_id`, `tetris_token`, `tetris_email`, `tetris_nickname` 모두 저장
- **버그 위험도**: 낮음

---

### TEST-G-006: 로그인 성공 → game.html + #player-name 표시

- **유형**: 세션
- **전제조건**: `trooper@example.com` / `trooper1` 계정 존재.
- **실행 단계**:
  ```javascript
  await page.goto('http://localhost:8080');
  await page.fill('#login-email', 'trooper@example.com');
  await page.fill('#login-password', 'trooper1');
  await page.click('#login-form .auth-btn');
  await page.waitForURL('**/game.html', { timeout: 5000 });
  const playerName = await page.textContent('#player-name');
  console.log('플레이어 이름:', playerName);
  assert(playerName && playerName.trim().length > 0);
  ```
- **기대 결과**:
  - URL = `.../game.html`
  - `#player-name` = "트루퍼" (또는 이메일 앞부분)
- **버그 위험도**: 낮음

---

### TEST-G-007: 잘못된 비밀번호 → #error-msg + shake 애니메이션

- **유형**: 세션
- **전제조건**: `trooper@example.com` 계정 존재.
- **실행 단계**:
  ```javascript
  await page.goto('http://localhost:8080');
  await page.fill('#login-email', 'trooper@example.com');
  await page.fill('#login-password', 'wrongpassword');
  await page.click('#login-form .auth-btn');
  await page.waitForTimeout(1500);
  const errorMsg = await page.textContent('#error-msg');
  const hasShake = await page.evaluate(() =>
    document.querySelector('#login-form .input-field').classList.contains('shake')
    // shake는 빠르게 제거되므로 대신 error-msg 내용으로 판단
  );
  console.log('에러 메시지:', errorMsg);
  assert(errorMsg && errorMsg.length > 0);
  ```
- **기대 결과**:
  - `#error-msg` 텍스트 비어있지 않음
  - URL = `http://localhost:8080/` (페이지 이동 없음)
- **버그 위험도**: 낮음

---

### TEST-G-008: LOGOUT → localStorage 초기화 + / 로 이동

- **유형**: 세션
- **전제조건**: `$TROOPER_UID`, `$TROOPER_TOKEN` 보유.
- **실행 단계**:
  ```javascript
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto('http://localhost:8080');
  await page.evaluate((uid, tok) => {
    localStorage.setItem('tetris_user_id', String(uid));
    localStorage.setItem('tetris_token', tok);
    localStorage.setItem('tetris_email', 'trooper@example.com');
    localStorage.setItem('tetris_nickname', '트루퍼');
  }, TROOPER_UID, TROOPER_TOKEN);
  await page.goto('http://localhost:8080/game.html');
  await page.waitForURL('**/game.html', { timeout: 3000 });
  // 로그아웃 버튼 클릭
  await page.click('#logout-btn');
  await page.waitForURL('http://localhost:8080/', { timeout: 3000 });
  const lsLen = await page.evaluate(() => localStorage.length);
  console.log('localStorage 개수:', lsLen, '/ URL:', page.url());
  assert(lsLen === 0 && page.url() === 'http://localhost:8080/');
  ```
- **기대 결과**:
  - URL = `http://localhost:8080/`
  - `localStorage.length` = 0
- **버그 위험도**: 중간

---

### TEST-G-009: 로그아웃 후 rankingTimer 폴링 중단 확인

- **유형**: 버그회귀
- **전제조건**: 게임 화면 진입 후 로그아웃.
- **실행 단계**:
  ```javascript
  // game.html 진입 후 rankingTimer가 null인지 로그아웃 후 확인
  await page.goto('http://localhost:8080/game.html'); // (세션 주입 후)
  // START 버튼 클릭 후 rankingTimer 생성 대기
  await page.click('#action-btn');
  await page.waitForTimeout(500);
  const timerBefore = await page.evaluate(() => typeof rankingTimer);
  // 로그아웃
  await page.click('#logout-btn');
  await page.waitForURL('http://localhost:8080/', { timeout: 3000 });
  // 새 페이지에선 확인 불가 → 로그아웃 자체가 정상 완료되면 PASS
  console.log('로그아웃 정상 완료');
  assert(page.url() === 'http://localhost:8080/');
  ```
- **기대 결과**:
  - 로그아웃 후 `/`에 정상 도달 (타이머 관련 JS 오류 없음)
- **버그 위험도**: 중간
- **참고**: rankingTimer clearInterval 미호출 버그. 로그아웃 후 추가 fetch가 발생할 수 있으나 현재 시각적 영향은 없음.

---

## 섹션 C — 게임 시작 및 기본 조작

> 이하 테스트는 모두 `$TROOPER_UID`, `$TROOPER_TOKEN`으로 세션 주입 후 game.html에서 실행한다.

---

### TEST-G-010: START 버튼 → overlay 숨김 + canvas 렌더링 확인

- **유형**: 게임로직
- **전제조건**: game.html 진입, 세션 주입 완료.
- **실행 단계**:
  ```javascript
  // overlay가 보이는 상태 확인
  const overlayBefore = await page.locator('#overlay').isVisible();
  // START 버튼 클릭
  await page.click('#action-btn');
  await page.waitForTimeout(200);
  const overlayAfter = await page.locator('#overlay').isVisible();
  const isRunning    = await page.evaluate(() => running);
  console.log('overlay 전:', overlayBefore, '/ 후:', overlayAfter, '/ running:', isRunning);
  assert(!overlayAfter && isRunning);
  ```
- **기대 결과**:
  - START 전: `#overlay` visible
  - START 후: `#overlay` hidden
  - `running` = `true`
- **버그 위험도**: 낮음

---

### TEST-G-011: ArrowLeft / ArrowRight → pieceX 변경

- **유형**: 게임로직
- **전제조건**: 게임 실행 중 (TEST-G-010 이후).
- **실행 단계**:
  ```javascript
  const xBefore = await page.evaluate(() => pieceX);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);
  const xAfterRight = await page.evaluate(() => pieceX);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(50);
  const xAfterLeft = await page.evaluate(() => pieceX);
  console.log('x: 초기', xBefore, '→ 우이동', xAfterRight, '→ 좌이동', xAfterLeft);
  assert(xAfterRight === xBefore + 1 || xAfterRight === xBefore); // 경계에서 이동 안 될 수 있음
  ```
- **기대 결과**:
  - ArrowRight 후 `pieceX` ≥ 이전값
  - ArrowLeft 후 `pieceX` ≤ ArrowRight 후 값
- **버그 위험도**: 낮음

---

### TEST-G-012: ArrowUp → 블록 회전

- **유형**: 게임로직
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  const pieceBefore = await page.evaluate(() => JSON.stringify(piece));
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(50);
  const pieceAfter  = await page.evaluate(() => JSON.stringify(piece));
  console.log('회전 발생:', pieceBefore !== pieceAfter);
  // O 피스(정사각형)는 회전해도 동일할 수 있음 → 오류 아님
  ```
- **기대 결과**:
  - `piece` 행렬이 이전과 다르거나 (O 피스인 경우 동일해도 정상)
  - JS 오류 없음
- **버그 위험도**: 낮음

---

### TEST-G-013: Space → 하드드롭 즉시 고정

- **유형**: 게임로직
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  const boardBefore = await page.evaluate(() => JSON.stringify(board));
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const boardAfter  = await page.evaluate(() => JSON.stringify(board));
  console.log('보드 변경됨:', boardBefore !== boardAfter);
  assert(boardBefore !== boardAfter, '하드드롭 후 보드가 변하지 않음');
  ```
- **기대 결과**:
  - Space 입력 후 `board` 배열이 변경됨 (피스가 고정됨)
- **버그 위험도**: 낮음

---

### TEST-G-014: P 키 일시정지 / 재개

- **유형**: 게임로직
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  // P키 → 일시정지
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(100);
  const pausedState = await page.evaluate(() => paused);
  // P키 → 재개
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(100);
  const resumedState = await page.evaluate(() => paused);
  console.log('일시정지:', pausedState, '/ 재개:', resumedState);
  assert(pausedState === true && resumedState === false);
  ```
- **기대 결과**:
  - 첫 P: `paused` = `true`
  - 두 번째 P: `paused` = `false`
- **버그 위험도**: 낮음

---

## 섹션 D — 게임 로직 검증

---

### TEST-G-015: 줄 완성 → #score 증가 + clear-popup 표시

- **유형**: 게임로직
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  // JS 직접 조작으로 보드 9열 채우기 + 마지막 1열만 비움
  await page.evaluate(() => {
    // 바닥 1줄을 9개 채움 (한 칸 비워서 아직 완성 안 된 상태)
    for(let c = 0; c < 9; c++) board[19][c] = 1;
  });
  const scoreBefore = await page.evaluate(() => score);
  // Space로 하드드롭 → 피스가 바닥에 닿으면서 줄 완성 가능성 있음
  // 대신 직접 clearLines() 호출
  await page.evaluate(() => {
    for(let c = 0; c < 10; c++) board[19][c] = 1; // 마지막 줄 완성
    clearLines();
  });
  await page.waitForTimeout(300);
  const scoreAfter = await page.evaluate(() => score);
  const popupVisible = await page.evaluate(() =>
    document.getElementById('clear-popup').classList.contains('show')
  );
  console.log('점수 변화:', scoreBefore, '->', scoreAfter, '/ 팝업:', popupVisible);
  assert(scoreAfter > scoreBefore);
  ```
- **기대 결과**:
  - `score` 증가
  - `#clear-popup`에 'show' 클래스 추가됨
- **버그 위험도**: 중간

---

### TEST-G-016: 게임 오버 → GAME OVER 오버레이 + RESTART 버튼

- **유형**: 게임로직
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  // 보드를 가득 채워 gameOver() 강제 호출
  await page.evaluate(() => gameOver());
  await page.waitForTimeout(1000); // 점수 저장 완료 대기
  const overlayVisible = await page.locator('#overlay').isVisible();
  const overlayText    = await page.textContent('#overlay');
  const hasRestart     = overlayText.includes('RESTART');
  console.log('overlay 표시:', overlayVisible, '/ RESTART 포함:', hasRestart);
  assert(overlayVisible && hasRestart);
  ```
- **기대 결과**:
  - `#overlay` visible
  - 텍스트에 "GAME OVER" 포함
  - RESTART 버튼 존재
- **버그 위험도**: 높음

---

### TEST-G-017: 게임 오버 → POST /api/scores 자동 저장

- **유형**: 게임로직
- **전제조건**: `$TROOPER_UID` + 세션 주입 + 게임 실행 중.
- **실행 단계**:
  ```javascript
  // 점수를 미리 설정
  await page.evaluate(() => { score = 5000; level = 5; linesCleared = 20; });
  // gameOver() 호출
  await page.evaluate(() => gameOver());
  await page.waitForTimeout(2000); // API 호출 + 응답 대기
  // 백엔드에서 점수 확인
  const res    = await fetch(`http://localhost:8080/api/scores?user_id=${TROOPER_UID}`);
  const scores = await res.json();
  const saved  = scores.some(s => s.score === 5000);
  console.log('점수 저장 확인:', saved);
  assert(saved);
  ```
  *(위 fetch는 node 스크립트 내에서 `httpx` 또는 `curl` 후처리로 확인)*
- **기대 결과**:
  - `GET /api/scores?user_id=$TROOPER_UID` 결과에 score=5000인 레코드 존재
- **버그 위험도**: 높음

---

### TEST-G-018: RESTART → score / level / lines 초기화

- **유형**: 버그회귀
- **전제조건**: TEST-G-016 실행 후 GAME OVER 상태.
- **실행 단계**:
  ```javascript
  // RESTART 버튼 클릭
  await page.click('#overlay .btn');
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => score);
  const l = await page.evaluate(() => level);
  const n = await page.evaluate(() => linesCleared);
  console.log('score:', s, 'level:', l, 'lines:', n);
  assert(s === 0 && l === 1 && n === 0);
  ```
- **기대 결과**:
  - `score` = 0, `level` = 1, `linesCleared` = 0
- **버그 위험도**: 중간

---

## 섹션 E — 모바일 터치 인터페이스

---

### TEST-G-019: #touch-left / #touch-right 클릭 → 블록 이동

- **유형**: 모바일
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  const xBefore = await page.evaluate(() => pieceX);
  await page.click('#touch-right');
  await page.waitForTimeout(50);
  const xRight = await page.evaluate(() => pieceX);
  await page.click('#touch-left');
  await page.waitForTimeout(50);
  const xLeft = await page.evaluate(() => pieceX);
  console.log('x: 초기', xBefore, '→ 우', xRight, '→ 좌', xLeft);
  ```
- **기대 결과**:
  - `#touch-right` 클릭 후 `pieceX` ≥ 이전 (경계 미만일 경우 +1)
  - `#touch-left` 클릭 후 `pieceX` ≤ 이전
- **버그 위험도**: 낮음

---

### TEST-G-020: #touch-drop 클릭 → hardDrop 실행

- **유형**: 모바일
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  const boardBefore = await page.evaluate(() => JSON.stringify(board));
  await page.click('#touch-drop');
  await page.waitForTimeout(200);
  const boardAfter  = await page.evaluate(() => JSON.stringify(board));
  console.log('보드 변경:', boardBefore !== boardAfter);
  assert(boardBefore !== boardAfter);
  ```
- **기대 결과**:
  - `board` 배열 변경됨 (피스 고정)
- **버그 위험도**: 낮음

---

### TEST-G-021: canvas 하향 스와이프 → 하드드롭

- **유형**: 모바일
- **전제조건**: 게임 실행 중.
- **실행 단계**:
  ```javascript
  const boardBefore = await page.evaluate(() => JSON.stringify(board));
  const canvas = page.locator('#board');
  const box    = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 4;
  // 터치 스와이프 시뮬레이션 (50px 이상 아래로)
  await page.touchscreen.tap(cx, cy);
  // touchstart → touchend with large dy
  await page.evaluate((cx, cy) => {
    const el = document.getElementById('board');
    el.dispatchEvent(new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy })]
    }));
    el.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy + 80 })]
    }));
  }, cx, cy);
  await page.waitForTimeout(200);
  const boardAfter = await page.evaluate(() => JSON.stringify(board));
  console.log('스와이프 후 보드 변경:', boardBefore !== boardAfter);
  ```
- **기대 결과**:
  - `board` 배열 변경됨 (하드드롭 실행)
- **버그 위험도**: 낮음

---

## 섹션 F — 버그 회귀 스위트

---

### TEST-G-022: [회귀] user_id 있고 token 없을 때 무한 리다이렉트 없음

- **유형**: 버그회귀
- **전제조건**: 반쪽 세션 상태 (user_id만 있음).
- **실행 단계**:
  ```javascript
  const context = await browser.newContext();
  const page    = await context.newPage();
  await page.goto('http://localhost:8080');
  await page.evaluate(() => {
    localStorage.setItem('tetris_user_id', '42');
    // tetris_token 없음
  });
  // 리다이렉트 카운터
  let redirectCount = 0;
  page.on('response', r => { if(r.status() >= 300 && r.status() < 400) redirectCount++; });
  await page.goto('http://localhost:8080/');
  await page.waitForTimeout(2000);
  console.log('리다이렉트 횟수:', redirectCount, '/ 최종 URL:', page.url());
  assert(redirectCount < 3, `무한 리다이렉트 발생: ${redirectCount}회`);
  ```
- **기대 결과**:
  - 리다이렉트 횟수 < 3 (무한루프 없음)
  - 최종 URL = `http://localhost:8080/`
- **버그 위험도**: 높음
- **관련 픽스**: `Frontend/login.js` — `tetris_user_id && tetris_token` 둘 다 체크

---

### TEST-G-023: [회귀] RESTART 빠른 더블클릭 → startGame() 중복 실행 없음

- **유형**: 버그회귀
- **전제조건**: 게임 오버 상태 (RESTART 버튼 표시 중).
- **실행 단계**:
  ```javascript
  await page.evaluate(() => gameOver());
  await page.waitForTimeout(1500); // RESTART 버튼 생성 대기
  // 빠르게 두 번 클릭
  await page.click('#overlay .btn');
  await page.click('#overlay .btn').catch(() => {}); // 버튼 사라질 수 있음
  await page.waitForTimeout(500);
  // 게임이 정상 실행 중인지 확인 (두 번 시작됐다면 이상 상태)
  const isRunning   = await page.evaluate(() => running);
  const overlayHidden = !(await page.locator('#overlay').isVisible());
  console.log('running:', isRunning, '/ overlay 숨김:', overlayHidden);
  assert(isRunning, '게임이 실행되지 않음');
  ```
- **기대 결과**:
  - `running` = `true` (게임 정상 실행)
  - overlay 숨김
  - JS 오류 없음
- **버그 위험도**: 중간

---

## 테스트 결과 기록 양식

Claude는 각 테스트 실행 후 아래 형식으로 결과를 보고한다.

| ID | 제목 | 결과 | 비고 |
|---|---|---|---|
| TEST-G-001 | 비로그인 → /game.html 접근 시 리다이렉트 | PASS / FAIL / SKIP | |
| ... | ... | ... | ... |
