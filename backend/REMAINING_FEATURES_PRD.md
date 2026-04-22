# SlideForge AI — Remaining Features PRD
## Implementation Guide for Gemini 2.5 Flash

> **Status:** Active Development
> **Scope:** 18% of original PRD not yet implemented
> **Model:** Gemini 2.5 Flash (gemini-2.5-flash-preview-05-20 or gemini-2.0-flash)
> **Last Updated:** March 2026

---

## How to Use This PRD with Gemini Flash

Each feature below contains a **"Gemini Prompt"** block — a ready-to-paste prompt engineered for Gemini 2.5 Flash. Follow these rules when using it:

1. **Always paste the full prompt** — do not summarise it; Flash needs the schema context
2. **Paste existing file contents first** when the prompt says `[PASTE FILE]`
3. **One feature at a time** — do not combine prompts; Flash loses precision on long multi-task prompts
4. **Ask for JSON output** — Flash handles structured output well; use `response_mime_type: "application/json"` in API calls when generating schemas
5. **Validate before integrating** — Flash can hallucinate import paths; always check generated `import` statements match your actual file structure
6. **Use temperature 0.2** for code generation — lower temperature = fewer hallucinations on boilerplate

---

## Build Order

Follow this exact sequence. Later features depend on earlier ones.

```
Phase 1 — Backend gaps (no UI dependency)
  GAP-01  PDF Ingestion
  GAP-02  Environment Pre-flight Check
  GAP-03  LanguageTool Integration
  GAP-04  Embedding-based Tone Consistency

Phase 2 — Frontend core workflows (highest user impact)
  GAP-05  Issue List Panel with Accept / Override
  GAP-06  Guardrail View + Sign-off UI
  GAP-07  Prepare for Delivery action

Phase 3 — Advanced UI views
  GAP-08  Supervisor Q-Loop UI (Template Discovery)
  GAP-09  Guardrail Diff View
  GAP-10  Audit Log View

Phase 4 — Access control
  GAP-11  Junior Read-only Mode
  GAP-12  Override Reason Structured Categories
```

---

## Phase 1 — Backend Gaps

---

### GAP-01 — PDF Ingestion

**PRD Reference:** F1.1, F1.2
**Current state:** `/api/session/{id}/analyze` returns `"pdf_not_yet_supported"`
**File to modify:** `backend/app/services/document_ingestion.py`
**File to modify:** `backend/app/main.py` (the `analyze_deck` endpoint)

#### What to build

Add a `ingest_pdf()` method to `DocumentIngestionService` that:
- Uses `pdfplumber` (already compatible with offline use) to extract text per page
- Treats each PDF page as one "slide" in the unified slide schema
- Extracts: page text, any tables, image references (base64 PNG raster of the page at 150 DPI)
- Returns the same `DeckContent` dataclass that `ingest_pptx()` returns so the rest of the pipeline is unchanged
- In `main.py`, route `.pdf` files to `ingest_pdf()` instead of returning the unsupported error

#### Data model — no changes needed
The existing `SlideData`, `TextBox`, `ChartData`, `TableData` dataclasses are reused. PDF pages have no charts, so `charts = []`. Tables from pdfplumber map directly to `TableData`.

#### Acceptance criteria
- Upload a 5-page PDF → get back 5 slides in the session
- Each slide has `full_text` populated
- Tables on PDF pages are extracted to `tables[]`
- Pipeline continues to analysis without error

---

**Gemini Prompt — GAP-01:**

```
You are a Python backend engineer. I need you to add PDF ingestion to an existing FastAPI service.

EXISTING DATACLASSES (from document_ingestion.py):
- TextBox(id, text, x, y, width, height, runs=[])
- TableData(table_id, title, text, rows, columns)
- ChartData(chart_id, chart_type, title, cache_values=[], data_range_ref=None)
- SlideData(slide_index, title, text_boxes=[], charts=[], tables=[], images=[], width, height)
- DeckContent(slides=[SlideData], raw_text="")

TASK:
Write a method `async def ingest_pdf(self, file_path: str) -> DeckContent` for the class `DocumentIngestionService`.

Requirements:
1. Use `pdfplumber` library (pip install pdfplumber)
2. Each PDF page becomes one SlideData with slide_index = page number (0-based)
3. Extract full page text → create ONE TextBox per page with id="tb_page_{n}", x=0, y=0, width=595, height=842 (A4 EMU approximation)
4. Extract tables using pdfplumber's extract_tables() → map to TableData with table_id="tbl_{page}_{i}", rows=len(rows), columns=len(rows[0]) if rows else 0, text=str(table)
5. Rasterise each page to PNG at 150 DPI using pdfplumber's page.to_image() → store as base64 string in an ImageElement (id="img_page_{n}")
6. charts=[] for all pages (PDFs have no native chart XML)
7. Return DeckContent(slides=[...], raw_text=full concatenated text)

Also write the update to main.py's analyze_deck() function:
- Current code: `if deck_path.endswith(".pptx"):` with elif for PDF returning unsupported
- New code: route `.pdf` to `await ingestion_service.ingest_pdf(deck_path)` using the same slides_data building loop as PPTX

Use async/await pattern. Handle pdfplumber exceptions with try/except, raising HTTPException(500).

Return only the two code blocks: the method and the updated analyze_deck function.
```

---

### GAP-02 — Environment Pre-flight Check

