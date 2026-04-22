import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional


class SQLiteSessionStore:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                  session_id TEXT PRIMARY KEY,
                  client_namespace TEXT,
                  status TEXT NOT NULL,
                  created_at REAL NOT NULL,
                  last_accessed REAL NOT NULL,
                  deck_fingerprint TEXT,
                  state_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions(client_namespace)"
            )

    def save(self, session_id: str, state: dict) -> None:
        now = time.time()
        created_at = float(state.get("created_at_ts") or now)
        status = str(state.get("status") or "created")
        client_namespace = state.get("client_namespace")
        deck_fingerprint = state.get("document_fingerprint") or state.get(
            "deck_fingerprint"
        )
        payload = json.dumps(self._to_jsonable(state))
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO sessions(session_id, client_namespace, status, created_at, last_accessed, deck_fingerprint, state_json)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                      client_namespace=excluded.client_namespace,
                      status=excluded.status,
                      last_accessed=excluded.last_accessed,
                      deck_fingerprint=excluded.deck_fingerprint,
                      state_json=excluded.state_json
                    """,
                    (
                        session_id,
                        client_namespace,
                        status,
                        created_at,
                        now,
                        deck_fingerprint,
                        payload,
                    ),
                )

    def load(self, session_id: str) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT state_json FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            if not row:
                return None
            return json.loads(row["state_json"])

    def delete(self, session_id: str) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))

    def list_active(self, ttl_seconds: int) -> dict[str, dict]:
        cutoff = time.time() - ttl_seconds
        sessions: dict[str, dict] = {}
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT session_id, state_json, status, last_accessed FROM sessions WHERE last_accessed >= ?",
                (cutoff,),
            ).fetchall()
            for row in rows:
                try:
                    sessions[row["session_id"]] = json.loads(row["state_json"])
                except Exception:
                    continue
        return sessions

    def mark_stale_inflight_failed(self, stale_seconds: int = 60) -> int:
        cutoff = time.time() - stale_seconds
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    "SELECT session_id, state_json FROM sessions WHERE status IN ('parsing','analyzing') AND last_accessed < ?",
                    (cutoff,),
                ).fetchall()
                updated = 0
                for row in rows:
                    try:
                        state = json.loads(row["state_json"])
                    except Exception:
                        continue
                    state["status"] = "failed"
                    state["failure_reason"] = "Recovered after stale in-flight session"
                    conn.execute(
                        "UPDATE sessions SET status = 'failed', state_json = ? WHERE session_id = ?",
                        (json.dumps(state), row["session_id"]),
                    )
                    updated += 1
        return updated

    def _to_jsonable(self, value):
        if hasattr(value, "model_dump"):
            return self._to_jsonable(value.model_dump())
        if isinstance(value, dict):
            return {str(k): self._to_jsonable(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._to_jsonable(v) for v in value]
        if isinstance(value, tuple):
            return [self._to_jsonable(v) for v in value]
        if isinstance(value, set):
            return [self._to_jsonable(v) for v in sorted(value, key=lambda x: str(x))]
        return value
