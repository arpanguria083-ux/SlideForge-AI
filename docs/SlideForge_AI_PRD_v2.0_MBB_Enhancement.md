# SlideForge AI - Product Requirements Document v2.0

## MBB Consulting Intelligence Enhancement

| Property | Value |
|---|---|
| **Version** | 2.0 |
| **Date** | March 30, 2026 |
| **Status** | Draft - Pending Review |
| **Classification** | Internal - Confidential |

---

## 1. Executive Summary

SlideForge AI is an offline-first consulting deck quality assurance platform powered by local LLMs (LM Studio) and computer vision (Surya OCR). Version 1.0 established a foundation with four parallel analysis agents covering claim grounding, narrative structure, data lineage, and visual compliance.

**Version 2.0** elevates SlideForge from a quality checker to an **MBB-grade consulting intelligence platform**. This release introduces four new analytical agents and enhances the vision pipeline to deliver the kind of rigorous, framework-aware, insight-driven feedback that partners at McKinsey, BCG, and Bain expect from their teams.

### Key Objectives

1. Detect and validate 16+ business consulting frameworks automatically
2. Enforce the "So What?" test on every content slide - the core MBB differentiator
3. Validate competitive benchmarking data for fairness and completeness
4. Synthesize holistic slide context combining text, images, tables, and framework analysis
5. Close the table-image-to-LLM pipeline gap for vision-based data verification

---

## 2. Problem Statement

### 2.1 Current State

SlideForge v1.0 provides robust quality assurance through four agents: InsightExtractor (claim grounding), StructureAuditor (MECE + Pyramid Principle), DataLineageAgent (chart/Excel verification), and VisualAnalysisAgent (layout detection). A LanguageAnalysisAgent checks grammar and consulting tone.

### 2.2 Identified Gaps

| Gap | Impact | Priority |
|---|---|---|
| No business framework identification | Cannot detect whether SWOT, Porter's, BCG Matrix etc. are used correctly or completely | **P0** |
| No "So What?" enforcement | Slides pass QA even when they lack actionable conclusions - the #1 MBB red flag | **P0** |
| No competitive benchmark validation | Benchmark slides with unfair comparisons or missing competitors go undetected | **P1** |
| No holistic slide context synthesis | Each agent reports independently; no unified "what is this slide actually saying?" view | **P1** |
| Table images bypass vision LLM | Native PPTX tables are never sent to the multimodal model for cross-verification | **P1** |
| Framework slides only get MECE check | A Porter's Five Forces slide missing 2 forces won't be flagged | **P0** |

---

## 3. Solution Architecture Overview

### 3.1 Agent Orchestration Flow

The enhanced pipeline operates in two phases:

**Phase 1 - Parallel Analysis (7 agents concurrently):**

- InsightExtractor (existing) - Claim grounding
- StructureAuditor (existing) - MECE + Pyramid Principle + Headlines
- DataLineageAgent (existing, enhanced) - Chart/Table/Excel verification + vision cross-ref
- VisualAnalysisAgent (existing, enhanced) - Layout + table image vision pipeline
- **FrameworkIdentifierAgent (NEW)** - Business framework detection and validation
- **SoWhatTestAgent (NEW)** - Actionable conclusion enforcement
- **CompetitiveBenchmarkAgent (NEW)** - Benchmark fairness and completeness

**Phase 1.5 - Language Analysis:**

- LanguageAnalysisAgent (existing) - Grammar, hedging, passive voice, vague quantifiers

**Phase 2 - Sequential Synthesis (after Phase 1 completes):**

- **SlideContextSynthesizer (NEW)** - Holistic per-slide understanding combining all Phase 1 results

### 3.2 Scoring Model Rebalancing

The composite score formula is rebalanced to reflect MBB priorities:

| Category | v1.0 Weight | v2.0 Weight | Agent |
|---|---|---|---|
| Structure | 25% | 15% | StructureAuditor |
| Claim Grounding | 30% | 20% | InsightExtractor |
| Data Accuracy | 20% | 15% | DataLineageAgent |
| Visual Compliance | 10% | 10% | VisualAnalysisAgent |
| Language Quality | 15% | 10% | LanguageAnalysisAgent |
| **Framework Quality** | - | **10%** | **FrameworkIdentifierAgent (NEW)** |
| **So What? Score** | - | **15%** | **SoWhatTestAgent (NEW)** |
| **Benchmarking** | - | **5%** | **CompetitiveBenchmarkAgent (NEW)** |

