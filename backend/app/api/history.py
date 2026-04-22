from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history/recent")
async def get_recent_analysis_history(limit: int = 12):
    from app import main as main_app

    return await main_app.get_recent_analysis_history(limit=limit)


@router.post("/history/{fingerprint}/open")
async def open_analysis_history(fingerprint: str):
    from app import main as main_app

    return await main_app.open_analysis_history(fingerprint=fingerprint)
