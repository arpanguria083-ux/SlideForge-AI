import importlib
import json

import pytest


@pytest.fixture
def main_module(tmp_path, monkeypatch):
    import app.main as main

    mod = importlib.reload(main)

    mod.data_dir = tmp_path / "data"
    mod.data_dir.mkdir(parents=True, exist_ok=True)

    from app.services.guardrail import GuardrailManager
    from app.services.audit_log import AuditLogService

    mod.guardrail_manager = GuardrailManager(str(mod.data_dir / "guardrails"))
    mod.audit_log_service = AuditLogService(str(mod.data_dir / "audit_logs"))

    def _noop_loader():
        return None

    monkeypatch.setattr(mod, "ensure_services_loaded", _noop_loader)
    return mod


def _seed_session(mod, session_id: str):
    mod.active_sessions[session_id] = {
        "client_namespace": "acme",
        "namespace_key": "acme",
        "deck_path": str(mod.data_dir / "uploads" / session_id / "deck.pptx"),
        "slides_data": [{"index": 0, "title": "Slide 1", "full_text": "Example"}],
        "scorecard": {
            "composite_score": 81,
            "annotations": [
                {
                    "slide_index": 0,
                    "text": "sample",
                    "category": "grammar",
                    "severity": "warning",
                    "message": "Sample warning",
                }
            ],
        },
        "annotations_by_slide": {
            "0": [
                {
                    "slide_index": 0,
                    "text": "sample",
                    "category": "grammar",
                    "severity": "warning",
                    "message": "Sample warning",
                }
            ]
        },
        "deep_analysis_by_slide": {"0": {"agents": [], "judge": {"findings": []}}},
        "agent_metadata": {"Visual Analysis Agent": {"slides_analysis": {}}},
        "history_restored": True,
        "status": "analyzed",
        "created_at_ts": 0,
        "last_access_ts": 0,
    }
    mod.session_store.save(session_id, mod.active_sessions[session_id])


@pytest.mark.asyncio
async def test_apply_guardrail_invalidates_cached_analysis(main_module):
    mod = main_module
    session_id = "session-apply"
    _seed_session(mod, session_id)

    guardrail = mod.guardrail_manager.create_guardrail(client_namespace="acme")
    result = await mod.apply_session_guardrail(session_id, guardrail)

    assert result["status"] == "applied"
    assert result.get("analysis_invalidated") is True

    session = mod.active_sessions[session_id]
    assert session.get("status") == "parsed"
    assert session.get("history_restored") is False
    assert session.get("scorecard") is None
    assert session.get("annotations_by_slide") is None
    assert session.get("deep_analysis_by_slide") is None
    assert session.get("agent_metadata") is None
    persisted = mod.session_store.load(session_id)
    assert persisted is not None
    assert persisted.get("status") == "parsed"


@pytest.mark.asyncio
async def test_activate_template_invalidates_cached_analysis(main_module):
    mod = main_module
    session_id = "session-activate"
    _seed_session(mod, session_id)

    guardrail = mod.guardrail_manager.create_guardrail(client_namespace="acme")
    template_dir = mod.data_dir / "guardrail_templates"
    template_dir.mkdir(parents=True, exist_ok=True)
    template_id = "template_test_acme_strategy_20260101T000000Z.json"
    (template_dir / template_id).write_text(
        json.dumps(guardrail.model_dump()), encoding="utf-8"
    )

    result = await mod.activate_guardrail_template(session_id, template_id)

    assert result["status"] == "activated"
    assert result.get("analysis_invalidated") is True

    session = mod.active_sessions[session_id]
    assert session.get("status") == "parsed"
    assert session.get("history_restored") is False
    assert session.get("scorecard") is None
    persisted = mod.session_store.load(session_id)
    assert persisted is not None
    assert persisted.get("status") == "parsed"