> **Note:** SlideContextSynthesizer is purely advisory and does NOT contribute to the composite score.

---

## 4. Feature Specifications

### 4.1 Business Framework Identifier Agent

| Property | Value |
|---|---|
| Agent Name | Framework Identifier |
| Category | `framework` |
| Score Weight | 10% |
| LLM Calls | ~0.4N per deck (pre-filtered) |
| Vision Calls | Only for visual framework candidates |

#### 4.1.1 Supported Frameworks

The agent detects and validates 16+ consulting frameworks:

| Framework | Required Components | Visual Pattern |
|---|---|---|
| SWOT Analysis | 4 quadrants: Strengths, Weaknesses, Opportunities, Threats | 2x2 grid |
| Porter's Five Forces | Rivalry, New Entrants, Substitutes, Buyer Power, Supplier Power | Hub-spoke diagram |
| BCG Growth-Share Matrix | Stars, Cash Cows, Question Marks, Dogs | 2x2 matrix with axes |
| McKinsey 7S | Strategy, Structure, Systems, Shared Values, Skills, Style, Staff | 7-node diagram |
| Value Chain Analysis | Inbound, Operations, Outbound, Marketing & Sales, Service | Arrow chain |
| PESTEL | Political, Economic, Social, Technological, Environmental, Legal | 6-section layout |
| TAM/SAM/SOM | Total Addressable, Serviceable Addressable, Serviceable Obtainable Market | Concentric circles |
| Ansoff Matrix | Market Penetration, Product Development, Market Development, Diversification | 2x2 grid |
| GE-McKinsey Nine-Box | Industry Attractiveness x Business Unit Strength (3x3) | 3x3 grid |
| 3C's Model | Company, Customers, Competitors | Triangle/Venn |
| Blue Ocean Strategy Canvas | Value curves across competing factors | Line chart |
| McKinsey Three Horizons | Horizon 1 (core), Horizon 2 (emerging), Horizon 3 (creation) | 3-layer timeline |
| Balanced Scorecard | Financial, Customer, Internal Process, Learning & Growth | 4-quadrant |
| Kano Model | Must-be, One-dimensional, Attractive, Indifferent, Reverse | XY curve chart |
| Jobs-to-be-Done | Functional, Emotional, Social jobs | Job map |
| Customer Journey Map | Awareness, Consideration, Purchase, Retention, Advocacy stages | Horizontal flow |

#### 4.1.2 Detection Pipeline

The agent uses a 4-phase detection approach to balance accuracy with LLM cost:

**Phase A - Keyword Pre-Filter (zero LLM cost):** A `FRAMEWORK_SIGNATURES` dictionary maps each framework to a set of required keywords. For each slide, check `full_text.lower()` against keyword sets. If 50%+ of a framework's keywords match, the slide is marked as a candidate. Non-candidate slides are skipped entirely.

**Phase B - LLM Validation:** Candidate slides are sent to the LLM with a structured prompt requesting: `framework_detected`, `confidence` (high/medium/low), `completeness` (expected components, present components, missing components, completeness_score), and `usage_quality` (score, issues, suggestions).

**Phase C - Vision Validation:** For candidate slides where Surya detected figure/image blocks, crop the visual region and send to the multimodal vision model. Many frameworks (BCG 2x2, SWOT quadrant, strategy canvas) have distinctive visual layouts that text analysis alone may miss.

**Phase D - Deterministic Completeness Rules:** Hard-coded post-LLM validation ensures accuracy: SWOT must have 4 quadrants, Porter's must address all 5 forces, 7S must mention all 7 elements, PESTEL must cover 6 factors. These catch LLM hallucinations.

#### 4.1.3 Scoring Rules

- Incomplete framework (missing required components): **-15** per framework (severity: `warning`)
- Framework misuse (wrong application): **-10** per instance (severity: `warning`)
- Quality improvement suggestions: **-0** (severity: `suggestion`, no score impact)
- Floor: 0. Agent score = `max(0, 100 - penalties)`

