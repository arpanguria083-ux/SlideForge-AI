from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import ConfigDict


class AppSettings(BaseSettings):
    app_name: str = "SlideForge AI"
    data_dir: str = str(Path.home() / ".slideforge" / "data")
    max_file_size: int = 50_000_000
    session_ttl_hours: int = 24
    session_cleanup_interval_minutes: int = 15
    max_active_sessions: int = 500
    max_active_sessions_per_namespace: int = 100

    model_config = ConfigDict(env_file=".env", extra="ignore")
