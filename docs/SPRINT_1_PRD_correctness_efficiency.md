# Sprint 1 PRD — Correctness & Efficiency

**Version:** 1.0
**Duration:** 2 weeks
**Owner:** Backend lead (primary), Frontend lead (secondary)
**Status:** Proposed
**Depends on:** None — entry sprint

---

## 1. Goal

Harden the LLM + analysis pipeline so it stops silently failing on transient errors, stops re-doing identical work, stops overwhelming local LLMs, and ships in a production Docker image. Everything in this sprint is a single-file or single-module change with no public API break.

## 2. Why now

- `httpx.AsyncClient` is constructed **per request** at [backend/app/services/llm_inference.py:355](../backend/app/services/llm_inference.py#L355) — every LLM call pays connection setup cost.
- No retry on transient `httpx.TimeoutException` / `NetworkError` — local LLMs stutter often; today the whole analysis aborts.
- Re-running analysis on a deck re-executes every LLM call (no cache), blowing 5–15 min per session.
- `asyncio.gather` over 30 slides spikes LM Studio to OOM on mid-range machines.
- Backend `Dockerfile` runs `uvicorn --reload` — dev flag in prod image.
- Frontend hand-maintains ~200 lines of TypeScript interfaces that drift from `schemas.py`.

## 3. Non-goals

- No module splits (that's Sprint 2).
- No UI changes (Sprint 2).
- No Electron work (Sprint 3).
- No new features — bug-fix + perf only.

## 4. Success metrics

| Metric | Baseline | Target |
|---|---|---|
| P95 full-deck analysis (20 slides, warm cache) | ~6 min | ≤ 90 s |
| LLM call retry success rate on transient errors | 0% (fails immediately) | ≥ 95% within 3 attempts |
| Identical-prompt cache hit rate on re-run | 0% | ≥ 90% |
| Docker image size | unmeasured | < 1.2 GB |
| TS interfaces in [services/apiService.ts](../services/apiService.ts) hand-written | ~35 | ≤ 5 (session/auth only) |

## 5. Deliverables

### 5.1 LLM layer hardening — [backend/app/services/llm_inference.py](../backend/app/services/llm_inference.py)

**5.1.1 Module-scoped `httpx.AsyncClient`**
- One client per `APILLM` instance, reused across calls.
- Explicit timeouts: `connect=5s`, `read=180s` (long enough for 7B local), `write=30s`, `pool=10s`.
- Keepalive limits: `max_keepalive_connections=8`, `max_connections=16`.
- Close cleanly on FastAPI shutdown via `app.on_event("shutdown")`.

**5.1.2 Retry with exponential backoff**
- Add `tenacity>=9.0` to [backend/pyproject.toml](../backend/pyproject.toml).
- Wrap `APILLM.generate` HTTP POST in `@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8), retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)))`.
- **Do not** retry on 4xx — treat as permanent.
- Log retry attempt number + error class at `WARNING`.

**5.1.3 Circuit breaker (per provider)**
- After 5 consecutive failures in 60s, open circuit; return `LLMProviderUnavailable` immediately for 30s.
- Surface via `/api/settings/local-llm/diagnostics`.
- Use `pybreaker>=1.2` or a 30-line custom implementation (prefer custom — one dep less).

**5.1.4 JSON parse robustness**
- Replace brute-force bracket scan in `parse_json_response` at [llm_inference.py:11](../backend/app/services/llm_inference.py#L11) with `json-repair>=0.30` (falls back to current logic on import failure).
- Target: <1% parse failure rate on 7B-model JSON output (currently ~8% observed).

### 5.2 Agent result cache — **new** `backend/app/services/llm_cache.py`

**5.2.1 Design**
- SQLite-backed, stored at `{DATA_DIR}/llm_cache.sqlite`.
- Key: `sha256(provider || model || prompt_template || input_hash)`.
- Value: JSON blob of `LLMResponse`.
- TTL: configurable per-caller, default 14 days.
- Size cap: 500 MB with LRU eviction on insert.

**5.2.2 Integration points**
- `InsightExtractor`, `StructureAuditor`, `DataLineageAgent`, `VisualAnalysisAgent` in [backend/app/agents/parallel_analysis.py](../backend/app/agents/parallel_analysis.py) each gain a `@cached_llm_call` decorator.
- Invalidation triggers: guardrail change (via `_invalidate_session_analysis`), manual `/api/admin/cache/clear`.

**5.2.3 Observability**
- Log hit/miss per call at `DEBUG`.
- Expose counters at `/api/admin/cache/stats`: `hits`, `misses`, `size_bytes`, `entries`.

### 5.3 Concurrency control

**5.3.1 Global semaphore**
- Add `LLM_MAX_CONCURRENCY` setting, default `2`.
- Wrap all calls to `inference_service.llm.generate` with `asyncio.Semaphore`.
- For remote APIs (`InferenceProvider.API`), allow override to `8`.

**5.3.2 Slide-level batching**
- In `ParallelAnalysisOrchestrator` at [parallel_analysis.py:1476](../backend/app/agents/parallel_analysis.py#L1476), replace unbounded `asyncio.gather(*slide_tasks)` with `asyncio.gather` gated on the semaphore.

### 5.4 Frontend type generation

**5.4.1 Tooling**
- Add `openapi-typescript@^7` to `devDependencies` in [package.json](../package.json).
- New npm script: `"gen:api": "openapi-typescript http://127.0.0.1:8002/openapi.json -o services/api.generated.ts"`.
- Commit the generated file; CI regenerates and diffs.

**5.4.2 Migration**
- Replace hand-written `Annotation`, `SlideData`, `GuardrailResponse`, `ScorecardResponse`, `HistoryItem`, `SessionMetricsResponse` etc. in [services/apiService.ts](../services/apiService.ts) with imports from `api.generated.ts`.
- Keep only façade types that don't 1:1 map to API (e.g. UI-only view models in [types.ts](../types.ts)).

### 5.5 Docker production image

**5.5.1 [backend/Dockerfile](../backend/Dockerfile)**
- Multi-stage build: `builder` (compiles wheels) + `runtime` (slim).
- Non-root `app` user.
- Use `uv sync --frozen --no-dev` against committed `uv.lock`.
- Remove `--reload` flag.
- `HEALTHCHECK` hitting `/api/health`.
- Expose port 8000 only.

**5.5.2 [Dockerfile](../Dockerfile) (frontend)**
- Multi-stage: Node builder → nginx:alpine static.
- Remove `npm run dev` — serve built assets.
- Only used in Docker Compose scenarios; Electron will embed differently.

### 5.6 Logging hygiene

**5.6.1 Redaction**
- Ensure no `api_key`, `Authorization` header value ever appears in logs.
- Add a `RedactingFormatter` applied to the root logger in [backend/app/main.py:81](../backend/app/main.py#L81).

**5.6.2 Request IDs**
- FastAPI middleware injects `x-request-id` (uuid4 if absent) into logs via `contextvars`.

## 6. Acceptance criteria

- [ ] Re-running analysis on an unchanged deck completes in < 10s (cache hit path).
- [ ] Killing LM Studio for 20s during analysis does not abort the run (retry or circuit-breaker fallback).
- [ ] `docker build -t slideforge:test .` produces an image that starts, serves `/api/health`, and contains no files writable by root processes.
- [ ] `npm run gen:api && git diff --exit-code services/api.generated.ts` is clean after backend changes are published.
- [ ] `pytest backend/tests` passes with new `test_llm_cache.py`, `test_llm_retry.py`, `test_concurrency.py`.
- [ ] Grep confirms no `api_key` substring in captured log output during integration test.

## 7. Test plan

| Test | Level | New/Existing |
|---|---|---|
| `test_llm_retry_transient_failure` | Unit | New — mock `httpx` to raise TimeoutException twice then succeed |
| `test_llm_circuit_breaker_opens` | Unit | New |
| `test_cache_hit_on_repeat_prompt` | Integration | New |
| `test_cache_invalidation_on_guardrail_change` | Integration | New |
| `test_semaphore_serializes_local_llm` | Integration | New — assert timestamps sequential when `LLM_MAX_CONCURRENCY=1` |
| `test_json_repair_handles_trailing_comma` | Unit | New |
| `test_openapi_contract_stable` | CI gate | New — fails if schema drifts without regen |
| Existing `test_agents.py`, `test_language_agent.py`, `test_models.py` | Regression | Keep green |

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `tenacity` retries mask real config errors | Med | Med | Classify 4xx as non-retryable; log on first retry |
| Cache key collision on prompt template edits | Low | High (stale output) | Include module version in key: `CACHE_SCHEMA_VERSION = "1"` |
| SQLite lock contention under concurrent writes | Low | Med | WAL mode: `PRAGMA journal_mode=WAL`, single writer pool |
| `json-repair` changes output silently | Low | Low | Keep bracket-scan fallback; test suite pins expected outputs |
| openapi-typescript breaks on custom schema types | Med | Low | Pin generator version; add `// @ts-expect-error` escape hatches if needed |

## 9. Rollout

- Branch: `sprint-1/llm-hardening`.
- No feature flags needed — all changes are strict improvements.
- Dog-food internally for 48h before merging to `main`.
- Tag release `v0.2.0`.

## 10. Out of scope / deferred

- Module splits → Sprint 2.
- Durable sessions → Sprint 2.
- Electron packaging → Sprint 3.
- Code signing, auto-update, telemetry → Sprint 4.
