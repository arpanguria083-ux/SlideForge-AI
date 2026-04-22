import asyncio
import json
import math
import re
from pathlib import Path

from app.models.schemas import Annotation, GuardrailSchema
from app.services.llm_inference import Message, inference_service, parse_json_response


_llm_semaphore = asyncio.Semaphore(4)
_vision_semaphore = asyncio.Semaphore(2)

# Removed duplicate _parse_json_response in favor of imported parse_json_response


async def _llm(prompt: str, system: str = "", max_tokens: int = 800) -> str:
    if inference_service.llm is None:
        return '{"error":"LLM unavailable"}'

    msgs = []
    if system:
        msgs.append(Message(role="system", content=system))
    msgs.append(
        Message(
            role="user",
            content=("Return only JSON. Do not include reasoning.\n\n" + prompt),
        )
    )

    async with _llm_semaphore:
        try:
            resp = await inference_service.llm.generate(
                msgs,
                max_tokens=min(
                    max_tokens,
                    getattr(inference_service, "analysis_max_tokens", max_tokens),
                ),
                context_window=getattr(inference_service, "local_context_window", None),
            )
        except Exception as exc:
            raise RuntimeError(f"LLM request failed: {exc}")
    return resp.content or "{}"


def _avg(values: list[int]) -> int:
    if not values:
        return 100
    return int(round(sum(values) / len(values)))


FRAMEWORK_SIGNATURES = {
    "swot": {
        "display": "SWOT Analysis",
        "keywords": {"swot", "strength", "weakness", "opportunity", "threat"},
    },
    "porters_five_forces": {
        "display": "Porter's Five Forces",
        "keywords": {
            "porter",
            "five forces",
            "rivalry",
            "new entrants",
            "substitutes",
            "buyer power",
            "supplier power",
        },
    },
    "bcg_matrix": {
        "display": "BCG Growth-Share Matrix",
        "keywords": {
            "bcg",
            "growth-share",
            "stars",
            "cash cows",
            "question marks",
            "dogs",
        },
    },
    "mckinsey_7s": {
        "display": "McKinsey 7S",
        "keywords": {"7s", "shared values", "skills", "style", "staff"},
    },
    "value_chain": {
        "display": "Value Chain Analysis",
        "keywords": {
            "value chain",
            "inbound",
            "operations",
            "outbound",
            "marketing",
            "service",
        },
    },
    "pestel": {
        "display": "PESTEL",
        "keywords": {
            "pestel",
            "political",
            "economic",
            "social",
            "technological",
            "environmental",
            "legal",
        },
    },
    "tam_sam_som": {
        "display": "TAM/SAM/SOM",
        "keywords": {"tam", "sam", "som", "addressable market"},
    },
    "ansoff_matrix": {
        "display": "Ansoff Matrix",
        "keywords": {
            "ansoff",
            "market penetration",
            "product development",
            "market development",
            "diversification",
        },
    },
    "ge_mckinsey_nine_box": {
        "display": "GE-McKinsey Nine-Box",
        "keywords": {"nine-box", "industry attractiveness", "business unit strength"},
    },
    "three_cs": {
        "display": "3C's Model",
        "keywords": {"3c", "company", "customers", "competitors"},
    },
    "strategy_canvas": {
        "display": "Blue Ocean Strategy Canvas",
        "keywords": {"strategy canvas", "blue ocean", "value curve"},
    },
    "three_horizons": {
        "display": "McKinsey Three Horizons",
        "keywords": {"three horizons", "horizon 1", "horizon 2", "horizon 3"},
    },
    "balanced_scorecard": {
        "display": "Balanced Scorecard",
        "keywords": {
            "balanced scorecard",
            "financial",
            "customer",
            "internal process",
            "learning",
        },
    },
    "kano_model": {
        "display": "Kano Model",
        "keywords": {"kano", "must-be", "one-dimensional", "attractive"},
    },
    "jobs_to_be_done": {
        "display": "Jobs-to-be-Done",
        "keywords": {
            "jobs-to-be-done",
            "functional jobs",
            "emotional jobs",
            "social jobs",
        },
    },
    "customer_journey": {
        "display": "Customer Journey Map",
        "keywords": {"awareness", "consideration", "purchase", "retention", "advocacy"},
    },
}

