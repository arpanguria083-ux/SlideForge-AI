import os
import re
import json
import math
import asyncio
from typing import TypedDict, Literal
from dataclasses import dataclass, field
from pathlib import Path
import logging

logger = logging.getLogger("slideforge.agents")


from ..models.schemas import (
    Annotation,
    QAScorecard,
    GuardrailSchema,
)
from ..services.llm_inference import inference_service, Message, parse_json_response


MAX_CONCURRENT_LLM = int(os.environ.get("MAX_CONCURRENT_LLM", "4"))
_llm_semaphore = asyncio.Semaphore(MAX_CONCURRENT_LLM)
_vision_semaphore = asyncio.Semaphore(2)


def _hash_llm_cache_key(parts: list[str]) -> str:
    import hashlib

    raw = "||".join(parts)
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()


def _llm_cache_db_path() -> Path:
    cache_dir = Path(
        os.getenv("LLM_CACHE_DIR", str(Path.home() / ".slideforge" / "data"))
    )
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / "llm_cache.sqlite"


def _llm_cache_get(key: str, ttl_seconds: int = 14 * 24 * 3600) -> str | None:
    import sqlite3
    import time

    db_path = _llm_cache_db_path()
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS llm_cache (cache_key TEXT PRIMARY KEY, response_text TEXT NOT NULL, created_at REAL NOT NULL)"
        )
        row = conn.execute(
            "SELECT response_text, created_at FROM llm_cache WHERE cache_key = ?",
            (key,),
        ).fetchone()
        if not row:
            return None
        response_text, created_at = row
        if (time.time() - float(created_at)) > ttl_seconds:
            conn.execute("DELETE FROM llm_cache WHERE cache_key = ?", (key,))
            conn.commit()
            return None
        return str(response_text)


def _llm_cache_set(key: str, response_text: str) -> None:
    import sqlite3
    import time

    db_path = _llm_cache_db_path()
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS llm_cache (cache_key TEXT PRIMARY KEY, response_text TEXT NOT NULL, created_at REAL NOT NULL)"
        )
        conn.execute(
            "INSERT OR REPLACE INTO llm_cache(cache_key, response_text, created_at) VALUES (?, ?, ?)",
            (key, response_text, time.time()),
        )
        conn.commit()


class AnalysisState(TypedDict):
    deck_path: str
    slides_data: list
    guardrail: GuardrailSchema
    annotations: list[Annotation]
    scorecard: QAScorecard | None
    revision_count: int
    status: Literal["pending", "analyzing", "completed", "failed"]


@dataclass
class AgentResult:
    agent_name: str
    findings: list[Annotation]
    score: int
    metadata: dict = field(default_factory=dict)


from ..services.model_registry import model_registry  # noqa: E402
from .mbb_agents import (
    FrameworkIdentifierAgent,
    SoWhatTestAgent,
    CompetitiveBenchmarkAgent,
    SlideContextSynthesizer,
)


def _surya_available() -> bool:
    try:
        import importlib.util

        return importlib.util.find_spec("surya.layout") is not None
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Shared LLM helper — parse JSON safely from model output
# ---------------------------------------------------------------------------


async def _llm(prompt: str, system: str = "", max_tokens: int = 4096) -> str:
    """Single LLM call returning raw content string. Retries up to 2x on failure.
    Uses a semaphore to limit concurrent LLM calls."""
    import logging

    logger = logging.getLogger("slideforge.agents")
    if inference_service.llm is None:
        return '{"error":"LLM provider unavailable"}'

    # Prepend no-think instruction to reduce reasoning verbosity
    no_think_prefix = (
        "IMPORTANT: Do NOT include any thinking process, reasoning steps, or preamble. "
        "Return ONLY the requested output format (JSON). No markdown wrapping unless requested.\n\n"
    )

    effective_max_tokens = max_tokens
    try:
        configured = int(getattr(inference_service, "analysis_max_tokens", max_tokens))
        effective_max_tokens = min(max_tokens, configured) if max_tokens else configured
    except Exception:
        effective_max_tokens = max_tokens

    msgs = []
    if system:
        msgs.append(Message(role="system", content=system))
    msgs.append(Message(role="user", content=no_think_prefix + prompt))

    provider = str(getattr(inference_service, "current_provider", "unknown"))
    model_name = getattr(getattr(inference_service, "llm", None), "model", "unknown")
    cache_key = _hash_llm_cache_key(
        [
            "v1",
            provider,
            str(model_name),
            str(effective_max_tokens),
            system or "",
            prompt,
        ]
    )
    cached = _llm_cache_get(cache_key)
    if cached is not None:
        logger.debug("LLM cache hit")
        return cached
    logger.debug("LLM cache miss")

    last_error = None
    async with _llm_semaphore:
        for attempt in range(3):
            try:
                resp = await inference_service.llm.generate(
                    msgs,
                    max_tokens=effective_max_tokens,
                    context_window=getattr(
                        inference_service, "local_context_window", None
                    ),
                )
                if resp.content and resp.content.strip():
                    _llm_cache_set(cache_key, resp.content)
                    return resp.content
                # Empty response — retry
                logger.warning(f"Empty LLM response on attempt {attempt + 1}")
            except Exception as e:
                last_error = e
                logger.warning(f"LLM call failed attempt {attempt + 1}: {e}")

            if attempt < 2:
                await asyncio.sleep(1 * (attempt + 1))  # 1s, 2s backoff

    return f'{{"error": "{str(last_error or "Empty response after retries")}"}}'


def _extract_numeric_values(text: str) -> list[float]:
    values: list[float] = []
    if not text:
        return values

    for match in re.findall(
        r"(?<![\w.])[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|[-+]?\d+(?:\.\d+)?%?",
        text,
    ):
        token = match.strip()
        if not token:
            continue
        is_percent = token.endswith("%")
        normalized = token[:-1] if is_percent else token
        normalized = normalized.replace(",", "")
        try:
            numeric = float(normalized)
            if is_percent:
                numeric = numeric / 100.0
            values.append(numeric)
        except Exception:
            continue
    return values


def _avg(values: list[int]) -> int:
    if not values:
        return 100
    return int(round(sum(values) / len(values)))


def _exponential_decay_score(
    hard_blocks: int = 0,
    warnings: int = 0,
    suggestions: int = 0,
    *,
    lambda_hard: float = 0.18,
    lambda_warn: float = 0.06,
    lambda_suggest: float = 0.02,
) -> int:
    """Score using exponential decay: 100 * exp(-Σ λ_i * count_i).

    Unlike linear stacking (100 - 15*hard - 5*warn), this provides
    diminishing returns per additional issue, producing more informative
    scores.  E.g. 2 hard + 4 warn → 64 (vs. flat 50), 7 hard → 28
    (vs. flat 0).
    """
    exponent = (
        lambda_hard * hard_blocks
        + lambda_warn * warnings
        + lambda_suggest * suggestions
    )
    return max(0, min(100, int(round(100 * math.exp(-exponent)))))


def _precision_significant_figures(value_str: str) -> int:
    """Estimate significant figures from a numeric string."""
    cleaned = value_str.strip().lstrip("-+").replace(",", "")
    if cleaned.endswith("%"):
        cleaned = cleaned[:-1]
    if "." in cleaned:
        integer_part, decimal_part = cleaned.split(".", 1)
        return len(integer_part.lstrip("0") or "0") + len(decimal_part)
    else:
        stripped = cleaned.lstrip("0") or "0"
        return len(stripped.rstrip("0")) or 1