#### 4.1.4 Output Schema

- **Annotations:** `category="framework"`, severity `warning`/`suggestion`
- **Metadata per slide:** `{ framework, confidence, completeness: { expected, present, missing, score }, quality: { score, issues, suggestions } }`

---

### 4.2 "So What?" Test Agent

**The core MBB differentiator.** Every content slide in an MBB deck must answer the question: "So what?" - what should the audience think, feel, or do based on this slide?

| Property | Value |
|---|---|
| Agent Name | So What Test |
| Category | `so_what` |
| Score Weight | 15% (highest new weight - reflects MBB importance) |
| LLM Calls | ~0.8N per deck (skips non-content slides) |

#### 4.2.1 Pre-Filter

The following slide types are automatically skipped (score = 100, no penalty):

- Title/cover slides (title contains: "agenda", "contents", "table of contents")
- Closing slides (title contains: "thank you", "questions", "Q&A")
- Appendix slides (title contains: "appendix", "backup")
- Section dividers (title contains: "cover" or slide has minimal text)

#### 4.2.2 LLM Analysis

For each content slide, the LLM (acting as a demanding McKinsey engagement manager) evaluates:

| Field | Type | Description |
|---|---|---|
| `has_clear_so_what` | boolean | Does the slide have a clear actionable conclusion? |
| `so_what_location` | enum | `"headline"` \| `"body_conclusion"` \| `"implied"` \| `"missing"` |
| `stated_so_what` | string | The actual so-what text extracted from the slide |
| `body_supports_so_what` | boolean | Does the body content logically support the conclusion? |
| `support_gap` | string | What's missing between body content and conclusion |
| `action_orientation` | enum | `"explicit_action"` \| `"implicit_action"` \| `"informational_only"` \| `"decorative"` |
| `score` | int (0-100) | Per-slide so-what quality score |
| `suggestion` | string | How to strengthen the slide's conclusion |

#### 4.2.3 Scoring Matrix

| Condition | Score | Severity |
|---|---|---|
| Headline states so-what + body supports it | 100 | None |
| So-what in body conclusion | 70 | Suggestion |
| So-what only implied, not stated | 40 | Warning |
| No clear so-what at all | 0 | Warning |
| `action_orientation = "informational_only"` | -20 penalty | Suggestion |

Agent composite score = average across all content slides (non-content slides excluded).

#### 4.2.4 Distinction from StructureAuditor

| Aspect | StructureAuditor (Existing) | So What? Agent (New) |
|---|---|---|
| **Focus** | Headline text quality | Slide content -> conclusion logic |
| **Question** | "Is the headline action-oriented?" | "Does the slide body support an actionable conclusion?" |
| **Example pass** | "Revenue declined 23%" (action headline) | Headline says decline, body shows data proving it, implication is clear |
| **Example fail** | "Revenue Analysis" (descriptive) | "Revenue declined 23%" headline but body shows unrelated cost data |

---

### 4.3 Competitive Benchmarking Agent

| Property | Value |
|---|---|
| Agent Name | Competitive Benchmark |
| Category | `benchmarking` |
| Score Weight | 5% (applies to subset of slides only) |
| LLM Calls | ~0.25N per deck (only benchmark slides) |

#### 4.3.1 Detection Pre-Filter

Slides are scanned for competitive/benchmarking signals:

- **Keywords:** "market share", "benchmark", "peer group", "competitor", "industry average", "quartile", "percentile", "ranking", "vs", "versus", "compared to"
- **Tables/charts** with 3+ entity columns (indicating multi-company comparison)
- Only slides passing this filter are processed by the LLM

#### 4.3.2 LLM Validation

For detected benchmark slides, the LLM evaluates:

- `comparison_type`: direct_competitor | industry_benchmark | peer_group | time_series
- `entities_compared`: list of companies/groups being compared
- `fairness_issues`: mixed units (M vs B), inconsistent time periods, mixed %/absolute values
- `completeness_issues`: missing major competitors, incomplete metrics, cherry-picked data points
- `conclusion_supported`: does the benchmark data actually support the slide's stated conclusion?
- `conclusion_gap`: how the benchmark fails to support the message (if applicable)