FRAMEWORK_REQUIRED = {
    "swot": ["strength", "weakness", "opportunity", "threat"],
    "porters_five_forces": [
        "rivalry",
        "new entrants",
        "substitutes",
        "buyer power",
        "supplier power",
    ],
    "bcg_matrix": ["stars", "cash cows", "question marks", "dogs"],
    "mckinsey_7s": [
        "strategy",
        "structure",
        "systems",
        "shared values",
        "skills",
        "style",
        "staff",
    ],
    "value_chain": ["inbound", "operations", "outbound", "marketing", "service"],
    "pestel": [
        "political",
        "economic",
        "social",
        "technological",
        "environmental",
        "legal",
    ],
    "tam_sam_som": ["tam", "sam", "som"],
    "ansoff_matrix": [
        "market penetration",
        "product development",
        "market development",
        "diversification",
    ],
    "three_cs": ["company", "customers", "competitors"],
    "three_horizons": ["horizon 1", "horizon 2", "horizon 3"],
}


class FrameworkIdentifierAgent:
    async def run(self, slides_data: list, guardrail: GuardrailSchema):
        annotations: list[Annotation] = []
        metadata: dict[str, dict] = {}
        penalties = 0

        for slide in slides_data:
            idx = slide.get("index", 0)
            text = (slide.get("full_text") or "").lower()
            candidates = []
            for key, cfg in FRAMEWORK_SIGNATURES.items():
                hits = sum(1 for kw in cfg["keywords"] if kw in text)
                if hits >= max(1, math.ceil(len(cfg["keywords"]) * 0.5)):
                    candidates.append((key, hits))
            candidates.sort(key=lambda x: x[1], reverse=True)
            candidate_keys = [c[0] for c in candidates]

            if not candidate_keys:
                metadata[str(idx)] = {
                    "framework": None,
                    "confidence": "low",
                    "completeness": {
                        "expected": [],
                        "present": [],
                        "missing": [],
                        "score": 100,
                    },
                    "quality": {"score": 100, "issues": [], "suggestions": []},
                    "candidate_frameworks": [],
                }
                continue

            prompt = f"""Identify and validate the consulting framework on this slide.
TITLE: {slide.get("title", "")}
TEXT: {(slide.get("full_text") or "")[:2200]}
CANDIDATES: {json.dumps([FRAMEWORK_SIGNATURES[k]["display"] for k in candidate_keys])}
Return JSON with keys:
framework_detected, confidence(high|medium|low), usage_quality(score, issues[], suggestions[])."""
            payload = parse_json_response(await _llm(prompt, max_tokens=650))
            if not isinstance(payload, dict):
                payload = {}

            detected_raw = str(payload.get("framework_detected") or "").lower()
            detected_key = None
            for key, cfg in FRAMEWORK_SIGNATURES.items():
                if key in detected_raw or cfg["display"].lower() in detected_raw:
                    detected_key = key
                    break
            if not detected_key:
                detected_key = candidate_keys[0]

            expected = FRAMEWORK_REQUIRED.get(detected_key, [])
            present = [comp for comp in expected if comp in text]
            missing = [comp for comp in expected if comp not in present]
            completeness_score = (
                int(round((len(present) / max(1, len(expected))) * 100))
                if expected
                else 100
            )

            usage_quality = (
                payload.get("usage_quality", {})
                if isinstance(payload.get("usage_quality"), dict)
                else {}
            )
            quality_score = int(usage_quality.get("score", 100) or 100)
            quality_issues = [
                str(i) for i in (usage_quality.get("issues") or []) if str(i).strip()
            ]
            quality_suggestions = [
                str(i)
                for i in (usage_quality.get("suggestions") or [])
                if str(i).strip()
            ]

            if missing:
                penalties += 15
                annotations.append(
                    Annotation(
                        slide_index=idx,
                        text=slide.get("title", "Framework slide"),
                        category="framework",
                        severity="warning",
                        message=f"Incomplete {FRAMEWORK_SIGNATURES[detected_key]['display']}: missing {', '.join(missing[:4])}",
                        suggestion="Fill all required framework components before client delivery.",
                    )
                )
            if quality_issues or quality_score < 60:
                penalties += 10
                annotations.append(
                    Annotation(
                        slide_index=idx,
                        text=slide.get("title", "Framework slide"),
                        category="framework",
                        severity="warning",
                        message=quality_issues[0]
                        if quality_issues
                        else "Framework usage quality is weak.",
                        suggestion=quality_suggestions[0]
                        if quality_suggestions
                        else "Clarify the framework logic and implications.",
                    )
                )

            metadata[str(idx)] = {
                "framework": FRAMEWORK_SIGNATURES[detected_key]["display"],
                "confidence": str(payload.get("confidence") or "medium").lower(),
                "completeness": {
                    "expected": expected,
                    "present": present,
                    "missing": missing,
                    "score": completeness_score,
                },
                "quality": {
                    "score": max(0, min(100, quality_score)),
                    "issues": quality_issues,
                    "suggestions": quality_suggestions,
                },
                "candidate_frameworks": [
                    FRAMEWORK_SIGNATURES[k]["display"] for k in candidate_keys
                ],
            }

        return {
            "agent_name": "Framework Identifier Agent",
            "findings": annotations,
            "score": max(0, 100 - penalties),
            "metadata": {"slides_framework": metadata},
        }


