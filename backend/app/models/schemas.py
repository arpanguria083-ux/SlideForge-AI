from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
from enum import Enum


RUBRIC_DIMENSIONS = (
    "structure",
    "claim_grounding",
    "data_accuracy",
    "visual",
    "language",
    "framework",
    "so_what",
    "benchmarking",
)

DEFAULT_RUBRIC_WEIGHTS = {
    "structure": 0.15,
    "claim_grounding": 0.20,
    "data_accuracy": 0.15,
    "visual": 0.10,
    "language": 0.10,
    "framework": 0.10,
    "so_what": 0.15,
    "benchmarking": 0.05,
}


class ViewMode(str, Enum):
    UPLOAD = "UPLOAD"
    DASHBOARD = "DASHBOARD"


class DensityLevel(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


class SentimentType(str, Enum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    CRITICAL = "critical"


class PersonaType(str, Enum):
    CHAIRMAN = "Chairman"
    STORYTELLER = "Storyteller"
    DATA_AUDITOR = "Data Auditor"
    DESIGNER = "Designer"


class SeverityType(str, Enum):
    HARD_BLOCK = "hard_block"
    WARNING = "warning"
    SUGGESTION = "suggestion"
    PASS = "pass"


class BoundingBox(BaseModel):
    top: float
    left: float
    width: float
    height: float
    label: str


class PersonaComment(BaseModel):
    persona: PersonaType
    text: str
    sentiment: SentimentType
    score: int


class SlideAnalysis(BaseModel):
    id: str
    title: str
    summary: str
    overall_score: int
    density: DensityLevel = DensityLevel.MEDIUM
    visuals: list[BoundingBox] = Field(default_factory=list)
    fixes: list[BoundingBox] = Field(default_factory=list)
    council_debate: list[PersonaComment] = Field(default_factory=list)
    framework_detected: Optional[str] = None
    citation_issues: list[str] = Field(default_factory=list)


class SlideModel(BaseModel):
    id: str
    file_name: str
    preview_url: Optional[str] = None
    analysis: Optional[SlideAnalysis] = None
    status: str = "idle"


class GuardrailSchema(BaseModel):
    schema_version: str = "1.0.0"
    engagement_type: str = "strategy"
    client_namespace: Optional[str] = None
    discovered_patterns: dict = Field(default_factory=dict)
    playbook_rules: list[dict | str] = Field(default_factory=list)
    human_confirmed_rules: list[dict | str] = Field(default_factory=list)
    rubric_weights: dict[str, float] = Field(
        default_factory=lambda: dict(DEFAULT_RUBRIC_WEIGHTS)
    )
    language_rules: dict = Field(default_factory=dict)
    pass_threshold: int = 75
    signed_by: Optional[str] = None
    signed_at: Optional[str] = None
    sha256: Optional[str] = None
    signature: Optional[str] = None
    public_key: Optional[str] = None
    signature_algorithm: Optional[str] = None

    @field_validator("pass_threshold")
    @classmethod
    def _validate_threshold(cls, value: int) -> int:
        return max(0, min(100, int(value)))

    @field_validator("rubric_weights", mode="before")
    @classmethod
    def _coerce_weights(cls, value):
        if not isinstance(value, dict):
            return dict(DEFAULT_RUBRIC_WEIGHTS)

        cleaned: dict[str, float] = {}
        for key, raw in value.items():
            if key not in RUBRIC_DIMENSIONS:
                continue
            try:
                numeric = float(raw)
            except (TypeError, ValueError):
                continue
            if numeric < 0:
                numeric = 0.0
            cleaned[key] = numeric

        if not cleaned:
            return dict(DEFAULT_RUBRIC_WEIGHTS)

        for dim in RUBRIC_DIMENSIONS:
            cleaned.setdefault(dim, DEFAULT_RUBRIC_WEIGHTS[dim])

        total = sum(cleaned.values())
        if total <= 0:
            return dict(DEFAULT_RUBRIC_WEIGHTS)

        normalized = {dim: cleaned[dim] / total for dim in RUBRIC_DIMENSIONS}

        rounded = {dim: round(val, 6) for dim, val in normalized.items()}
        drift = round(1.0 - sum(rounded.values()), 6)
        if abs(drift) > 0 and rounded:
            rounded["claim_grounding"] = round(rounded["claim_grounding"] + drift, 6)

        return rounded

    @model_validator(mode="after")
    def _normalize_rule_limits(self):
        self.playbook_rules = list(self.playbook_rules or [])[:50]
        self.human_confirmed_rules = list(self.human_confirmed_rules or [])[:50]
        return self

    def normalized_rubric_weights(self) -> dict[str, float]:
        return {
            key: float(self.rubric_weights.get(key, DEFAULT_RUBRIC_WEIGHTS[key]))
            for key in RUBRIC_DIMENSIONS
        }


class Annotation(BaseModel):
    slide_index: int
    shape_id: Optional[str] = None
    run_start: Optional[int] = None
    run_end: Optional[int] = None
    text: str
    category: str
    severity: SeverityType
    message: str
    suggestion: Optional[str] = None


class QAScorecard(BaseModel):
    composite_score: int
    structure_score: int = 0
    claim_grounding_score: int = 0
    data_accuracy_score: int = 0
    visual_compliance_score: int = 0
    language_score: int = 0
    framework_score: int = 0
    so_what_score: int = 0
    benchmarking_score: int = 0
    hard_block_count: int = 0
    warning_count: int = 0
    failing_slides: list[int] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    summary: str = ""


class RevisionState(BaseModel):
    attempt_count: int = 0
    score_history: list[int] = Field(default_factory=list)
    resolved_issues: list[str] = Field(default_factory=list)
    persistent_issues: list[str] = Field(default_factory=list)
    escalation_required: bool = False
    deck_path: Optional[str] = None
    scorecard: Optional[QAScorecard] = None


class OverrideRequest(BaseModel):
    annotation_id: str
    reason: str


class AcceptRequest(BaseModel):
    annotation_id: str


class SignRequest(BaseModel):
    user_name: str


class SaveTemplateRequest(BaseModel):
    template_name: str
