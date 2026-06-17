# Tetris Backend API — 단위 테스트 명세서

> Claude가 이 파일을 읽고 curl / Python httpx로 각 테스트를 실행한다.
> 새 엔드포인트나 버그 픽스가 생기면 이 파일에 케이스를 추가한다.

---

## 실행 환경

| 항목 | 값 |
|---|---|
| Python | `.venv/bin/python` (3.10) |
| 서버 기동 | `.venv/bin/uvicorn Backend.main:app --port 8080` |
| BASE_URL | `http://localhost:8080` |
| DB | `Backend/tetris.db` |

## 서버 시작 절차

```bash
# 1. 프로젝트 루트로 이동
cd /home/cool/vibeCoding/kosa-vibecoding-2026-3rd/src/exercise/ksw19627/day02/vibeCoding-tetris

# 2. MySQL 컨테이너 기동 (이미 실행 중이면 건너뜀)
docker compose up -d
# healthy 상태 대기 (최대 30초)
until docker inspect tetris_mysql --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do sleep 2; done
echo "MySQL 준비 완료"

# 3. 클린 테스트 DB 확보 — 기존 테스트 데이터 삭제
docker exec tetris_mysql mysql -utetris_user -ptetris_pass tetris \
  -e "DELETE FROM scores; DELETE FROM users;" 2>/dev/null || true

# 4. 백그라운드 서버 기동
.venv/bin/uvicorn Backend.main:app --port 8080 &
sleep 1

# 5. 서버 응답 확인
curl -s http://localhost:8080/api/rankings > /dev/null && echo "서버 OK" || echo "서버 기동 실패"
```

## 테스트 완료 후 정리

```bash
kill $(lsof -t -i:8080) 2>/dev/null
# MySQL 컨테이너는 계속 실행 유지 (데이터 보존)
```

## 테스트 간 값 공유

Claude는 테스트 실행 중 생성된 `user_id`, `token` 등을 다음 테스트에서 변수처럼 활용한다.
예: TEST-U-001에서 생성된 user_id를 TEST-U-014~021에서 재사용.

---

## 섹션 1 — 회원가입 (POST /api/users/register)

---

### TEST-U-001: 정상 회원가입 — 닉네임 포함

- **목적**: 유효한 이메일·비밀번호·닉네임으로 회원가입 시 201과 UserResponse를 반환하는지 확인한다.
- **전제조건**: 서버 실행 중, `test001@example.com`이 DB에 없어야 함.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test001@example.com","password":"pass01","nickname":"테스터"}'
  ```
- **기대 결과**:
  - HTTP **201**
  - 응답 JSON에 `id`(정수), `email`="test001@example.com", `nickname`="테스터", `created_at`(ISO 문자열) 포함
  - `password` 필드 없음

---

### TEST-U-002: 정상 회원가입 — 닉네임 없음

- **목적**: `nickname` 생략 시 `null`로 반환되는지 확인한다.
- **전제조건**: `test002@example.com`이 DB에 없어야 함.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test002@example.com","password":"pass02"}'
  ```
- **기대 결과**:
  - HTTP **201**
  - `nickname` 필드 = `null`

---

### TEST-U-003: 이메일 형식 오류 → 400

- **목적**: 유효하지 않은 이메일 형식 전송 시 400을 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/register \
    -H "Content-Type: application/json" \
    -d '{"email":"notanemail","password":"pass03"}'
  ```
- **기대 결과**:
  - HTTP **400**
  - `detail` 필드에 이메일 형식 오류 메시지 포함

---

### TEST-U-004: 비밀번호 5자 미달 → 422

- **목적**: Pydantic `min_length=6` 검증이 서버에서도 동작하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test004@example.com","password":"ab12"}'
  ```
- **기대 결과**:
  - HTTP **422**
  - `detail` 배열에 password 최소 길이 관련 메시지 포함

---