#### 4.3.3 Rule-Based Fairness Checks (No LLM)

Post-LLM deterministic checks catch common benchmark manipulation patterns:

1. Mixed units detection: millions vs billions in same comparison
2. Time period inconsistency: comparing FY2024 vs TTM vs calendar year
3. Mixed metric types: absolute values next to percentages without normalization
4. Base year manipulation: growth rates from cherry-picked base years

#### 4.3.4 Scoring

- Slides without competitive data: score = **100** (no penalty)
- Fair and complete benchmark: score = **100**
- Fairness issue: **-15** per issue (severity: `warning`)
- Completeness issue: **-10** per issue (severity: `warning`)
- Conclusion unsupported by data: **-20** (severity: `hard_block`)

---

### 4.4 Slide Context Synthesizer Agent

This agent provides the **senior partner's perspective**: a holistic understanding of what each slide communicates, combining insights from ALL other agents.

| Property | Value |
|---|---|
| Agent Name | Context Synthesizer |
| Category | Advisory (no score contribution) |
| Execution Phase | Phase 2 (runs AFTER all Phase 1 agents complete) |
| LLM Calls | ~N per deck (one per slide) |
| Score Impact | None - purely advisory |

#### 4.4.1 Input Aggregation

For each slide, the synthesizer collects from Phase 1 results:

- Slide text content and title from document ingestion
- Image analysis descriptions from VisualAnalysisAgent metadata
- Table summaries (native + vision-extracted) from enhanced pipeline
- Detected framework and completeness from FrameworkIdentifierAgent
- Claim findings (supported/unsupported) from InsightExtractor
- Structure findings (narrative arc position) from StructureAuditor
- So-what assessment from SoWhatTestAgent
- Benchmark validation from CompetitiveBenchmarkAgent (if applicable)
- Language quality issues from LanguageAnalysisAgent

#### 4.4.2 LLM Synthesis Prompt

The LLM acts as a senior McKinsey partner reviewing the combined evidence and returns per slide:

| Field | Description |
|---|---|
| `core_message` | What this slide fundamentally communicates (1-2 sentences) |
| `so_what` | The key takeaway or implication for the audience |
| `audience_impact` | What the audience should think, feel, or do after seeing this slide |
| `narrative_role` | One of: `context` \| `problem` \| `diagnosis` \| `recommendation` \| `evidence` \| `transition` \| `appendix` |
| `deck_fit` | How this slide connects to the slides before and after it |
| `executive_summary` | One-sentence description a partner would use to describe this slide |
| `gaps` | What's missing to make the slide stronger (actionable list) |

#### 4.4.3 Design Rationale

The synthesizer runs in Phase 2 (not parallel with Phase 1) because it needs complete results from all other agents. It does NOT contribute to the composite score because its value is qualitative insight, not compliance checking. It answers the partner's question: *"Walk me through this deck slide by slide - what's the story?"*

---

### 4.5 Enhanced Table Image Analysis Pipeline

#### 4.5.1 Problem

Currently, native PPTX tables extracted via python-pptx are processed only structurally by DataLineageAgent (text-based value comparison against Excel). They are NEVER cropped from the slide preview PNG and sent to the multimodal vision model. This means:

- Tables with formatting that obscures values (merged cells, colored backgrounds) may have OCR-invisible data
- Tables embedded as images (common in PDF imports) are detected by Surya but not cross-referenced with native data
- No three-way verification: native text vs vision extraction vs Excel source

#### 4.5.2 Solution

**Step 1 - Crop native tables from preview:** In `VisualAnalysisAgent._analyze_images_with_vision()`, after the existing charts loop, add a new loop for native PPTX tables. For each table in `slide.get("tables", [])`, call `_crop_element_from_preview(slide, table)` to extract the table region as a PIL Image.

**Step 2 - Vision extraction:** Send the cropped table image to `vision_service.extract_table_content(crop)` (method already exists in `vision.py`). Store the result as `type="table_vision"` in the image_analysis list, including: `native_text`, `vision_headers`, `vision_rows`, `vision_summary`, `confidence`, and `discrepancies`.