class SoWhatTestAgent:
    SKIP_KEYWORDS = {
        "agenda",
        "contents",
        "thank you",
        "questions",
        "q&a",
        "appendix",
        "backup",
    }

    async def run(self, slides_data: list, guardrail: GuardrailSchema):
        annotations: list[Annotation] = []
        metadata: dict[str, dict] = {}
        scores: list[int] = []

        for slide in slides_data:
            idx = slide.get("index", 0)
            title = (slide.get("title") or "").lower()
            full_text = slide.get("full_text") or ""
            if (
                any(k in title for k in self.SKIP_KEYWORDS)
                or len(full_text.strip()) < 15
            ):
                metadata[str(idx)] = {
                    "skipped": True,
                    "score": 100,
                    "so_what_location": "headline",
                }
                continue

            prompt = f"""Evaluate so-what quality for this slide.
TITLE: {slide.get("title", "")}
TEXT: {full_text[:2200]}
Return JSON keys: has_clear_so_what, so_what_location(headline|body_conclusion|implied|missing), stated_so_what, body_supports_so_what, support_gap, action_orientation(explicit_action|implicit_action|informational_only|decorative), suggestion."""
            payload = parse_json_response(await _llm(prompt, max_tokens=500))
            if not isinstance(payload, dict):
                payload = {}

            location = str(payload.get("so_what_location") or "missing").lower()
            supports = bool(payload.get("body_supports_so_what", False))
            action_orientation = str(
                payload.get("action_orientation") or "informational_only"
            ).lower()
            if location == "headline" and supports:
                score = 100
            elif location == "body_conclusion":
                score = 70
            elif location == "implied":
                score = 40
            else:
                score = 0
            if action_orientation == "informational_only":
                score = max(0, score - 20)
            scores.append(score)

            if location in {"implied", "missing"}:
                annotations.append(
                    Annotation(
                        slide_index=idx,
                        text=slide.get("title", "Content slide"),
                        category="so_what",
                        severity="warning",
                        message="Slide does not state a clear actionable so-what.",
                        suggestion=str(
                            payload.get("suggestion")
                            or "Rewrite title/body so conclusion is explicit and actionable."
                        ),
                    )
                )
            if not supports:
                annotations.append(
                    Annotation(
                        slide_index=idx,
                        text=slide.get("title", "Content slide"),
                        category="so_what",
                        severity="warning",
                        message="Body evidence does not fully support the stated so-what.",
                        suggestion=str(
                            payload.get("support_gap")
                            or "Add evidence that directly supports the conclusion."
                        ),
                    )
                )

            metadata[str(idx)] = {
                "skipped": False,
                "has_clear_so_what": bool(
                    payload.get(
                        "has_clear_so_what", location in {"headline", "body_conclusion"}
                    )
                ),
                "so_what_location": location,
                "stated_so_what": str(payload.get("stated_so_what") or ""),
                "body_supports_so_what": supports,
                "support_gap": str(payload.get("support_gap") or ""),
                "action_orientation": action_orientation,
                "score": score,
                "suggestion": str(payload.get("suggestion") or ""),
            }

        return {
            "agent_name": "So What Test Agent",
            "findings": annotations,
            "score": _avg(scores),
            "metadata": {"slides_so_what": metadata},
        }