# ---------------------------------------------------------------------------
# Insight Extractor — LLM-powered factual claim detection
# ---------------------------------------------------------------------------


class InsightExtractor:
    """
    Extracts every factual claim from slide text and flags those that appear
    unsupported by hedging language or missing citations.
    Uses the LLM to distinguish real claims from decorative text.
    """

    SYSTEM = (
        "You are a senior management consultant reviewing slide decks. "
        "Your job is to identify every factual claim that requires evidence: "
        "statistics, percentages, financial figures, causal assertions, "
        "forward-looking statements, and benchmark comparisons. "
        "For each claim decide: SUPPORTED (the slide itself provides a source), "
        "UNVERIFIED (no source visible but claim seems plausible), "
        "UNSUPPORTED (strong claim with no source and hedging language missing)."
    )

    async def run(self, slides_data: list, guardrail: GuardrailSchema) -> AgentResult:
        import asyncio

        annotations = []
        ungrounded_count = 0

        # Build (slide_idx, full_text, prompt) for slides with content
        tasks_meta = []
        for slide in slides_data:
            slide_idx = slide.get("index", 0)
            full_text = slide.get("full_text", "").strip()
            if not full_text:
                continue

            rules_context = ""
            if guardrail.playbook_rules:
                rules_list = "\n".join(
                    f"- {r.get('rule', r) if isinstance(r, dict) else r}"
                    for r in guardrail.playbook_rules[:10]
                )
                rules_context = (
                    f"\n\nCLIENT PLAYBOOK RULES (flag violations):\n{rules_list}"
                )

            prompt = f"""Analyze this consulting slide text for factual claims.

SLIDE TITLE: {slide.get("title", "(untitled)")}
SLIDE TEXT:
{full_text}{rules_context}

Return a JSON array. Each item:
{{
  "claim": "<exact claim text from slide>",
  "status": "SUPPORTED" | "UNVERIFIED" | "UNSUPPORTED",
  "reason": "<one-sentence explanation>",
  "suggestion": "<how to fix — only for UNSUPPORTED/UNVERIFIED>"
}}

Return [] if no factual claims found. Return ONLY the JSON array."""

            tasks_meta.append((slide_idx, full_text, prompt))

        # Fire all LLM calls concurrently instead of one-by-one
        raw_results = await asyncio.gather(
            *[_llm(prompt, system=self.SYSTEM) for _, _, prompt in tasks_meta],
            return_exceptions=True,
        )

        for (slide_idx, full_text, _), raw in zip(tasks_meta, raw_results):
            if isinstance(raw, Exception):
                continue
            claims = parse_json_response(raw)
            if not isinstance(claims, list):
                claims = []

            for c in claims:
                if not isinstance(c, dict):
                    continue
                status = c.get("status", "UNVERIFIED")
                if status == "SUPPORTED":
                    continue
                severity = "hard_block" if status == "UNSUPPORTED" else "warning"
                if status == "UNSUPPORTED":
                    ungrounded_count += 1
                annotations.append(
                    Annotation(
                        slide_index=slide_idx,
                        text=c.get("claim", full_text[:60]),
                        category="claim_extraction",
                        severity=severity,
                        message=c.get("reason", "Claim may lack supporting evidence"),
                        suggestion=c.get("suggestion"),
                    )
                )

        # Exponential decay scoring — diminishing returns per issue
        hard = sum(1 for a in annotations if a.severity == "hard_block")
        warn = sum(1 for a in annotations if a.severity == "warning")
        score = _exponential_decay_score(hard, warn)

        return AgentResult(
            agent_name="Insight Extractor",
            findings=annotations,
            score=score,
            metadata={
                "claims_extracted": len(annotations),
                "ungrounded": ungrounded_count,
            },
        )


# ---------------------------------------------------------------------------
# Structure Auditor — LLM-powered narrative arc + MECE
# ---------------------------------------------------------------------------


class StructureAuditor:
    """
    Evaluates the deck's storyline using the LLM — not keyword matching.
    Checks:
    - Pyramid Principle compliance (conclusion-first or evidence-first)
    - Narrative arc (context → problem → diagnosis → recommendation)
    - Action-oriented vs descriptive headlines
    - MECE compliance for framework slides
    """

    SYSTEM = (
        "You are an expert in McKinsey's Pyramid Principle and MECE frameworks. "
        "You evaluate consulting slide decks for structural quality. "
        "Be precise and evidence-based in your findings."
    )

    async def run(self, slides_data: list, guardrail: GuardrailSchema) -> AgentResult:
        annotations = []

        headlines = [s.get("title", "") for s in slides_data]

        # --- Narrative arc evaluation (one LLM call for the whole deck) ---
        arc_annotations = await self._evaluate_narrative_arc(headlines, slides_data)
        annotations.extend(arc_annotations)

        # --- Headline quality (action-oriented vs descriptive) ---
        headline_annotations = await self._evaluate_headlines(headlines)
        annotations.extend(headline_annotations)

        # --- MECE check for individual framework slides (parallelized) ---
        import asyncio

        mece_results = await asyncio.gather(
            *[self._check_mece(idx, slide) for idx, slide in enumerate(slides_data)],
            return_exceptions=True,
        )
        for mece_ann in mece_results:
            if mece_ann and not isinstance(mece_ann, Exception):
                annotations.append(mece_ann)

        hard = sum(1 for a in annotations if a.severity == "hard_block")
        warn = sum(1 for a in annotations if a.severity == "warning")
        suggest = sum(1 for a in annotations if a.severity == "suggestion")
        score = _exponential_decay_score(hard, warn, suggest)
        return AgentResult(
            agent_name="Structure Auditor",
            findings=annotations,
            score=score,
            metadata={"headlines_checked": len(headlines)},
        )

    async def _evaluate_narrative_arc(
        self, headlines: list[str], slides_data: list
    ) -> list[Annotation]:
        if len(headlines) < 2:
            return []

        deck_outline = "\n".join(
            f"Slide {i + 1}: {h}" for i, h in enumerate(headlines) if h
        )

        prompt = f"""Review this consulting deck outline and evaluate the narrative arc.

DECK OUTLINE:
{deck_outline}

Tasks:
1. Does the deck follow a logical flow (Context/Situation → Problem/Complication → Recommendation/Resolution)?
2. Are there any logical jumps (e.g., recommendations before diagnosis)?
3. Which specific slides break the narrative flow?

Return JSON:
{{
  "arc_valid": true | false,
  "arc_type": "Pyramid (conclusion-first)" | "Narrative (context-first)" | "Fragmented" | "Other",
  "issues": [
    {{"slide_index": 0, "message": "<specific issue>", "suggestion": "<how to fix>"}}
  ],
  "overall_assessment": "<one paragraph>"
}}

Return ONLY the JSON."""

        raw = await _llm(prompt, system=self.SYSTEM, max_tokens=600)
        result = parse_json_response(raw)
        if not isinstance(result, dict):
            return []

        annotations = []
        for issue in result.get("issues", []):
            if not isinstance(issue, dict):
                continue
            idx = issue.get("slide_index", 0)
            # Clamp to valid range — never flag all slides for one issue
            idx = max(0, min(idx, len(headlines) - 1))
            annotations.append(
                Annotation(
                    slide_index=idx,
                    text=headlines[idx] if idx < len(headlines) else "",
                    category="structure",
                    severity="warning",
                    message=issue.get("message", "Narrative arc issue"),
                    suggestion=issue.get(
                        "suggestion",
                        "Reorder to follow Context → Problem → Recommendation",
                    ),
                )
            )

        return annotations

    async def _evaluate_headlines(self, headlines: list[str]) -> list[Annotation]:
        if not headlines:
            return []

        numbered = "\n".join(f"{i}: {h}" for i, h in enumerate(headlines) if h)
        prompt = f"""For each slide headline below, evaluate if it is:
- ACTION-ORIENTED: Contains an insight or recommendation ("Revenue declined 23% due to churn")
- DESCRIPTIVE: Just labels the topic ("Revenue Analysis")

Return a JSON array of only the descriptive (weak) headlines:
[{{"slide_index": 0, "headline": "...", "suggestion": "<stronger action-oriented version>"}}]

If all headlines are strong, return [].

HEADLINES:
{numbered}

Return ONLY the JSON array."""

        raw = await _llm(prompt, system=self.SYSTEM, max_tokens=400)
        items = parse_json_response(raw)
        if not isinstance(items, list):
            return []

        return [
            Annotation(
                slide_index=item.get("slide_index", 0),
                text=item.get("headline", ""),
                category="structure",
                severity="suggestion",
                message="Descriptive headline — does not convey the key insight",
                suggestion=item.get("suggestion"),
            )
            for item in items
            if isinstance(item, dict)
        ]

    async def _check_mece(self, idx: int, slide: dict) -> Annotation | None:
        text = slide.get("full_text", "")
        title = slide.get("title", "")

        # Only check slides that appear to be framework/categorisation slides
        has_bullets = text.count("\n") >= 3 or text.count("•") >= 3
        has_parallel = any(
            kw in text.lower()
            for kw in ["first", "second", "third", "1.", "2.", "3.", "a)", "b)", "c)"]
        )
        if not (has_bullets or has_parallel):
            return None

        prompt = f"""This consulting slide appears to present a categorisation or framework.
Evaluate if the categories/items are MECE (Mutually Exclusive, Collectively Exhaustive).

TITLE: {title}
TEXT:
{text[:600]}

Return JSON:
{{
  "is_mece": true | false,
  "overlap_issues": ["<describe any overlapping items>"],
  "gap_issues": ["<describe any missing coverage>"],
  "suggestion": "<how to fix>"
}}

If the slide is not a categorisation framework, return {{"is_mece": true, "overlap_issues": [], "gap_issues": [], "suggestion": ""}}
Return ONLY the JSON."""

        raw = await _llm(prompt, system=self.SYSTEM, max_tokens=300)
        result = parse_json_response(raw)
        if not isinstance(result, dict) or result.get("is_mece", True):
            return None

        issues = result.get("overlap_issues", []) + result.get("gap_issues", [])
        message = "; ".join(issues) if issues else "MECE compliance issue detected"

        return Annotation(
            slide_index=idx,
            text=title,
            category="structure",
            severity="warning",
            message=f"MECE issue: {message}",
            suggestion=result.get(
                "suggestion",
                "Ensure categories are mutually exclusive and collectively exhaustive",
            ),
        )