**PRD Reference:** F1.3
**Current state:** No env variable validation exists anywhere
**File to modify:** `backend/app/main.py` (startup event)
**File to create:** `backend/app/core/preflight.py`

#### What to build

A `preflight_check()` function called at FastAPI startup (`@app.on_event("startup")`) that:
- Checks `TRANSFORMERS_OFFLINE` and `HF_DATASETS_OFFLINE` env vars — logs `WARNING` if not set to `"1"`
- Verifies the data directory is writable
- Checks SQLite DB is accessible
- Checks ChromaDB directory exists
- Logs all results to stdout in a structured format
- Does NOT block startup — all findings are warnings only (consultant decides)

---

**Gemini Prompt — GAP-02:**

```
Write a Python module `preflight.py` for a FastAPI application.

The module must contain one function: `run_preflight_checks() -> dict`

It checks the following and returns a dict of results:

1. ENV_OFFLINE: Check os.environ.get("TRANSFORMERS_OFFLINE") == "1" and os.environ.get("HF_DATASETS_OFFLINE") == "1". If either is missing, status="WARNING", message="Offline mode not enforced — Hugging Face may make network calls"

2. DATA_DIR_WRITABLE: Accept data_dir path as parameter. Try writing a temp file. status="OK" or status="ERROR"

3. CHROMADB_DIR: Check if data/chromadb directory exists. status="OK" or status="MISSING" (MISSING is a warning, not error — will be created on first use)

4. PYTHON_VERSION: Check sys.version_info >= (3, 11). status="OK" or "WARNING"

Return structure:
{
  "timestamp": "ISO-8601",
  "checks": [
    {"name": "ENV_OFFLINE", "status": "OK|WARNING|ERROR", "message": "..."},
    ...
  ],
  "overall": "OK|WARNING|ERROR"  # ERROR if any check is ERROR, WARNING if any WARNING, else OK
}

Also write the FastAPI startup hook to add to main.py:
```python
@app.on_event("startup")
async def startup_event():
    from app.core.preflight import run_preflight_checks
    results = run_preflight_checks(data_dir=str(data_dir))
    for check in results["checks"]:
        if check["status"] != "OK":
            import logging
            logging.warning(f"[PREFLIGHT] {check['name']}: {check['message']}")
```

No external dependencies beyond stdlib. Return only the module code and the startup hook.
```

---

### GAP-03 — LanguageTool Integration

**PRD Reference:** F4.1
**Current state:** `_check_grammar()` uses ~5 hardcoded regex rules. Should use LanguageTool Java server.
**File to modify:** `backend/app/agents/language_analysis.py`
**File to create:** `backend/app/services/language_tool_client.py`

#### What to build

A `LanguageToolClient` class that:
- Connects to a locally running LanguageTool server (default: `http://localhost:8081`)
- Calls the `/v2/check` REST endpoint with `text` and `language` params
- Parses the response into the existing `Annotation` schema
- Has a `is_available()` method that pings the server — if unavailable, falls back gracefully to the existing regex method
- In `LanguageAnalysisAgent._check_grammar()`, try `LanguageToolClient` first; fall back to regex if not available

#### LanguageTool server setup (document for the team)
```bash
# Download LanguageTool standalone server
wget https://languagetool.org/download/LanguageTool-stable.zip
unzip LanguageTool-stable.zip
# Run the server
java -jar LanguageTool-*/languagetool-server.jar --port 8081 --allow-origin '*'
```

#### Acceptance criteria
- If Java server running: grammar check calls `/v2/check` and maps `matches` array to `Annotation` objects
- If Java server down: falls back to regex silently; logs one warning
- Response maps: `match.message` → `Annotation.message`, `match.replacements[0].value` → `Annotation.suggestion`, `match.context.offset` → `run_start`

---

**Gemini Prompt — GAP-03:**

```
Write a Python class `LanguageToolClient` for a FastAPI backend.

LanguageTool server exposes a REST API at http://localhost:8081/v2/check
Request (POST form-encoded): text=<string>&language=en-US
Response JSON structure:
{
  "matches": [
    {
      "message": "string",
      "shortMessage": "string",
      "replacements": [{"value": "string"}],
      "offset": int,
      "length": int,
      "context": {"text": "string", "offset": int, "length": int},
      "rule": {"id": "string", "category": {"id": "string"}}
    }
  ]
}

Existing Annotation dataclass (from models/schemas.py):
```python
class Annotation(BaseModel):
    slide_index: int
    shape_id: str = ""
    run_start: int = 0
    run_end: int = 0
    text: str
    category: str  # "grammar" for all LanguageTool results
    severity: str  # "warning" for most, "hard_block" if rule category is TYPOS
    message: str
    suggestion: Optional[str] = None
```

Requirements for LanguageToolClient:
1. `__init__(self, base_url="http://localhost:8081", timeout=5.0)` — use httpx for async HTTP
2. `async def is_available(self) -> bool` — GET /v2/languages; return True if 200
3. `async def check(self, text: str, slide_index: int, language="en-US") -> list[Annotation]`
   - POST to /v2/check
   - Map each match to Annotation
   - skip matches where rule.id starts with "WHITESPACE" (too noisy)
   - severity = "hard_block" if match.rule.category.id == "TYPOS" else "warning"
4. Handle connection errors: raise LanguageToolUnavailableError (custom exception)

Then write the update to LanguageAnalysisAgent._check_grammar() method:
- Try LanguageToolClient().check() first
- Catch LanguageToolUnavailableError → fall back to existing regex _check_grammar_regex() (rename current _check_grammar to _check_grammar_regex)
- Log one warning per session if fallback is used (use a class-level flag to avoid repeating)

Use httpx.AsyncClient. Return both class implementations.
```