class CompetitiveBenchmarkAgent:
    KEYWORDS = {
        "market share",
        "benchmark",
        "peer group",
        "competitor",
        "industry average",
        "quartile",
        "percentile",
        "ranking",
        "vs",
        "versus",
        "compared to",
    }

    async def run(self, slides_data: list, guardrail: GuardrailSchema):
        annotations: list[Annotation] = []
        metadata: dict[str, dict] = {}
        scores: list[int] = []

        for slide in slides_data:
            idx = slide.get("index", 0)
            text = slide.get("full_text") or ""
            text_l = text.lower()
            is_candidate = any(k in text_l for k in self.KEYWORDS) or any(
                (t.get("columns", 0) or 0) >= 3 for t in slide.get("tables", [])
            )
            if not is_candidate:
                scores.append(100)
                metadata[str(idx)] = {"is_benchmark_slide": False, "score": 100}
                continue

            prompt = f"""Validate benchmark fairness and completeness.
TITLE: {slide.get("title", "")}
TEXT: {text[:2200]}
Return JSON keys: comparison_type, entities_compared[], fairness_issues[], completeness_issues[], conclusion_supported, conclusion_gap."""
            payload = parse_json_response(await _llm(prompt, max_tokens=500))
            if not isinstance(payload, dict):
                payload = {}

            fairness = [
                str(i) for i in (payload.get("fairness_issues") or []) if str(i).strip()
            ]
            completeness = [
                str(i)
                for i in (payload.get("completeness_issues") or [])
                if str(i).strip()
            ]
            if (" million" in text_l or " mn" in text_l) and (
                " billion" in text_l or " bn" in text_l
            ):
                fairness.append("mixed units detected (million and billion).")
            if "%" in text_l and re.search(r"[$€£]\s*\d", text_l):
                fairness.append(
                    "mixed metric types detected (percent and currency values)."
                )
            if re.search(r"\bfy\s*20\d{2}\b", text_l) and (
                "ttm" in text_l or re.search(r"\bq[1-4]\b", text_l)
            ):
                fairness.append("time period inconsistency risk detected.")
            fairness = list(dict.fromkeys(fairness))
            completeness = list(dict.fromkeys(completeness))

            conclusion_supported = bool(payload.get("conclusion_supported", True))
            penalty = (
                len(fairness) * 15
                + len(completeness) * 10
                + (20 if not conclusion_supported else 0)
            )
            score = max(0, 100 - penalty)
            scores.append(score)

            for issue in fairness:
                annotations.append(
                    Annotation(
                        slide_index=idx,
                        text=slide.get("title", "Benchmark slide"),
                        category="benchmarking",
                        severity="warning",
                        message=f"Benchmark fairness issue: {issue}",
                        suggestion="Normalize periods/units and ensure apples-to-apples comparison.",
                    )
                )
            for issue in completeness:
                annotations.append(
                    Annotation(
                        slide_index=idx,
                        text=slide.get("title", "Benchmark slide"),
                        category="benchmarking",
                        severity="warning",
                        message=f"Benchmark completeness issue: {issue}",
                        suggestion="Include omitted peers/metrics that materially affect the conclusion.",
                    )
                )
            if not conclusion_supported:
                annotations.append(
                    Annotation(
                        slide_index=idx,
                        text=slide.get("title", "Benchmark slide"),
                        category="benchmarking",
                        severity="hard_block",
                        message=str(
                            payload.get("conclusion_gap")
                            or "Conclusion is not supported by benchmark evidence."
                        ),
                        suggestion="Revise the claim or add evidence that directly supports it.",
                    )
                )

            metadata[str(idx)] = {
                "is_benchmark_slide": True,
                "comparison_type": str(payload.get("comparison_type") or "peer_group"),
                "entities_compared": [
                    str(i)
                    for i in (payload.get("entities_compared") or [])
                    if str(i).strip()
                ],
                "fairness_issues": fairness,
                "completeness_issues": completeness,
                "conclusion_supported": conclusion_supported,
                "conclusion_gap": str(payload.get("conclusion_gap") or ""),
                "score": score,
            }

        return {
            "agent_name": "Competitive Benchmark Agent",
            "findings": annotations,
            "score": _avg(scores),
            "metadata": {"slides_benchmarking": metadata},
        }


