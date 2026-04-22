import csv
import json
import csv
from pathlib import Path
from typing import List, Dict, Any
from app.core.time_utils import utc_now_iso


class AuditLogService:
    def __init__(self, log_dir: str):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def _get_log_path(self, session_id: str) -> Path:
        return self.log_dir / f"{session_id}_audit.csv"

    def log_event(
        self, session_id: str, user_role: str, action: str, details: Dict[str, Any]
    ):
        log_path = self._get_log_path(session_id)
        file_exists = log_path.exists()

        with open(log_path, mode="a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["timestamp", "user_role", "action", "details"])

            writer.writerow([utc_now_iso(), user_role, action, json.dumps(details)])

    def get_events(self, session_id: str) -> List[Dict[str, Any]]:
        log_path = self._get_log_path(session_id)
        if not log_path.exists():
            return []

        events = []
        with open(log_path, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                row["details"] = json.loads(row["details"])
                events.append(row)
        return events

    def export_csv(self, session_id: str, output_path: str):
        log_path = self._get_log_path(session_id)
        if log_path.exists():
            import shutil

            shutil.copy(log_path, output_path)


audit_log_service = AuditLogService(str(Path.home() / ".slideforge" / "audit_logs"))