---

### GAP-04 — Embedding-based Tone Consistency

**PRD Reference:** F4.3
**Current state:** `_check_tone_llm()` sends a generic LLM prompt per slide. No cosine similarity, no cross-deck consistency check.
**File to modify:** `backend/app/agents/language_analysis.py`

#### What to build

Replace `_check_tone_llm()` with a proper embedding-based tone check:
- After all slides are individually analyzed, compute embeddings for each slide's full text using `sentence-transformers` (model: `all-MiniLM-L6-v2`, ~80MB, works offline)
- Compute the deck centroid (mean of all slide embeddings)
- For each slide, compute cosine similarity between its embedding and the centroid
- Slides with similarity < `tone_drift_threshold` (from guardrail, default `0.72`) → flag as `tone_drift` annotation
- For flagged slides, call LLM once to generate a human-readable explanation (not one call per slide)
- Add `tone_consistency_score` (mean pairwise cosine similarity, 0–100) to the language result

#### Why this matters
The LLM-per-slide approach currently costs tokens on every slide. The embedding approach is deterministic, fast, and matches the PRD spec for the `tone_drift_threshold` guardrail field.

---

**Gemini Prompt — GAP-04:**

```
I need to replace a per-slide LLM tone check with an embedding-based cross-deck tone consistency check.

CURRENT CODE (to replace):
```python
async def _check_tone_llm(self, text: str, slide_index: int) -> list[Annotation]:
    # ... makes one LLM call per slide
```

CURRENT CALL SITE in analyze_deck():
```python
tone_issues = await self._check_tone_llm(text, slide_index)
result.tone_issues = tone_issues
```

TASK: Write a new method `async def check_tone_consistency(self, slides_texts: list[str], tone_drift_threshold: float = 0.72) -> tuple[list[Annotation], float]`

Requirements:
1. Use sentence-transformers library: `from sentence_transformers import SentenceTransformer`
2. Load model lazily (cache on self._embedding_model): `SentenceTransformer('all-MiniLM-L6-v2')`
3. Encode all slides: `embeddings = self._embedding_model.encode(slides_texts)` → shape (n_slides, 384)
4. Compute centroid: `centroid = embeddings.mean(axis=0)`
5. For each slide, compute cosine similarity to centroid using sklearn.metrics.pairwise.cosine_similarity
6. Slides where similarity < tone_drift_threshold → create Annotation:
   - category="tone_drift", severity="warning"
   - message=f"Slide tone diverges from deck average (similarity: {sim:.2f}, threshold: {threshold})"
   - suggestion=None (LLM call below handles this)
7. If any drift detected: make ONE LLM call with all flagged slide texts to get register descriptions. Prompt: "For each of these consulting slide texts, in one sentence describe how its tone differs from a standard executive consulting register. Return JSON array of strings, one per slide." Map responses back to Annotation.suggestion for each flagged slide.
8. Compute tone_consistency_score = mean pairwise cosine similarity * 100 (int 0-100)
9. Return (list[Annotation], tone_consistency_score)

Also write the updated analyze_deck() method signature showing where to call check_tone_consistency:
- Collect all slide texts into a list
- Call check_tone_consistency() ONCE after per-slide analysis (not inside the per-slide loop)
- Add returned annotations to all_annotations
- Return tone_consistency_score in LanguageResult

Handle ImportError for sentence-transformers gracefully: if not installed, skip tone check and return score=100.
```

---

## Phase 2 — Frontend Core Workflows

---

### GAP-05 — Issue List Panel with Accept / Override

**PRD Reference:** F11.1, F11.2
**Current state:** `Dashboard.tsx` shows a score chart but has no issue list. Backend endpoints `POST /api/session/{id}/accept` and `POST /api/session/{id}/override` exist but are never called from the frontend.
**File to modify:** `backend/app/main.py` (update `/api/session/{id}/run-analysis` response to include annotations)
**File to create:** `SlideForge-AI/components/IssuePanel.tsx`
**File to modify:** `SlideForge-AI/components/Dashboard.tsx` (add IssuePanel)
**File to modify:** `SlideForge-AI/services/apiService.ts` (add accept/override calls)

#### Current API contract

```
GET  /api/session/{id}/scorecard
→ { composite_score, dimension_scores, annotations: [...], hard_block_count, warning_count }

POST /api/session/{id}/accept?annotation_id=<text>
→ { status: "accepted", applied_count: 1 }

POST /api/session/{id}/override?annotation_id=<text>&category=<str>&reason=<str>&slide_index=<int>
→ { status: "recorded" }
```

#### Annotation schema (from backend)
```typescript
interface Annotation {
  slide_index: number;
  shape_id: string;
  text: string;              // the flagged text span
  category: string;          // "grammar" | "hedging" | "passive" | "tone_drift" | "quality" | ...
  severity: "hard_block" | "warning" | "suggestion" | "pass";
  message: string;
  suggestion: string | null;
}
```

#### What to build — `IssuePanel.tsx`

A right-side panel component showing:
- **Filter tabs:** All | Hard Blocks | Warnings | Suggestions (with counts)
- **Issue cards** (one per annotation), sorted by severity then slide index:
  - Severity badge (red/amber/blue)
  - Category label (e.g., "Grammar", "Hedging Language")
  - Flagged text in a monospace quote block
  - Message below the text
  - Suggestion (if non-null) in a green box
  - Two action buttons: **Accept Fix** and **Dismiss**
