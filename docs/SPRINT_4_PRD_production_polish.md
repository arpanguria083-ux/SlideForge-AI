# Sprint 4 PRD — Production Polish

**Version:** 1.0
**Duration:** 3 weeks
**Owner:** Desktop lead + DevOps lead + Security lead
**Status:** Proposed
**Depends on:** Sprint 3 complete (Electron shell shipping as unsigned beta)

---

## 1. Goal

Graduate SlideForge AI from "unsigned beta" to **GA-quality desktop product**: signed installers, silent auto-update, production-grade observability, hardened guardrail signing, CI/CD, and crash reporting. After this sprint, a user downloads a signed installer, and the app updates itself transparently.

## 2. Why now

- Sprint 3 shipped a working desktop app but unsigned binaries trigger SmartScreen (Windows) and Gatekeeper (macOS) warnings — most non-technical users abandon install.
- No auto-update means each patch requires manual reinstall — unsustainable past v1.
- Guardrail "signing" at [backend/app/services/guardrail.py:52](../backend/app/services/guardrail.py#L52) is plain SHA-256 — integrity only, no authenticity. Senior partners expect real attestation.
- No CI gate; regressions ship.
- No crash reporting; we can't see what breaks in the field.

## 3. Non-goals

- No new product features.
- No marketplace distribution (Mac App Store / Windows Store) — direct download only.
- No enterprise SSO / device management — deferred post-v1.

## 4. Success metrics

| Metric | Target |
|---|---|
| Installer passes Windows SmartScreen without warning | ✅ |
| Installer passes macOS Gatekeeper without warning | ✅ |
| Auto-update completes successfully in < 60 s (p95) | ✅ |
| Unhandled crash captured and surfaced to dashboard | 100% |
| CI green-to-merge rule enforced on `main` | 100% |
| Guardrail signatures verifiable offline by 3rd party | ✅ |
| Mean time from commit-merge → signed release published | ≤ 30 min |

## 5. Deliverables

### 5.1 Code signing — Windows

**5.1.1 Certificate**
- EV code-signing certificate procured in Sprint 3 (ordered lead time).
- Store private key on hardware token (YubiKey FIPS) — industry standard.
- CI signing uses cloud HSM (DigiCert KeyLocker or equivalent) to avoid shipping the physical token to GH Actions.

**5.1.2 Integration**
- `electron-builder.yml` adds:
  ```yaml
  win:
    signingHashAlgorithms: [sha256]
    signDlls: false
    sign: "./build/sign-win.js"   # custom signer invoking KeyLocker CLI
  ```
- Verify signature in CI with `signtool verify /pa /all *.exe`.

### 5.2 Code signing + notarization — macOS

**5.2.1 Developer ID**
- Apple Developer account confirmed active.
- "Developer ID Application" cert installed on CI macos-14 runner via keychain.

**5.2.2 Integration**
- `electron-builder.yml`:
  ```yaml
  mac:
    hardenedRuntime: true
    gatekeeperAssess: false
    entitlements: build/entitlements.mac.plist
    notarize:
      teamId: ABCDEFGHIJ
  ```
- Entitlements: `com.apple.security.cs.allow-jit` (for V8), allow outgoing network to `127.0.0.1` and LM Studio/Ollama hosts.
- `stapler staple` post-notarization verified in CI.

### 5.3 Auto-update — electron-updater

**5.3.1 Infrastructure**
- GitHub Releases as update channel (free, built-in to electron-updater).
- `latest.yml` / `latest-mac.yml` published by CI.
- `provider: github` in `electron-builder.yml`.

**5.3.2 Update UX**
- Check on boot + every 6 h.
- Download in background; prompt user to "Restart & Update" via non-modal banner.
- Enforce update only on critical security patches (flag: `critical: true` in release notes) — silent install on next launch.
- Delta updates enabled (block-map).

**5.3.3 Rollback**
- Keep last-known-good `app-1.asar.backup`; if new version crashes 3× within 60s on launch, revert automatically.

### 5.4 Guardrail signing — real cryptography

**5.4.1 Replace SHA-256 with Ed25519**
- [backend/app/services/guardrail.py](../backend/app/services/guardrail.py) `sign_guardrail` today computes `hashlib.sha256(canonical_json)` — integrity only.
- New design: per-install Ed25519 keypair generated on first run, stored at `{userData}/keys/signing.key` (0600 perms).
- `sign_guardrail` produces: `signature` (base64 Ed25519), `public_key` (base64), `signed_at`, `signed_by`.
- `verify_guardrail` validates signature against embedded public key; optionally against a trusted keyring (`{userData}/keys/trusted/`).

**5.4.2 Optional: organization signing**
- Admin can import an org public key file; guardrails signed by that key show an "Org-verified" badge in UI.
- No PKI infrastructure required — flat key list, Signal-style TOFU.

**5.4.3 Backward compatibility**
- Old SHA-256 guardrails load with a "legacy integrity check only" warning.
- Re-save signs with new scheme.

**5.4.4 Library**
- `cryptography>=43` (already transitively present).

### 5.5 Observability

**5.5.1 Structured logging**
- Replace `logging.basicConfig(...)` at [backend/app/main.py:81](../backend/app/main.py#L81) with `structlog` + JSON renderer in prod, pretty renderer in dev.
- Context keys: `request_id`, `session_id`, `agent`, `model`, `duration_ms`.
- Rotating file handler: 10 MB × 5 files at `{userData}/logs/backend.log`.
- Electron side uses `electron-log` already; unify log path.

**5.5.2 Optional OpenTelemetry**
- Opt-in via settings toggle (default OFF for privacy).
- If ON, emit traces to configured OTLP endpoint (e.g. local `otel-collector`).
- Slide-level + agent-level spans in `ParallelAnalysisOrchestrator`.

**5.5.3 In-app log viewer**
- New UI panel (extend [components/AuditLog.tsx](../components/AuditLog.tsx)) with "View logs" button → opens log folder via `window.slideforge.revealInFolder`.
- "Export diagnostics" bundles last 24h logs + anonymized session metadata into a zip for support.

### 5.6 Crash reporting

**5.6.1 Electron crashes**
- `crashReporter.start({ submitURL, uploadToServer })` — Sentry or self-hosted Symbolicator.
- Opt-in modal on first launch; respect "no telemetry" setting.
- Symbolicate renderer JS stacks using sourcemaps uploaded during release.

**5.6.2 Backend crashes**
- `sentry-sdk[fastapi]` conditional import — activated only when the user opts in.
- Scrubbing: no request/response bodies, no `Authorization` headers, no file paths beyond module name.

**5.6.3 Self-hosted alternative**
- For paranoid/enterprise users, document how to point crash reporting at a self-hosted Sentry OSS / GlitchTip.

### 5.7 CI/CD

**5.7.1 GitHub Actions workflows**
```
.github/workflows/
├── ci.yml              # Lint + typecheck + test (Py 3.11/3.12, Node 20); runs on every PR
├── e2e.yml             # Playwright desktop tests on mac + win; runs on main + nightly
├── build-desktop.yml   # Signed builds triggered by tag push (v*.*.*)
└── security.yml        # Weekly dep audit (pip-audit, npm audit, Snyk)
```

**5.7.2 ci.yml essentials**
- Matrix: `{python: [3.11, 3.12], node: 20, os: [ubuntu-latest, windows-latest, macos-14]}`.
- Steps:
  1. `uv sync --frozen`
  2. `ruff check .` + `mypy .`
  3. `pytest -q` (parallel)
  4. `npm ci` + `npm run gen:api` + `git diff --exit-code services/api.generated.ts`
  5. `tsc --noEmit`
  6. `vite build`
  7. Upload artifacts.
- Block merge on red.

**5.7.3 build-desktop.yml**
- Triggered by `v*.*.*` tags.
- Runs per-OS: `npm run package:${OS}`.
- Signs in CI (KeyLocker for Win, Apple keychain for Mac).
- Uploads artifacts to a GH Release draft; release is published after manual QA sign-off.

**5.7.4 Branch protection**
- `main` requires 1 reviewer + all CI green + up-to-date with base.
- No force-push.
- Signed commits required (optional but recommended).

### 5.8 Security hardening

**5.8.1 Dependency scanning**
- `pip-audit` and `npm audit --audit-level=high` in CI; fail on HIGH/CRITICAL.
- Weekly scheduled scan posts a digest to team chat.

**5.8.2 SBOM**
- `cyclonedx-bom` for Python deps, `@cyclonedx/cyclonedx-npm` for Node.
- Generated SBOMs attached to every release.

**5.8.3 Secrets management**
- No API keys in repo; use `.env.example` + user-configured settings in UI.
- CI secrets (signing certs, notarization keys) scoped to `build-desktop.yml` only.

### 5.9 Release process

**5.9.1 Versioning**
- SemVer strict: `MAJOR.MINOR.PATCH`.
- Pre-release: `v1.0.0-rc.1`.

**5.9.2 Changelog**
- `CHANGELOG.md` auto-generated via `conventional-changelog` from commit messages.
- Enforced commit convention: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`, `ci:`.

**5.9.3 Release checklist** (codified in `docs/RELEASE.md`)
- [ ] All CI green
- [ ] E2E suite passed per-OS
- [ ] Smoke install on clean VM per-OS
- [ ] Changelog updated
- [ ] Version bumped in `package.json`, `backend/pyproject.toml`
- [ ] Git tag pushed
- [ ] CI publishes signed artifacts
- [ ] Manual QA checks + publishes GH Release
- [ ] Auto-update channel verified on a prior-version test box

## 6. Acceptance criteria

- [ ] Signed Win installer opens on a clean Windows 11 VM with **no** SmartScreen warning.
- [ ] Signed + notarized Mac DMG opens on clean macOS 14 with **no** Gatekeeper block.
- [ ] From v0.4.0 → v0.4.1: auto-update completes silently in background; user sees "Restart to update" banner; restart applies update.
- [ ] Tampered guardrail file (any byte flipped) fails `verify_guardrail` with Ed25519 signature invalid error; legacy SHA-256 files still load with warning.
- [ ] Intentional crash in renderer produces a symbolicated event in crash reporter (sourcemaps resolved).
- [ ] `git push` on feature branch triggers CI; red CI blocks merge.
- [ ] `git tag v0.5.0 && git push --tags` produces signed artifacts + draft release within 30 min.
- [ ] `pip-audit` / `npm audit` report zero HIGH/CRITICAL.

## 7. Test plan

| Test | Level | Notes |
|---|---|---|
| `signtool verify` on generated exe | CI check | Must pass `/pa /all` |
| `spctl --assess` on DMG | CI check | macOS only |
| `stapler validate` on DMG | CI check | macOS only |
| Auto-update E2E: old → new | E2E | Headless; assert app restarts on new version |
| Rollback: crashing update reverts | E2E | Mock crash loop on startup |
| Guardrail tamper detection | Unit | Flip a byte; expect verify failure |
| Guardrail legacy load | Unit | SHA-256 file loads with warning |
| Crash reporter smoke | Manual QA | Trigger `throw` in renderer; verify Sentry event |
| Opt-out respected | Unit | With telemetry OFF, no network calls to reporter |

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| EV cert issuance delays | Med | High | Ordered in Sprint 3; fallback: ship with SmartScreen warning for v1.0 and re-release signed |
| Apple notarization rejection (entitlements) | Med | High | Test notarization on first beta build of sprint, not last |
| Auto-update infinite crash loop | Low | High | Rollback guard (5.3.3); kill-switch config file checked at launch |
| Crash reports leak PII | Med | High | Strict scrubbing allowlist; third-party review before first send |
| Supply-chain compromise in CI signing | Low | Critical | Signing credentials scoped to single workflow; require manual approval on signing jobs |
| Sentry / update server outage blocks launch | Low | High | Reporter and updater are non-fatal; app starts offline |

## 9. Dependencies external to the team

- **Certificates** (from Sprint 3 ordering): Windows EV cert + Apple Developer ID — must be in hand at Sprint 4 kickoff.
- **Cloud HSM** (DigiCert KeyLocker or similar): account provisioned.
- **Crash reporting** service choice: Sentry SaaS plan or self-hosted — decide in week 1.

## 10. Rollout

- Week 1: Signing pipelines land; first signed alpha distributed internally.
- Week 2: Auto-update + crash reporting wired; signed beta to external testers.
- Week 3: CI hardening + security scans + release-rehearsal.
- **End of sprint: v1.0.0 GA tag.**

## 11. Out of scope

- Mac App Store / Microsoft Store distribution.
- Enterprise MSI / MDM deployment profiles.
- Localization / i18n.
- Linux builds (AppImage / deb / Flatpak).
- Hardware-backed attestation beyond Ed25519.
