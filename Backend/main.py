from pathlib import Path
from datetime import datetime
import hashlib
import os
import re
import secrets

import bcrypt as _bcrypt
import pymysql
import pymysql.cursors
from dotenv import load_dotenv

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

# ── 상수 ──
EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.]+$")

DB_CONFIG = {
    "host":        os.getenv("MYSQL_HOST", "localhost"),
    "port":        int(os.getenv("MYSQL_PORT", 3306)),
    "user":        os.getenv("MYSQL_USER", "tetris_user"),
    "password":    os.getenv("MYSQL_PASSWORD", "tetris_pass"),
    "database":    os.getenv("MYSQL_DATABASE", "tetris"),
    "cursorclass": pymysql.cursors.DictCursor,
    "charset":     "utf8mb4",
}

app = FastAPI(title="Tetris API", description="테트리스 백엔드 API")


# ── DB 헬퍼 ──
def get_db() -> pymysql.connections.Connection:
    return pymysql.connect(**DB_CONFIG)


def init_db():
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id         INT          AUTO_INCREMENT PRIMARY KEY,
                    email      VARCHAR(255) NOT NULL UNIQUE,
                    password   VARCHAR(255) NOT NULL,
                    nickname   VARCHAR(100),
                    token      VARCHAR(64),
                    created_at VARCHAR(50)  NOT NULL
                )
            """)
            c.execute("""
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'users' AND COLUMN_NAME = 'token'
            """, (os.getenv("MYSQL_DATABASE", "tetris"),))
            if not c.fetchone():
                c.execute("ALTER TABLE users ADD COLUMN token VARCHAR(64)")
            c.execute("""
                CREATE TABLE IF NOT EXISTS scores (
                    id        INT         AUTO_INCREMENT PRIMARY KEY,
                    user_id   INT         NOT NULL,
                    score     INT         NOT NULL,
                    level     INT         NOT NULL,
                    `lines`   INT         NOT NULL,
                    played_at VARCHAR(50) NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
        conn.commit()
    finally:
        conn.close()


init_db()


def hash_password(pw: str) -> str:
    return _bcrypt.hashpw(pw.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    # 기존 솔트 없는 SHA-256 해시(64자 소문자 hex) 감지 → 레거시 비교
    if len(hashed) == 64 and all(c in "0123456789abcdef" for c in hashed):
        return hashlib.sha256(plain.encode()).hexdigest() == hashed
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


# ── Pydantic 모델 ──
class UserCreate(BaseModel):
    email: str
    password: str = Field(min_length=6, description="비밀번호는 6자 이상이어야 합니다.")
    nickname: str | None = None


class UserLogin(BaseModel):
    email: str
    password: str


class UserUpdate(BaseModel):
    nickname: str | None = None


class UserResponse(BaseModel):
    id: int
    email: str
    nickname: str | None
    created_at: str


class UserLoginResponse(BaseModel):
    user_id: int
    email: str
    nickname: str | None
    token: str


class ScoreCreate(BaseModel):
    user_id: int
    score: int
    level: int
    lines: int


class ScoreUpdate(BaseModel):
    score: int | None = None
    level: int | None = None
    lines: int | None = None


class ScoreResponse(BaseModel):
    id: int
    user_id: int
    score: int
    level: int
    lines: int
    played_at: str


class RankingEntry(BaseModel):
    rank: int
    user_id: int
    email: str
    nickname: str | None
    best_score: int
    best_level: int


# ── 유저 엔드포인트 ──
@app.post("/api/users/register", response_model=UserResponse, status_code=201)
def register(body: UserCreate):
    if not EMAIL_RE.fullmatch(body.email):
        raise HTTPException(status_code=400, detail="올바른 이메일 형식이 아닙니다.")
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT id FROM users WHERE email=%s", (body.email,))
            if c.fetchone():
                raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.")
            now = datetime.now().isoformat()
            c.execute(
                "INSERT INTO users (email, password, nickname, created_at) VALUES (%s,%s,%s,%s)",
                (body.email, hash_password(body.password), body.nickname, now),
            )
            conn.commit()
            c.execute("SELECT * FROM users WHERE id=%s", (c.lastrowid,))
            return c.fetchone()
    finally:
        conn.close()


@app.post("/api/users/login", response_model=UserLoginResponse)
def login(body: UserLogin):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT * FROM users WHERE email=%s", (body.email,))
            row = c.fetchone()
            if not row or not verify_password(body.password, row["password"]):
                raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
            token = secrets.token_hex(32)
            updates: list[tuple] = [("token", token)]
            # 레거시 SHA-256 해시 → bcrypt로 온라인 업그레이드
            if len(row["password"]) == 64:
                updates.append(("password", hash_password(body.password)))
            set_clause = ", ".join(f"{col}=%s" for col, _ in updates)
            values = [v for _, v in updates] + [row["id"]]
            c.execute(f"UPDATE users SET {set_clause} WHERE id=%s", values)
            conn.commit()
            return {"user_id": row["id"], "email": row["email"],
                    "nickname": row["nickname"], "token": token}
    finally:
        conn.close()


@app.get("/api/users/{user_id}", response_model=UserResponse)
def get_user(user_id: int):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT * FROM users WHERE id=%s", (user_id,))
            row = c.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
            return row
    finally:
        conn.close()


@app.put("/api/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, body: UserUpdate):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT * FROM users WHERE id=%s", (user_id,))
            row = c.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
            nickname = body.nickname if body.nickname is not None else row["nickname"]
            c.execute("UPDATE users SET nickname=%s WHERE id=%s", (nickname, user_id))
            conn.commit()
            c.execute("SELECT * FROM users WHERE id=%s", (user_id,))
            return c.fetchone()
    finally:
        conn.close()


@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: int):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT id FROM users WHERE id=%s", (user_id,))
            if not c.fetchone():
                raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
            c.execute("DELETE FROM scores WHERE user_id=%s", (user_id,))
            c.execute("DELETE FROM users WHERE id=%s", (user_id,))
            conn.commit()
    finally:
        conn.close()


# ── 점수 엔드포인트 ──
@app.post("/api/scores", response_model=ScoreResponse, status_code=201)
def create_score(
    body: ScoreCreate,
    authorization: str | None = Header(default=None),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    token = authorization.removeprefix("Bearer ").strip()
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT id FROM users WHERE token=%s", (token,))
            auth_row = c.fetchone()
            if not auth_row:
                raise HTTPException(status_code=401, detail="유효하지 않은 인증 토큰입니다.")
            if auth_row["id"] != body.user_id:
                raise HTTPException(status_code=403, detail="본인의 점수만 등록할 수 있습니다.")
            c.execute("SELECT id FROM users WHERE id=%s", (body.user_id,))
            if not c.fetchone():
                raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
            now = datetime.now().isoformat()
            c.execute(
                "INSERT INTO scores (user_id, score, level, `lines`, played_at) VALUES (%s,%s,%s,%s,%s)",
                (body.user_id, body.score, body.level, body.lines, now),
            )
            conn.commit()
            c.execute("SELECT * FROM scores WHERE id=%s", (c.lastrowid,))
            return c.fetchone()
    finally:
        conn.close()


@app.get("/api/scores", response_model=list[ScoreResponse])
def list_scores(user_id: int | None = None):
    conn = get_db()
    try:
        with conn.cursor() as c:
            if user_id is not None:
                c.execute("SELECT * FROM scores WHERE user_id=%s ORDER BY id DESC", (user_id,))
            else:
                c.execute("SELECT * FROM scores ORDER BY id DESC")
            return c.fetchall()
    finally:
        conn.close()


@app.get("/api/scores/{score_id}", response_model=ScoreResponse)
def get_score(score_id: int):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT * FROM scores WHERE id=%s", (score_id,))
            row = c.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="점수를 찾을 수 없습니다.")
            return row
    finally:
        conn.close()


@app.put("/api/scores/{score_id}", response_model=ScoreResponse)
def update_score(score_id: int, body: ScoreUpdate):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT * FROM scores WHERE id=%s", (score_id,))
            row = c.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="점수를 찾을 수 없습니다.")
            score = body.score if body.score is not None else row["score"]
            level = body.level if body.level is not None else row["level"]
            lines = body.lines if body.lines is not None else row["lines"]
            c.execute(
                "UPDATE scores SET score=%s, level=%s, `lines`=%s WHERE id=%s",
                (score, level, lines, score_id),
            )
            conn.commit()
            c.execute("SELECT * FROM scores WHERE id=%s", (score_id,))
            return c.fetchone()
    finally:
        conn.close()


