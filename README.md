# TETRIS

우주 최강 테트리스 랭킹에 도전하는 웹 기반 테트리스 게임.

---

## 1. 개요

클래식 테트리스 룰을 따르는 멀티유저 랭킹 게임이다. 회원가입 후 로그인하면 바로 플레이할 수 있으며, 게임 오버 시 점수가 자동으로 서버에 저장된다. 실시간으로 갱신되는 랭킹 보드에서 다른 플레이어와 최고 점수를 겨룬다.

**주요 특징**
- 회원가입 · 로그인 기반의 개인 점수 관리
- 게임 오버 시 점수 자동 저장 및 글로벌 랭킹 반영
- 고스트 피스(낙하 위치 미리보기) 지원
- 줄 제거 시 팝업 텍스트 + 음성 피드백 (Web Speech API)
- Web Audio API 기반 효과음 (블록 고정 · 줄 제거 · 게임 오버)
- 로그인 페이지에서 글로벌 랭킹 실시간 마퀴 표시
- 모바일 터치 지원 (스와이프 · 탭 · 버튼 UI)

---

## 2. 조작법

### 키보드

| 키 | 동작 |
|----|------|
| `←` `→` | 블록 좌우 이동 |
| `↑` | 블록 회전 (시계방향 90°) |
| `↓` | 블록 빠르게 내리기 |
| `Space` | 즉시 낙하 (하드드롭) |
| `P` | 일시정지 / 재개 |

### 터치 (모바일)

| 제스처 | 동작 |
|--------|------|
| 탭 | 블록 회전 |
| 좌우 스와이프 | 블록 이동 |
| 아래 스와이프 | 즉시 낙하 |
| ◀ ↻ ▼▼ ▶ 버튼 | 이동 · 회전 · 즉시 낙하 |

### 점수 체계

| 줄 제거 수 | 기본 점수 |
|-----------|-----------|
| 1줄 | 100 × 레벨 |
| 2줄 | 300 × 레벨 |
| 3줄 | 500 × 레벨 |
| 4줄 (테트리스) | 800 × 레벨 |

10줄마다 레벨이 오르고 블록 낙하 속도가 빨라진다.

---

## 3. 기술 스택 및 구현

### 프론트엔드

| 항목 | 내용 |
|------|------|
| 언어 | HTML5 · CSS3 · Vanilla JavaScript (ES2022) |
| 렌더링 | HTML5 Canvas API (300 × 600 px, 셀 30 px) |
| 사운드 | Web Audio API — 블록 고정 · 줄 제거 화음 · 게임 오버 |
| 음성 | Web Speech API — 줄 제거 멘트(영어) · 게임 오버(일본어) |
| 세션 | `localStorage` — `user_id` · `email` · `nickname` · `token` |
| 폰트 | Google Fonts — Press Start 2P |

**구현 포인트**
- **게임 루프**: `requestAnimationFrame` 기반, 경과 시간(`dt`)으로 낙하 간격 제어
- **회전**: 시계방향 90° 행렬 변환 + SRS-lite 벽 킥 (오프셋 `[0, -1, 1, -2, 2]` 순서 시도)
- **고스트 피스**: 현재 피스에서 충돌 없이 내려갈 수 있는 최하단 Y를 계산하여 반투명 렌더링
- **랭킹 폴링**: 게임 중 15초 간격으로 `GET /api/rankings` 호출, 로그인 페이지는 30초 간격
- **인증**: 로그인 응답의 `token`을 `localStorage`에 저장, 점수 저장 시 `Authorization: Bearer <token>` 헤더로 전송

---

### 백엔드

| 항목 | 내용 |
|------|------|
| 언어 | Python 3.10 |
| 프레임워크 | FastAPI |
| 데이터베이스 | MySQL 8.0 (Docker Compose) |
| 비밀번호 해싱 | bcrypt (cost factor 12) |
| 인증 | Bearer 토큰 (`secrets.token_hex(32)`) |
| 정적 파일 서빙 | `StaticFiles` 마운트 (`/` 경로) |

**DB 스키마**

```
users  : id, email, password(bcrypt), nickname, token, created_at
scores : id, user_id(FK), score, level, lines, played_at
```