### TEST-U-005: 중복 이메일 → 409

- **목적**: 동일 이메일 두 번 등록 시 두 번째 요청에서 409를 반환하는지 확인한다.
- **전제조건**: TEST-U-001 실행 후 `test001@example.com`이 DB에 존재해야 함.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test001@example.com","password":"another"}'
  ```
- **기대 결과**:
  - HTTP **409**
  - `detail` = "이미 사용 중인 이메일입니다."

---

### TEST-U-006: 빈 이메일 → 400 또는 422

- **목적**: `email=""` 전송 시 서버가 400 또는 422로 거부하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/register \
    -H "Content-Type: application/json" \
    -d '{"email":"","password":"pass06"}'
  ```
- **기대 결과**:
  - HTTP **400** 또는 **422** (400 우선; EMAIL_RE가 빈 문자열을 거부)

---

### TEST-U-007: 응답에 password 필드 미포함

- **목적**: UserResponse에 해시된 비밀번호가 노출되지 않는지 확인한다.
- **전제조건**: TEST-U-001 또는 TEST-U-002 응답 참조.
- **실행**: TEST-U-001/002 응답 JSON을 검사한다.
  ```bash
  curl -s -X POST http://localhost:8080/api/users/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test007@example.com","password":"pass07"}' | grep -c '"password"'
  ```
- **기대 결과**:
  - 출력 = `0` (password 키가 응답에 없음)

---

## 섹션 2 — 로그인 / 토큰 (POST /api/users/login)

---

### TEST-U-008: 정상 로그인 — 4개 필드 반환

- **목적**: 올바른 자격증명으로 로그인 시 `user_id`, `email`, `nickname`, `token` 4개 필드를 반환하는지 확인한다.
- **전제조건**: TEST-U-001로 `test001@example.com` / `pass01` 등록 완료.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test001@example.com","password":"pass01"}'
  ```
- **기대 결과**:
  - HTTP **200**
  - 응답 JSON에 `user_id`(정수), `email`, `nickname`, `token`(문자열) 포함

---

### TEST-U-009: 잘못된 비밀번호 → 401

- **목적**: 틀린 비밀번호로 로그인 시 401을 반환하는지 확인한다.
- **전제조건**: `test001@example.com` 등록 완료.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test001@example.com","password":"wrongpass"}'
  ```
- **기대 결과**:
  - HTTP **401**
  - `detail` = "이메일 또는 비밀번호가 올바르지 않습니다."

---

### TEST-U-010: 존재하지 않는 이메일 → 401

