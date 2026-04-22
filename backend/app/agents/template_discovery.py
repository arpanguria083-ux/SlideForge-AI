from typing import TypedDict, Literal, Optional
from dataclasses import dataclass
from enum import Enum
import json
import re

from ..models.schemas import GuardrailSchema, DEFAULT_RUBRIC_WEIGHTS
from ..services.llm_inference import inference_service, Message, parse_json_response


class SupervisorResponseType(str, Enum):
    YES = "yes"
    NO = "no"
    MODIFY = "modify"
    CLARIFY = "clarify"
    COMPLETE = "complete"


@dataclass
class DiscoveredPattern:
    category: str
    pattern: str
    evidence: list[str]
    confidence: float


@dataclass
class Question:
    question: str
    evidence: str
    context: str


class TemplateDiscoveryState(TypedDict):
    gold_slides_data: list
    playbook_text: str
    discovered_patterns: dict
    questions: list[dict]
    answers: list[dict]
    draft_schema: Optional[dict]
    status: Literal[
        "idle", "observing", "questioning", "validating", "completed", "failed"
    ]
    question_count: int


class TemplateDiscoveryAgent:
    def __init__(self, max_questions: int = 15):
        self.max_questions = max_questions

    async def discover_from_gold_slides(
        self,
        slides_data: list[dict],
        existing_rules: list[dict] = None,
    ) -> GuardrailSchema:
        state = TemplateDiscoveryState(
            gold_slides_data=slides_data,
            playbook_text="",
            discovered_patterns={},
            questions=[],
            answers=[],
            draft_schema=None,
            status="observing",
            question_count=0,
        )

        state["discovered_patterns"] = await self._observe_slides(slides_data)

        state["status"] = "questioning"

        while state["question_count"] < self.max_questions:
            question = await self._generate_next_question(state, existing_rules or [])

            if not question:
                break

            state["questions"].append(
                {
                    "question": question.question,
                    "evidence": question.evidence,
                }
            )

            state["question_count"] += 1

        state["draft_schema"] = self._build_schema(state)
        state["status"] = "completed"

        return self._to_guardrail(state["draft_schema"])

    async def discover_from_playbook(
        self,
        playbook_text: str,
        existing_rules: list[dict] = None,
    ) -> GuardrailSchema:
        state = TemplateDiscoveryState(
            gold_slides_data=[],
            playbook_text=playbook_text,
            discovered_patterns={},
            questions=[],
            answers=[],
            draft_schema=None,
            status="observing",
            question_count=0,
        )

        state["discovered_patterns"] = await self._extract_playbook_rules(playbook_text)

        contradictions = await self._find_contradictions(state["discovered_patterns"])

        if contradictions:
            for contradiction in contradictions:
                state["questions"].append(
                    {
                        "question": f"Contradiction found: {contradiction}",
                        "type": "clarify",
                    }
                )

        state["draft_schema"] = self._build_schema(state)
        state["status"] = "completed"

        return self._to_guardrail(state["draft_schema"])

    async def discover_combined(
        self,
        slides_data: list[dict],
        playbook_text: str,
        existing_rules: list[dict] = None,
    ) -> GuardrailSchema:
        playbook_schema = await self.discover_from_playbook(
            playbook_text, existing_rules
        )

        slides_schema = await self.discover_from_gold_slides(
            slides_data, existing_rules
        )

        _discrepancies = self._find_discrepancies(
            playbook_schema.model_dump(),
            slides_schema.model_dump(),
        )

        combined = GuardrailSchema(
            schema_version="1.0.0",
            engagement_type=playbook_schema.engagement_type,
            client_namespace=playbook_schema.client_namespace,
            discovered_patterns=slides_schema.discovered_patterns,
            playbook_rules=playbook_schema.playbook_rules,
            human_confirmed_rules=existing_rules or [],
            rubric_weights=playbook_schema.rubric_weights,
            language_rules=playbook_schema.language_rules,
            pass_threshold=playbook_schema.pass_threshold,
        )

        return combined

    async def _observe_slides(self, slides_data: list[dict]) -> dict:
        patterns = {
            "visual": [],
            "semantic": [],
            "style": [],
        }

        positions = {}
        for slide in slides_data:
            for tb in slide.get("text_boxes", []):
                pos_key = f"{tb.get('x', 0):.1f}_{tb.get('y', 0):.1f}"
                positions[pos_key] = positions.get(pos_key, 0) + 1

        consistent_positions = [
            pos for pos, count in positions.items() if count >= len(slides_data) * 0.5
        ]

        if consistent_positions:
            patterns["visual"].append(
                {
                    "type": "consistent_position",
                    "positions": consistent_positions,
                    "confidence": 0.8,
                }
            )

        titles = [s.get("title", "") for s in slides_data]
        action_oriented = sum(
            1
            for t in titles
            if any(
                kw in t.lower()
                for kw in ["recommend", "action", "implement", "strateg"]
            )
        )

        patterns["semantic"].append(
            {
                "type": "headline_style",
                "action_oriented_ratio": action_oriented / len(titles) if titles else 0,
                "confidence": 0.7,
            }
        )

        fonts = set()
        font_sizes = set()
        for slide in slides_data:
            for tb in slide.get("text_boxes", []):
                for run in tb.get("runs", []):
                    fonts.add(run.get("font_name", "Arial"))
                    font_sizes.add(run.get("font_size", 12))

        if fonts:
            patterns["style"].append(
                {
                    "type": "font_usage",
                    "fonts": list(fonts),
                    "confidence": 0.9,
                }
            )

        return patterns

    async def _extract_playbook_rules(self, playbook_text: str) -> dict:
        prompt = f"""Extract all mandatory design and content rules from this playbook.
Categorize them as: layout, typography, content, legal, tone.
Return JSON array with objects containing: rule (string), source_page (int or null), category (string).
Rules should be specific and actionable.

Playbook text:
{playbook_text[:5000]}
"""

        messages = [
            Message(
                role="system",
                content="You are a consulting playbook analyzer. Extract actionable rules as JSON array.",
            ),
            Message(role="user", content=prompt),
        ]

        try:
            response = await inference_service.llm.generate(messages)
            parsed = parse_json_response(response.content)
            rules = parsed.get("rules") if isinstance(parsed, dict) else parsed
            normalized = self._normalize_playbook_rules(rules)
            if normalized:
                return normalized
        except Exception:
            pass

        return self._extract_playbook_rules_fallback(playbook_text)

    async def _find_contradictions(self, rules: dict) -> list[str]:
        if not rules or not isinstance(rules, list):
            return []

        contradictions = []

        colors = {}
        for rule in rules:
            rule_text = rule.get("rule", "").lower()
            if "color" in rule_text or "blue" in rule_text or "navy" in rule_text:
                for color in ["blue", "navy", "black", "gray"]:
                    if color in rule_text:
                        colors[color] = colors.get(color, 0) + 1

        if len(colors) > 1:
            contradictions.append(
                f"Multiple color specifications found: {', '.join(colors.keys())}"
            )

        return contradictions

    def _find_discrepancies(self, playbook: dict, gold_slides: dict) -> list[str]:
        discrepancies = []

        _playbook_rules = playbook.get("playbook_rules", [])
        _gold_patterns = gold_slides.get("discovered_patterns", {})

        return discrepancies

    async def _generate_next_question(
        self,
        state: TemplateDiscoveryState,
        existing_rules: list[dict],
    ) -> Optional[Question]:
        patterns = state.get("discovered_patterns") or state.get("patterns") or {}
        asked_contexts = {
            item.get("context")
            for item in (state.get("questions", []) + state.get("answers", []))
            if isinstance(item, dict)
        }

        if "visual" in patterns and patterns["visual"]:
            first_pattern = patterns["visual"][0]
            if (
                first_pattern.get("type") == "consistent_position"
                and "visual_layout" not in asked_contexts
            ):
                return Question(
                    question="I noticed elements appear in consistent positions across slides. Should positional consistency be a hard rule?",
                    evidence=str(first_pattern),
                    context="visual_layout",
                )

        if "semantic" in patterns:
            for pattern in patterns["semantic"]:
                if (
                    pattern.get("action_oriented_ratio", 0) < 0.5
                    and "headline_style" not in asked_contexts
                ):
                    return Question(
                        question="Less than half of slide headlines are action-oriented. Should recommendations require action verbs in headlines?",
                        evidence=f"Action ratio: {pattern.get('action_oriented_ratio')}",
                        context="headline_style",
                    )

        if "style" in patterns:
            for pattern in patterns["style"]:
                if (
                    pattern.get("type") == "font_usage"
                    and "typography" not in asked_contexts
                ):
                    fonts = pattern.get("fonts", [])
                    if len(fonts) > 2:
                        return Question(
                            question=f"Found {len(fonts)} different fonts. Should we limit to 2 fonts maximum?",
                            evidence=str(fonts),
                            context="typography",
                        )

        return None

    def _build_schema(self, state: TemplateDiscoveryState) -> dict:
        patterns = state.get("discovered_patterns") or state.get("patterns") or {}

        if isinstance(patterns, list):
            playbook_rules = self._normalize_playbook_rules(patterns)
            return {
                "discovered_patterns": self._summarize_playbook_patterns(
                    playbook_rules
                ),
                "playbook_rules": playbook_rules,
                "human_confirmed_rules": state.get("answers", []),
                "rubric_weights": dict(DEFAULT_RUBRIC_WEIGHTS),
                "language_rules": self._derive_language_rules(playbook_rules),
                "pass_threshold": 75,
            }

        rules = []

        if "visual" in patterns:
            rules.append(
                {
                    "rule": "Consistent element positioning across slides",
                    "category": "layout",
                    "severity": "warning",
                }
            )

        if "semantic" in patterns:
            rules.append(
                {
                    "rule": "Action-oriented headlines for recommendations",
                    "category": "content",
                    "severity": "suggestion",
                }
            )

        if "style" in patterns:
            rules.append(
                {
                    "rule": "Maximum 2 fonts per slide",
                    "category": "typography",
                    "severity": "warning",
                }
            )

        return {
            "discovered_patterns": patterns,
            "playbook_rules": [],
            "human_confirmed_rules": rules,
            "rubric_weights": dict(DEFAULT_RUBRIC_WEIGHTS),
            "pass_threshold": 75,
        }

    def _to_guardrail(self, schema_dict: dict) -> GuardrailSchema:
        return GuardrailSchema(
            schema_version="1.0.0",
            discovered_patterns=schema_dict.get("discovered_patterns", {}),
            playbook_rules=schema_dict.get("playbook_rules", []),
            human_confirmed_rules=schema_dict.get("human_confirmed_rules", []),
            rubric_weights=schema_dict.get("rubric_weights", {}),
            language_rules=schema_dict.get("language_rules", {}),
            pass_threshold=schema_dict.get("pass_threshold", 75),
        )

    def _normalize_playbook_rules(self, rules) -> list[dict]:
        if not isinstance(rules, list):
            return []

        normalized: list[dict] = []
        seen: set[tuple[str, str]] = set()
        valid_categories = {"layout", "typography", "content", "legal", "tone"}
        for item in rules:
            if isinstance(item, str):
                rule_text = item.strip()
                category = self._categorize_rule(rule_text)
                source_page = None
            elif isinstance(item, dict):
                rule_text = str(item.get("rule", "")).strip()
                category = str(
                    item.get("category", "")
                ).strip().lower() or self._categorize_rule(rule_text)
                source_page = item.get("source_page")
            else:
                continue

            if not rule_text:
                continue
            if category not in valid_categories:
                category = self._categorize_rule(rule_text)

            key = (rule_text.lower(), category)
            if key in seen:
                continue
            seen.add(key)
            normalized.append(
                {
                    "rule": rule_text,
                    "category": category,
                    "source_page": source_page
                    if isinstance(source_page, int)
                    else None,
                }
            )
        return normalized

    def _extract_playbook_rules_fallback(self, playbook_text: str) -> list[dict]:
        lines = [line.strip() for line in playbook_text.splitlines()]
        section = "content"
        extracted: list[dict] = []
        cues = (
            "must",
            "should",
            "no ",
            "max ",
            "every ",
            "one ",
            "always",
            "avoid",
            "required",
            "title states",
            "partner signs off",
        )

        for raw_line in lines:
            line = re.sub(r"\s+", " ", raw_line).strip(" -\t")
            if not line:
                continue

            lowered = line.lower()
            if len(line) <= 4:
                continue

            if any(
                token in lowered for token in ("visual", "layout", "chart", "footer")
            ):
                if len(line) < 80 and line.endswith(
                    ("Rules", "Standards", "defaults", "standard")
                ):
                    section = "layout"
            if any(
                token in lowered
                for token in ("title", "narrative", "storyline", "recommendation")
            ):
                if len(line) < 80:
                    section = "content"
            if any(
                token in lowered for token in ("typography", "colour", "color", "font")
            ):
                if len(line) < 80:
                    section = "typography"

            looks_like_rule = (
                any(cue in lowered for cue in cues)
                or line.startswith("✓")
                or line.startswith("✗")
                or re.match(r"^\d+[–-]\d+\b", line)
                or (line[0].isupper() and line.endswith("."))
            )
            if not looks_like_rule:
                continue
            if len(line) < 12 or len(line) > 220:
                continue
            if lowered in {
                "do",
                "don't",
                "storyline flow",
                "chart defaults",
                "footer standard",
            }:
                continue

            extracted.append(
                {
                    "rule": line.lstrip("✓✗ ").strip(),
                    "category": self._categorize_rule(line, default=section),
                    "source_page": None,
                }
            )

        return self._normalize_playbook_rules(extracted)

    def _categorize_rule(self, rule_text: str, default: str = "content") -> str:
        lowered = (rule_text or "").lower()
        if any(
            token in lowered
            for token in ("font", "typography", "colour", "color", "bold", "italic")
        ):
            return "typography"
        if any(
            token in lowered
            for token in ("source", "cite", "legal", "disclaimer", "page number")
        ):
            return "legal"
        if any(
            token in lowered
            for token in ("tone", "concise", "plain english", "jargon", "headline")
        ):
            return "tone"
        if any(
            token in lowered
            for token in (
                "layout",
                "chart",
                "table",
                "footer",
                "position",
                "align",
                "slide",
                "appendix",
                "visual",
            )
        ):
            return "layout"
        if any(
            token in lowered
            for token in (
                "recommendation",
                "title",
                "storyline",
                "message",
                "evidence",
                "bullet",
                "so what",
                "objective",
            )
        ):
            return "content"
        return (
            default
            if default in {"layout", "typography", "content", "legal", "tone"}
            else "content"
        )

    def _derive_language_rules(self, rules: list[dict]) -> dict:
        language_rules: dict[str, object] = {}
        joined = " ".join(rule.get("rule", "").lower() for rule in rules)

        if "one key message per slide" in joined:
            language_rules["one_key_message_per_slide"] = True
        if (
            "title states the insight" in joined
            or "headline is the conclusion" in joined
        ):
            language_rules["insight_led_headlines"] = True
        if "no prose paragraphs" in joined:
            language_rules["avoid_prose_paragraphs"] = True
        if "so what" in joined:
            language_rules["require_so_what"] = True
        if "unexpanded acronyms" in joined:
            language_rules["expand_acronyms"] = True

        return language_rules

    def _summarize_playbook_patterns(self, rules: list[dict]) -> dict:
        by_category: dict[str, list[dict]] = {
            "layout": [],
            "typography": [],
            "content": [],
            "legal": [],
            "tone": [],
        }
        for rule in rules:
            category = rule.get("category", "content")
            by_category.setdefault(category, []).append(rule)

        return {
            "playbook_rule_count": len(rules),
            "by_category": {
                key: len(value) for key, value in by_category.items() if value
            },
            "sample_rules": {
                key: value[:5] for key, value in by_category.items() if value
            },
        }


template_discovery_agent = TemplateDiscoveryAgent()
