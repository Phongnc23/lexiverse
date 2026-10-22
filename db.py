"""Persistent relational schema; SQLite with WAL. No data stored in browser as source of truth."""
import os, sqlite3
from pathlib import Path
from contextlib import contextmanager

DB_PATH = os.getenv('DATABASE_PATH', './data/lexiverse.db')

def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT,
          name TEXT NOT NULL, avatar TEXT DEFAULT '', role TEXT NOT NULL DEFAULT 'teacher', created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
          title TEXT NOT NULL, language TEXT NOT NULL CHECK(language IN ('vi','en','ja','zh-CN')),
          description TEXT DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lessons (
          id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          title TEXT NOT NULL, description TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS words (
          id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
          term TEXT NOT NULL, meaning TEXT NOT NULL, pronunciation TEXT DEFAULT '', alternatives TEXT NOT NULL DEFAULT '[]',
          sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS classrooms (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
          name TEXT NOT NULL, language TEXT NOT NULL, description TEXT DEFAULT '',
          invite_code TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'ACTIVE', created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS class_members (
          id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
          nickname TEXT NOT NULL, joined_at INTEGER NOT NULL, status TEXT DEFAULT 'ACTIVE',
          UNIQUE(class_id, nickname)
        );
        CREATE TABLE IF NOT EXISTS live_sessions (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
          lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
          class_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
          title TEXT NOT NULL, pin TEXT UNIQUE NOT NULL, join_token TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'LOBBY', locked INTEGER DEFAULT 0, allow_late INTEGER DEFAULT 0,
          mode TEXT NOT NULL, speed TEXT NOT NULL, duration_ms INTEGER NOT NULL,
          snapshot TEXT NOT NULL, question_index INTEGER DEFAULT -1,
          phase TEXT DEFAULT 'WAITING', round_started INTEGER DEFAULT 0,
          round_ends INTEGER DEFAULT 0, pause_remaining INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS participants (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
          nickname TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, score INTEGER DEFAULT 0,
          streak INTEGER DEFAULT 0, correct_count INTEGER DEFAULT 0, latency_total INTEGER DEFAULT 0,
          joined_at INTEGER NOT NULL, removed INTEGER DEFAULT 0,
          UNIQUE(session_id, nickname)
        );
        CREATE TABLE IF NOT EXISTS answers (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES live_sessions(id),
          participant_id TEXT NOT NULL REFERENCES participants(id),
          round_index INTEGER NOT NULL, answer TEXT NOT NULL, correct INTEGER NOT NULL,
          points INTEGER NOT NULL, latency_ms INTEGER NOT NULL, submitted_at INTEGER NOT NULL,
          UNIQUE(participant_id, round_index)
        );
        CREATE TABLE IF NOT EXISTS reports (
          session_id TEXT PRIMARY KEY REFERENCES live_sessions(id) ON DELETE CASCADE,
          body TEXT NOT NULL, generated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_books_owner ON books(owner_id);
        CREATE INDEX IF NOT EXISTS ix_classes_owner ON classrooms(owner_id);
        CREATE INDEX IF NOT EXISTS ix_sessions_owner ON live_sessions(owner_id);
        CREATE INDEX IF NOT EXISTS ix_answers_session ON answers(session_id);
        PRAGMA journal_mode=WAL;
        ''')

@contextmanager
def connect():
    db = sqlite3.connect(DB_PATH, timeout=8)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=8000')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def one(sql, args=()):
    with connect() as db:
        row = db.execute(sql, args).fetchone()
        return dict(row) if row else None

def all_rows(sql, args=()):
    with connect() as db:
        return [dict(r) for r in db.execute(sql, args).fetchall()]
