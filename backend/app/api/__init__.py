from fastapi import APIRouter
from .admin import router as admin_router
from .history import router as history_router
from .settings import router as settings_router

api_router = APIRouter()
api_router.include_router(admin_router)
api_router.include_router(history_router)
api_router.include_router(settings_router)
