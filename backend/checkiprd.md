# SlideForge AI
## Consultant Deliverable Intelligence Platform
### Product Requirements Document — Version 1.0

> **Status:** Draft — Pending Engineering Review
> **Target platform:** macOS (Apple Silicon M1–M4), offline-first
> **Primary stack:** Python · LangGraph · MLX · FastAPI · python-pptx
> **Last updated:** March 2026
> **Classification:** Confidential — Internal Use Only

---

> **Scope note:** This PRD covers the full SlideForge AI system — from document ingestion and template discovery through parallel analysis agents, QA scoring, revision loops, language analysis, and guardrail portability. All inference runs locally on Apple Silicon. No client data leaves the device.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [Architecture Overview](#4-architecture-overview)
5. [Feature Specifications](#5-feature-specifications)
   - [F1 — Document Ingestion](#f1--document-ingestion)
   - [F2 — Template Discovery Agent](#f2--template-discovery-agent-lazy-supervisor-mode)
   - [F3 — Parallel Analysis Agents](#f3--parallel-analysis-agents)
   - [F4 — Language Analysis Agent](#f4--language-analysis-agent)
   - [F5 — Claim–Evidence Guardrail](#f5--claimevidence-guardrail)
   - [F6 — QA Rubric Scorer](#f6--qa-rubric-scorer)
   - [F7 — Slide Builder and Auto-Remediation](#f7--slide-builder-and-auto-remediation)
   - [F8 — Revision Loop](#f8--revision-loop)
   - [F9 — Guardrail Portability and Distribution](#f9--guardrail-portability-and-distribution)
   - [F10 — Adaptation Loop](#f10--adaptation-loop)
   - [F11 — Dashboard and UI](#f11--dashboard-and-ui)
6. [Gap Analysis](#6-gap-analysis)
7. [Build Sequence and Milestones](#7-build-sequence-and-milestones)
8. [Security and Compliance](#8-security-and-compliance)
9. [Testing Requirements](#9-testing-requirements)
10. [Open Questions](#10-open-questions)

---

## 1. Executive Summary

SlideForge AI is an offline-first, agentic document intelligence platform designed for consulting firms. It replaces the senior consultant review cycle on standard deliverables by running a structured evaluation pipeline locally on Apple Silicon MacBooks — producing QA-scored, auto-remediated slide decks without any data leaving the device.

The system has four core value propositions:

- **Delivery acceleration:** Reduces the senior review loop from days to minutes by running automated structure audits, claim-evidence checks, data lineage verification, and language quality analysis in parallel.
- **Consistency at scale:** A signed guardrail artifact encodes firm standards, client preferences, and engagement-type rules — deployable to any consultant laptop with hash-verified integrity.
- **Institutional memory:** The adaptation loop accumulates failure patterns across engagements, feeding them back into prompt refinement so the system improves without retraining.
- **Data security by default:** All inference runs via MLX or CoreML. No API calls, no cloud dependencies after initial model download. Air-gap safe when environment variables are set correctly.

---

## 2. Problem Statement

### 2.1 The Senior Review Bottleneck

In a typical consulting engagement, a junior or mid-level consultant drafts a deliverable — a strategy deck, due diligence report, or operational review — and submits it for senior review. The senior consultant's review covers six distinct checks, each requiring different expertise and attention:

| Review dimension | What the senior checks | Current cost |
|---|---|---|
| Logic & structure | MECE decomposition, Pyramid Principle compliance, storyline coherence | 2–4 hours per deck |
| Claim grounding | Every factual claim traceable to a source; no hallucinated statistics | 1–2 hours per deck |
| Data accuracy | Chart figures match source Excel; no copy-paste errors | 30–90 mins per deck |
| Visual compliance | Brand adherence, logo placement, font rules, layout density | 30–60 mins per deck |
| Language quality | Grammar, tone consistency, consulting register, hedging language | 45–90 mins per deck |
| Client fit | Tone matches client communication style from past engagements | 20–40 mins per deck |

Across a typical engagement with 10–15 deliverables, senior review time totals 40–80 hours. This is expensive, creates a delivery bottleneck, and introduces inconsistency — different senior reviewers apply different standards.

### 2.2 The Security Constraint

Cloud-based AI tools (ChatGPT, Claude.ai, Gemini) are prohibited on most client engagements due to confidentiality obligations. Consultants cannot paste client data into external systems. This means the automation opportunity has been inaccessible until the maturation of on-device inference via Apple Silicon's Unified Memory architecture.

### 2.3 The Consistency Problem

Even when senior review is performed diligently, standards vary by reviewer. The firm has no systematic way to encode what "good" looks like for a given engagement type, client, or practice area. SlideForge solves this by making the review criteria explicit, versioned, and portable.

---

## 3. Goals and Non-Goals

### 3.1 Goals

- **G1:** Reduce senior review time by 70%+ on standard deliverable types within 6 months of deployment.
- **G2:** Achieve zero data egress — all inference, storage, and processing on-device.
- **G3:** Produce signed, portable guardrail artifacts deployable to any firm laptop with hash verification.
- **G4:** Support three engagement types at launch: strategy decks, due diligence reports, operational reviews.
- **G5:** Auto-remediate at least 60% of flagged issues without human intervention.
- **G6:** Surface language quality, grammar, tone, and consulting register issues inline in the dashboard and as native PPTX comments.

### 3.2 Non-Goals

- **NG1:** Fine-tuning or retraining models. All adaptation is prompt-level.
- **NG2:** Real-time collaboration or multi-user simultaneous editing.
- **NG3:** Integration with cloud document management (SharePoint, Google Drive) at launch.
- **NG4:** Support for non-Mac platforms at launch (Windows/Linux to follow).
- **NG5:** Automated chart regeneration from updated data. Auto-remediation covers layout and text; chart rebuilding is out of scope for v1.

---

## 4. Architecture Overview

The system is structured as a LangGraph `StateGraph` with five distinct phases. The graph is unidirectional except for the revision loop, which is a controlled cycle with an explicit attempt counter as a stopping criterion.

| Phase | Description | Type | Key tools |
|---|---|---|---|
| 0 — Parsing | Ingest all input files into structured representations | Deterministic | Docling, MinerU, python-pptx, openpyxl |
| 1 — Template discovery | Reverse-engineer guardrail schema from gold slides + playbook | Agentic | DeepSeek-R1 (MLX), ChromaDB, supervisor Q loop |
| 2 — Parallel analysis | Run four specialist agents concurrently | Agentic | LangGraph asyncio, MLX-LM, mlx-embeddings |
| 3 — QA scoring | Score deck against guardrail schema; check claim grounding and language | Hybrid | LanguageTool, Qwen/Mistral (MLX), vector retrieval |
| 4 — Revision loop | Auto-fix failing slides; iterate up to 3× then escalate | Agentic | python-pptx, LangGraph conditional edges, SQLite |

### 4.1 Technology Stack

| Layer | Component | Rationale |
|---|---|---|
| Orchestration | LangGraph (Python) | Native cyclic graph support for revision loop; checkpointing; parallel branches via asyncio; AgentMiddleware for guardrail hooks |
| LLM inference | MLX-LM (Apple Silicon) | Avoids Ollama's Metal shader compatibility issues on macOS 26; native Unified Memory; supports Qwen3, Mistral, DeepSeek-R1 distills |
| Vision inference | CoreML (via Ultralytics export) + mlx-vlm | CoreML for Neural Engine performance on structured vision tasks; mlx-vlm for VQA on charts/images |
| Document parsing | Docling / MinerU | Preserves table structure, layout hierarchy, and captions when converting PPTX/PDF to LLM-ready markdown |
| PPTX manipulation | python-pptx | Direct XML access for element coordinates, text box IDs, comment write-back, and auto-remediation |
| Grammar checking | LanguageTool (local Java server) | Deterministic, offline, 25+ language support; no LLM tokens spent on surface errors |
| Vector storage | ChromaDB (local) | Persistent RAG store for approved decks and playbook rules; namespaced per client |
| State persistence | SQLite | Session checkpoints, failure pattern logging, guardrail version history |
| API layer | FastAPI | Local REST API for dashboard; packageable as single executable |
| Dashboard UI | Streamlit (prototype) → React (production) | Slide viewer with inline highlights, score display, accept/override controls |

### 4.2 Agentic vs Deterministic Classification

Each pipeline section is classified as one of three types. This classification drives implementation decisions — agentic sections use LangGraph `StateGraph` with conditional edges; hybrid sections use single LLM calls within deterministic wrappers; deterministic sections are pure Python with no inference.

| Section | Classification | Reason |
|---|---|---|
| Document parsing | Deterministic | Fixed transformation — no decision-making required |
| Template discovery | **Agentic** | Multi-step: observe → hypothesise → ask supervisor → revise schema → decide to continue or close |
| Playbook extraction | Hybrid | Docling parse (deterministic) → reasoning model extracts rules → cross-verify (LLM) |
| Parallel analysis agents | **Agentic** | Each agent can call tools, re-query, and make routing decisions |
| Claim–evidence guardrail | Hybrid | Vector retrieval (deterministic) + entailment check (LLM) |
| Slide builder | Deterministic | Rule-driven coordinate manipulation — no decision-making |
| QA rubric scorer | Hybrid | Rule-based dimension scores + narrative coherence (LLM) |
| Revision loop | **Agentic** | Score → diagnose → rewrite → re-score → decide (pass / loop / escalate) |
| Pattern logger | Hybrid | SQLite write (deterministic) + prompt refinement suggestions (LLM) |
| Final output | Deterministic | File serialisation |

---

## 5. Feature Specifications

---

### F1 — Document Ingestion

> **Type:** Deterministic — no LLM calls in this phase

#### F1.1 Supported input formats

- Draft deck: `.pptx` (primary), `.pptx` converted from `.key` via LibreOffice
- Corporate playbook: `.pdf`, `.pptx`
- Source data: `.xlsx`, `.csv`
- Gold standard examples: `.pptx` (2–10 slides per example, up to 5 examples)

#### F1.2 Extraction requirements

- **Per-slide extraction:** all text runs with shape ID, text box ID, character start/end offset, font metadata, position (x, y, width, height in EMU)
- **Chart extraction:** embedded chart XML cache values, linked data range reference, chart type
- **Image extraction:** rasterise to PNG at 150 DPI for vision model input
- **Playbook extraction:** Docling full-document parse preserving headers, tables, figure captions; output as structured markdown with section hierarchy
- **Excel extraction:** all sheet names, named ranges, used cell values via openpyxl

#### F1.3 Input guardrail (pre-flight check)

Before any inference, the system validates inputs deterministically:

- **PII detection:** Scan all text for patterns matching email addresses, phone numbers, national ID formats (configurable regex per jurisdiction). Flag but do not block — consultant decides.
- **File integrity:** Validate PPTX ZIP structure; check for password protection; detect corrupted XML. Block and log if critical.
- **Context completeness:** Warn if no playbook or gold slides are provided. System can run without them but guardrail will be minimal.
- **Environment check:** Verify `TRANSFORMERS_OFFLINE=1` and `HF_DATASETS_OFFLINE=1` are set. Warn if not — silent network calls from Hugging Face cache are a security risk.

---

### F2 — Template Discovery Agent (Lazy Supervisor Mode)

> **Type:** Agentic — multi-step reasoning loop with supervisor interaction

The template discovery agent reverse-engineers a guardrail JSON schema from provided gold slides and/or a corporate playbook. It operates in two modes depending on what inputs are available.

#### F2.1 Gold slide mode (2–10 example slides provided)

The agent runs three parallel observations, synthesises into a hypothesis, then enters a targeted Q&A loop with the supervisor.

- **Visual clustering (CoreML):** Detect element positions across all gold slides. Identify elements that appear in consistent positions (logo, footer, page number, chart areas). Flag positional outliers.
- **Semantic clustering (DeepSeek-R1 via MLX):** Extract all text. Cluster headings by structure (observe whether they follow action-oriented, problem-solution, or descriptive patterns). Identify recurring phrases (`"Source:"`, `"Confidential"`, disclaimer text).
- **Style extraction (python-pptx):** Compute font name/size/colour frequency across all text runs. Record logo position and dimensions. Measure text density (text area ÷ slide area) per slide.

After observation, the reasoning model forms hypotheses as a draft schema, then enters the supervisor Q loop:

- Questions are targeted and binary (Yes/No/Modify) — never open-ended
- Each question includes the evidence that prompted it: *"I noticed all 3 slides have a 10pt footnote at y>18000. Should font size ≥ 10pt be a hard rule for all footer text?"*
- After each answer, the model updates the draft schema and decides: if new rules were found or existing rules were modified, continue; else close and write the schema
- Maximum 15 questions per session. Supervisor can terminate early
- Draft schema is shown to supervisor for final review before signing

#### F2.2 Playbook mode (PDF/PPTX playbook provided)

Docling parses the playbook to structured markdown. DeepSeek-R1 receives a system prompt instructing it to extract all mandatory design and content rules, categorise them (layout, typography, content, legal, tone), and flag any internal contradictions (e.g., "Use blue" on page 5 vs "Use navy" on page 50).

- Output is a structured rule list, not raw text
- Contradictions are surfaced to the supervisor as a separate review step before the schema is written
- Playbook rules are tagged with their source page/section for traceability

#### F2.3 Combined mode (both inputs provided)

Playbook rules form the base layer. Gold slide observations are used to validate and extend the playbook rules — if a playbook says "use Arial" but all gold slides use Calibri, this is flagged as a discrepancy before asking the supervisor which is authoritative.

#### F2.4 Guardrail schema structure

The output schema is a versioned JSON artifact with the following top-level fields:

```json
{
  "schema_version": "1.0.0",
  "engagement_type": "strategy | due_diligence | ops_review | custom",
  "client_namespace": "client-identifier",
  "discovered_patterns": {
    "visual": {},
    "semantic": {},
    "style": {}
  },
  "playbook_rules": [
    {
      "rule": "string",
      "source_page": "integer",
      "category": "layout | typography | content | legal | tone"
    }
  ],
  "human_confirmed_rules": [
    {
      "rule": "string",
      "confirmed_at": "ISO-8601",
      "severity": "hard_block | warning | suggestion"
    }
  ],
  "rubric_weights": {
    "structure": 0.25,
    "claim_grounding": 0.30,
    "data_accuracy": 0.20,
    "visual": 0.10,
    "language": 0.15
  },
  "language_rules": {
    "prohibited_phrases": [],
    "tone_register": "string",
    "citation_required_for": ["charts", "statistics"],
    "tone_drift_threshold": 0.72
  },
  "pass_threshold": 75,
  "signed_by": "Senior Evaluator Name",
  "signed_at": "ISO-8601",
  "sha256": "hash-of-all-fields-above"
}
```

---

### F3 — Parallel Analysis Agents

> **Type:** Agentic — each agent has tool access and multi-step decision capability

Four agents run concurrently via LangGraph asyncio. Each agent receives the parsed slide representations and the active guardrail schema. Each agent can call tools (ChromaDB, openpyxl, MLX inference) and make decisions based on intermediate results.

#### F3.1 Insight extractor

- Extracts every factual claim from slide text (statements with numbers, percentages, comparisons, causal assertions)
- For each claim, queries ChromaDB against source document chunks to find grounding evidence
- If no grounding is found after 2 retrieval attempts with different query formulations, marks the claim as `UNGROUNDED` (severity: hard block)
- Identifies the headline of each slide and evaluates whether it is action-oriented ("so what") vs descriptive — descriptive headlines are flagged as warnings

#### F3.2 Structure auditor

- Evaluates the deck's storyline as a sequence: extracts all slide headlines and checks whether they form a logical problem → diagnosis → recommendation arc
- Checks MECE compliance at each level of any framework slide: are sub-points collectively exhaustive and mutually exclusive?
- Flags slide sequences where the logic jumps (conclusion before evidence, recommendation without diagnosis)
- Scores overall narrative coherence on a 0–100 scale; scores below 60 trigger the revision agent

#### F3.3 Data lineage agent

- For each chart on each slide, extracts the embedded chart XML cache to get the values the chart is currently rendering
- Parses the chart's data range reference (e.g., `Sheet1!C3:C14`) and reads those cells from the source Excel file via openpyxl
- Compares chart cache values against live Excel values. Any mismatch > 0.5% is flagged as a hard block
- If no source Excel is provided, flags all charts as `UNVERIFIED` rather than blocking
- Also checks that every chart has a source citation in the caption or footnote, per guardrail language rules

#### F3.4 Visual analysis agent

- Rasterises each slide to PNG (150 DPI) and runs CoreML (exported YOLOv8n) to detect standard elements: logo, footer, page number, chart area, text box
- Validates detected element positions against guardrail layout rules (e.g., logo must be in top-right quadrant within 200px tolerance)
- Runs text density calculation: flags slides where text area > guardrail `max_text_density` threshold
- For charts and diagrams that contain embedded images (not native PPTX charts), uses mlx-vlm to extract visible data labels and trend direction for semantic verification
- Flags font inconsistencies by comparing extracted font metadata against guardrail typography rules

---

### F4 — Language Analysis Agent

> **Type:** Hybrid — deterministic grammar check + LLM language quality + embedding tone check

The language analysis agent runs as a fourth parallel agent alongside F3.1–F3.4. It operates three sub-agents internally.

#### F4.1 Grammar checker (LanguageTool)

- Runs LanguageTool via local Java server (`language_tool_python` client)
- Checks: spelling, punctuation, subject-verb agreement, article usage, hyphenation, comma splices
- Returns findings as structured list: `{slide_index, shape_id, run_start, run_end, text, rule_id, message, replacements}`
- Deterministic — same input produces same output. No LLM tokens consumed for surface errors
- Supports multilingual decks: language detected per slide, or overridden in guardrail settings

#### F4.2 Consulting language quality (local LLM)

A single LLM call per slide with a system prompt encoding consulting-specific language standards. The model returns structured JSON, not prose.

Patterns flagged as **warnings:**

| Pattern | Description |
|---|---|
| Hedging language | "it could potentially be argued", "may wish to consider", "there is a possibility that" — flag and suggest direct alternative |
| Passive without actor | "costs were reduced", "margins declined" — flag when the responsible party is omitted and the context requires attribution |
| Vague quantifiers | "significant", "substantial", "meaningful", "considerable" without a number — flag and require quantification |
| Recommendation without verb | Recommendation slides where the headline does not contain an action verb (manage, optimise, implement, divest, etc.) |
| Inconsistent person | Mixing first-person ("we recommend") with third-person ("the team suggests") within a single deck |

Patterns flagged as **hard blocks** (from guardrail `language_rules`):

- Prohibited phrases defined in the guardrail (e.g., specific competitor names, uncleared forward-looking statements)
- Legal disclaimer absent on slides containing financial projections (detected by keyword matching + LLM confirmation)

#### F4.3 Tone consistency (embedding-based)

- Embeds each slide's full text using a local embedding model (`mlx-embeddings` or `sentence-transformers`)
- Computes cosine similarity between each slide's embedding and the deck centroid (mean of all slide embeddings)
- Slides with cosine similarity < `tone_drift_threshold` (default: 0.72, configurable in guardrail) are flagged as tone drift warnings
- Flagged slides are passed to the LLM with a brief prompt to describe the register difference — produces a human-readable explanation for the dashboard
- Tone consistency score (mean pairwise cosine similarity across all slides) feeds into the QA rubric as the `language_score` dimension

#### F4.4 Annotation output schema

All three sub-agents write to a unified annotation schema:

```json
{
  "slide_index": "integer",
  "shape_id": "string",
  "run_start": "integer",
  "run_end": "integer",
  "text": "string (the flagged span)",
  "category": "grammar | hedging | passive | vague_quantifier | rec_no_verb | person_inconsistency | prohibited_phrase | legal_missing | tone_drift",
  "severity": "hard_block | warning | suggestion | pass",
  "message": "string (human-readable explanation)",
  "suggestion": "string (proposed rewrite, nullable)"
}
```

#### F4.5 PPTX comment write-back

- After QA scoring, all findings with severity `hard_block` or `warning` are written as native PowerPoint comments onto the relevant shape using python-pptx
- Comment body: `message` + `suggestion`. Comment author: `"SlideForge AI — [category]"`
- Allows reviewers to open the file directly in PowerPoint and work through flagged items without the dashboard
- `pass` findings are not written as comments — zero noise for clean slides

---

### F5 — Claim–Evidence Guardrail

> **Type:** Hybrid — vector retrieval (deterministic) + entailment check (LLM)

This guardrail node sits between the parallel analysis phase and the slide builder. It is the primary defence against hallucinated or unsupported claims.

- ChromaDB stores chunks of all source documents (playbook, client data files, any reference material provided at session start)
- For each `UNGROUNDED` claim flagged by the insight extractor, a retrieval query is run with two alternative phrasings. If neither retrieval returns a chunk with cosine similarity > 0.80, the claim is confirmed `UNGROUNDED` and escalated
- For claims where a retrieval hit exists, the LLM runs an entailment check: does the retrieved chunk actually support the claim, or does it just share keywords? This is a single yes/no call with chain-of-thought
- Failed entailment (chunk exists but doesn't support the claim) is a hard block — the revision agent must either rewrite the claim to match the evidence, or remove the claim
- Entailment failures are logged to SQLite with the claim text, the retrieved chunk, and the LLM's reasoning — this is valuable data for future prompt refinement

---

### F6 — QA Rubric Scorer

> **Type:** Hybrid — rule-based scoring (deterministic) + narrative coherence (LLM)

#### F6.1 Scoring dimensions

| Dimension | Source | Default weight | Pass threshold |
|---|---|---|---|
| Structure score | Structure auditor — narrative arc, MECE, headline quality | 25% | ≥ 70 |
| Claim grounding score | Insight extractor + claim-evidence guardrail | 30% | ≥ 85 (zero hard blocks) |
| Data accuracy score | Data lineage agent — chart vs Excel match | 20% | ≥ 95 (zero mismatches) |
| Visual compliance score | Visual analysis agent — layout, density, typography | 10% | ≥ 75 |
| Language score | Language analysis agent — grammar + quality + tone | 15% | ≥ 70 |

Weights are configurable per engagement type in the guardrail schema. A due diligence deck weights data accuracy higher (30%); a strategy deck weights structure and claim grounding higher.

#### F6.2 Score calculation rules

- Each dimension produces a 0–100 score
- Composite score = weighted average of all dimensions
- **Any hard block in any dimension sets the composite score to 0 regardless of other dimensions** — hard blocks are not averaged away
- Composite score is compared to the guardrail's `pass_threshold` (default: 75). Below threshold triggers the revision loop

#### F6.3 Score output

The scorer produces a QA scorecard JSON containing: `composite_score`, `dimension_scores`, `hard_block_count`, `warning_count`, `failing_slides` (list of slide indices with per-slide scores), and a human-readable summary paragraph generated by the LLM.

---

### F7 — Slide Builder and Auto-Remediation

> **Type:** Deterministic — rule-driven; no LLM calls for layout operations

#### F7.1 Auto-remediation capabilities

| Issue type | Remediation action | Confidence |
|---|---|---|
| Logo wrong position | Read guardrail layout rule → compute correct EMU coordinates → move shape via python-pptx | High |
| Font non-compliant | Iterate text runs → replace font name while preserving size/bold/colour | High |
| Footer missing | Insert footer text box at guardrail-specified position and style | High |
| Page number absent | Insert page number field at guardrail-specified position | High |
| Text density over limit | Flag for LLM rewrite — cannot auto-reduce text without losing meaning | N/A (escalates) |
| Chart source citation missing | Append `"Source: [placeholder]"` in guardrail-specified font below chart shape | Medium |
| Grammar error | Apply LanguageTool top replacement suggestion via python-pptx text run edit | Medium |
| Hedging language | Apply LLM-suggested rewrite to text run | Medium (flagged for review) |
| Vague quantifier | Flag with suggestion — cannot auto-quantify without data | N/A (escalates) |
| Ungrounded claim | Flag for consultant — system cannot invent supporting evidence | N/A (hard escalate) |

#### F7.2 Remediation workflow

- High-confidence remediations are applied automatically and logged
- Medium-confidence remediations are applied and shown to the consultant in the dashboard as "applied — please review"
- Escalation items (ungrounded claims, text density, vague quantifiers) are flagged in the dashboard with the specific slide and text — consultant must resolve manually
- After all remediations, the modified PPTX is saved as `deck_v{n}_remediated.pptx` — **the original is never overwritten**

---

### F8 — Revision Loop

> **Type:** Agentic — multi-step; the core senior-review-replacement loop

The revision loop is the most agentic component of the system. It implements the LangGraph conditional edge pattern: `score → diagnose → rewrite → re-score → decide (pass | loop | escalate)`.

- After the first QA score, if `composite_score < pass_threshold`, the revision agent activates
- The revision agent receives: the QA scorecard, the list of failing slides with per-slide dimension scores, and all flagged annotations
- It diagnoses why each slide failed and applies the appropriate remediation strategy
- After remediation, the slide builder runs again (F7), followed by a re-score (F6)
- The loop runs up to 3 times. Each iteration logs: attempt number, composite score before and after, which slides were modified, which issues resolved vs persisted
- If after 3 iterations the score is still below threshold, the system writes a failure summary and escalates to the human queue
- Hard blocks short-circuit the loop — they escalate immediately regardless of attempt count

#### F8.1 Revision agent LangGraph state

```python
class RevisionState(TypedDict):
    attempt_count: int                  # 0–3
    score_history: list[float]          # composite scores per attempt
    resolved_issues: list[str]          # annotation IDs resolved in previous iterations
    persistent_issues: list[str]        # annotation IDs unresolved after 2+ attempts
    escalation_required: bool
    deck_path: str                      # path to current working PPTX
    scorecard: dict                     # most recent QA scorecard
```

---

### F9 — Guardrail Portability and Distribution

> **Type:** Deterministic — portability is a file management and verification concern

A senior-evaluator-signed guardrail artifact is a portable, versioned JSON file that any system instance can load and run against.

#### F9.1 Signing workflow

1. Senior evaluator reviews the draft schema in the dashboard: rule-by-rule acceptance, weight adjustment, prohibited phrase additions
2. Evaluator provides their name and confirms sign-off via the UI
3. System serialises all fields in canonical order, computes SHA-256 hash, and appends `signed_by`, `signed_at`, and `sha256` fields
4. The artifact is written to the local guardrail registry (Git-tracked directory)

#### F9.2 Inheritance model

Three scope levels, loaded and merged in order (most specific wins on conflicts):

```
Firm-wide base
    └── Client layer          (extends firm-wide; may override specific rules)
            └── Engagement layer    (most specific; wins all ties)
```

- **Firm-wide base:** Brand, legal, tone-of-voice rules applicable to all engagements
- **Client layer:** Client-specific preferences, logo variant, communication style
- **Engagement layer:** Engagement-type scoring weights, specific prohibited phrases, data citation requirements

#### F9.3 Load-time verification

Any system loading a guardrail artifact must:

1. Strip the `sha256` field from the loaded JSON
2. Serialise remaining fields in canonical order
3. Compute SHA-256 hash
4. Compare against the stored `sha256` field
5. **Refuse to run if hashes do not match** — log the failure with timestamp and artifact path

#### F9.4 Access control

- Junior consultant instances load guardrails as read-only — no editing capability in the UI
- To propose a rule change, junior adds a `change_request` to a local queue JSON file — senior evaluator reviews the queue and approves/rejects via their instance
- Approved changes increment the patch version (e.g., `1.2.0 → 1.2.1`), are re-signed, and distributed
- The diff between any two versions is human-readable: which rules were added, modified, or removed

#### F9.5 Distribution methods

| Method | Recommended for |
|---|---|
| Local network folder | Same-office teams |
| Private Git repository | Multi-office or remote teams |
| Manual USB / secure file transfer | Fully air-gapped environments |

> Distribution tooling is out of scope for v1 — consultants copy the file manually. v2 will add a registry sync mechanism.

---

### F10 — Adaptation Loop

> **Type:** Hybrid — SQLite logging (deterministic) + prompt refinement suggestions (LLM)

The adaptation loop accumulates failure patterns over time and surfaces them as proposed prompt refinements. It does not autonomously modify any prompts or guardrail rules — all adaptations require evaluator approval.

- After every completed engagement, the pattern logger writes to SQLite: `engagement_type`, `client_namespace`, `score_history`, `resolved_issues`, `persistent_issues`, `revision_count`, `final_composite_score`
- At configurable intervals (default: every 10 engagements of the same type), the adaptation agent runs a summary analysis: which issue categories are most persistent? Which rules trigger false positives (flagged but immediately overridden)?
- The LLM generates a natural-language summary of observed patterns and 2–3 specific prompt refinement suggestions
- Suggestions are shown to the senior evaluator in the dashboard — **not applied automatically**
- Approved suggestions become new system prompt sections, versioned and stored in the guardrail registry

---

### F11 — Dashboard and UI

> **Type:** Product feature — the consultant-facing interface

#### F11.1 Core views

- **Slide viewer:** Thumbnail grid with inline colour-coded highlights per annotation category.
  - 🔴 Red: hard block
  - 🟠 Amber: warning
  - 🔵 Blue: suggestion
  - 🟢 Green: pass
- **Score panel:** Composite score + per-dimension breakdown. Score history chart if revision loop ran. Pass/fail badge.
- **Issue list:** Sorted by severity. Each item shows: slide number, category, the flagged text span, the message, the suggested fix. Accept / override / dismiss controls.
- **Guardrail view:** Read-only display of active guardrail schema with version and `signed_by`. Senior evaluators see edit + sign-off workflow here.
- **Audit log:** Full log of every agent action, tool call, score, and remediation for the current session — for debugging and compliance.

#### F11.2 Interaction model

| Action | Behaviour |
|---|---|
| Accept fix | Applies suggested remediation to PPTX and removes the annotation |
| Override | Dismisses annotation with a machine-readable reason from a dropdown — logged for adaptation loop |
| Export annotated PPTX | Produces deck with all accepted fixes applied and remaining warnings as native PPTX comments |
| Re-run analysis | Re-runs full pipeline on current state of the deck |
| Prepare for delivery | Strips all SlideForge comments and metadata; produces clean client-ready file |

---

## 6. Gap Analysis

### 6.1 Critical gaps — address before v1 launch

#### Multi-tenant guardrail namespace isolation
The design describes namespacing per client in ChromaDB but does not specify the enforcement mechanism. Without explicit namespace isolation, a bug in session configuration could bleed Client A's RAG context into a Client B engagement. This must be enforced at the API layer — session initialisation must specify a namespace, and all ChromaDB calls must be scoped to that namespace with no fallback to a global namespace.

#### Guardrail diff view for evaluators
When guardrail v1.3 differs from v1.2, the senior evaluator must see a human-readable diff — not a raw JSON diff. The dashboard needs a dedicated diff view showing: rules added (green), rules modified (amber with before/after), rules removed (red), and weight changes. Without this, evaluators will either rubber-stamp updates or re-read the entire schema each time.

#### Override feedback loop completeness
The adaptation loop relies on override logging to detect false positives. The current spec logs that an override happened but not the reason at a structured level. The override reason dropdown must produce machine-readable categories (not free text) so the adaptation agent can aggregate them meaningfully.

#### Packaging for consultant laptops
The system requires a Python environment, a local Java server (LanguageTool), and pre-downloaded model weights. For deployment to non-technical consultants, this must be packaged as a single executable. The setup experience must be: download one file, run one command, done. First-run model download should be guided with progress indicators and offline verification.

---

### 6.2 Important gaps — target v1.1

#### Table and text box data verification
The data lineage agent currently checks chart XML cache values against Excel. It does not verify data in PPTX tables or manually typed text boxes (e.g., a financial summary table on a key findings slide). Implementation: extract table cell text via python-pptx, identify numeric values, query ChromaDB for matching values in source documents.

#### Slide-level permission model for junior consultants
The current spec gives juniors read-only access to the guardrail but does not address the case where a junior needs to add client-specific context (e.g., a new client acronym that should not be flagged). There should be a lightweight mechanism for juniors to propose additions to a session-local allowlist, which the evaluator can promote to the guardrail schema.

#### Version control UI for guardrail registry
The spec assumes Git for guardrail versioning, but non-technical users should not be expected to use Git directly. The dashboard needs a simple version history view: list of past versions, who signed each, date, a one-click diff against the current version.

#### Presentation mode stripping
Before a deck is delivered to a client, all SlideForge comments and metadata must be stripped. A "prepare for delivery" action in the dashboard should: accept all remaining overrideable warnings, strip all comments, remove SlideForge metadata from PPTX file properties, and produce a clean final file.

---

### 6.3 Future considerations — v2 and beyond

- **Cross-document consistency:** If multiple deliverables are produced for the same engagement, check that key numbers and recommendations are consistent across documents, not just within each one.
- **Client-facing language localisation:** For non-English engagements, the consulting language quality check needs locale-specific prohibited phrase lists and tone rules.
- **Automated benchmark against past decks:** When a new deck is scored, benchmark it against the distribution of scores for the same engagement type from ChromaDB history.
- **Real-time editing integration:** Run lightweight analysis as the consultant edits — flagging issues as they type rather than only on full pipeline runs.
- **Windows and Linux support:** Replace MLX with ONNX Runtime (with DirectML or CUDA backend) for cross-platform support.
- **Cryptographic signing:** Replace the current name + timestamp sign-off with GPG signing for cryptographic non-repudiation of guardrail artifacts.

---

## 7. Build Sequence and Milestones

| Milestone | Deliverable | Effort | Key risk |
|---|---|---|---|
| M0 — Rubric annotation | Senior consultants annotate 20 past decks. Output: ground truth dataset for scoring validation. | 2 weeks (human time) | Evaluator availability |
| M1 — Parsing + extraction | Working python-pptx extractor with full annotation schema. LanguageTool integration. Data lineage agent (Excel ↔ chart). | 1.5 weeks | PPTX XML schema variation across Office versions |
| M2 — Guardrail schema + Q loop | Template discovery agent with DeepSeek-R1. Supervisor Q loop UI. Guardrail JSON writer + hash signer. | 2 weeks | Reasoning model quality on edge cases |
| M3 — Parallel analysis agents | All four analysis agents running in LangGraph asyncio. ChromaDB RAG store. Claim-evidence guardrail. | 3 weeks | MLX model selection and performance on M1 vs M4 |
| M4 — Language analysis agent | LanguageTool + LLM quality check + embedding tone consistency. Annotation write-back to PPTX. | 1.5 weeks | LLM prompt calibration for false positive rate |
| M5 — QA scorer + revision loop | Composite scorer with weighted dimensions. LangGraph revision loop with 3-attempt limit. Auto-remediation for high-confidence issues. | 2 weeks | Revision loop convergence on real decks |
| M6 — Dashboard MVP | FastAPI backend + Streamlit dashboard. Slide viewer, score panel, issue list, accept/override controls. | 2 weeks | Rendering PPTX slide thumbnails offline |
| M7 — Guardrail portability | Sign-off workflow, diff view, inheritance model, load-time hash verification. Junior read-only mode. | 1 week | Evaluator adoption of sign-off workflow |
| M8 — Packaging + pilot | Single-executable installer. Pilot with 3 consultants on live engagement. Collect override logs. | 2 weeks | Installation on managed corporate MacBooks |

**Total estimated engineering effort (single experienced Python developer): ~15–17 weeks.**
Two developers working in parallel on M3 (agents) and M4 (language) can compress this to ~11 weeks.

---

## 8. Security and Compliance

### 8.1 Data egress controls

- Set `TRANSFORMERS_OFFLINE=1` and `HF_DATASETS_OFFLINE=1` at application startup — verified during pre-flight check (F1.3)
- All model weights must be downloaded on a secure network before deployment to engagement laptops
- No logging to external services. All logs written to local SQLite only
- LanguageTool runs as a local Java process — no external API calls
- FastAPI dashboard binds to `127.0.0.1` only — not accessible from the network

### 8.2 PII handling

- PII detection on input (F1.3) flags but does not block — consultant decides whether to proceed
- Detected PII patterns are logged to a separate `pii_flags` table in SQLite, not to the main audit log
- No PII is included in any adaptation loop logging or prompt refinement suggestions

### 8.3 Guardrail artifact integrity

- SHA-256 hash is computed over canonical-ordered JSON excluding the hash field itself
- Any load-time hash mismatch is a hard block — the system does not run with an unverified guardrail
- The signing workflow records the evaluator's name and timestamp, creating an audit trail
- **v2 target:** GPG signing by the evaluator for cryptographic non-repudiation

---

## 9. Testing Requirements

### 9.1 Unit tests

- **Parsing:** each extractor function tested against a fixture PPTX with known element positions and text content
- **LanguageTool integration:** grammar checker tested against a fixture with 10 known errors across 5 error categories
- **Data lineage:** Excel ↔ chart comparison tested with a fixture deck + fixture Excel with 3 matching and 2 mismatching cells
- **Guardrail hash:** verify that any single-field modification in guardrail JSON fails hash verification
- **Annotation schema:** all agent outputs validated against the annotation JSON schema before entering the QA scorer

### 9.2 Integration tests

- Full pipeline run on 5 fixture decks (one per engagement type + 2 deliberate failure cases) — assert expected composite scores ±5 points
- Revision loop convergence test: fixture deck designed to fail on first run, pass on second — assert loop terminates at attempt 2 with score ≥ threshold
- Guardrail portability: write a guardrail on instance A, load on instance B — assert hash verification passes and scores are identical for same input deck

### 9.3 Evaluation against M0 ground truth

| Metric | Target |
|---|---|
| Agreement with senior evaluator on hard blocks | ≥ 80% |
| Agreement with senior evaluator on warnings | ≥ 70% |
| Warning false positive rate (overridden in pilot) | ≤ 15% |
| Hard block false negative rate (missed by system) | ≤ 10% |

---

## 10. Open Questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| OQ1 | Which three engagement types are in scope for v1? (Strategy / DD / ops review assumed — confirm with practice leads) | Product | Before M1 |
| OQ2 | Which local LLM is the default for language quality and structure analysis? Qwen3-8B vs Mistral-7B vs DeepSeek-R1-7B — need to benchmark on M1 16GB vs M3 Max 36GB to set the floor | Engineering | Before M3 |
| OQ3 | Is LanguageTool sufficient for grammar checking, or do we need domain-specific rules for financial/legal terminology? Legal review recommended | Product + Legal | Before M4 |
| OQ4 | What is the acceptable false positive rate for the language quality agent before consultants stop trusting it? Recommend surveying 3 senior consultants with a sample output before M8 | Product | Before M6 |
| OQ5 | Who are the senior evaluators who will sign guardrails? Their availability determines M2 completion. Need at least 2 evaluators for the pilot | Product | Before M2 |
| OQ6 | Is Git an acceptable distribution mechanism for guardrail artifacts, or do we need a simpler file-share approach for less technical teams? | Product | Before M7 |

---

*SlideForge AI PRD v1.0 — Confidential — For Internal Use Only*
