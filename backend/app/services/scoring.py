"""Slide-level scoring, reliability, and visual-coverage calculations.

Extracted from main.py to keep the orchestration layer thin and the
scoring logic independently testable.
"""
from __future__ import annotations

import re
from typing import Any


# ---------------------------------------------------------------------------
# Annotation penalty helper
# ---------------------------------------------------------------------------

def annotation_penalty(annotation: dict) -> int:
    """Map annotation severity to a numeric penalty weight."""
    severity = annotation.get("severity", "")
    if severity == "hard_block":
        return 20
    if severity == "warning":
        return 8
    if severity == "suggestion":
        return 3
    return 0


# ---------------------------------------------------------------------------
# Visual coverage
# ---------------------------------------------------------------------------

def build_visual_coverage(slide: dict, visual_meta: dict | None) -> dict:
    """Compute how much of a slide's visual content was actually analysed."""
    visual_meta = visual_meta or {}
    image_analysis = visual_meta.get("image_analysis", []) or []
    detected_visuals = visual_meta.get("visuals", []) or []

    native_images = len(slide.get("images", []))
    native_tables = len(slide.get("tables", []))
    native_charts = len(slide.get("charts", []))

    analyzed_images = sum(1 for item in image_analysis if item.get("type") == "image")
    analyzed_charts = sum(1 for item in image_analysis if item.get("type") == "chart")
    analyzed_table_like = sum(
        1
        for item in image_analysis
        if (
            item.get("type") == "table_vision"
            or (
                item.get("type") == "surya_block"
                and "table" in str(item.get("label", "")).lower()
            )
        )
    )
    analyzed_regions = sum(
        1 for item in image_analysis if item.get("type") == "surya_block"
    )

    expected_visuals = native_images + native_tables + native_charts
    fallback_expected = expected_visuals or len(detected_visuals)
    analyzed_visuals = analyzed_images + analyzed_charts + analyzed_table_like
    effective_analyzed = max(analyzed_visuals, analyzed_regions)
    coverage_ratio = (
        round(min(1.0, effective_analyzed / fallback_expected), 2)
        if fallback_expected > 0
        else 1.0
    )

    gaps: list[str] = []
    if native_tables > 0 and analyzed_table_like == 0:
        gaps.append(
            "tables were detected structurally but not interpreted as table content"
        )
    if native_images > 0 and analyzed_images == 0:
        gaps.append(
            "native images were present but did not produce image-level understanding"
        )
    if native_charts > 0 and analyzed_charts < native_charts:
        gaps.append("some charts were not fully interpreted")
    if expected_visuals == 0 and detected_visuals and analyzed_regions == 0:
        gaps.append(
            "visual regions were detected from layout, but none were semantically analyzed"
        )
    if effective_analyzed == 0 and fallback_expected > 0:
        gaps.append(
            "the slide contains visuals, but the model mostly judged text/layout rather than the visuals themselves"
        )

    if fallback_expected == 0:
        status = "not_applicable"
        summary = "This slide has little or no visual evidence to analyze."
    elif coverage_ratio >= 0.8:
        status = "strong"
        summary = "Most visual evidence on this slide was directly inspected by the analysis pipeline."
    elif coverage_ratio >= 0.45:
        status = "partial"
        summary = "Some visuals were analyzed, but coverage is incomplete and consultant-style judgment is only partially grounded."
    else:
        status = "weak"
        summary = "Visual analysis coverage is weak, so image/table scoring is less reliable than text/storyline scoring."

    return {
        "status": status,
        "coverage_ratio": coverage_ratio,
        "detected_visual_count": len(detected_visuals),
        "expected_visual_count": fallback_expected,
        "analyzed_visual_count": effective_analyzed,
        "native_images": native_images,
        "native_tables": native_tables,
        "native_charts": native_charts,
        "summary": summary,
        "gaps": gaps,
    }


# ---------------------------------------------------------------------------
# Consultant slide score (composite of 5 sub-dimensions)
# ---------------------------------------------------------------------------