# ---------------------------------------------------------------------------
# Data Lineage Agent — chart vs Excel + table verification (unchanged logic,
# but now uses LLM to describe mismatches instead of generic messages)
# ---------------------------------------------------------------------------


class DataLineageAgent:
    async def run(self, slides_data: list, excel_data: dict | None) -> AgentResult:
        annotations = []

        if not excel_data:
            # Mark charts as UNVERIFIED rather than giving a hard 50 score
            for slide in slides_data:
                for chart in slide.get("charts", []):
                    annotations.append(
                        Annotation(
                            slide_index=slide.get("index", 0),
                            shape_id=chart.get("id", ""),
                            text=chart.get("title", "Untitled Chart"),
                            category="data_accuracy",
                            severity="suggestion",
                            message="No source Excel provided — chart values unverified",
                            suggestion="Upload the source Excel file to enable data lineage verification",
                        )
                    )
            score = 60 if not any(s.get("charts") for s in slides_data) else 40
            return AgentResult(
                agent_name="Data Lineage Agent",
                findings=annotations,
                score=score,
                metadata={"note": "No Excel source — charts flagged as unverified"},
            )

        for slide in slides_data:
            for chart in slide.get("charts", []):
                cache_values = chart.get("cache_values", [])
                range_ref = chart.get("data_range_ref", "")

                if range_ref and excel_data:
                    sheet_name = (
                        range_ref.split("!")[0].replace("'", "")
                        if "!" in range_ref
                        else list(excel_data.get("sheets", {}).keys())[0]
                    )
                    excel_sheet = excel_data.get("sheets", {}).get(sheet_name, [])

                    mismatches = self._find_mismatches(cache_values, excel_sheet)
                    if mismatches:
                        annotations.append(
                            Annotation(
                                slide_index=slide.get("index", 0),
                                shape_id=chart.get("id", ""),
                                text=chart.get("title", "Untitled Chart"),
                                category="data_accuracy",
                                severity="hard_block",
                                message=f"Chart values differ from Excel source: {mismatches[0]}",
                                suggestion="Update chart data from the Excel source or correct the Excel file",
                            )
                        )

            table_annotations = self._verify_tables(slide, excel_data)
            annotations.extend(table_annotations)

        hard = sum(1 for a in annotations if a.severity == "hard_block")
        warn = sum(1 for a in annotations if a.severity == "warning")
        score = _exponential_decay_score(hard, warn, lambda_hard=0.25)

        return AgentResult(
            agent_name="Data Lineage Agent",
            findings=annotations,
            score=score,
            metadata={
                "charts_checked": sum(len(s.get("charts", [])) for s in slides_data),
                "tables_checked": sum(len(s.get("tables", [])) for s in slides_data),
            },
        )

    def _find_mismatches(self, cache: list, excel: list) -> list[str]:
        """Precision-aware mismatch detection.

        Instead of a fixed 0.5% threshold, this respects the significant
        figures of the chart value.  E.g. a chart showing '1.2' (2 sig figs)
        will be compared against the Excel value rounded to 2 sig figs,
        preventing false positives from legitimate rounding.
        """
        mismatches = []
        for i, row in enumerate(cache):
            if i >= len(excel):
                break
            for j, val in enumerate(row):
                if j >= len(excel[i]):
                    break
                try:
                    chart_val = float(str(val).replace(",", ""))
                    excel_val = float(str(excel[i][j]).replace(",", ""))
                    if excel_val == 0 and chart_val == 0:
                        continue
                    # Determine sig-figs from chart value to set tolerance
                    sig_figs = _precision_significant_figures(str(val))
                    if abs(excel_val) > 0:
                        magnitude = int(math.floor(math.log10(abs(excel_val))))
                        rounded_excel = round(excel_val, sig_figs - magnitude - 1)
                    else:
                        rounded_excel = 0.0
                    diff = abs(chart_val - rounded_excel)
                    denominator = (
                        abs(rounded_excel)
                        if rounded_excel != 0
                        else abs(chart_val) + 1e-9
                    )
                    pct = diff / denominator
                    if pct > 0.005:  # > 0.5% after precision alignment
                        mismatches.append(
                            f"Cell [{i},{j}]: slide shows {val}, Excel shows {excel[i][j]} "
                            f"(delta {pct:.1%} after precision alignment)"
                        )
                except (ValueError, TypeError):
                    pass
        return mismatches

    def _verify_tables(self, slide: dict, excel_data: dict) -> list[Annotation]:
        annotations = []
        for table in slide.get("tables", []):
            table_text = table.get("text", "")
            table_values = re.findall(r"\$?\d+(?:,\d{3})*(?:\.\d+)?%?", table_text)
            if not table_values:
                continue

            matched = False
            for sheet_data in excel_data.get("sheets", {}).values():
                for row in sheet_data:
                    row_str = " ".join(str(cell) for cell in row)
                    if (
                        sum(1 for tv in table_values if tv in row_str)
                        >= len(table_values) * 0.5
                    ):
                        matched = True
                        break
                if matched:
                    break

            if not matched:
                annotations.append(
                    Annotation(
                        slide_index=slide.get("index", 0),
                        shape_id=table.get("id", ""),
                        text=table.get("title", "Table")[:50],
                        category="data_accuracy",
                        severity="warning",
                        message="Table contains values not found in source Excel",
                        suggestion="Verify table data against source Excel",
                    )
                )
        return annotations

    def verify_vision_table(self, vision_table: dict, excel_data: dict) -> list[str]:
        if not excel_data:
            return []

        native_text = str(vision_table.get("native_text") or "")
        vision_summary = str(vision_table.get("table_summary") or "")
        headers = " ".join(str(h) for h in (vision_table.get("table_headers") or []))
        rows_blob = " ".join(
            " ".join(str(v) for v in (row.get("values") or []))
            for row in (vision_table.get("table_rows") or [])
            if isinstance(row, dict)
        )
        reference_blob = " ".join([native_text, vision_summary, headers, rows_blob])
        extracted = re.findall(r"\$?\d+(?:,\d{3})*(?:\.\d+)?%?", reference_blob)
        if not extracted:
            return []

        excel_rows = []
        for sheet_rows in (excel_data.get("sheets") or {}).values():
            for row in sheet_rows:
                excel_rows.append(" ".join(str(cell) for cell in row))

        mismatches = []
        for token in extracted[:40]:
            if not any(token in row for row in excel_rows):
                mismatches.append(f"Value {token} not found in Excel source")
        return mismatches[:6]


