import json

from app.core.session_store import SQLiteSessionStore


def test_session_store_persist_reload_roundtrip(tmp_path):
    db_path = tmp_path / "sessions.db"
    store = SQLiteSessionStore(str(db_path))

    session_id = "s1"
    state = {
        "status": "created",
        "created_at_ts": 100.0,
        "last_access_ts": 100.0,
        "client_namespace": "acme",
        "slides_data": [{"index": 0}],
    }
    store.save(session_id, state)

    loaded = store.load(session_id)
    assert loaded is not None
    assert loaded["status"] == "created"
    assert loaded["client_namespace"] == "acme"
    assert loaded["slides_data"][0]["index"] == 0


def test_session_store_marks_stale_inflight_failed(tmp_path):
    db_path = tmp_path / "sessions.db"
    store = SQLiteSessionStore(str(db_path))

    state = {
        "status": "analyzing",
        "created_at_ts": 1.0,
        "last_access_ts": 1.0,
        "client_namespace": "acme",
    }
    store.save("inflight", state)

    # Force stale by directly updating last_accessed
    with store._connect() as conn:
        conn.execute(
            "UPDATE sessions SET status='analyzing', last_accessed=0, state_json=? WHERE session_id='inflight'",
            (json.dumps(state),),
        )

    updated = store.mark_stale_inflight_failed(stale_seconds=1)
    assert updated == 1
    loaded = store.load("inflight")
    assert loaded is not None
    assert loaded["status"] == "failed"
    assert "failure_reason" in loaded
