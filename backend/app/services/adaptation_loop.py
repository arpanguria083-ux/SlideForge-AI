import sqlite3
from dataclasses import dataclass
from pathlib import Path
import json
from app.core.time_utils import utc_now_iso


@dataclass
class EngagementPattern:
    engagement_type: str
    client_namespace: str
    score_history: list
    resolved_issues: list
    persistent_issues: list
    revision_count: int
    final_composite_score: int
    created_at: str


@dataclass
class OverrideRecord:
    session_id: str
    annotation_id: str
    category: str
    reason: str
    slide_index: int
    created_at: str


class AdaptationDatabase:
    def __init__(self, db_path: str = "data/slideforge.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS engagement_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                engagement_type TEXT NOT NULL,
                client_namespace TEXT,
                score_history TEXT,
                resolved_issues TEXT,
                persistent_issues TEXT,
                revision_count INTEGER,
                final_composite_score INTEGER,
                created_at TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS override_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                annotation_id TEXT NOT NULL,
                category TEXT NOT NULL,
                reason TEXT NOT NULL,
                slide_index INTEGER,
                created_at TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS prompt_suggestions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                engagement_type TEXT NOT NULL,
                suggestion TEXT NOT NULL,
                category TEXT,
                approved INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_engagement_type
            ON engagement_patterns(engagement_type)
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_override_session
            ON override_records(session_id)
        """)

        conn.commit()
        conn.close()

    def log_engagement(self, pattern: EngagementPattern):
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO engagement_patterns
            (engagement_type, client_namespace, score_history, resolved_issues,
             persistent_issues, revision_count, final_composite_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                pattern.engagement_type,
                pattern.client_namespace,
                json.dumps(pattern.score_history),
                json.dumps(pattern.resolved_issues),
                json.dumps(pattern.persistent_issues),
                pattern.revision_count,
                pattern.final_composite_score,
                pattern.created_at,
            ),
        )

        conn.commit()
        conn.close()

    def log_override(self, override: OverrideRecord):
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO override_records
            (session_id, annotation_id, category, reason, slide_index, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            (
                override.session_id,
                override.annotation_id,
                override.category,
                override.reason,
                override.slide_index,
                override.created_at,
            ),
        )

        conn.commit()
        conn.close()

    def get_persistent_issues(self, engagement_type: str = None) -> dict:
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        if engagement_type:
            cursor.execute(
                """
                SELECT category, COUNT(*) as count
                FROM override_records
                WHERE session_id IN (
                    SELECT session_id FROM override_records
                    GROUP BY session_id
                    HAVING COUNT(*) > 2
                )
                AND category = ?
                GROUP BY category
            """,
                (engagement_type,),
            )
        else:
            cursor.execute("""
                SELECT category, COUNT(*) as count
                FROM override_records
                GROUP BY category
                ORDER BY count DESC
            """)

        results = cursor.fetchall()
        conn.close()

        return {row[0]: row[1] for row in results}

    def get_false_positive_rate(self, category: str = None) -> float:
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        if category:
            cursor.execute(
                """
                SELECT COUNT(*) FROM override_records
                WHERE category = ?
            """,
                (category,),
            )
        else:
            cursor.execute("SELECT COUNT(*) FROM override_records")

        override_count = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM engagement_patterns")
        total_engagements = cursor.fetchone()[0]

        conn.close()

        if total_engagements == 0:
            return 0.0

        return (
            override_count / (total_engagements * 10) if total_engagements > 0 else 0.0
        )

    def get_persistent_categories(self, min_count: int = 3) -> list:
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT category, COUNT(*) as count
            FROM override_records
            GROUP BY category
            HAVING count >= ?
            ORDER BY count DESC
        """,
            (min_count,),
        )

        results = [row[0] for row in cursor.fetchall()]
        conn.close()

        return results