# ---------------------------------------------------------------------------
# Visual Analysis Agent — Surya layout detection + python-pptx fallback
# ---------------------------------------------------------------------------


class VisualAnalysisAgent:
    """
    Uses Surya layout model when available for real bounding-box element detection.
    Falls back to python-pptx coordinate analysis when Surya is not installed.

    Surya detects 15+ block types: text, section-header, caption, footnote,
    table, figure, image, page-header, page-footer, etc.
    Reading order predictor gives the correct visual reading sequence.
    """

    async def run(self, slides_data: list, guardrail: GuardrailSchema) -> AgentResult:
        import asyncio

        annotations = []
        slide_metadata = {}

        # Check Surya availability/model readiness once, not inside every loop iteration.
        surya_layout_predictor = None
        if _surya_available():
            try:
                surya_layout_predictor = model_registry.get_surya_layout()
            except Exception:
                surya_layout_predictor = None
        surya_ok = surya_layout_predictor is not None

        vision_backend = "unknown"
        try:
            from ..services.vision import LMStudioVisionModel, vision_service

            vision_backend = (
                "lm_studio"
                if isinstance(vision_service, LMStudioVisionModel)
                else "fallback"
            )
        except Exception:
            vision_backend = "unavailable"

        async def _process_slide(slide: dict):
            slide_idx = slide.get("index", 0)
            result_data = {"visuals": [], "density": "Medium", "image_analysis": []}

            if surya_ok:
                surya_anns, visuals, density_val = await self._analyze_with_surya(
                    slide_idx,
                    slide,
                    guardrail,
                    layout_predictor=surya_layout_predictor,
                )
                result_data["visuals"] = visuals
                result_data["density"] = density_val
            else:
                surya_anns = self._analyze_with_pptx_coords(slide_idx, slide, guardrail)
                result_data["visuals"] = self._get_visual_blocks_from_pptx(slide)

            font_issues = self._check_font_consistency(slide_idx, slide)
            image_anns, image_analysis = await self._analyze_images_with_vision(
                slide_idx, slide, result_data["visuals"]
            )
            result_data["image_analysis"] = image_analysis

            return slide_idx, surya_anns + font_issues + image_anns, result_data

        slide_results = await asyncio.gather(
            *[_process_slide(slide) for slide in slides_data],
            return_exceptions=True,
        )

        for outcome in slide_results:
            if isinstance(outcome, Exception):
                continue
            slide_idx, slide_anns, result_data = outcome
            annotations.extend(slide_anns)
            slide_metadata[str(slide_idx)] = result_data

        hard = sum(1 for a in annotations if a.severity == "hard_block")
        warn = sum(1 for a in annotations if a.severity == "warning")
        suggest = sum(1 for a in annotations if a.severity == "suggestion")
        score = _exponential_decay_score(hard, warn, suggest)
        return AgentResult(
            agent_name="Visual Analysis Agent",
            findings=annotations,
            score=score,
            metadata={
                "slides_checked": len(slides_data),
                "surya_used": surya_ok,
                "surya_model_ready": surya_ok,
                "vision_backend": vision_backend,
                "slides_analysis": slide_metadata,
            },
        )

    def _get_visual_blocks_from_pptx(self, slide: dict) -> list[dict]:
        """Convert extracted PPTX shapes to BoundingBox format."""
        visuals = []
        # Add charts
        for chart in slide.get("charts", []):
            visuals.append(
                {
                    "top": chart.get("y", 0),
                    "left": chart.get("x", 0),
                    "width": chart.get("width", 0),
                    "height": chart.get("height", 0),
                    "coord_unit": chart.get("coord_unit", "percent"),
                    "label": f"Chart: {chart.get('title', 'Untitled')}",
                    "visual_key": chart.get("id", ""),
                }
            )
        # Add tables
        for table in slide.get("tables", []):
            visuals.append(
                {
                    "top": table.get("y", 0),
                    "left": table.get("x", 0),
                    "width": table.get("width", 0),
                    "height": table.get("height", 0),
                    "coord_unit": table.get("coord_unit", "percent"),
                    "label": f"Table: {table.get('title', 'Untitled')}",
                    "visual_key": table.get("id", ""),
                }
            )
        return visuals

    async def _analyze_with_surya(
        self,
        slide_idx: int,
        slide: dict,
        guardrail: GuardrailSchema,
        layout_predictor=None,
    ) -> tuple[list[Annotation], list[dict], str]:
        """
        Use Surya LayoutPredictor on the rasterized slide PNG.
        Returns (annotations, visuals_list, density_str)
        """
        from PIL import Image

        annotations = []
        visuals = []
        density_label = "Medium"

        preview_path = slide.get("preview_path")
        if not preview_path or not Path(preview_path).exists():
            return [], [], "Low"

        try:
            with Image.open(preview_path) as img_source:
                img = img_source.convert("RGB")
            width, height = img.size

            predict_fn = layout_predictor if callable(layout_predictor) else None
            if predict_fn is None:
                return (
                    self._analyze_with_pptx_coords(slide_idx, slide, guardrail),
                    self._get_visual_blocks_from_pptx(slide),
                    "Medium",
                )

            # Run Surya layout detection
            layout_outputs = predict_fn([img])
            if not layout_outputs:
                return (
                    self._analyze_with_pptx_coords(slide_idx, slide, guardrail),
                    self._get_visual_blocks_from_pptx(slide),
                    "Medium",
                )
            layout_result = layout_outputs[0]
            blocks = (
                layout_result.bboxes
            )  # list of LayoutBox with label, bbox, confidence

            # Convert Surya bboxes to frontend format (percentage-based or absolute)
            # Frontend BoundingBox expects {top, left, width, height, label}
            for b in blocks:
                visuals.append(
                    {
                        "top": (b.bbox[1] / height) * 100,
                        "left": (b.bbox[0] / width) * 100,
                        "width": ((b.bbox[2] - b.bbox[0]) / width) * 100,
                        "height": ((b.bbox[3] - b.bbox[1]) / height) * 100,
                        "label": b.label,
                        "visual_key": f"{b.label}_{len(visuals)}",
                    }
                )

            # --- Check: is a page-footer present? ---
            footer_blocks = [b for b in blocks if b.label in ("footer", "page-footer")]
            if not footer_blocks:
                layout_rules = (
                    guardrail.discovered_patterns.get("visual", {})
                    if guardrail.discovered_patterns
                    else {}
                )
                if layout_rules.get("footer_required", False):
                    annotations.append(
                        Annotation(
                            slide_index=slide_idx,
                            text=slide.get("title", ""),
                            category="visual",
                            severity="warning",
                            message="Footer not detected on slide",
                            suggestion="Add a footer with confidentiality notice and date per guardrail rules",
                        )
                    )

            # --- Check: text density using Surya text block areas ---
            text_blocks = [
                b
                for b in blocks
                if b.label in ("text", "section-header", "list-group", "caption")
            ]
            if text_blocks:
                text_area = sum(
                    (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
                    for b in text_blocks
                )
                slide_area = width * height
                density = text_area / slide_area if slide_area > 0 else 0

                if density > 0.4:
                    density_label = "High"
                elif density < 0.15:
                    density_label = "Low"
                else:
                    density_label = "Medium"

                lang_rules = guardrail.language_rules or {}
                max_density = lang_rules.get("max_text_density", 0.55)

                if density > max_density:
                    annotations.append(
                        Annotation(
                            slide_index=slide_idx,
                            text=slide.get("title", ""),
                            category="visual",
                            severity="warning",
                            message=f"High text density ({density:.1%}) — slide may be too text-heavy",
                            suggestion="Consider splitting into two slides or using visual summaries",
                        )
                    )

            # --- Check: figure/chart count vs slide text ratio ---
            figure_blocks = [
                b for b in blocks if b.label in ("figure", "image", "table")
            ]
            total_blocks = len(blocks)
            if (
                total_blocks > 0
                and len(figure_blocks) / total_blocks < 0.1
                and total_blocks > 6
            ):
                annotations.append(
                    Annotation(
                        slide_index=slide_idx,
                        text=slide.get("title", ""),
                        category="visual",
                        severity="suggestion",
                        message="Slide is very text-heavy with few visuals",
                        suggestion="Consider adding a chart, diagram, or table to support the narrative",
                    )
                )

            return annotations, visuals, density_label

        except Exception as e:
            print(f"Surya analysis failed for slide {slide_idx}: {e}")
            return [], [], "Medium"

    def _analyze_with_pptx_coords(
        self, slide_idx: int, slide: dict, guardrail: GuardrailSchema
    ) -> list[Annotation]:
        """
        Fallback when Surya is not installed.
        Uses EMU coordinates from python-pptx to estimate layout compliance.
        """
        annotations = []

        slide_width = slide.get("width", 9144000)  # standard 10-inch in EMU
        slide_height = slide.get("height", 6858000)  # standard 7.5-inch in EMU
        text_boxes = slide.get("text_boxes", [])

        if slide_width == 0 or slide_height == 0:
            return annotations

        # Text density: sum of all text box areas vs slide area
        text_area = sum(tb.get("width", 0) * tb.get("height", 0) for tb in text_boxes)
        density = (
            text_area / (slide_width * slide_height)
            if (slide_width * slide_height) > 0
            else 0
        )

        lang_rules = guardrail.language_rules or {}
        max_density = lang_rules.get("max_text_density", 0.55)
        if density > max_density:
            annotations.append(
                Annotation(
                    slide_index=slide_idx,
                    text=slide.get("title", ""),
                    category="visual",
                    severity="warning",
                    message=f"High text density ({density:.1%}) — slide may be too text-heavy",
                    suggestion="Consider splitting into two slides or reducing text",
                )
            )

        # Check for any text box positioned in the bottom 10% (likely footer)
        footer_zone_y = slide_height * 0.90
        has_footer = any(tb.get("y", 0) >= footer_zone_y for tb in text_boxes)
        visual_rules = (guardrail.discovered_patterns or {}).get("visual", {})
        if not has_footer and visual_rules.get("footer_required", False):
            annotations.append(
                Annotation(
                    slide_index=slide_idx,
                    text=slide.get("title", ""),
                    category="visual",
                    severity="warning",
                    message="Footer not detected in the expected position",
                    suggestion="Add a footer in the bottom strip of the slide",
                )
            )

        return annotations

    def _check_font_consistency(self, slide_idx: int, slide: dict) -> list[Annotation]:
        fonts = set()
        for tb in slide.get("text_boxes", []):
            for run in tb.get("runs", []):
                fname = run.get("font_name")
                if fname:
                    fonts.add(fname)

        if len(fonts) > 3:
            return [
                Annotation(
                    slide_index=slide_idx,
                    text=f"Fonts detected: {', '.join(sorted(fonts)[:5])}",
                    category="visual",
                    severity="warning",
                    message=f"Too many fonts ({len(fonts)}) — slide looks inconsistent",
                    suggestion="Standardise to a maximum of 2 fonts per slide (heading + body)",
                )
            ]
        return []

    def _crop_element_from_preview(self, slide: dict, element: dict):
        from PIL import Image

        preview_path = slide.get("preview_path")
        if not preview_path or not Path(preview_path).exists():
            return None

        with Image.open(preview_path) as img_source:
            img = img_source.convert("RGB")
        img_w, img_h = img.size

        coord_unit = (element.get("coord_unit") or "percent").lower()
        x = float(element.get("x", 0) or 0)
        y = float(element.get("y", 0) or 0)
        width = float(element.get("width", 0) or 0)
        height = float(element.get("height", 0) or 0)

        if coord_unit == "absolute":
            slide_w = float(slide.get("width", 0) or 0)
            slide_h = float(slide.get("height", 0) or 0)
            if slide_w <= 0 or slide_h <= 0:
                return None
            left = int((x / slide_w) * img_w)
            top = int((y / slide_h) * img_h)
            right = int(((x + width) / slide_w) * img_w)
            bottom = int(((y + height) / slide_h) * img_h)
        else:
            left = int((x / 100.0) * img_w)
            top = int((y / 100.0) * img_h)
            right = int(((x + width) / 100.0) * img_w)
            bottom = int(((y + height) / 100.0) * img_h)

        left = max(0, min(left, img_w - 1))
        top = max(0, min(top, img_h - 1))
        right = max(left + 1, min(right, img_w))
        bottom = max(top + 1, min(bottom, img_h))

        if right - left < 8 or bottom - top < 8:
            return None

        return img.crop((left, top, right, bottom))

    def _cross_reference_table(self, native_text: str, vision_data: dict) -> list[str]:
        native_values = _extract_numeric_values(native_text)
        vision_blob = " ".join(
            [
                str(vision_data.get("table_summary") or ""),
                " ".join(str(h) for h in (vision_data.get("headers") or [])),
                " ".join(
                    " ".join(str(v) for v in (row.get("values") or []))
                    for row in (vision_data.get("key_rows") or [])
                    if isinstance(row, dict)
                ),
            ]
        )
        vision_values = _extract_numeric_values(vision_blob)
        if not native_values or not vision_values:
            return []

        discrepancies = []
        for native in native_values[:20]:
            closest = min((abs(native - v) for v in vision_values), default=0.0)
            tolerance = max(abs(native) * 0.05, 0.01)
            if closest > tolerance:
                discrepancies.append(
                    f"Native value {native:.2f} differs from vision-read values (>5% delta)."
                )
        return discrepancies[:5]

    async def _analyze_images_with_vision(
        self, slide_idx: int, slide: dict, detected_visuals: list[dict] | None = None
    ) -> tuple[list[Annotation], list[dict]]:
        """
        Use LM Studio vision model to analyze images found in the slide.
        Returns annotations for issues and structured image analysis data.
        """
        import logging

        logger = logging.getLogger("slideforge.agents.vision")
        import base64
        import io
        from PIL import Image

        annotations = []
        image_analysis = []

        images = slide.get("images", [])
        charts = slide.get("charts", [])
        detected_visuals = detected_visuals or []

        if not images and not charts and not detected_visuals:
            return annotations, image_analysis  # Nothing to analyze

        try:
            from ..services.vision import vision_service
        except ImportError:
            logger.warning("Vision service not available")
            return annotations, image_analysis

        # Analyze charts using vision if available
        for chart in charts:
            chart_title = chart.get("title", "")
            chart_type = chart.get("type", "unknown")
            cache_values = chart.get("cache_values", None)
            chart_crop = self._crop_element_from_preview(slide, chart)

            if not chart_title and not cache_values:
                annotations.append(
                    Annotation(
                        slide_index=slide_idx,
                        shape_id=chart.get("id", ""),
                        text=f"Chart: {chart.get('id', '')}",
                        category="visual",
                        severity="warning",
                        message="Chart has no title and no cached data — cannot verify accuracy",
                        suggestion="Add a descriptive title to this chart",
                    )
                )

            if chart_type == "unknown":
                annotations.append(
                    Annotation(
                        slide_index=slide_idx,
                        shape_id=chart.get("id", ""),
                        text=f"Chart: {chart.get('id', '')}",
                        category="visual",
                        severity="suggestion",
                        message="Chart type could not be determined from PPTX metadata",
                        suggestion="Ensure chart is properly formatted in PowerPoint",
                    )
                )

            image_analysis.append(
                {
                    "type": "chart",
                    "id": chart.get("id", ""),
                    "x": chart.get("x", 0),
                    "y": chart.get("y", 0),
                    "width": chart.get("width", 0),
                    "height": chart.get("height", 0),
                    "chart_type": chart_type,
                    "title": chart_title,
                    "has_data": cache_values is not None,
                }
            )

            if chart_crop is not None:
                try:
                    async with _vision_semaphore:
                        chart_vision = await vision_service.extract_chart_data(
                            chart_crop
                        )
                    image_analysis[-1]["vision_summary"] = chart_vision
                except Exception as ve:
                    logger.error(f"Chart vision failed for {chart.get('id', '')}: {ve}")

        # Analyze native PPTX tables with the vision model (capped per slide)
        for table in (slide.get("tables", []) or [])[:4]:
            table_id = table.get("id", table.get("table_id", "table"))
            table_crop = self._crop_element_from_preview(slide, table)
            if table_crop is None:
                continue
            try:
                async with _vision_semaphore:
                    table_res = await vision_service.extract_table_content(table_crop)
                discrepancies = self._cross_reference_table(
                    str(table.get("text") or ""),
                    table_res or {},
                )
                image_analysis.append(
                    {
                        "type": "table_vision",
                        "id": table_id,
                        "x": table.get("x", 0),
                        "y": table.get("y", 0),
                        "width": table.get("width", 0),
                        "height": table.get("height", 0),
                        "native_text": table.get("text", ""),
                        "table_summary": table_res.get("table_summary"),
                        "table_headers": table_res.get("headers", []),
                        "table_rows": table_res.get("key_rows", []),
                        "analysis_confidence": table_res.get("confidence"),
                        "discrepancies": discrepancies,
                    }
                )

                if discrepancies:
                    annotations.append(
                        Annotation(
                            slide_index=slide_idx,
                            shape_id=table_id,
                            text=table.get("title", "Table"),
                            category="data_accuracy",
                            severity="warning",
                            message=(
                                "Table vision cross-check detected mismatches "
                                "between native and visual values."
                            ),
                            suggestion=discrepancies[0],
                        )
                    )
            except Exception as ve:
                logger.error(f"Table vision failed for {table_id}: {ve}")

        # Analyze each image
        for img in images:
            img_id = img.get("id", "unknown")
            has_content = img.get("has_content", False)
            img_data = img.get("image_data")
            img_w = img.get("width", 0)
            img_h = img.get("height", 0)
            preview_crop = self._crop_element_from_preview(slide, img)

            # Check image sizing
            if img_w < 5 or img_h < 5:
                annotations.append(
                    Annotation(
                        slide_index=slide_idx,
                        shape_id=img_id,
                        text=f"Image: {img_id}",
                        category="visual",
                        severity="warning",
                        message=f"Very small image detected ({img_w:.0f}%×{img_h:.0f}%) — may be a decorative element or icon",
                        suggestion="Ensure image is large enough to convey information effectively",
                    )
                )
            elif img_w > 90 and img_h > 90:
                annotations.append(
                    Annotation(
                        slide_index=slide_idx,
                        shape_id=img_id,
                        text=f"Image: {img_id}",
                        category="visual",
                        severity="suggestion",
                        message="Full-bleed image detected — ensure text overlays remain readable",
                        suggestion="Add contrast overlay or text box background for readability",
                    )
                )

            # --- VISON MODEL CALL ---
            if has_content and img_data:
                try:
                    # Convert b64 to PIL
                    with Image.open(io.BytesIO(base64.b64decode(img_data))) as img_raw:
                        img_pil = img_raw.convert("RGB")

                    # Call multimodal model
                    async with _vision_semaphore:
                        vision_res = await vision_service.describe_image(img_pil)

                    if vision_res.get("relevance") == "low":
                        annotations.append(
                            Annotation(
                                slide_index=slide_idx,
                                text=f"Image: {img_id}",
                                category="visual",
                                severity="warning",
                                message=f"Image seems low relevance: {vision_res.get('description', '')}",
                                suggestion=vision_res.get("suggestion")
                                or "Consider using a more impactful image",
                            )
                        )

                    image_analysis.append(
                        {
                            "type": "image",
                            "id": img_id,
                            "x": img.get("x", 0),
                            "y": img.get("y", 0),
                            "width": img_w,
                            "height": img_h,
                            "has_content": True,
                            "vision_description": vision_res.get("description"),
                            "visible_text": vision_res.get("visible_text", []),
                        }
                    )
                    continue  # Skip the default append below
                except Exception as ve:
                    logger.error(f"Vision call failed for {img_id}: {ve}")

            if preview_crop is not None:
                try:
                    async with _vision_semaphore:
                        vision_res = await vision_service.describe_image(preview_crop)
                    if vision_res.get("relevance") == "low":
                        annotations.append(
                            Annotation(
                                slide_index=slide_idx,
                                text=f"Image: {img_id}",
                                category="visual",
                                severity="warning",
                                message=f"Image seems low relevance: {vision_res.get('description', '')}",
                                suggestion=vision_res.get("suggestion")
                                or "Consider using a more impactful image",
                                shape_id=img_id,
                            )
                        )

                    image_analysis.append(
                        {
                            "type": "image",
                            "id": img_id,
                            "x": img.get("x", 0),
                            "y": img.get("y", 0),
                            "width": img_w,
                            "height": img_h,
                            "has_content": False,
                            "vision_description": vision_res.get("description"),
                            "visible_text": vision_res.get("visible_text", []),
                        }
                    )
                    continue
                except Exception as ve:
                    logger.error(f"Preview crop vision failed for {img_id}: {ve}")

            image_analysis.append(
                {
                    "type": "image",
                    "id": img_id,
                    "x": img.get("x", 0),
                    "y": img.get("y", 0),
                    "width": img_w,
                    "height": img_h,
                    "has_content": has_content,
                }
            )

        # If total images + charts is zero for a content-heavy slide, flag it

        full_text = slide.get("full_text", "")
        if len(full_text) > 300 and len(images) == 0 and len(charts) == 0:
            annotations.append(
                Annotation(
                    slide_index=slide_idx,
                    text=slide.get("title", ""),
                    category="visual",
                    severity="suggestion",
                    message="Text-heavy slide with no visuals — consider adding a chart, diagram, or image",
                    suggestion="Break up dense text with visual elements to improve readability",
                )
            )

        logger.info(
            f"Slide {slide_idx}: {len(images)} images, {len(charts)} charts analyzed"
        )

        # Fallback for PDFs/screenshots: analyze cropped figure/table regions detected by Surya
        if detected_visuals:
            surrogate_blocks = [
                block
                for block in detected_visuals
                if str(block.get("label", "")).lower() in ("figure", "image", "table")
            ]
            for block_idx, block in enumerate(surrogate_blocks[:4]):
                try:
                    crop = self._crop_element_from_preview(
                        slide,
                        {
                            "coord_unit": "percent",
                            "x": block.get("left", 0),
                            "y": block.get("top", 0),
                            "width": block.get("width", 0),
                            "height": block.get("height", 0),
                        },
                    )
                    if crop is None:
                        continue
                    block_label = str(block.get("label", "figure")).lower()
                    if block_label == "table":
                        async with _vision_semaphore:
                            table_res = await vision_service.extract_table_content(crop)
                        vision_res = {
                            "description": table_res.get("table_summary", ""),
                            "visible_text": table_res.get("headers", []),
                            "relevance": "medium"
                            if table_res.get("confidence") == "low"
                            else "high",
                            "suggestion": "",
                        }
                    else:
                        table_res = None
                        async with _vision_semaphore:
                            vision_res = await vision_service.describe_image(crop)
                    image_analysis.append(
                        {
                            "type": "surya_block",
                            "id": f"surya_{slide_idx}_{block_idx}",
                            "label": block.get("label", "figure"),
                            "vision_description": vision_res.get("description"),
                            "visible_text": vision_res.get("visible_text", []),
                            "table_summary": (table_res or {}).get("table_summary"),
                            "table_headers": (table_res or {}).get("headers", []),
                            "table_rows": (table_res or {}).get("key_rows", []),
                            "analysis_confidence": (table_res or {}).get("confidence"),
                            "x": block.get("left", 0),
                            "y": block.get("top", 0),
                            "width": block.get("width", 0),
                            "height": block.get("height", 0),
                        }
                    )
                    if (
                        block_label == "table"
                        and table_res
                        and table_res.get("confidence") == "low"
                    ):
                        annotations.append(
                            Annotation(
                                slide_index=slide_idx,
                                text=f"Detected {block.get('label', 'table')}",
                                category="visual",
                                severity="suggestion",
                                message="Table-like region detected, but table reading confidence is low",
                                suggestion="Use a clearer native table or increase image/table legibility for stronger verification",
                            )
                        )
                    elif vision_res.get("relevance") == "low":
                        annotations.append(
                            Annotation(
                                slide_index=slide_idx,
                                text=f"Detected {block.get('label', 'figure')}",
                                category="visual",
                                severity="warning",
                                message=f"Low-value visual region detected: {vision_res.get('description', '')}",
                                suggestion=vision_res.get("suggestion")
                                or "Replace with a more decision-useful chart, table, or explanatory visual",
                            )
                        )
                except Exception as ve:
                    logger.error(
                        f"Surya block vision failed on slide {slide_idx}: {ve}"
                    )

        return annotations, image_analysis


# ---------------------------------------------------------------------------
# Orchestrators (unchanged interface — just wires the new classes)
# ---------------------------------------------------------------------------


class ParallelAnalysisOrchestrator:
    def __init__(self):
        self._insight = InsightExtractor()
        self._structure = StructureAuditor()
        self._data = DataLineageAgent()
        self._visual = VisualAnalysisAgent()
        self._framework = FrameworkIdentifierAgent()
        self._so_what = SoWhatTestAgent()
        self._benchmark = CompetitiveBenchmarkAgent()
        self._context = SlideContextSynthesizer()

    async def run_parallel_analysis(
        self, slides_data: list, guardrail: GuardrailSchema, excel_data: dict | None
    ) -> list[AgentResult]:
        tasks = [
            self._insight.run(slides_data, guardrail),
            self._structure.run(slides_data, guardrail),
            self._data.run(slides_data, excel_data),
            self._visual.run(slides_data, guardrail),
            self._framework.run(slides_data, guardrail),
            self._so_what.run(slides_data, guardrail),
            self._benchmark.run(slides_data, guardrail),
        ]
        raw_results = list(await asyncio.gather(*tasks))
        results = [self._ensure_agent_result(item) for item in raw_results]
        self._augment_data_lineage_with_vision_tables(results, excel_data)
        return results

    # Keep the old method names so existing call sites don't break
    async def run_insight_extractor(self, slides_data, guardrail):
        return await self._insight.run(slides_data, guardrail)

    async def run_structure_auditor(self, slides_data, guardrail):
        return await self._structure.run(slides_data, guardrail)

    async def run_data_lineage_agent(self, slides_data, excel_data):
        return await self._data.run(slides_data, excel_data)

    async def run_visual_analysis_agent(self, slides_data, guardrail):
        return await self._visual.run(slides_data, guardrail)

    async def run_slide_context_synthesizer(
        self,
        slides_data: list,
        phase_one_results: list[AgentResult],
        language_annotations: list[Annotation],
    ) -> AgentResult:
        raw = await self._context.run(
            slides_data, phase_one_results, language_annotations
        )
        return self._ensure_agent_result(raw)

    def _ensure_agent_result(self, payload) -> AgentResult:
        if isinstance(payload, AgentResult):
            return payload
        if isinstance(payload, dict):
            return AgentResult(
                agent_name=str(payload.get("agent_name", "Unknown Agent")),
                findings=list(payload.get("findings", []) or []),
                score=int(payload.get("score", 0) or 0),
                metadata=dict(payload.get("metadata", {}) or {}),
            )
        return AgentResult(
            agent_name="Unknown Agent", findings=[], score=0, metadata={}
        )

    def _augment_data_lineage_with_vision_tables(
        self, agent_results: list[AgentResult], excel_data: dict | None
    ) -> None:
        if not excel_data:
            return
        data_result = next(
            (
                result
                for result in agent_results
                if result.agent_name == "Data Lineage Agent"
            ),
            None,
        )
        visual_result = next(
            (
                result
                for result in agent_results
                if result.agent_name == "Visual Analysis Agent"
            ),
            None,
        )
        if data_result is None or visual_result is None:
            return

        extra_annotations = []
        slides_analysis = (visual_result.metadata or {}).get("slides_analysis", {})
        for slide_idx, details in slides_analysis.items():
            for item in details.get("image_analysis", []) or []:
                if item.get("type") != "table_vision":
                    continue
                mismatches = self._data.verify_vision_table(item, excel_data)
                if not mismatches:
                    continue
                extra_annotations.append(
                    Annotation(
                        slide_index=int(slide_idx),
                        shape_id=item.get("id"),
                        text="Table vision cross-check",
                        category="data_accuracy",
                        severity="warning",
                        message="Vision table values could not be reconciled with Excel source.",
                        suggestion=mismatches[0],
                    )
                )
        if extra_annotations:
            data_result.findings.extend(extra_annotations)
            data_result.score = max(0, data_result.score - len(extra_annotations) * 5)


class QAGradingOrchestrator:
    def __init__(self):
        self.weights = {
            "structure": 0.15,
            "claim_grounding": 0.20,
            "data_accuracy": 0.15,
            "visual": 0.10,
            "language": 0.10,
            "framework": 0.10,
            "so_what": 0.15,
            "benchmarking": 0.05,
        }

    def calculate_scorecard(
        self,
        agent_results: list[AgentResult],
        language_results: list[Annotation],
        guardrail: GuardrailSchema,
    ) -> QAScorecard:
        scores = {
            "structure": 0,
            "claim_grounding": 0,
            "data_accuracy": 0,
            "visual": 0,
            "language": 0,
            "framework": 0,
            "so_what": 0,
            "benchmarking": 0,
        }

        for result in agent_results:
            if result.agent_name == "Insight Extractor":
                scores["claim_grounding"] = result.score
            elif result.agent_name == "Structure Auditor":
                scores["structure"] = result.score
            elif result.agent_name == "Data Lineage Agent":
                scores["data_accuracy"] = result.score
            elif result.agent_name == "Visual Analysis Agent":
                scores["visual"] = result.score
            elif result.agent_name == "Framework Identifier Agent":
                scores["framework"] = result.score
            elif result.agent_name == "So What Test Agent":
                scores["so_what"] = result.score
            elif result.agent_name == "Competitive Benchmark Agent":
                scores["benchmarking"] = result.score

        scores["language"] = self._calculate_language_score(language_results)

        weights = guardrail.rubric_weights or self.weights
        composite = int(sum(scores[k] * weights.get(k, 0) for k in scores))

        all_annotations = []
        for result in agent_results:
            all_annotations.extend(result.findings)
        all_annotations.extend(language_results)

        hard_blocks = [a for a in all_annotations if a.severity == "hard_block"]
        warnings = [a for a in all_annotations if a.severity == "warning"]

        if hard_blocks:
            composite = 0

        failing_slides = list(set(a.slide_index for a in all_annotations))

        return QAScorecard(
            composite_score=composite,
            structure_score=scores["structure"],
            claim_grounding_score=scores["claim_grounding"],
            data_accuracy_score=scores["data_accuracy"],
            visual_compliance_score=scores["visual"],
            language_score=scores["language"],
            framework_score=scores["framework"],
            so_what_score=scores["so_what"],
            benchmarking_score=scores["benchmarking"],
            hard_block_count=len(hard_blocks),
            warning_count=len(warnings),
            failing_slides=failing_slides,
            annotations=all_annotations,
            summary=self._generate_summary(
                composite, hard_blocks, warnings, scores, guardrail.pass_threshold
            ),
        )

    def _calculate_language_score(self, annotations: list[Annotation]) -> int:
        if not annotations:
            return 100
        grammar = sum(1 for a in annotations if a.category == "grammar")
        hedging = sum(1 for a in annotations if a.category == "hedging")
        tone = sum(1 for a in annotations if a.category in ("tone", "tone_drift"))
        deductions = grammar * 5 + hedging * 4 + tone * 3
        return max(0, 100 - deductions)

    def _generate_summary(
        self,
        composite: int,
        hard_blocks: list,
        warnings: list,
        scores: dict,
        pass_threshold: int = 75,
    ) -> str:
        status = "PASS" if composite >= pass_threshold else "FAIL"
        summary = (
            f"Overall Score: {composite}/100 ({status}, threshold: {pass_threshold}). "
        )
        summary += (
            f"Found {len(hard_blocks)} critical issues and {len(warnings)} warnings. "
        )

        # Identify weakest dimension for actionable feedback
        if scores:
            weakest = min(scores, key=scores.get)
            dim_labels = {
                "structure": "narrative structure",
                "claim_grounding": "claim evidence",
                "data_accuracy": "data accuracy",
                "visual": "visual compliance",
                "language": "language quality",
                "framework": "framework quality",
                "so_what": "so-what quality",
                "benchmarking": "benchmarking quality",
            }
            summary += f"Weakest area: {dim_labels.get(weakest, weakest)} ({scores[weakest]}/100). "

        if hard_blocks:
            summary += "Critical issues must be resolved before delivery. "
        if warnings:
            summary += "Review warnings to improve quality."
        return summary


class RevisionOrchestrator:
    def __init__(self, max_attempts: int = 3, pass_threshold: int = 75):
        self.max_attempts = max_attempts
        self.pass_threshold = pass_threshold

    async def should_revise(self, scorecard: QAScorecard, attempt: int) -> bool:
        if scorecard.hard_block_count > 0:
            return True
        if scorecard.composite_score < self.pass_threshold:
            return attempt < self.max_attempts
        return False

    async def apply_auto_remediation(
        self, scorecard: QAScorecard, slides_data: list
    ) -> list[dict]:
        applied_fixes = []

        for annotation in scorecard.annotations:
            if annotation.severity == "hard_block":
                continue  # hard blocks require human review

            if (
                annotation.category in ["hedging", "passive", "quality"]
                and not annotation.suggestion
            ):
                prompt = (
                    f"Rewrite the following consulting slide snippet to be more direct, "
                    f'active, and professional.\nSnippet: "{annotation.text}"\n'
                    f"Return ONLY the corrected text, no explanation."
                )
                try:
                    raw = await _llm(prompt, max_tokens=100)
                    suggestion = raw.strip().strip('"')
                    applied_fixes.append(
                        {
                            "slide_index": annotation.slide_index,
                            "original_text": annotation.text,
                            "suggested_text": suggestion,
                            "action": "auto_applied_llm",
                        }
                    )
                except Exception:
                    continue

            elif annotation.category == "grammar" and annotation.suggestion:
                applied_fixes.append(
                    {
                        "slide_index": annotation.slide_index,
                        "original_text": annotation.text,
                        "suggested_text": annotation.suggestion,
                        "action": "auto_applied",
                    }
                )

            elif (
                annotation.category == "visual" and "font" in annotation.message.lower()
            ):
                applied_fixes.append(
                    {
                        "slide_index": annotation.slide_index,
                        "action": "font_standardization",
                    }
                )

        return applied_fixes