**Step 3 - Cross-reference:** New method `_cross_reference_table(native_text, vision_data)` extracts numeric values from both native PPTX text and vision-extracted rows, compares with >5% tolerance, and returns a list of discrepancy strings.

**Step 4 - Three-way verification:** Wire into DataLineageAgent with new method `verify_vision_table(vision_data, excel_data)` that compares: native PPTX text values vs vision-extracted values vs Excel source values. Flag any two-way mismatches.

**Step 5 - Concurrency control:** Add `_vision_semaphore = asyncio.Semaphore(2)` to limit concurrent vision model calls. Cap at 4 tables per slide maximum to prevent resource exhaustion.

#### 4.5.3 Frontend Display

The existing `ImageAnalysisItem` type in `types.ts` already supports `table_summary`, `table_headers`, `table_rows`. Add an optional `discrepancies?: string[]` field. The Dashboard.tsx table insights section already filters for table items; add a discrepancy badge (red indicator) when vision-vs-native mismatches are detected.

---

## 5. Technical Specifications

### 5.1 Files to Modify

| File | Changes |
|---|---|
| `backend/app/agents/parallel_analysis.py` | 4 new agent classes (FrameworkIdentifier, SoWhatTest, CompetitiveBenchmark, SlideContextSynthesizer), orchestrator updates, table vision enhancement in VisualAnalysisAgent, scoring rebalancing in QAGradingOrchestrator |
| `backend/app/main.py` | Phase 2 orchestration wiring, session metadata storage for new agents, slide response field additions (~line 2096) |
| `backend/app/models/schemas.py` | New fields on QAScorecard (framework_score, so_what_score, benchmarking_score), updated default rubric weights |
| `SlideForge-AI/types.ts` | New interfaces: FrameworkAnalysis, SlideContext, SoWhatResult, BenchmarkAnalysis; add optional fields to SlideAnalysis; add discrepancies to ImageAnalysisItem |
| `SlideForge-AI/components/Dashboard.tsx` | 4 new card sections: Framework Detection, Partner View, So-What Indicator, Benchmark Validation |
| `SlideForge-AI/services/apiService.ts` | Add framework_score, so_what_score, benchmarking_score to ScorecardResponse mapping |

### 5.2 LLM Call Budget Analysis

Impact analysis for a typical 20-slide deck (N=20):

| Component | v1.0 Calls | v2.0 Calls | Notes |
|---|---|---|---|
| InsightExtractor | ~20 | ~20 | Unchanged |
| StructureAuditor | ~22 | ~22 | Arc(1) + Headlines(1) + MECE(~20) |
| DataLineageAgent | 0 | 0 | Rule-based, no LLM |
| VisualAnalysisAgent | ~20 | ~20 | Per-slide layout + vision |
| LanguageAnalysisAgent | ~20 | ~20 | Unchanged |
| **FrameworkIdentifier** | - | **~8** | Pre-filter reduces to ~40% of slides |
| **SoWhatTestAgent** | - | **~16** | Skips ~20% non-content slides |
| **CompetitiveBenchmark** | - | **~5** | Only benchmark slides (~25%) |
| **SlideContextSynthesizer** | - | **~20** | All slides, Phase 2 |
| **Table Vision** | - | **~10** | Vision model calls for native tables |
| **TOTAL** | **~82** | **~141** | **+72% increase, mitigated by semaphore limiting** |

### 5.3 Concurrency & Performance

- Existing `_llm_semaphore(MAX_CONCURRENT_LLM=4)` applies to all text LLM calls
- New `_vision_semaphore(2)` limits concurrent multimodal vision calls
- Phase 1 agents run in parallel via `asyncio.gather` - wall-clock time determined by slowest agent
- Phase 2 (SlideContextSynthesizer) runs sequentially after Phase 1 but parallelizes per-slide LLM calls internally
- Pre-filters (keyword matching, slide type detection) have zero LLM cost and reduce unnecessary calls by ~40-60%

### 5.4 Data Flow

All new agents follow the existing `AgentResult` pattern:

