"""
SQLite → MySQL 1회성 마이그레이션 스크립트.

사용법:
  1. docker compose up -d  (MySQL 컨테이너 기동 후 Healthy 상태 확인)
  2. .venv/bin/python Backend/migrate.py

기존 MySQL에 데이터가 이미 있으면 중복 삽입을 건너뛴다.
"""
import os
import sqlite3
from pathlib import Path

import pymysql
import pymysql.cursors
from dotenv import load_dotenv

load_dotenv()

SQLITE_PATH = Path(__file__).parent / "tetris.db"

DB_CONFIG = {
    "host":        os.getenv("MYSQL_HOST", "localhost"),
    "port":        int(os.getenv("MYSQL_PORT", 3306)),
    "user":        os.getenv("MYSQL_USER", "tetris_user"),
    "password":    os.getenv("MYSQL_PASSWORD", "tetris_pass"),
    "database":    os.getenv("MYSQL_DATABASE", "tetris"),
    "cursorclass": pymysql.cursors.DictCursor,
    "charset":     "utf8mb4",
}


def ensure_tables(conn):
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


def migrate():
    if not SQLITE_PATH.exists():
        print(f"[SKIP] SQLite DB 없음: {SQLITE_PATH}")
        return

    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    mysql_conn  = pymysql.connect(**DB_CONFIG)

    try:
        ensure_tables(mysql_conn)
        users  = sqlite_conn.execute("SELECT * FROM users").fetchall()
        scores = sqlite_conn.execute("SELECT * FROM scores").fetchall()

        with mysql_conn.cursor() as c:
            # ── users 이전 ──
            user_ok = user_skip = 0
            for u in users:
                try:
                    c.execute(
                        "INSERT INTO users (id, email, password, nickname, token, created_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s)",
                        (u["id"], u["email"], u["password"],
                         u["nickname"], u["token"], u["created_at"]),
                    )
                    user_ok += 1
                except pymysql.err.IntegrityError:
                    user_skip += 1

            # AUTO_INCREMENT 재설정
            if users:
                max_uid = max(u["id"] for u in users)
                c.execute(f"ALTER TABLE users AUTO_INCREMENT = {max_uid + 1}")

            # ── scores 이전 ──
            score_ok = score_skip = 0
            for s in scores:
                try:
                    c.execute(
                        "INSERT INTO scores (id, user_id, score, level, `lines`, played_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s)",
                        (s["id"], s["user_id"], s["score"],
                         s["level"], s["lines"], s["played_at"]),
                    )
                    score_ok += 1
                except pymysql.err.IntegrityError:
                    score_skip += 1

            if scores:
                max_sid = max(s["id"] for s in scores)
                c.execute(f"ALTER TABLE scores AUTO_INCREMENT = {max_sid + 1}")

        mysql_conn.commit()
        print(f"[완료] users  : {user_ok}건 이전, {user_skip}건 중복 건너뜀")
        print(f"[완료] scores : {score_ok}건 이전, {score_skip}건 중복 건너뜀")

    finally:
        sqlite_conn.close()
        mysql_conn.close()


if __name__ == "__main__":
    migrate()