- Accepting removes the card and calls `POST /accept`
- Dismissing shows a 3-option reason dropdown first, then calls `POST /override`

#### Dismiss reason options (structured — fixes GAP-12)
```typescript
const DISMISS_REASONS = [
  { value: "false_positive", label: "False positive — rule doesn't apply here" },
  { value: "client_exception", label: "Client preference — allowed for this engagement" },
  { value: "already_fixed", label: "Already addressed manually" },
];
```

---

**Gemini Prompt — GAP-05a (IssuePanel component):**

```
Write a React TypeScript component `IssuePanel.tsx` using Tailwind CSS.

TYPES:
```typescript
interface Annotation {
  slide_index: number;
  shape_id: string;
  text: string;
  category: string;
  severity: "hard_block" | "warning" | "suggestion" | "pass";
  message: string;
  suggestion: string | null;
}

interface IssuePanelProps {
  annotations: Annotation[];
  onAccept: (annotationId: string) => Promise<void>;
  onDismiss: (annotationId: string, reason: string) => Promise<void>;
}
```

DISMISS_REASONS = [
  { value: "false_positive", label: "False positive" },
  { value: "client_exception", label: "Client preference" },
  { value: "already_fixed", label: "Already fixed manually" },
]

COMPONENT REQUIREMENTS:
1. Filter tabs at top: "All", "Hard Blocks", "Warnings", "Suggestions" — each shows count badge
   - Tab styling: active tab has indigo-600 border-bottom and text, inactive is slate-400
2. Sort annotations: hard_block first, then warning, then suggestion; within each group sort by slide_index ascending
3. Each annotation card:
   - Left border color: red-500 for hard_block, amber-400 for warning, blue-400 for suggestion
   - Header row: severity badge (pill) + category label (capitalize and replace _ with space) + "Slide {n}" right-aligned
   - Flagged text in a <code> block with bg-slate-100 rounded px-2 py-1 text-sm font-mono
   - message in text-slate-600 text-sm mt-1
   - If suggestion != null: green box (bg-green-50 border border-green-200 rounded p-2 text-sm text-green-800) showing "Suggested fix: {suggestion}"
   - Action buttons at bottom:
     - "Accept Fix" button: only show if suggestion != null. indigo filled button. On click → call onAccept(annotation.text) → remove card from list
     - "Dismiss" button: slate outline button. On click → show inline reason dropdown (select from DISMISS_REASONS) + "Confirm Dismiss" button → call onDismiss(annotation.text, reason) → remove card
4. Empty state: "No issues found" with a green checkmark icon if filtered list is empty
5. Panel has a sticky header with total count: "X Issues Found"

Use useState for filter tab, dismiss state (which annotation is in dismiss mode, selected reason).
Use lucide-react icons: AlertTriangle (hard_block), AlertCircle (warning), Info (suggestion), CheckCircle2 (empty state).
Export as default. No external libraries except React, lucide-react, Tailwind.
```

---

**Gemini Prompt — GAP-05b (apiService.ts additions):**

```
I have an existing TypeScript file `apiService.ts` in a React app. Add these three methods to the existing `apiService` object.

Base URL is already defined as: `const BASE_URL = 'http://localhost:8000'`
Session ID is passed as parameter.

Methods to add:

1. `async acceptFix(sessionId: string, annotationId: string): Promise<void>`
   - POST `${BASE_URL}/api/session/${sessionId}/accept?annotation_id=${encodeURIComponent(annotationId)}`
   - No request body needed (query params only)
   - Throw error if response not ok

2. `async dismissAnnotation(sessionId: string, annotationId: string, category: string, reason: string, slideIndex: number): Promise<void>`
   - POST `${BASE_URL}/api/session/${sessionId}/override?annotation_id=${encodeURIComponent(annotationId)}&category=${category}&reason=${encodeURIComponent(reason)}&slide_index=${slideIndex}`
   - Throw error if response not ok

3. `async getScorecard(sessionId: string): Promise<Scorecard>`
   - GET `${BASE_URL}/api/session/${sessionId}/scorecard`
   - Return the JSON response typed as:
     ```typescript
     interface Scorecard {
       composite_score: number;
       dimension_scores: Record<string, number>;
       annotations: Annotation[];
       hard_block_count: number;
       warning_count: number;
     }
     ```

Write only the three method implementations to add to the existing apiService object.
Use async/await with fetch. No external HTTP libraries.
```

---

### GAP-06 — Guardrail View + Sign-off UI

**PRD Reference:** F11.1 (Guardrail view)
**Current state:** No frontend guardrail management exists
**File to create:** `SlideForge-AI/components/GuardrailView.tsx`
**File to modify:** `SlideForge-AI/components/Dashboard.tsx` (add tab/panel)

#### What to build

A panel with two modes: **Read-only** (default) and **Sign-off** (senior evaluator)

**Read-only view shows:**
- Schema version, engagement type, client namespace
- `signed_by` name + `signed_at` date (or "Unsigned" badge if not signed)
- List of `human_confirmed_rules` grouped by severity (hard_block / warning / suggestion)
- List of `playbook_rules` grouped by category
- Rubric weights as a horizontal bar chart (5 bars)
- Language rules section: prohibited phrases, tone register, tone drift threshold