- **Input:** `slides_data` (list of dicts from document ingestion), `guardrail` (GuardrailSchema), optional `excel_data`
- **Output:** `AgentResult(agent_name: str, findings: list[Annotation], score: int, metadata: dict)`
- **Annotations** use existing categories and severities (`hard_block`, `warning`, `suggestion`)
- **Metadata** keyed by slide_index string for frontend consumption
- **Session storage** via session dict in `main.py` (existing pattern)

---

## 6. Frontend UX Specifications

### 6.1 Framework Detection Card

Renders below the existing `frameworkDetected` field in the slide detail panel:

- Framework name with confidence badge (high=green, medium=yellow, low=red)
- Completeness progress bar (e.g., 4/5 forces detected -> 80%)
- Missing components listed as actionable items
- Quality score with color-coded indicator
- Usage suggestions in collapsible section

### 6.2 Partner View / Context Card

A new "Partner View" tab or card showing the synthesized understanding:

- Executive summary (one-sentence partner description) in bold/highlighted
- Core message and audience impact as labeled text blocks
- Narrative role badge (context/problem/diagnosis/recommendation/evidence/transition)
- Deck fit showing connection to previous and next slides
- Gaps listed as actionable improvement items

### 6.3 So-What Score Indicator

- Traffic light badge next to slide title in the slide navigator: green (80-100), yellow (40-79), red (0-39)
- In slide detail: "So What" location indicator showing where the conclusion lives (headline/body/implied/missing)
- Support gap highlighted as a warning card when body doesn't support the stated conclusion
- Suggested stronger so-what text displayed as an actionable recommendation

### 6.4 Benchmark Validation Card

Conditional card - only renders for slides with competitive data:

- Comparison type badge (direct competitor / industry benchmark / peer group / time series)
- Entities compared listed as tags
- Fairness issues as red warning items
- Completeness issues as yellow warning items
- "Conclusion Supported" indicator (green check or red X) with gap explanation

### 6.5 Scorecard Updates

- Three new score categories added to the radar/pie chart: Framework Quality, So What Score, Benchmarking
- New score breakdown rows in the scorecard summary table
- Updated composite score calculation reflecting new 8-category weights

---

## 7. Implementation Plan

### 7.1 Phase 1 - Backend Agents

All four new agent classes can be developed in parallel:

| Task | Dependency | Estimated Complexity |
|---|---|---|
| FrameworkIdentifierAgent class + FRAMEWORK_SIGNATURES | None | High - 16+ frameworks, 4-phase pipeline |
| SoWhatTestAgent class | None | Medium - single LLM prompt, scoring matrix |
| CompetitiveBenchmarkAgent class | None | Medium - pre-filter + LLM + rule checks |
| Table vision enhancement in VisualAnalysisAgent | None | Medium - extends existing _analyze_images_with_vision |

### 7.2 Phase 2 - Backend Integration

Sequential integration after Phase 1 agents are complete:

| Task | Dependency | Estimated Complexity |
|---|---|---|
| SlideContextSynthesizer class | Phase 1 agents | Medium - aggregation + LLM synthesis |
| Update ParallelAnalysisOrchestrator | All new agents | Low - add to asyncio.gather |
| Update QAGradingOrchestrator + scoring weights | All new agents | Low - new keys in score dict |
| Update schemas.py (QAScorecard fields) | Scoring changes | Low - 3 new fields |
| Update main.py orchestration + response construction | All above | Medium - session metadata, response fields |

### 7.3 Phase 3 - Frontend

Frontend changes after backend API is stable:

| Task | Dependency | Estimated Complexity |
|---|---|---|
| Update types.ts with new interfaces | Backend API | Low |
| Framework Detection Card component | types.ts | Medium |
| Partner View / Context Card component | types.ts | Medium |
| So-What indicator + detail card | types.ts | Low |
| Benchmark Validation Card (conditional) | types.ts | Medium |
| Scorecard display updates (radar chart + breakdown) | apiService.ts | Low |

---

## 8. Verification & Testing Plan

### 8.1 Agent-Level Testing

