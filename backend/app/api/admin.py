from fastapi import APIRouter, Header

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/admin/healthz")
async def admin_healthz():
    return {"status": "ok"}


@router.get("/health")
async def health_check():
    from app import main as main_app

    return await main_app.health_check()


@router.get("/admin/session-metrics")
async def get_session_metrics(
    include_sessions: bool = False, x_user_role: str = Header("junior")
):
    from app import main as main_app

    return await main_app.get_session_metrics(
        include_sessions=include_sessions, x_user_role=x_user_role
    )