**Sign-off mode adds:**
- Text input for evaluator name
- "Sign Guardrail" button → calls `POST /api/guardrail/{session_id}/sign?signer_name=<name>`
- After signing: shows SHA-256 hash confirmation, download button for `.json` file

---

**Gemini Prompt — GAP-06:**

```
Write a React TypeScript component `GuardrailView.tsx` using Tailwind CSS.

PROPS:
```typescript
interface GuardrailViewProps {
  sessionId: string;
  guardrail: GuardrailSchema | null;
  onSigned: (updatedGuardrail: GuardrailSchema) => void;
}

interface GuardrailSchema {
  schema_version: string;
  engagement_type: string;
  client_namespace: string | null;
  playbook_rules: Array<{ rule: string; source_page?: number; category: string }>;
  human_confirmed_rules: Array<{ rule: string; confirmed_at?: string; severity: string }>;
  rubric_weights: Record<string, number>;
  language_rules: {
    prohibited_phrases?: string[];
    tone_register?: string;
    tone_drift_threshold?: number;
  };
  pass_threshold: number;
  signed_by: string | null;
  signed_at: string | null;
  sha256: string | null;
}
```

COMPONENT REQUIREMENTS:

Header section:
- Title "Guardrail Schema" with version badge (schema_version)
- Engagement type chip + client namespace chip (if not null)
- Signed status: if signed_by → show green "Signed by {name} on {date}" badge; else show amber "Unsigned" badge

Rubric weights section:
- Title "Scoring Weights"
- For each weight: label (capitalize key), percentage value, a horizontal progress bar (indigo-500)
- Total must show as 100%

Rules section (two columns):
- Left: "Confirmed Rules" grouped by severity. Each rule as a card with colored left border. Count header per group.
- Right: "Playbook Rules" grouped by category. Each as a list item with category chip.

Language rules section:
- tone_register as text
- tone_drift_threshold as a number
- prohibited_phrases as a tag cloud (each phrase in a red-100 pill)

Sign-off section (always visible at bottom):
- If already signed: show the sha256 hash in a monospace block truncated to 16 chars + "..." + "Copy" button
- If unsigned: show text input "Evaluator Name" + "Sign Guardrail" button
  - On click: POST to `http://localhost:8000/api/guardrail/${sessionId}/sign?signer_name=${encodeURIComponent(name)}`
  - On success: call onSigned() with response JSON, show success toast
  - Download button: creates JSON blob from guardrail data, triggers browser download as `guardrail_${engagement_type}_${schema_version}.json`

If guardrail prop is null: show a centered message "No guardrail loaded — upload a playbook or use template discovery"

Use useState for signerName input, signing loading state.
Use lucide-react: Shield (header icon), CheckCircle2 (signed), AlertTriangle (unsigned), Copy.
Export as default.
```

---

### GAP-07 — Prepare for Delivery Action

**PRD Reference:** F11.2 (Prepare for delivery)
**Current state:** `POST /api/session/{id}/prepare` exists in backend. Not wired in frontend.
**File to modify:** `SlideForge-AI/components/Dashboard.tsx` (the Export PPTX button)

#### What to build

Replace the non-functional "Export PPTX" button in the Dashboard header with two actions:
1. **Download Annotated** — downloads PPTX with SlideForge comments → calls `GET /api/session/{id}/download`
2. **Prepare for Delivery** — strips all SlideForge metadata → calls `POST /api/session/{id}/prepare` → shows a confirmation modal explaining what will be stripped → then triggers file download

---

**Gemini Prompt — GAP-07:**

```
I have a React Dashboard component. The header currently has non-functional buttons. Replace the export button area with working download functionality.

CURRENT BUTTON CODE (to replace):
```tsx
<button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors">
  <Download className="w-4 h-4" /> Export PPTX
</button>
```

REPLACE WITH two buttons and a modal:

Props needed (add to DashboardProps interface):
```typescript
sessionId: string | null;
```

Button 1 — "Download Annotated" (outline button, slate colors):
- On click: fetch GET `http://localhost:8000/api/session/${sessionId}/download`
- Response is a binary PPTX file (blob)
- Trigger browser download with filename "SlideForge_annotated.pptx"
- Show loading spinner while downloading

Button 2 — "Prepare for Delivery" (filled indigo button):
- On click: show a confirmation modal (centered, backdrop blur)
- Modal content:
  - Title: "Prepare Clean Delivery Copy"
  - Description: "This will create a clean version of your deck with all SlideForge comments removed, metadata stripped, and notes cleared. The original file is unchanged."
  - Checklist (with CheckCircle2 icons): "Remove all SlideForge comments", "Strip file metadata", "Clear speaker notes containing SlideForge content"
  - Two buttons: "Cancel" (close modal) and "Create Delivery Copy" (indigo)
- On confirm: POST to `http://localhost:8000/api/session/${sessionId}/prepare`
  - Response: { status: "ready", output_path: string }
  - Then fetch GET the output file and trigger download as "SlideForge_delivery_ready.pptx"
  - Show success toast: "Delivery copy ready — all SlideForge metadata removed"
- Loading state on the confirm button while in flight