@app.delete("/api/scores/{score_id}", status_code=204)
def delete_score(score_id: int):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("SELECT id FROM scores WHERE id=%s", (score_id,))
            if not c.fetchone():
                raise HTTPException(status_code=404, detail="점수를 찾을 수 없습니다.")
            c.execute("DELETE FROM scores WHERE id=%s", (score_id,))
            conn.commit()
    finally:
        conn.close()


# ── 랭킹 엔드포인트 ──
@app.get("/api/rankings", response_model=list[RankingEntry])
def get_rankings(limit: int = Query(default=10, ge=1, le=100)):
    conn = get_db()
    try:
        with conn.cursor() as c:
            c.execute("""
                SELECT u.id, u.email, u.nickname,
                       MAX(s.score) AS best_score,
                       (SELECT s2.level FROM scores s2
                        WHERE s2.user_id = u.id
                        ORDER BY s2.score DESC LIMIT 1) AS best_level
                FROM scores s
                JOIN users u ON s.user_id = u.id
                GROUP BY u.id
                ORDER BY best_score DESC
                LIMIT %s
            """, (limit,))
            rows = c.fetchall()
        result = []
        for rank, r in enumerate(rows, 1):
            result.append({
                "rank":       rank,
                "user_id":    r["id"],
                "email":      r["email"],
                "nickname":   r["nickname"],
                "best_score": r["best_score"],
                "best_level": r["best_level"],
            })
        return result
    finally:
        conn.close()


# ── 정적 파일 마운트 (반드시 마지막) ──
app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "Frontend", html=True), name="static")
