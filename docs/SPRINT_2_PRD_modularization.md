# Sprint 2 PRD — Modularization & Durability

**Version:** 1.0
**Duration:** 3 weeks
**Owner:** Backend lead + Frontend lead
**Status:** Proposed
**Depends on:** Sprint 1 complete (cache, retry, type-gen in place)

---

## 1. Goal

Break the two largest files ([backend/app/main.py](../backend/app/main.py), 4,056 lines and [components/Dashboard.tsx](../components/Dashboard.tsx), 1,604 lines) into maintainable modules, replace in-memory sessions with SQLite-backed durability, and introduce a first-class data layer on the frontend (TanStack Query). These changes make Sprint 3 (Electron) and Sprint 4 (prod) feasible.

## 2. Why now

- A 4,056-line `main.py` with 70+ routes cannot be reviewed, tested, or hot-reloaded incrementally. Every change risks regressions across unrelated domains.
- `Dashboard.tsx` has **43 `useState`/`useEffect`/fetch sites** with no cache, no request cancellation, no retry. Users report "stale data after upload" and "double-submit" bugs that all stem from this.
- Sessions live in process memory (see `_get_session_or_404` in [backend/app/main.py:321](../backend/app/main.py#L321)). Closing the app drops in-flight work — unacceptable for a desktop product.
- `parallel_analysis.py` at 1,785 lines with 4 agents + 3 orchestrators in one file is equally painful to test.

## 3. Non-goals

- No new product features.
- No change to the JSON shape of any public API endpoint. (Internal refactor only — OpenAPI schema stays stable.)
- No Electron work (Sprint 3).

## 4. Success metrics

| Metric | Baseline | Target |
|---|---|---|
| Largest backend file | 4,056 lines (`main.py`) | ≤ 600 lines |
| Largest agent file | 1,785 lines (`parallel_analysis.py`) | ≤ 500 lines |
| Largest frontend file | 1,604 lines (`Dashboard.tsx`) | ≤ 400 lines |
| Fetch call sites in Dashboard tree | 43 direct | 0 direct; all via query hooks |
| Session survives backend restart | No | Yes |
| Mean test file cold-run time | unmeasured | ≤ 8s |

## 5. Deliverables

### 5.1 Backend API router split — [backend/app/main.py](../backend/app/main.py)

**5.1.1 Target layout**
```
backend/app/
├── main.py                 # ≤ 150 lines: FastAPI app, middleware, include_router
├── core/
│   ├── config.py           # Settings class + env loading
│   ├── logging.py          # structured logger, redaction, request-id middleware
│   ├── lifespan.py         # startup/shutdown hooks (was @app.on_event)
│   ├── session_store.py    # Session CRUD, TTL, cleanup, capacity enforcement
│   └── dependencies.py     # require_senior, get_session, etc.
├── api/
│   ├── __init__.py         # assembles the single APIRouter
│   ├── sessions.py         # /session/create, /upload, /analyze, /slides, /evidence
│   ├── analysis.py         # /run-analysis, /scorecard, /slide/*/analysis, /revision
│   ├── guardrail.py        # /guardrail/*, templates, diff, sign
│   ├── history.py          # /history/*
│   ├── discovery.py        # /template/discover/*
│   ├── settings.py         # /settings/local-llm/*, /settings/analysis
│   ├── admin.py            # /admin/*, /health
│   └── downloads.py        # /download, /download-package, /prepare
└── services/               # unchanged
```

**5.1.2 Contract**
- Each router module exports one `router = APIRouter(prefix="/api", tags=["..."])`.
- `api/__init__.py` exports `api_router` that includes all sub-routers; `main.py` calls `app.include_router(api_router)` once.
- Shared helpers currently inlined in `main.py` (`_get_session_or_404`, `_touch_session`, `_build_annotation_id`, `_clone_slide_payloads_for_session`, etc.) move to `core/session_store.py` or a new `core/annotations.py`.

**5.1.3 Ground rules**
- No endpoint path, method, or JSON schema may change. Verify by diffing `openapi.json` before/after.
- Every moved helper gets a unit test covering its existing behavior before the move.

### 5.2 Agent package split — [backend/app/agents/parallel_analysis.py](../backend/app/agents/parallel_analysis.py)

**5.2.1 Target layout**
```
backend/app/agents/
├── base.py                 # AnalysisState, AgentResult, _llm, shared utils
├── insight.py              # InsightExtractor
├── structure.py            # StructureAuditor
├── data_lineage.py         # DataLineageAgent
├── visual.py               # VisualAnalysisAgent
└── orchestrators.py        # ParallelAnalysisOrchestrator, QAGradingOrchestrator, RevisionOrchestrator
```
Old `parallel_analysis.py` becomes a compatibility shim that re-exports from the new modules for one release, then removed.

### 5.3 Durable session store — **new** [backend/app/core/session_store.py](../backend/app/core/session_store.py)

**5.3.1 Schema (SQLite)**
```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  client_namespace TEXT,
  status TEXT NOT NULL,          -- idle | parsing | analyzing | complete | expired
  created_at REAL NOT NULL,
  last_accessed REAL NOT NULL,
  deck_fingerprint TEXT,
  state_json TEXT NOT NULL       -- the current in-memory session dict
);
CREATE INDEX idx_sessions_last_accessed ON sessions(last_accessed);
CREATE INDEX idx_sessions_namespace ON sessions(client_namespace);
```
- Large artifacts (slide images, parsed text) stay on disk at `{DATA_DIR}/sessions/{session_id}/`; the DB row points to them.
- Writes are debounced (200ms) — in-memory dict remains source-of-truth during a request; persisted at request boundary.

**5.3.2 Migration path**
- New setting `SESSION_PERSISTENCE=sqlite|memory` (default `sqlite`).
- On startup, load non-expired rows into memory cache. TTL + capacity enforcement unchanged.
- Existing in-memory ops keep the same Python signatures so router code is untouched.

**5.3.3 Crash recovery**
- On boot, sessions with `status IN ('parsing','analyzing')` older than 60s are marked `failed` and cleaned up.
- `/api/session/{id}/resume` added for future use (not wired to UI this sprint).

### 5.4 Frontend — TanStack Query + Dashboard split

**5.4.1 Install**
- Add `@tanstack/react-query@^5` and `@tanstack/react-query-devtools` to [package.json](../package.json).
- Root `QueryClientProvider` in [index.tsx](../index.tsx) with `staleTime: 30s`, `retry: 2`, `refetchOnWindowFocus: false`.

**5.4.2 Query hooks — new `services/queries/`**
```
services/queries/
├── sessions.ts      # useSession, useSlides, useSlideAnalysis, useScorecard
├── guardrail.ts     # useGuardrail, useGuardrailTemplates, useGuardrailDiff
├── history.ts       # useHistory, useOpenHistory
├── settings.ts      # useLlmProvider, useAnalysisSettings, useGrammarStatus
└── mutations.ts     # useUploadDeck, useAcceptFix, useDismissAnnotation, ...
```
Every fetch in `apiService.ts` gets a matching hook. Components consume hooks, not `apiService` directly.

**5.4.3 Dashboard split — [components/Dashboard.tsx](../components/Dashboard.tsx)**
Target: parent `Dashboard.tsx` ≤ 200 lines, composing:
```
components/dashboard/
├── ScorecardHeader.tsx       # composite score, dimension bars
├── SlideGrid.tsx             # SlideCanvas list + navigation
├── IssuePanel.tsx             # already exists — hook into query
├── EvidencePanel.tsx          # already exists — hook into query
├── GuardrailView.tsx          # already exists — hook into query
├── AuditLog.tsx               # already exists — hook into query
├── CouncilPanel.tsx           # already exists — hook into query
└── hooks/
    └── useDashboardState.ts   # URL/route state (selected slide, filters)
```

**5.4.4 Cancellation & invalidation**
- Every mutation calls `queryClient.invalidateQueries` on the relevant keys (e.g. accepting a fix invalidates `['scorecard', sessionId]`).
- All fetches accept `{ signal }` from React Query; pass through to `fetch(..., { signal })`.

### 5.5 Frontend state shape (non-query)

**5.5.1 `useReducer`-based app state**
- Replace the 7 `useState` calls in [App.tsx](../App.tsx) with a reducer in `state/appReducer.ts`.
- Transitions: `UPLOAD → PROCESSING → DASHBOARD`, error paths explicit.
- Progress events move from local state to an async iterator exposed by `useAnalysisRun(sessionId)`.

## 6. Acceptance criteria

- [ ] `wc -l backend/app/main.py` ≤ 150.
- [ ] `wc -l backend/app/agents/*.py` — no file > 500 lines.
- [ ] `wc -l components/Dashboard.tsx` ≤ 200.
- [ ] `diff <(curl pre-refactor/openapi.json) <(curl post-refactor/openapi.json)` — no changes.
- [ ] E2E test `tests/e2e/run_all_e2e.py` passes against refactored backend.
- [ ] `grep -rn "fetch(" components/` returns 0 matches (all via hooks).
- [ ] Killing and restarting the backend mid-analysis preserves the session row; user re-opens via `/history` and sees "resumable" state.
- [ ] React Query Devtools shows expected cache behavior under a 10-click UX script.

## 7. Test plan

| Test | Level | New/Existing |
|---|---|---|
| Router integration — all 70+ endpoints hit correct handler | Integration | New (golden-file `openapi.json` + per-route smoke) |
| `session_store.persist_reload_roundtrip` | Unit | New |
| `session_store.expired_sessions_cleaned_on_boot` | Unit | New |
| `session_store.capacity_limits_enforced` | Unit | Existing — ported |
| `useScorecard_refetches_after_accept_fix` | RTL | New |
| `useSlides_cancels_on_unmount` | RTL | New |
| E2E: upload → analyze → restart backend → resume | E2E | New |
| Existing backend `test_*.py` | Regression | All green |

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Router move introduces subtle dependency-injection bugs | High | High | Land in 8-10 PRs, one router at a time, each with green CI + manual E2E |
| SQLite write contention on large artifacts | Low | Med | Artifacts stay on disk; DB stores only metadata. WAL mode. |
| React Query misuse causes over-fetching | Med | Low | Code review checklist; staleTime defaults + devtools in dev |
| Frontend refactor blocks feature work | Med | Med | Keep `apiService` class alive for 1 release cycle; hooks wrap it |
| Behavior drift in extracted `_build_dynamic_slide_scorecard` etc. | Med | High | Golden-file tests before/after move; compare against 10 fixture decks |

## 9. Rollout

- Branch strategy: one PR per router module; merges to `sprint-2/modularization` integration branch.
- After all splits land, run 48h of dog-fooding on integration branch.
- Merge to `main` as squash; tag `v0.3.0`.
- One-week grace period where old `parallel_analysis.py` re-exports for backward compatibility, then removed in `v0.3.1`.

## 10. Out of scope

- New persistence backends (Postgres etc.) — SQLite only.
- GraphQL — REST stays.
- Real-time progress over WebSockets — Sprint 3 may add.
- UI visual redesign — pure refactor, look/feel unchanged.