- **목적**: 미등록 이메일로 로그인 시 401을 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/users/login \
    -H "Content-Type: application/json" \
    -d '{"email":"ghost@example.com","password":"pass"}'
  ```
- **기대 결과**:
  - HTTP **401**

---

### TEST-U-011: 토큰 형식 검증 (64자 hex)

- **목적**: 반환된 token이 `secrets.token_hex(32)` 형식(64자 소문자 hex)인지 확인한다.
- **전제조건**: TEST-U-008 실행 후 token 값 보유.
- **실행**:
  ```bash
  TOKEN=$(curl -s -X POST http://localhost:8080/api/users/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test001@example.com","password":"pass01"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  echo "길이: ${#TOKEN}"
  echo "$TOKEN" | grep -E '^[0-9a-f]{64}$' && echo "형식 OK" || echo "형식 FAIL"
  ```
- **기대 결과**:
  - 길이 = 64
  - 소문자 hex 문자만 포함

---

### TEST-U-012: 재로그인 시 토큰 갱신

- **목적**: 동일 유저가 두 번 로그인하면 두 번째 토큰이 첫 번째와 달라야 한다.
- **전제조건**: `test001@example.com` 등록 완료.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import httpx
  BASE = "http://localhost:8080"
  body = {"email": "test001@example.com", "password": "pass01"}
  t1 = httpx.post(f"{BASE}/api/users/login", json=body).json()["token"]
  t2 = httpx.post(f"{BASE}/api/users/login", json=body).json()["token"]
  print("토큰 갱신:", t1 != t2)
  assert t1 != t2, "토큰이 갱신되지 않았음"
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `토큰 갱신: True` / `PASS`

---

### TEST-U-013: 레거시 SHA-256 해시 → bcrypt 온라인 업그레이드

- **목적**: 기존 SHA-256 해시 보유 계정 로그인 성공 후 DB의 password가 bcrypt로 업그레이드되는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import hashlib, httpx, time
  email = f"legacy{int(time.time())}@example.com"
  plain = "legacypass"
  sha256_hash = hashlib.sha256(plain.encode()).hexdigest()

  # DB에 SHA-256 해시로 직접 삽입
  import pymysql, pymysql.cursors
  conn = pymysql.connect(
      host="localhost", port=3306, user="tetris_user",
      password="tetris_pass", database="tetris",
      cursorclass=pymysql.cursors.DictCursor
  )
  with conn.cursor() as c:
      c.execute("INSERT INTO users (email, password, created_at) VALUES (%s,%s,%s)",
                (email, sha256_hash, "2024-01-01T00:00:00"))
  conn.commit()
  conn.close()

  # 로그인 (SHA-256 검증 후 bcrypt 업그레이드 발생)
  r = httpx.post("http://localhost:8080/api/users/login",
                 json={"email": email, "password": plain})
  assert r.status_code == 200, f"로그인 실패: {r.status_code}"

  # DB에서 password 재조회 → bcrypt 형식인지 확인
  conn = sqlite3.connect(DB)
  row = conn.execute("SELECT password FROM users WHERE email=?", (email,)).fetchone()
  conn.close()
  upgraded = row[0].startswith("$2b$")
  print("bcrypt 업그레이드:", upgraded)
  assert upgraded, "bcrypt 업그레이드 실패"
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `bcrypt 업그레이드: True` / `PASS`

---

## 섹션 3 — 유저 CRUD

---

### TEST-U-014: GET /api/users/{user_id} — 정상 조회

- **목적**: 존재하는 user_id로 200과 UserResponse를 반환하는지 확인한다.
- **전제조건**: TEST-U-001로 생성된 user_id 보유 (이하 `$UID`로 표기).
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" http://localhost:8080/api/users/$UID
  ```
- **기대 결과**:
  - HTTP **200**
  - `id` = `$UID`, `email` = "test001@example.com"

---

### TEST-U-015: GET /api/users/{user_id} — 없는 ID → 404

- **목적**: 존재하지 않는 user_id 조회 시 404를 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" http://localhost:8080/api/users/99999
  ```
- **기대 결과**:
  - HTTP **404**
  - `detail` = "유저를 찾을 수 없습니다."

---

### TEST-U-016: PUT /api/users/{user_id} — 닉네임 변경

- **목적**: 닉네임 업데이트 요청 시 200과 변경된 nickname을 반환하는지 확인한다.
- **전제조건**: `$UID` 보유.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X PUT http://localhost:8080/api/users/$UID \
    -H "Content-Type: application/json" \
    -d '{"nickname":"변경된닉네임"}'
  ```
- **기대 결과**:
  - HTTP **200**
  - `nickname` = "변경된닉네임"

---

### TEST-U-017: PUT /api/users/{user_id} — nickname=null → 기존값 유지

- **목적**: `{"nickname": null}` 전송 시 기존 닉네임이 그대로 유지되는지 확인한다.
- **전제조건**: TEST-U-016 실행 후 `$UID`의 nickname = "변경된닉네임".
- **실행**:
  ```bash
  curl -s -X PUT http://localhost:8080/api/users/$UID \
    -H "Content-Type: application/json" \
    -d '{"nickname":null}' | python3 -c "import sys,json; print(json.load(sys.stdin)['nickname'])"
  ```
- **기대 결과**:
  - 출력 = "변경된닉네임" (null 전송 시 기존값 유지)

---

### TEST-U-018: PUT /api/users/{user_id} — 없는 ID → 404

- **목적**: 없는 user_id PUT 시 404를 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X PUT http://localhost:8080/api/users/99999 \
    -H "Content-Type: application/json" \
    -d '{"nickname":"ghost"}'
  ```
- **기대 결과**:
  - HTTP **404**

---

### TEST-U-019: DELETE /api/users/{user_id} — 정상 삭제 → 204

- **목적**: 존재하는 유저 삭제 시 204 No Content를 반환하는지 확인한다.
- **전제조건**: TEST-U-002로 생성된 test002@example.com의 user_id 보유 (이하 `$UID2`).
- **실행**:
  ```bash
  curl -s -w "%{http_code}" -X DELETE http://localhost:8080/api/users/$UID2
  ```
- **기대 결과**:
  - HTTP **204** (본문 없음)

---

### TEST-U-020: DELETE /api/users/{user_id} — 없는 ID → 404

- **목적**: 없는 user_id 삭제 시 404를 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X DELETE http://localhost:8080/api/users/99999
  ```
- **기대 결과**:
  - HTTP **404**

---

### TEST-U-021: DELETE 유저 시 점수 캐스케이드 삭제

- **목적**: 유저 삭제 시 해당 유저의 점수도 함께 삭제되는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import httpx
  BASE = "http://localhost:8080"

  # 유저 생성 + 로그인
  r = httpx.post(f"{BASE}/api/users/register", json={"email":"cascade@example.com","password":"cascade1"})
  uid = r.json()["id"]
  token = httpx.post(f"{BASE}/api/users/login", json={"email":"cascade@example.com","password":"cascade1"}).json()["token"]

  # 점수 저장
  httpx.post(f"{BASE}/api/scores",
             headers={"Authorization": f"Bearer {token}"},
             json={"user_id": uid, "score": 100, "level": 1, "lines": 1})

  # 유저 삭제
  httpx.delete(f"{BASE}/api/users/{uid}")

  # 점수 조회 → 빈 배열이어야 함
  scores = httpx.get(f"{BASE}/api/scores", params={"user_id": uid}).json()
  print("남은 점수 수:", len(scores))
  assert len(scores) == 0, "캐스케이드 삭제 실패"
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `남은 점수 수: 0` / `PASS`

---

## 섹션 4 — 점수 API

---

### TEST-U-022: POST /api/scores — 정상 저장 → 201

- **목적**: 올바른 Bearer 토큰과 body로 점수 저장 시 201과 ScoreResponse를 반환하는지 확인한다.
- **전제조건**: `$UID`와 `$TOKEN` 보유 (TEST-U-008).
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/scores \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"user_id\":$UID,\"score\":1500,\"level\":3,\"lines\":10}"
  ```
- **기대 결과**:
  - HTTP **201**
  - 응답 JSON에 `id`, `user_id`=$UID, `score`=1500, `level`=3, `lines`=10, `played_at` 포함

---

### TEST-U-023: POST /api/scores — Authorization 헤더 없음 → 401

- **목적**: Authorization 헤더 미포함 시 401을 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/scores \
    -H "Content-Type: application/json" \
    -d '{"user_id":1,"score":100,"level":1,"lines":1}'
  ```
- **기대 결과**:
  - HTTP **401**
  - `detail` = "인증이 필요합니다."

---

### TEST-U-024: POST /api/scores — 잘못된 토큰 → 401

- **목적**: 유효하지 않은 Bearer 토큰 전송 시 401을 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/scores \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer invalidtoken0000000000000000000000000000000000000000000000000000" \
    -d '{"user_id":1,"score":100,"level":1,"lines":1}'
  ```
- **기대 결과**:
  - HTTP **401**
  - `detail` = "유효하지 않은 인증 토큰입니다."

---

### TEST-U-025: POST /api/scores — 토큰 주인 ≠ user_id → 403

- **목적**: 유저 A의 토큰으로 유저 B의 user_id에 점수 저장 시 403을 반환하는지 확인한다.
- **전제조건**: 두 유저 생성 후 각각의 user_id와 token 보유.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import httpx
  BASE = "http://localhost:8080"

  # 유저 A 생성
  httpx.post(f"{BASE}/api/users/register", json={"email":"usera@example.com","password":"passaaa"})
  token_a = httpx.post(f"{BASE}/api/users/login", json={"email":"usera@example.com","password":"passaaa"}).json()["token"]

  # 유저 B 생성
  uid_b = httpx.post(f"{BASE}/api/users/register", json={"email":"userb@example.com","password":"passbbb"}).json()["id"]

  # A의 토큰으로 B의 user_id에 점수 저장
  r = httpx.post(f"{BASE}/api/scores",
                 headers={"Authorization": f"Bearer {token_a}"},
                 json={"user_id": uid_b, "score": 100, "level": 1, "lines": 1})
  print("상태코드:", r.status_code)
  assert r.status_code == 403, f"403 기대, {r.status_code} 반환"
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `상태코드: 403` / `PASS`

---

### TEST-U-026: GET /api/scores — 전체 목록 (최신순)

- **목적**: query string 없이 GET /api/scores 호출 시 전체 점수 목록을 최신순으로 반환하는지 확인한다.
- **전제조건**: TEST-U-022로 점수 저장 완료.
- **실행**:
  ```bash
  curl -s http://localhost:8080/api/scores | python3 -c "import sys,json; d=json.load(sys.stdin); print('개수:', len(d)); print('첫 항목 id:', d[0]['id'] if d else 'N/A')"
  ```
- **기대 결과**:
  - 배열 반환, 첫 항목이 가장 최근에 저장된 점수(id가 가장 큰 것)

---

### TEST-U-027: GET /api/scores?user_id= — 유저별 필터링

- **목적**: `user_id` query param으로 해당 유저의 점수만 반환하는지 확인한다.
- **전제조건**: `$UID` 보유, 해당 유저의 점수 최소 1개 존재.
- **실행**:
  ```bash
  curl -s "http://localhost:8080/api/scores?user_id=$UID" | python3 -c "import sys,json; d=json.load(sys.stdin); print('모두 동일 user_id:', all(x['user_id']==$UID for x in d))"
  ```
- **기대 결과**:
  - 출력: `모두 동일 user_id: True`

---

### TEST-U-028: GET /api/scores/{score_id} — 단건 조회

- **목적**: 존재하는 score_id로 단건 조회 시 200과 ScoreResponse를 반환하는지 확인한다.
- **전제조건**: TEST-U-022에서 생성된 score_id (이하 `$SID`) 보유.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" http://localhost:8080/api/scores/$SID
  ```
- **기대 결과**:
  - HTTP **200**
  - `id` = `$SID`

---

### TEST-U-029: GET /api/scores/{score_id} — 없는 ID → 404

- **목적**: 없는 score_id 조회 시 404를 반환하는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" http://localhost:8080/api/scores/99999
  ```
- **기대 결과**:
  - HTTP **404**
  - `detail` = "점수를 찾을 수 없습니다."

---

### TEST-U-030: PUT /api/scores/{score_id} — 부분 업데이트

- **목적**: score만 변경 시 level, lines가 기존값을 유지하는지 확인한다.
- **전제조건**: `$SID` 보유 (score=1500, level=3, lines=10).
- **실행**:
  ```bash
  curl -s -X PUT http://localhost:8080/api/scores/$SID \
    -H "Content-Type: application/json" \
    -d '{"score":9999}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('score:', d['score'], 'level:', d['level'], 'lines:', d['lines'])"
  ```
- **기대 결과**:
  - 출력: `score: 9999 level: 3 lines: 10`

---

### TEST-U-031: PUT /api/scores/{score_id} — 모든 필드 null → 변경 없음

- **목적**: 빈 객체 전송 시 기존 값이 그대로 반환되는지 확인한다.
- **전제조건**: TEST-U-030 실행 후 `$SID`의 score=9999, level=3, lines=10.
- **실행**:
  ```bash
  curl -s -X PUT http://localhost:8080/api/scores/$SID \
    -H "Content-Type: application/json" \
    -d '{}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('score:', d['score'], 'level:', d['level'])"
  ```
- **기대 결과**:
  - 출력: `score: 9999 level: 3`

---

### TEST-U-032: DELETE /api/scores/{score_id} — 정상 삭제 → 204

- **목적**: 존재하는 점수 삭제 시 204를 반환하는지 확인한다.
- **전제조건**: `$SID` 보유.
- **실행**:
  ```bash
  curl -s -w "%{http_code}" -X DELETE http://localhost:8080/api/scores/$SID
  ```
- **기대 결과**:
  - HTTP **204** (본문 없음)

---

## 섹션 5 — 랭킹 API (GET /api/rankings)

---

### TEST-U-033: 기본 limit=10, rank 순서 확인

- **목적**: query string 없이 호출 시 최대 10개 반환, rank 필드가 1부터 순서대로 증가하는지 확인한다.
- **전제조건**: 점수 데이터 최소 1개 이상 존재.
- **실행**:
  ```bash
  curl -s http://localhost:8080/api/rankings | python3 -c "
  import sys,json; d=json.load(sys.stdin)
  print('개수:', len(d))
  ranks = [x['rank'] for x in d]
  print('rank 목록:', ranks)
  print('순서 정상:', ranks == list(range(1, len(d)+1)))"
  ```
- **기대 결과**:
  - 개수 ≤ 10
  - 순서 정상: `True`

---

### TEST-U-034: limit=3, best_score 내림차순

- **목적**: limit=3 시 최대 3개 반환, best_score 내림차순 정렬인지 확인한다.
- **전제조건**: 점수 보유 유저 최소 3명 이상.
- **실행**:
  ```bash
  curl -s "http://localhost:8080/api/rankings?limit=3" | python3 -c "
  import sys,json; d=json.load(sys.stdin)
  scores = [x['best_score'] for x in d]
  print('점수 목록:', scores)
  print('내림차순:', scores == sorted(scores, reverse=True))"
  ```
- **기대 결과**:
  - 개수 ≤ 3
  - 내림차순: `True`

---

### TEST-U-035: limit=0 → 422

- **목적**: limit 하한(ge=1) 위반 시 422를 반환하는지 확인한다.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" "http://localhost:8080/api/rankings?limit=0"
  ```
- **기대 결과**:
  - HTTP **422**

---

### TEST-U-036: limit=101 → 422

- **목적**: limit 상한(le=100) 초과 시 422를 반환하는지 확인한다.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" "http://localhost:8080/api/rankings?limit=101"
  ```
- **기대 결과**:
  - HTTP **422**

---

### TEST-U-037: limit=1 — 경계값 정상

- **목적**: limit=1이 정상 처리되는지 확인한다.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" "http://localhost:8080/api/rankings?limit=1"
  ```
- **기대 결과**:
  - HTTP **200**
  - 배열 길이 ≤ 1

---

### TEST-U-038: limit=100 — 경계값 정상

- **목적**: limit=100이 정상 처리되는지 확인한다.
- **실행**:
  ```bash
  curl -s -w "\n%{http_code}" "http://localhost:8080/api/rankings?limit=100"
  ```
- **기대 결과**:
  - HTTP **200**

---

### TEST-U-039: 점수 없는 유저는 랭킹 미포함

- **목적**: 점수 레코드가 없는 유저는 rankings 결과에 나타나지 않는지 확인한다.
- **전제조건**: 서버 실행 중.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import httpx
  BASE = "http://localhost:8080"

  # 점수 없는 유저 생성
  r = httpx.post(f"{BASE}/api/users/register", json={"email":"noscore@example.com","password":"noscore1"})
  uid = r.json()["id"]

  # 랭킹 조회
  rankings = httpx.get(f"{BASE}/api/rankings?limit=100").json()
  user_ids = [x["user_id"] for x in rankings]
  print("랭킹에 없음:", uid not in user_ids)
  assert uid not in user_ids, "점수 없는 유저가 랭킹에 포함됨"
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `랭킹에 없음: True` / `PASS`

---

## 섹션 6 — 유틸리티 함수 (Python 직접 호출)

> 아래 테스트는 서버 없이 `Backend/main.py`를 직접 import하여 실행한다.

---

### TEST-U-040: hash_password → `$2b$` 접두사 확인

- **목적**: `hash_password()`가 bcrypt 형식(`$2b$12$...`)의 해시를 반환하는지 확인한다.
- **실행**:
  ```bash
  cd /home/cool/vibeCoding/kosa-vibecoding-2026-3rd/src/exercise/ksw19627/day02/vibeCoding-tetris
  .venv/bin/python3 - << 'EOF'
  import sys; sys.path.insert(0, ".")
  from Backend.main import hash_password
  h = hash_password("testpass")
  print("해시:", h[:10], "...")
  assert h.startswith("$2b$"), f"bcrypt 형식 아님: {h[:10]}"
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `해시: $2b$12$... ...` / `PASS`

---

### TEST-U-041: verify_password — bcrypt 해시 정상 검증

- **목적**: `hash_password()`로 생성한 해시를 `verify_password()`로 검증 시 True를 반환하는지 확인한다.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import sys; sys.path.insert(0, ".")
  from Backend.main import hash_password, verify_password
  plain = "mypassword"
  h = hash_password(plain)
  result = verify_password(plain, h)
  print("검증 결과:", result)
  assert result is True
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `검증 결과: True` / `PASS`

---

### TEST-U-042: verify_password — 레거시 SHA-256 해시 감지

- **목적**: 64자 소문자 hex 문자열을 hashed로 넣으면 레거시 경로로 분기하여 올바르게 검증하는지 확인한다.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import sys, hashlib; sys.path.insert(0, ".")
  from Backend.main import verify_password
  plain = "legacypass"
  sha256_hash = hashlib.sha256(plain.encode()).hexdigest()
  print("해시 길이:", len(sha256_hash), "모두 hex:", all(c in "0123456789abcdef" for c in sha256_hash))
  result = verify_password(plain, sha256_hash)
  print("레거시 검증:", result)
  assert result is True
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `레거시 검증: True` / `PASS`

---

### TEST-U-043: verify_password — 틀린 비밀번호 → False

- **목적**: 잘못된 평문으로 `verify_password()` 호출 시 False를 반환하는지 확인한다.
- **실행**:
  ```bash
  .venv/bin/python3 - << 'EOF'
  import sys; sys.path.insert(0, ".")
  from Backend.main import hash_password, verify_password
  h = hash_password("correctpass")
  result = verify_password("wrongpass", h)
  print("틀린 비밀번호 결과:", result)
  assert result is False
  print("PASS")
  EOF
  ```
- **기대 결과**:
  - 출력: `틀린 비밀번호 결과: False` / `PASS`

---

## 테스트 결과 기록 양식

Claude는 각 테스트 실행 후 아래 형식으로 결과를 보고한다.

| ID | 제목 | 결과 | 비고 |
|---|---|---|---|
| TEST-U-001 | 정상 회원가입 — 닉네임 포함 | PASS / FAIL / SKIP | |
| ... | ... | ... | ... |
