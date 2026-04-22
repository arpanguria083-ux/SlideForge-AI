from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["settings"])


class RuntimeProviderConfigPayload(BaseModel):
    provider: str
    api_base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    local_context_window: int | None = None


@router.get("/settings/local-llm")
async def get_local_llm_status():
    from app import main as main_app

    return await main_app.get_local_llm_status()


@router.post("/settings/local-llm")
async def update_local_llm_config(payload: RuntimeProviderConfigPayload):
    from app import main as main_app

    return await main_app.update_local_llm_config(payload)


@router.post("/session/{session_id}/llm-settings")
async def set_session_llm_settings(
    session_id: str, provider: str, context_window: int | None = None
):
    from app import main as main_app

    return await main_app.set_session_llm_settings(
        session_id=session_id, provider=provider, context_window=context_window
    )


@router.get("/settings/analysis")
async def get_analysis_settings():
    from app import main as main_app

    return await main_app.get_analysis_settings()


@router.post("/settings/analysis")
async def update_analysis_settings(analysis_max_tokens: int):
    from app import main as main_app

    return await main_app.update_analysis_settings(
        analysis_max_tokens=analysis_max_tokens
    )


@router.get("/settings/grammar-status")
async def get_grammar_status():
    from app import main as main_app

    return await main_app.get_grammar_status()


@router.get("/settings/local-llm/test")
async def test_llm_connection():
    from app import main as main_app

    return await main_app.test_llm_connection()


@router.get("/settings/local-llm/diagnostics")
async def get_llm_diagnostics():
    from app import main as main_app

    return await main_app.get_llm_diagnostics()


@router.get("/settings/local-llm/models")
async def list_available_models():
    from app import main as main_app

    return await main_app.list_available_models()