| Agent | Test Case | Expected Result |
|---|---|---|
| FrameworkIdentifier | Upload deck with SWOT slide missing Threats quadrant | Flags incomplete SWOT, lists "Threats" as missing component |
| FrameworkIdentifier | Upload deck with Porter's Five Forces (all 5 present) | Detects Porter's, completeness=100%, no warnings |
| FrameworkIdentifier | Upload deck with BCG Matrix image (no text labels) | Vision model detects 2x2 grid pattern, identifies BCG Matrix |
| SoWhatTest | Slide with headline "Revenue Analysis" + body with data | Flags missing so-what, suggests action-oriented conclusion |
| SoWhatTest | Slide with "Revenue declined 23%" headline + supporting data | Score=100, so_what_location="headline", body_supports=true |
| SoWhatTest | Agenda slide | Skipped (pre-filter), score=100 |
| CompetitiveBenchmark | Slide comparing Q1 vs FY data for different companies | Flags time period inconsistency as fairness issue |
| CompetitiveBenchmark | Slide with market share table, all same metrics/period | No fairness issues, conclusion_supported evaluated |
| ContextSynthesizer | Full deck analysis | Each slide has core_message, narrative_role, gaps populated |
| Table Vision | Slide with native PPTX table + Excel source | Vision extraction matches native text; both verified against Excel |

### 8.2 Integration Testing

1. Upload a 15-20 slide consulting deck with mixed framework types -> verify all agents produce results
2. Verify composite score reflects new 8-category weighting (sum of weighted scores)
3. Verify Phase 2 (ContextSynthesizer) only runs after Phase 1 completes
4. Verify pre-filters reduce LLM calls (check logs for skipped slides)
5. Verify frontend renders all 4 new card sections correctly
6. Verify scorecard displays 8 categories with correct weights
7. Verify backward compatibility: existing guardrails with old weight dicts still work
8. Verify `_vision_semaphore` limits concurrent vision calls to 2

### 8.3 Performance Testing

1. Benchmark total analysis time for 20-slide deck: target <3 minutes with LM Studio (4 concurrent LLM calls)
2. Verify memory usage stays within bounds (Surya + vision + 7 agents)
3. Verify no deadlocks between `_llm_semaphore` and `_vision_semaphore`
4. Stress test with 50-slide deck to validate semaphore limiting

---

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| LLM call volume increase (+72%) | Longer analysis time | High | Pre-filters reduce actual calls by 40-60%; semaphore limits concurrency |
| Framework misidentification by LLM | False positives in framework detection | Medium | Phase D deterministic rules validate LLM output; confidence scores exposed to user |
| Vision model inaccuracy on complex tables | Incorrect cross-reference discrepancies | Medium | 5% tolerance threshold; discrepancies shown as suggestions, not hard blocks |
| Context Synthesizer adding latency (Phase 2) | Increased total analysis time | High | Phase 2 parallelizes per-slide LLM calls internally; can be made optional |
| Scoring weight rebalancing breaks existing guardrails | Unexpected score changes for existing users | Low | `weights.get(k, 0)` pattern ensures missing keys default to 0; no migration needed |
| Local model quality insufficient for framework nuance | Poor framework validation quality | Medium | Keyword pre-filter handles simple cases; LLM only validates nuanced candidates |

---

## 10. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Framework detection accuracy | >=85% precision on known framework slides | Manual review of 50 slides with labeled frameworks |
| So-What coverage | 100% content slides evaluated | Count of slides analyzed vs skipped |
| False positive rate (all new agents) | <10% annotations overridden by users | Override tracking via existing engagement pattern logging |
| Analysis time increase | <50% wall-clock increase for 20-slide deck | Benchmark before/after with same deck |
| User engagement with new cards | >60% of users interact with framework/context cards | Frontend analytics (click tracking) |

---

## 11. Future Considerations

- Industry-specific framework libraries (healthcare: Value-Based Care Model; fintech: Unit Economics Canvas)
- Cross-slide framework consistency (same framework used differently across slides)
- Automated framework suggestion ("this data would be better presented as a BCG Matrix")
- Benchmark data enrichment from external databases (when online mode is available)
- Framework template generation (auto-create a correct Porter's Five Forces layout from detected content)
- Multi-deck comparison (compare framework usage across related decks in an engagement)
- Real-time collaborative review with partner annotations synced across reviewers

---

*End of Document*