def build_slide_consultant_score(
    slide: dict,
    slide_annotations: list[dict],
    deep_analysis: dict | None,
    visual_meta: dict | None,
) -> dict:
    """Compute the per-slide consultant score with 5 sub-dimensions."""
    review = (deep_analysis or {}).get("review", {})
    alignment = ((review or {}).get("guardrail_alignment") or {}).get(
        "status", "partial"
    )
    visual_coverage = build_visual_coverage(slide, visual_meta)

    structure_categories = {
        "structure", "hedging", "quality", "grammar", "tone", "so_what",
    }
    evidence_categories = {
        "claim_grounding", "claim_extraction", "data_accuracy", "benchmarking",
    }
    visual_categories = {"visual"}

    structure_penalty = sum(
        annotation_penalty(a)
        for a in slide_annotations
        if a.get("category") in structure_categories
    )
    evidence_penalty = sum(
        annotation_penalty(a)
        for a in slide_annotations
        if a.get("category") in evidence_categories
    )
    visual_penalty = sum(
        annotation_penalty(a)
        for a in slide_annotations
        if a.get("category") in visual_categories
    )

    density = slide.get("density_proxy", "Medium")
    image_count = len(slide.get("images", []))
    table_count = len(slide.get("tables", []))
    chart_count = len(slide.get("charts", []))
    full_text = slide.get("full_text", "") or ""
    word_count = len(re.findall(r"\w+", full_text))
    review_understanding = str(
        (review or {}).get("llm_understanding", "") or ""
    ).strip()
    layout_intelligence = str(
        (review or {}).get("layout_intelligence", "") or ""
    ).strip()

    message_clarity = max(0, 100 - structure_penalty)
    if not slide.get("title"):
        message_clarity -= 8
    if word_count > 140:
        message_clarity -= min(18, (word_count - 140) // 10 + 6)
    if review_understanding.lower().startswith("review summary unavailable"):
        message_clarity -= 10
    message_clarity = max(0, message_clarity)

    evidence_strength = max(0, 100 - evidence_penalty)
    if len(full_text) > 80 and not any(
        a.get("category") in evidence_categories for a in slide_annotations
    ):
        evidence_strength -= 6
    if visual_coverage["status"] == "weak" and (table_count > 0 or chart_count > 0):
        evidence_strength -= 10
    evidence_strength = max(0, evidence_strength)

    layout_quality = max(0, 100 - visual_penalty - (10 if density == "High" else 0))
    if layout_intelligence.lower().startswith("layout assessment unavailable"):
        layout_quality -= 20
    if (
        density == "Low"
        and word_count < 25
        and image_count + table_count + chart_count == 0
    ):
        layout_quality -= 10
    layout_quality = max(0, layout_quality)

    visual_usefulness = 88
    if len(full_text) > 250 and image_count + table_count + chart_count == 0:
        visual_usefulness -= 20
    if image_count + table_count + chart_count > 0:
        visual_usefulness += 5
    if visual_coverage["status"] == "partial":
        visual_usefulness -= 12
    elif visual_coverage["status"] == "weak":
        visual_usefulness -= 28
    visual_usefulness -= min(25, visual_penalty)
    visual_usefulness = max(0, min(100, visual_usefulness))

    guardrail_fit = 92
    if alignment == "partial":
        guardrail_fit = 75
    elif alignment == "misaligned":
        guardrail_fit = 45
    guardrail_fit = max(
        0,
        guardrail_fit
        - sum(
            annotation_penalty(a)
            for a in slide_annotations
            if a.get("category")
            in {
                "claim_grounding", "structure", "visual",
                "quality", "framework", "so_what", "benchmarking",
            }
        )
        // 2,
    )
    if visual_coverage["status"] == "weak" and alignment != "aligned":
        guardrail_fit -= 8
    guardrail_fit = max(0, guardrail_fit)

    overall = int(
        round(
            message_clarity * 0.27
            + evidence_strength * 0.25
            + layout_quality * 0.18
            + visual_usefulness * 0.15
            + guardrail_fit * 0.15
        )
    )
    if any(a.get("severity") == "hard_block" for a in slide_annotations):
        overall = min(overall, 55)

    weakest = min(
        [
            ("message clarity", message_clarity),
            ("evidence strength", evidence_strength),
            ("layout quality", layout_quality),
            ("visual usefulness", visual_usefulness),
            ("guardrail fit", guardrail_fit),
        ],
        key=lambda item: item[1],
    )[0]

    coverage_sentence = visual_coverage["summary"]
    if visual_coverage["gaps"]:
        coverage_sentence += " Main gap: " + visual_coverage["gaps"][0] + "."
    summary = f"This slide scores {overall}/100. The biggest gap is {weakest}. {coverage_sentence}"

    return {
        "overall_score": overall,
        "breakdown": {
            "message_clarity": message_clarity,
            "evidence_strength": evidence_strength,
            "layout_quality": layout_quality,
            "visual_usefulness": visual_usefulness,
            "guardrail_fit": guardrail_fit,
        },
        "consultant_summary": summary,
        "visual_coverage": visual_coverage,
    }


# ---------------------------------------------------------------------------
# Bayesian reliability model
# ---------------------------------------------------------------------------

def build_slide_reliability(
    slide: dict,
    slide_annotations: list[dict],
    deep_analysis: dict | None,
    visual_meta: dict | None,
) -> dict:
    """Bayesian reliability model using Beta-distribution posterior.

    Each evidence dimension is modelled as a Bernoulli trial:
      - present / strong → α += weight  (success)
      - missing / weak   → β += weight  (failure)
    Final reliability = E[Beta(α, β)] = α / (α + β), scaled to 0-100.
    """
    review = (deep_analysis or {}).get("review", {}) or {}
    judge = (deep_analysis or {}).get("judge", {}) or {}
    agents = (deep_analysis or {}).get("agents", []) or []
    visual_coverage = build_visual_coverage(slide, visual_meta)

    # Prior: mildly optimistic (α=3, β=1 ≈ 75% before any evidence)
    alpha = 3.0
    beta_param = 1.0
    factors: list[str] = []

    llm_understanding = str(review.get("llm_understanding", "") or "").strip().lower()
    layout_intelligence = str(review.get("layout_intelligence", "") or "").strip().lower()
    recommendations = review.get("detailed_recommendations", []) or []
    alignment_status = (
        (review.get("guardrail_alignment") or {}).get("status") or "partial"
    ).lower()

    # D1: LLM review summary (weight 2.5)
    if review and not llm_understanding.startswith("review summary unavailable"):
        alpha += 2.5
    else:
        beta_param += 2.5
        factors.append("slide-level LLM review summary is missing")

    # D2: Layout intelligence (weight 2.0)
    if not layout_intelligence.startswith("layout assessment unavailable"):
        alpha += 2.0
    else:
        beta_param += 2.0
        factors.append("layout intelligence could not be generated")

    # D3: Detailed recommendations (weight 1.0)
    if recommendations:
        alpha += 1.0
    else:
        beta_param += 1.0
        factors.append("detailed recommendations were not generated")

    # D4: Visual coverage (weight 3.0)
    if visual_coverage["status"] == "strong":
        alpha += 3.0
    elif visual_coverage["status"] == "partial":
        alpha += 1.0
        beta_param += 2.0
        factors.append("visual coverage is only partial")
    elif visual_coverage["status"] == "weak":
        beta_param += 3.0
        factors.append("visual coverage is weak, so visual scoring is partly inferred")
    else:
        alpha += 1.5
        beta_param += 0.5

    # D5: Evidence-specific critique for data-rich slides (weight 1.5)
    has_structured = len(slide.get("tables", [])) + len(slide.get("charts", [])) > 0
    has_evidence_critique = any(
        a.get("category") in {"claim_grounding", "data_accuracy", "visual"}
        for a in slide_annotations
    )
    if has_structured and has_evidence_critique:
        alpha += 1.5
    elif has_structured and not has_evidence_critique:
        beta_param += 1.5
        factors.append("structured evidence exists but no evidence-specific critique")
    else:
        alpha += 0.5

    # D6: Slide-specific findings exist (weight 1.0)
    if judge.get("findings") or slide_annotations:
        alpha += 1.0
    else:
        beta_param += 1.0
        factors.append("very few slide-specific findings were produced")

    # D7: Vision confidence (weight up to 1.5)
    low_confidence_visuals = sum(
        1
        for item in (visual_meta or {}).get("image_analysis", []) or []
        if str(item.get("analysis_confidence", "")).lower() == "low"
    )
    if low_confidence_visuals:
        beta_param += min(1.5, low_confidence_visuals * 0.5)
        factors.append("some visual/table regions were read with low confidence")
    else:
        alpha += 0.5

    # D8: Agent productivity (weight 1.0)
    populated_agents = sum(1 for agent in agents if agent.get("findings"))
    if agents and populated_agents > 0:
        alpha += 1.0
    elif agents:
        beta_param += 1.0
        factors.append("agents produced mostly general rather than slide-specific feedback")

    # D9: Guardrail alignment (weight 0.5)
    if alignment_status == "misaligned":
        beta_param += 0.5

    # Beta posterior mean → reliability score
    reliability = int(round(100 * alpha / (alpha + beta_param)))
    reliability = max(25, min(98, reliability))

    if reliability >= 82:
        status = "strong"
        summary = "This score is strongly grounded in the available slide evidence."
    elif reliability >= 60:
        status = "moderate"
        summary = "This score is directionally useful, but some dimensions are inferred rather than directly verified."
    else:
        status = "low"
        summary = "Treat this score as provisional because important evidence was only partially analyzed."

    if factors:
        summary += " Main reliability gap: " + factors[0] + "."

    return {
        "status": status,
        "score": reliability,
        "summary": summary,
        "factors": factors,
    }
