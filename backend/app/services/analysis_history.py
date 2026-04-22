import hashlib
import json
import shutil
from pathlib import Path
from typing import Optional
from app.core.time_utils import utc_now_iso

ANALYSIS_HISTORY_VERSION = 2


class AnalysisHistoryStore:
    def __init__(self, root_dir: str):
        self.root_dir = Path(root_dir)
        self.entries_dir = self.root_dir / "entries"
        self.decks_dir = self.root_dir / "decks"
        self.index_path = self.root_dir / "index.json"
        self.entries_dir.mkdir(parents=True, exist_ok=True)
        self.decks_dir.mkdir(parents=True, exist_ok=True)
        if not self.index_path.exists():
            self.index_path.write_text("[]", encoding="utf-8")

    def compute_sha256(self, file_path: str) -> str:
        digest = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def get_by_fingerprint(self, fingerprint: str) -> Optional[dict]:
        entry_path = self.entries_dir / f"{fingerprint}.json"
        if not entry_path.exists():
            return None
        return json.loads(entry_path.read_text(encoding="utf-8"))

    def list_recent(self, limit: int = 20) -> list[dict]:
        try:
            items = json.loads(self.index_path.read_text(encoding="utf-8"))
        except Exception:
            items = []
        items = sorted(items, key=lambda item: item.get("updated_at", ""), reverse=True)
        return items[:limit]

    def save_analysis(
        self,
        *,
        fingerprint: str,
        original_filename: str,
        deck_path: str,
        session_id: str,
        slides_data: list[dict],
        scorecard: dict,
        agent_metadata: dict,
        deep_analysis_by_slide: dict,
        deck_metadata: dict,
    ) -> dict:
        now = utc_now_iso()
        deck_ext = Path(deck_path).suffix.lower() or ".bin"
        archived_deck = self.decks_dir / f"{fingerprint}{deck_ext}"
        if not archived_deck.exists():
            shutil.copy2(deck_path, archived_deck)

        entry = {
            "analysis_version": ANALYSIS_HISTORY_VERSION,
            "fingerprint": fingerprint,
            "original_filename": original_filename,
            "archived_deck_path": str(archived_deck),
            "deck_metadata": deck_metadata,
            "slide_count": len(slides_data),
            "composite_score": scorecard.get("composite_score", 0),
            "warning_count": scorecard.get("warning_count", 0),
            "hard_block_count": scorecard.get("hard_block_count", 0),
            "updated_at": now,
            "last_session_id": session_id,
            "slides_data": slides_data,
            "scorecard": scorecard,
            "agent_metadata": agent_metadata,
            "deep_analysis_by_slide": deep_analysis_by_slide,
        }

        entry_path = self.entries_dir / f"{fingerprint}.json"
        entry_path.write_text(json.dumps(entry, indent=2), encoding="utf-8")

        recent_items = [
            item
            for item in self.list_recent(limit=500)
            if item.get("fingerprint") != fingerprint
        ]
        recent_items.insert(
            0,
            {
                "analysis_version": ANALYSIS_HISTORY_VERSION,
                "fingerprint": fingerprint,
                "original_filename": original_filename,
                "archived_deck_path": str(archived_deck),
                "slide_count": len(slides_data),
                "composite_score": scorecard.get("composite_score", 0),
                "warning_count": scorecard.get("warning_count", 0),
                "hard_block_count": scorecard.get("hard_block_count", 0),
                "updated_at": now,
            },
        )
        self.index_path.write_text(
            json.dumps(recent_items[:200], indent=2), encoding="utf-8"
        )
        return entry