Write only the replacement button JSX + modal JSX + the two handler functions (handleDownloadAnnotated, handlePrepareDelivery).
Use fetch API, Blob, URL.createObjectURL for file downloads. Use useState for modal open state and loading states.
```

---

## Phase 3 — Advanced UI Views

---

### GAP-08 — Supervisor Q-Loop UI (Template Discovery)

**PRD Reference:** F2.1 — Binary Q&A loop with supervisor
**Current state:** `POST /api/template/discover` is a one-shot call. No interactive Q&A.
**File to create:** `SlideForge-AI/components/TemplateDiscovery.tsx`
**Backend change needed:** `backend/app/main.py` — add a session-scoped Q-loop endpoint

#### What to build (backend)

Add two new endpoints:

```python
POST /api/template/start-discovery
  body: { gold_slides?: list[dict], playbook_text?: str, engagement_type: str }
  response: { discovery_session_id: str, first_question: str, evidence: str, draft_schema: dict }

POST /api/template/answer-question
  body: { discovery_session_id: str, answer: "yes" | "no" | "modify", modification?: str }
  response: {
    done: bool,           # True when agent decides to close
    next_question?: str,  # None if done
    evidence?: str,
    updated_schema: dict,
    question_count: int
  }
```

Store discovery session state in memory (dict keyed by discovery_session_id), max 15 questions.

#### What to build (frontend)

A wizard-style component:
- **Step 1:** Upload gold slides or paste playbook text (or both)
- **Step 2:** Q&A chat interface showing binary questions from the agent
  - Question displayed in large text
  - Evidence panel below (smaller, grey)
  - Three buttons: Yes / No / Modify (opens text input)
  - Progress bar: "Question X of max 15"
- **Step 3:** Final schema review — shows the discovered rules in GuardrailView read-only, with a "Save as Active Guardrail" button

---

**Gemini Prompt — GAP-08 (backend endpoints):**

```
Add two FastAPI endpoints to an existing main.py for an interactive template discovery Q-loop.

Existing import to use:
```python
from app.agents.template_discovery import template_discovery_agent
```

The template_discovery_agent already has these methods:
- await template_discovery_agent.discover_from_gold_slides(gold_slides) → GuardrailSchema
- await template_discovery_agent.discover_from_playbook(playbook_text) → GuardrailSchema

TASK: Add a simulated Q-loop on top by intercepting the discovery process.

Add at module level: `discovery_sessions: dict = {}`

Endpoint 1: POST /api/template/start-discovery
- Body params: gold_slides: list[dict] = None, playbook_text: str = None, engagement_type: str = "strategy"
- Run the appropriate discover_* method to get an initial GuardrailSchema
- Generate the first question by calling the LLM with this prompt:
  "Based on this draft guardrail schema, generate the single most important binary Yes/No clarification question for the senior evaluator. Format: JSON with fields 'question' (string) and 'evidence' (string explaining what you observed that prompted this question)."
  Pass the schema as context.
- Store in discovery_sessions[uuid]: { schema, questions_asked: 0, max_questions: 15, done: False }
- Return: { discovery_session_id, first_question, evidence, draft_schema: schema.model_dump() }

Endpoint 2: POST /api/template/answer-question
- Body: discovery_session_id: str, answer: str (yes/no/modify), modification: str = None
- Retrieve session, increment questions_asked
- If answer == "modify": call LLM to update schema based on modification instruction
- If questions_asked >= max_questions or answer == "yes" (confirming the last schema is good): set done=True
- Else: generate next question using LLM same as above
- Return: { done, next_question (None if done), evidence (None if done), updated_schema, question_count }

Use the existing inference_service from app.services.llm_inference.
Parse LLM response JSON safely (handle markdown code block wrapping).
```

---

### GAP-09 — Guardrail Diff View

**PRD Reference:** F6.2 (section gap analysis) — human-readable diff
**Current state:** `GET /api/guardrail/diff` endpoint returns JSON diff. No UI.
**File to create:** `SlideForge-AI/components/GuardrailDiff.tsx`

#### What to build

A comparison view showing two guardrail versions side by side or as a change list:
- **Rules added** (green background)
- **Rules modified** (amber background, showing before → after)
- **Rules removed** (red background with strikethrough)
- **Weight changes** (inline, showing old % → new %)
- Load from file picker (two file inputs: "Old Version" and "New Version")
- Calls `GET /api/guardrail/diff?old_path=<>&new_path=<>`

---

**Gemini Prompt — GAP-09:**

```
Write a React TypeScript component `GuardrailDiff.tsx` using Tailwind CSS.

The component shows a human-readable diff between two guardrail versions.

PROPS:
```typescript
interface GuardrailDiffProps {
  sessionId: string;  // used to find guardrail files
}
```

API call: GET `http://localhost:8000/api/guardrail/diff?old_path=${encodeURIComponent(oldPath)}&new_path=${encodeURIComponent(newPath)}`
Response:
```typescript
interface DiffResult {
  old_version: string;
  new_version: string;
  diff: {
    added_rules: Array<{ rule: string; category: string }>;
    removed_rules: Array<{ rule: string; category: string }>;
    modified_rules: Array<{ old: string; new: string; category: string }>;
    weight_changes: Record<string, { old: number; new: number }>;
    threshold_change?: { old: number; new: number };
  };
}
```

COMPONENT:
1. Two text inputs at top: "Old guardrail path" and "New guardrail path" + "Compare" button
2. Version badge row: "v{old} → v{new}" with arrow icon
3. Summary row: X added (green chip), Y removed (red chip), Z modified (amber chip)
4. Changes list:
   - ADDED rules: green-50 bg, green left border, "+" prefix, category chip
   - REMOVED rules: red-50 bg, red left border, "−" prefix, strikethrough text
   - MODIFIED rules: amber-50 bg, amber left border, show old text (slate, strikethrough) and new text (slate-800) with "→" between