class AdaptationAgent:
    def __init__(self, db: AdaptationDatabase = None):
        self.db = db or AdaptationDatabase()
        self.analysis_threshold = 10

    def log_engagement_completion(
        self,
        engagement_type: str,
        client_namespace: str,
        score_history: list,
        resolved_issues: list,
        persistent_issues: list,
        revision_count: int,
        final_score: int,
    ):
        pattern = EngagementPattern(
            engagement_type=engagement_type,
            client_namespace=client_namespace,
            score_history=score_history,
            resolved_issues=resolved_issues,
            persistent_issues=persistent_issues,
            revision_count=revision_count,
            final_composite_score=final_score,
            created_at=utc_now_iso(),
        )

        self.db.log_engagement(pattern)

    def log_override_decision(
        self,
        session_id: str,
        annotation_id: str,
        category: str,
        reason: str,
        slide_index: int,
    ):
        override = OverrideRecord(
            session_id=session_id,
            annotation_id=annotation_id,
            category=category,
            reason=reason,
            slide_index=slide_index,
            created_at=utc_now_iso(),
        )

        self.db.log_override(override)

    def should_analyze(self, engagement_type: str = None) -> bool:
        conn = sqlite3.connect(str(self.db.db_path))
        cursor = conn.cursor()

        if engagement_type:
            cursor.execute(
                """
                SELECT COUNT(*) FROM engagement_patterns
                WHERE engagement_type = ?
            """,
                (engagement_type,),
            )
        else:
            cursor.execute("SELECT COUNT(*) FROM engagement_patterns")

        count = cursor.fetchone()[0]
        conn.close()

        return count >= self.analysis_threshold

    def generate_suggestions(self, engagement_type: str = None) -> list[dict]:
        persistent_categories = self.db.get_persistent_categories()

        suggestions = []

        category_fixes = {
            "hedging": "Consider relaxing hedging language detection rules or adding specific allowed phrases",
            "grammar": "Review grammar rules - high false positive rate suggests rules are too strict",
            "vague_quantifier": "Add context detection to avoid flagging legitimate qualitative statements",
            "passive": "Allow passive voice in context of historical statements or observations",
            "structure": "Review structure rules - narrative arc detection may need calibration",
            "data_accuracy": "Verify Excel source reference patterns",
            "visual": "Review visual rules for font and density thresholds",
            "claim_grounding": "Adjust similarity threshold for claim-evidence matching",
        }

        for category in persistent_categories:
            suggestions.append(
                {
                    "category": category,
                    "suggestion": category_fixes.get(
                        category, f"Review {category} detection rules"
                    ),
                    "priority": "high"
                    if persistent_categories.index(category) < 2
                    else "medium",
                }
            )

        fp_rate = self.db.get_false_positive_rate()
        if fp_rate > 0.15:
            suggestions.append(
                {
                    "category": "general",
                    "suggestion": f"Overall false positive rate is {fp_rate:.1%}. Consider reviewing threshold settings.",
                    "priority": "high",
                }
            )

        return suggestions

    def analyze_and_suggest(self, engagement_type: str = None) -> dict:
        if not self.should_analyze(engagement_type):
            return {
                "ready": False,
                "engagement_count": 0,
                "threshold": self.analysis_threshold,
                "message": f"Need {self.analysis_threshold} more engagements before analysis",
            }

        suggestions = self.generate_suggestions(engagement_type)

        persistent_categories = self.db.get_persistent_categories()

        return {
            "ready": True,
            "suggestions": suggestions,
            "persistent_categories": persistent_categories,
            "false_positive_rate": self.db.get_false_positive_rate(),
        }

    def save_suggestion(
        self,
        engagement_type: str,
        suggestion: str,
        category: str = "general",
    ):
        conn = sqlite3.connect(str(self.db.db_path))
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO prompt_suggestions
            (engagement_type, suggestion, category, created_at)
            VALUES (?, ?, ?, ?)
        """,
            (
                engagement_type,
                suggestion,
                category,
                utc_now_iso(),
            ),
        )

        conn.commit()
        conn.close()

    def approve_suggestion(self, suggestion_id: int):
        conn = sqlite3.connect(str(self.db.db_path))
        cursor = conn.cursor()

        cursor.execute(
            """
            UPDATE prompt_suggestions
            SET approved = 1
            WHERE id = ?
        """,
            (suggestion_id,),
        )

        conn.commit()
        conn.close()

    def get_approved_suggestions(self, engagement_type: str = None) -> list[dict]:
        conn = sqlite3.connect(str(self.db.db_path))
        cursor = conn.cursor()

        if engagement_type:
            cursor.execute(
                """
                SELECT id, engagement_type, suggestion, category
                FROM prompt_suggestions
                WHERE approved = 1 AND engagement_type = ?
            """,
                (engagement_type,),
            )
        else:
            cursor.execute("""
                SELECT id, engagement_type, suggestion, category
                FROM prompt_suggestions
                WHERE approved = 1
            """)

        results = [
            {
                "id": row[0],
                "engagement_type": row[1],
                "suggestion": row[2],
                "category": row[3],
            }
            for row in cursor.fetchall()
        ]

        conn.close()
        return results


adaptation_agent = AdaptationAgent()
adaptation_db = AdaptationDatabase()