**API 목록**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/users/register` | 회원가입 |
| `POST` | `/api/users/login` | 로그인 (토큰 발급) |
| `GET` | `/api/users/{user_id}` | 유저 정보 조회 |
| `PUT` | `/api/users/{user_id}` | 닉네임 수정 |
| `DELETE` | `/api/users/{user_id}` | 회원 탈퇴 |
| `POST` | `/api/scores` | 점수 저장 (인증 필요) |
| `GET` | `/api/scores` | 점수 목록 조회 (`?user_id=` 필터) |
| `GET` | `/api/scores/{score_id}` | 개별 점수 조회 |
| `PUT` | `/api/scores/{score_id}` | 점수 수정 |
| `DELETE` | `/api/scores/{score_id}` | 점수 삭제 |
| `GET` | `/api/rankings` | 유저별 최고 점수 랭킹 (`?limit=1~100`) |

---

## 프로젝트 구조

```
vibeCoding-tetris/
├── README.md
├── docker-compose.yml    # MySQL 8.0 컨테이너 정의
├── .env                  # DB 접속 정보 (gitignore 대상)
├── Backend/
│   ├── main.py           # FastAPI 앱 (API + 정적 파일 서빙)
│   ├── requirements.txt  # Python 의존성
│   └── migrate.py        # SQLite → MySQL 1회성 마이그레이션 스크립트
└── Frontend/
    ├── index.html        # 로그인 · 회원가입 페이지
    ├── login.js          # 인증 로직 · 랭킹 마퀴
    ├── login.css         # 로그인 UI 스타일
    ├── game.html         # 게임 페이지
    ├── game.js           # 테트리스 게임 엔진
    └── game.css          # 게임 UI 스타일
```

---

## 실행 방법

### Backend — Docker Compose (MySQL)

프로젝트 루트(`vibeCoding-tetris/`)에서 아래 명령을 순서대로 실행한다.

**1. MySQL 컨테이너 기동**
```bash
docker compose up -d
```

**2. MySQL 동작 확인**
```bash
# 컨테이너 상태 확인 (STATUS 컬럼이 healthy 가 될 때까지 대기)
docker compose ps

# MySQL 직접 접속하여 확인
docker exec -it tetris_mysql mysql -utetris_user -ptetris_pass tetris -e "SHOW TABLES;"
```

> 처음 기동 시 MySQL 초기화에 10~30초가 걸릴 수 있다. `healthy` 상태 확인 후 다음 단계로 진행한다.

**3. 가상환경 생성 (최초 1회)**
```bash
uv venv .venv
```

**4. 의존성 설치 (최초 1회 또는 requirements.txt 변경 시)**
```bash
uv pip install -r Backend/requirements.txt --python .venv/bin/python
```

**5. 기존 SQLite 데이터 마이그레이션 (최초 1회, 기존 데이터가 있는 경우)**
```bash
.venv/bin/python Backend/migrate.py
```

**6. 서버 실행**
```bash
# 방법 A — 가상환경 활성화 후 실행
source .venv/bin/activate
uvicorn Backend.main:app --reload

# 방법 B — 가상환경 경로 직접 지정
.venv/bin/uvicorn Backend.main:app --reload
```

> `--reload` 옵션은 개발 시 소스 변경을 자동 반영한다. 운영 환경에서는 제거한다.

**7. 서버 종료 및 컨테이너 중지**
```bash
# 서버 종료
Ctrl + C

# MySQL 컨테이너 중지 (데이터 유지)
docker compose stop

# MySQL 컨테이너 + 볼륨 완전 삭제 (데이터 초기화)
docker compose down -v
```

---

### Frontend — 브라우저

서버 실행 후 별도 빌드 없이 브라우저에서 바로 접속한다.  
Frontend 파일은 FastAPI `StaticFiles`로 자동 서빙되므로 별도 웹서버가 필요 없다.

**1. 브라우저에서 접속**
```
http://localhost:8000
```

**2. 회원가입**
- `REGISTER` 탭 선택
- 이메일 · 비밀번호(6자 이상) · 닉네임(선택) 입력 후 `REGISTER` 클릭
- 가입 완료 후 자동으로 게임 화면으로 이동

**3. 로그인 (기존 계정)**
- `LOGIN` 탭에서 이메일 · 비밀번호 입력 후 `LOGIN` 클릭

**4. 게임 플레이**
- 게임 화면에서 `START` 버튼 클릭 후 플레이
- 게임 오버 시 점수 자동 저장 → `RESTART` 버튼으로 재시작

**5. 로그아웃**
- 게임 화면 우측 하단 `LOGOUT` 버튼 클릭