5. Weight changes section: for each changed dimension, show "Structure: 25% → 30%" in a row with up/down arrow (green if increased, red if decreased)
6. If no diff data: show "Select two guardrail files to compare"
7. If no changes: show green "Versions are identical"

Loading state on Compare button. Error state if API fails.
Use lucide-react: Plus, Minus, ArrowRight, ArrowUp, ArrowDown, GitCompare (header).
Export as default.
```

---

### GAP-10 — Audit Log View

**PRD Reference:** F11.1 — Audit log of every agent action and remediation
**Current state:** Logs go to stdout and SQLite adaptation_loop table. No UI.
**File to create:** `SlideForge-AI/components/AuditLog.tsx`
**Backend change:** Add `GET /api/session/{id}/audit-log` endpoint

#### What to build (backend)

```python
GET /api/session/{session_id}/audit-log
response: {
  entries: [
    { timestamp: ISO, event_type: str, detail: str, score?: float }
  ]
}
```

Build this log by collecting from the session dict during analysis. Add logging calls at key points:
- After document parse: `{ event_type: "PARSE_COMPLETE", detail: f"{n} slides parsed" }`
- After each agent: `{ event_type: "AGENT_COMPLETE", detail: "Structure auditor: 3 findings" }`
- After QA score: `{ event_type: "QA_SCORE", detail: "Composite: 72", score: 72 }`
- After revision: `{ event_type: "REVISION", detail: "Attempt 1: score 72 → 81" }`
- After accept/override: `{ event_type: "ANNOTATION_DECISION", detail: "Accepted grammar fix on slide 3" }`

Store as `session["audit_log"] = []` and append throughout the request lifecycle.

---

**Gemini Prompt — GAP-10:**

```
Write a React TypeScript component `AuditLog.tsx` using Tailwind CSS.

PROPS:
```typescript
interface AuditEntry {
  timestamp: string;  // ISO-8601
  event_type: string; // "PARSE_COMPLETE" | "AGENT_COMPLETE" | "QA_SCORE" | "REVISION" | "ANNOTATION_DECISION" | "PREFLIGHT"
  detail: string;
  score?: number;
}

interface AuditLogProps {
  sessionId: string;
  isVisible: boolean;
}
```

API: GET `http://localhost:8000/api/session/${sessionId}/audit-log`
Poll every 3 seconds while isVisible and sessionId is set (use setInterval in useEffect, clear on cleanup).

COMPONENT:
1. Header: "Audit Log" + auto-refresh indicator (spinning icon when polling)
2. Filter row: chips for event types — "All", "Parse", "Agents", "Scoring", "Decisions"
3. Timeline list (newest first):
   - Each entry: timestamp (HH:MM:SS format) in monospace slate-400 | event_type badge | detail text
   - Badge colors: PARSE → blue, AGENT_COMPLETE → purple, QA_SCORE → indigo, REVISION → amber, ANNOTATION_DECISION → green, PREFLIGHT → slate
   - If score is present: show score as a mini pill badge (green if ≥75, amber if 50-74, red if <50)
4. Empty state: "No events yet — upload a deck to begin"
5. "Copy to clipboard" button at top right → copies all log entries as plain text

Timeline items use a vertical line connector between them (like a GitHub commit timeline).
Timestamps formatted with: new Date(ts).toLocaleTimeString()
Use lucide-react: Activity (header), Clock (timestamps), Copy.
Export as default.
```

---

## Phase 4 — Access Control

---

### GAP-11 — Junior Read-only Mode

**PRD Reference:** F9.4
**Current state:** No role-based access. Any user can sign guardrails.
**File to modify:** `backend/app/main.py` (add role header check to sign endpoint)
**File to modify:** `SlideForge-AI/App.tsx` (add role selection to app init)

#### What to build

Simple role model (no authentication — this is a local app):
- On first load, show a role picker: "Senior Evaluator" vs "Consultant"
- Store in localStorage as `slideforge_role`
- Pass as `X-User-Role: senior | junior` header with every API call
- Backend reads the header and blocks `POST /api/guardrail/sign` if role is `junior` (returns 403)
- Frontend: in GuardrailView, hide sign-off section if role is `junior`

---

**Gemini Prompt — GAP-11:**

```
I need to add a simple role system to an existing React + FastAPI app. No authentication — role is self-selected and stored in localStorage.

TASK 1 — React: Role Picker component
Write `RolePicker.tsx`:
- Shown on first load (if localStorage.getItem("slideforge_role") is null)
- Full-screen centered modal on slate-900 backdrop
- Two large cards to click:
  Card 1: "Senior Evaluator" — Shield icon, description "Full access: sign guardrails, approve suggestions, create engagement templates"
  Card 2: "Consultant" — User icon, description "Review and annotate decks, accept/dismiss findings, export annotated PPTX"
- On click: localStorage.setItem("slideforge_role", "senior" or "junior") → call onRoleSelected(role) prop
- Styling: white card, hover:border-indigo-500, selected state with indigo ring

TASK 2 — React: Update apiService.ts
Add a helper at the top:
```typescript
const getRole = () => localStorage.getItem("slideforge_role") || "junior";
const authHeaders = () => ({ "X-User-Role": getRole() });
```
Add `...authHeaders()` to the headers of every existing fetch call.