class SlideContextSynthesizer:
    async def run(
        self,
        slides_data: list,
        phase_one_results: list,
        language_annotations: list[Annotation],
    ):
        findings_by_slide: dict[str, list[dict]] = {}
        for result in phase_one_results:
            for finding in result.findings:
                key = str(finding.slide_index)
                findings_by_slide.setdefault(key, []).append(
                    {
                        "category": finding.category,
                        "severity": finding.severity,
                        "message": finding.message,
                    }
                )
        for finding in language_annotations:
            key = str(finding.slide_index)
            findings_by_slide.setdefault(key, []).append(
                {
                    "category": finding.category,
                    "severity": finding.severity,
                    "message": finding.message,
                }
            )

        framework_meta = next(
            (
                r.metadata.get("slides_framework", {})
                for r in phase_one_results
                if r.agent_name == "Framework Identifier Agent"
            ),
            {},
        )
        so_what_meta = next(
            (
                r.metadata.get("slides_so_what", {})
                for r in phase_one_results
                if r.agent_name == "So What Test Agent"
            ),
            {},
        )
        benchmark_meta = next(
            (
                r.metadata.get("slides_benchmarking", {})
                for r in phase_one_results
                if r.agent_name == "Competitive Benchmark Agent"
            ),
            {},
        )

        contexts: dict[str, dict] = {}
        for slide in slides_data:
            idx = str(slide.get("index", 0))
            if inference_service.llm is None:
                contexts[idx] = {
                    "core_message": slide.get("title", "No title"),
                    "so_what": "Context synthesis unavailable because LLM is offline.",
                    "audience_impact": "Review manually.",
                    "narrative_role": "evidence",
                    "deck_fit": "",
                    "executive_summary": "Synthesis unavailable.",
                    "gaps": [],
                }
                continue
            prompt = f"""Synthesize this consulting slide for partner review.
TITLE: {slide.get("title", "")}
TEXT: {(slide.get("full_text") or "")[:2200]}
FRAMEWORK: {json.dumps(framework_meta.get(idx, {}))[:1200]}
SO_WHAT: {json.dumps(so_what_meta.get(idx, {}))[:1200]}
BENCHMARK: {json.dumps(benchmark_meta.get(idx, {}))[:1200]}
FINDINGS: {json.dumps(findings_by_slide.get(idx, [])[:8])}
Return JSON keys: core_message, so_what, audience_impact, narrative_role(context|problem|diagnosis|recommendation|evidence|transition|appendix), deck_fit, executive_summary, gaps[]."""
            payload = parse_json_response(await _llm(prompt, max_tokens=500))
            if not isinstance(payload, dict):
                payload = {}
            contexts[idx] = {
                "core_message": str(payload.get("core_message") or ""),
                "so_what": str(payload.get("so_what") or ""),
                "audience_impact": str(payload.get("audience_impact") or ""),
                "narrative_role": str(payload.get("narrative_role") or "evidence"),
                "deck_fit": str(payload.get("deck_fit") or ""),
                "executive_summary": str(payload.get("executive_summary") or ""),
                "gaps": [str(i) for i in (payload.get("gaps") or []) if str(i).strip()],
            }

        return {
            "agent_name": "Slide Context Synthesizer",
            "findings": [],
            "score": 100,
            "metadata": {"slides_context": contexts},
        }
