# SlideForge AI — 4-Sprint Production Roadmap

High-level index for the per-sprint PRDs. Read this first for context; each sprint PRD is self-contained with deliverables, acceptance criteria, and risks.

| Sprint | Theme | Duration | Doc |
|---|---|---|---|
| 1 | Correctness & Efficiency | 2 weeks | [SPRINT_1_PRD_correctness_efficiency.md](SPRINT_1_PRD_correctness_efficiency.md) |
| 2 | Modularization & Durability | 3 weeks | [SPRINT_2_PRD_modularization.md](SPRINT_2_PRD_modularization.md) |
| 3 | Electron Desktop Shell | 3 weeks | [SPRINT_3_PRD_electron_shell.md](SPRINT_3_PRD_electron_shell.md) |
| 4 | Production Polish | 3 weeks | [SPRINT_4_PRD_production_polish.md](SPRINT_4_PRD_production_polish.md) |

**Total:** 11 weeks → v1.0.0 GA (signed, auto-updating, production-observable desktop app).

## Sequencing rationale

- **Sprint 1** fixes things that are broken today (retries, caching, concurrency, Docker). Everything after assumes a working baseline. Low risk, high ROI — do it first.
- **Sprint 2** makes the codebase reviewable and sessions durable. Required before packaging — shipping a 4,000-line `main.py` inside Electron locks in tech debt.
- **Sprint 3** is the big architectural step — Electron shell + backend sidecar. Needs Sprint 2's API stability to avoid breaking shipped binaries.
- **Sprint 4** turns the beta into a product. Signing cert lead times (3–5 business days for Windows, 1–2 weeks for Apple) mean **order certs in Sprint 3** — documented in Sprint 3 §10.

## Parallelization opportunities

- Sprint 1 §5.4 (frontend type gen) can start in parallel with §5.1–5.3 (backend LLM work).
- Sprint 2 §5.4 (Dashboard split + TanStack Query) can start in parallel with §5.1 (backend router split).
- Sprint 3 §6.1 (Electron scaffold) can start before Sprint 2 fully lands if done against a mocked backend port.
- Sprint 4 §5.7 (CI/CD) should start at Sprint 3 week 1 to pay dividends all the way through.

## Exit criteria per sprint

| Sprint | Tag | Gate |
|---|---|---|
| 1 | `v0.2.0` | Docker image passes healthcheck; cache hit rate ≥ 90% on re-run |
| 2 | `v0.3.0` | No backend file > 600 lines; Dashboard ≤ 400 lines; session survives restart |
| 3 | `v0.4.0-beta.1` | Double-click install works on clean Win + Mac; backend sidecar managed |
| 4 | `v1.0.0` | Signed, notarized, auto-updating, CI-gated |