TASK 3 — FastAPI: Role guard
Write a FastAPI dependency:
```python
from fastapi import Header, HTTPException
async def require_senior(x_user_role: str = Header(default="junior")):
    if x_user_role != "senior":
        raise HTTPException(status_code=403, detail="Senior evaluator access required")
```
Apply to: POST /api/guardrail/{session_id}/sign, POST /api/patterns/approve-suggestion, POST /api/template/answer-question

Write all three tasks separately. Export RolePicker as default component.
```

---

### GAP-12 — Override Reason Structured Categories

**PRD Reference:** Section 6.1 gap — "override reason must be machine-readable categories"
**Current state:** `POST /api/session/{id}/override` accepts free-text `reason` string. Adaptation loop cannot aggregate.
**This is already solved by GAP-05** — the IssuePanel uses the structured `DISMISS_REASONS` enum.
**Backend change:** Validate `reason` is one of the allowed values.

---

**Gemini Prompt — GAP-12:**

```
Update the override endpoint in FastAPI main.py to validate that the reason field is one of an allowed set of structured categories.

CURRENT ENDPOINT SIGNATURE:
```python
@app.post("/api/session/{session_id}/override")
async def record_override(
    session_id: str,
    annotation_id: str,
    category: str,
    reason: str,       # currently free text — needs validation
    slide_index: int,
):
```

TASK:
1. Add an enum:
```python
from enum import Enum
class OverrideReason(str, Enum):
    false_positive = "false_positive"
    client_exception = "client_exception"
    already_fixed = "already_fixed"
```
2. Change `reason: str` to `reason: OverrideReason` in the endpoint signature
3. FastAPI will automatically return 422 if an invalid value is passed

Also update the SQLite log call in adaptation_agent.log_override_decision() to store reason.value (the string) not the enum object.

Write only the enum definition and the updated endpoint signature line. One sentence explaining the 422 behaviour.
```

---

## Testing Checklist (for each GAP)

After implementing each gap, validate with this checklist:

| GAP | Test |
|-----|------|
| GAP-01 | Upload a PDF → confirm slide_count > 0 in response |
| GAP-02 | Start server without TRANSFORMERS_OFFLINE set → confirm WARNING in logs |
| GAP-03 | Start LanguageTool server → upload deck with "data is showing" → confirm grammar annotation returned |
| GAP-03 | Stop LanguageTool server → confirm fallback to regex, no crash |
| GAP-04 | Upload deck where slide 5 is intentionally off-topic → confirm tone_drift annotation on slide 5 |
| GAP-05 | Run analysis → confirm issue panel shows cards → click Accept → confirm card disappears → confirm Dismiss shows dropdown |
| GAP-06 | Load guardrail view → confirm rules visible → enter name → click Sign → confirm sha256 displayed |
| GAP-07 | Click "Prepare for Delivery" → confirm modal → confirm → confirm file download |
| GAP-08 | Start discovery → confirm first question → answer Yes → confirm schema updates |
| GAP-09 | Select two guardrail files → confirm green/red/amber change display |
| GAP-10 | Run analysis → open audit log → confirm events appear in timeline |
| GAP-11 | Select Consultant role → confirm Sign Guardrail section hidden → confirm API returns 403 on sign attempt |
| GAP-12 | POST /override with reason="random text" → confirm 422 response |

---

## Dependencies to Add

```bash
# Backend — add to pyproject.toml / requirements
pdfplumber>=0.10.0          # GAP-01: PDF parsing
httpx>=0.27.0               # GAP-03: LanguageTool HTTP client (may already be present)
sentence-transformers>=3.0  # GAP-04: Embedding-based tone check

# Frontend — add to package.json
# No new npm packages needed — all gaps use existing React/Tailwind/lucide-react
```

---

## File Map Summary

| GAP | New files | Modified files |
|-----|-----------|----------------|
| GAP-01 | — | `backend/app/services/document_ingestion.py`, `backend/app/main.py` |
| GAP-02 | `backend/app/core/preflight.py` | `backend/app/main.py` |
| GAP-03 | `backend/app/services/language_tool_client.py` | `backend/app/agents/language_analysis.py` |
| GAP-04 | — | `backend/app/agents/language_analysis.py` |
| GAP-05 | `SlideForge-AI/components/IssuePanel.tsx` | `SlideForge-AI/components/Dashboard.tsx`, `SlideForge-AI/services/apiService.ts` |
| GAP-06 | `SlideForge-AI/components/GuardrailView.tsx` | `SlideForge-AI/components/Dashboard.tsx` |
| GAP-07 | — | `SlideForge-AI/components/Dashboard.tsx`, `SlideForge-AI/services/apiService.ts` |
| GAP-08 | `SlideForge-AI/components/TemplateDiscovery.tsx` | `backend/app/main.py` |
| GAP-09 | `SlideForge-AI/components/GuardrailDiff.tsx` | — |
| GAP-10 | `SlideForge-AI/components/AuditLog.tsx` | `backend/app/main.py` |
| GAP-11 | `SlideForge-AI/components/RolePicker.tsx` | `SlideForge-AI/App.tsx`, `SlideForge-AI/services/apiService.ts`, `backend/app/main.py` |
| GAP-12 | — | `backend/app/main.py` |

---

*Last Updated: March 2026*
*Total gaps: 12 | Estimated effort with Gemini Flash: 3–5 days per developer*
