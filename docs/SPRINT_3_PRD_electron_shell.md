# Sprint 3 PRD — Electron Desktop Shell

**Version:** 1.0
**Duration:** 3 weeks
**Owner:** Desktop lead (new hire or rotate from frontend) + Backend lead (sidecar)
**Status:** Proposed
**Depends on:** Sprint 2 complete (durable sessions, split codebase, type-safe API)

---

## 1. Goal

Ship SlideForge AI as a **single-install, double-click desktop application** on Windows (primary) and macOS (secondary). The existing FastAPI backend runs as a sidecar process; the existing React UI runs in an Electron renderer. Users do not see Python, Node, or a browser — they see one icon.

## 2. Why now

- Target users (consultants) cannot run a `.ps1` + `uv sync` + `npm run dev` flow.
- The product is offline-first and local-LLM-first — a desktop app is the natural shape.
- PyInstaller spec already exists ([backend/SlideForge.spec](../backend/SlideForge.spec)) and Vite is configured with `base: './'` ([vite.config.ts:8](../vite.config.ts#L8)) — two of the three packaging pieces are already there.

## 3. Non-goals

- **No code signing** this sprint (Sprint 4).
- **No auto-update** this sprint (Sprint 4).
- **No bundled LLM** — users install LM Studio or Ollama separately; app detects them.
- No Linux builds (deferred post-v1).
- No mobile/tablet.

## 4. Success metrics

| Metric | Target |
|---|---|
| Windows installer size (excluding LLM) | ≤ 350 MB |
| macOS DMG size | ≤ 400 MB |
| Cold start to interactive UI (after install) | ≤ 8 s |
| Backend sidecar crash → auto-restart within | ≤ 3 s |
| Zero CVE-flagged `electronjs/electron` version at ship | Yes |
| Orphan Python processes after Electron quit | 0 |

## 5. Architecture

```
┌──────────────────── SlideForge.app ────────────────────┐
│                                                         │
│   Electron main (Node)                                  │
│     ├─ BrowserWindow (renderer, sandboxed)              │
│     │    └─ Vite-built React UI (file://…/index.html)   │
│     ├─ preload.ts (contextBridge: safe IPC)             │
│     └─ BackendManager (spawns PyInstaller exe)          │
│              │ stdout/stderr → electron-log             │
│              ▼                                          │
│   SlideForge-backend.exe (PyInstaller onedir)           │
│     ├─ FastAPI @ 127.0.0.1:${dynamicPort}               │
│     └─ SQLite @ {userData}/sessions.db                  │
│                                                         │
│   External (optional, detected at runtime):             │
│     • LM Studio @ :1234                                 │
│     • Ollama    @ :11434                                │
└─────────────────────────────────────────────────────────┘
```

All inter-process communication is HTTP over `127.0.0.1` — reuses every existing API unchanged.

## 6. Deliverables

### 6.1 Electron scaffold — **new** `electron/` directory

```
electron/
├── main.ts                  # App lifecycle, BrowserWindow
├── preload.ts               # contextBridge: {getBackendPort, openDeckDialog, …}
├── backend-manager.ts       # spawn/health/restart/kill the sidecar
├── ipc/
│   ├── dialogs.ts           # file/save pickers
│   ├── logs.ts              # expose log path to renderer
│   └── telemetry.ts         # stub for Sprint 4
├── util/
│   ├── port.ts              # random free port (`get-port`)
│   ├── paths.ts             # resolve resources vs dev paths
│   └── health.ts            # poll /api/health with timeout
└── tsconfig.json
```

**Tech pins:**
- `electron@^33` (latest LTS at time of writing)
- `electron-builder@^25` (packaging)
- `electron-log@^5` (file logging at `%AppData%/SlideForge/logs/`)
- `get-port@^7`
- Shared `tsconfig.base.json` extended by renderer and electron.

### 6.2 Backend sidecar integration

**6.2.1 PyInstaller updates — [backend/SlideForge.spec](../backend/SlideForge.spec)**
- Confirm onedir output (already `COLLECT` block present).
- Add missing hidden imports: `tiktoken_ext`, `surya`, `sentence_transformers`, `tokenizers`.
- `console=False` for production spec variant (keep `console=True` for debug).
- Add Windows resource (icon + version info) and macOS `Info.plist`.
- Build command lands in `backend/build_and_package.ps1` + new `build_and_package.sh` for mac.

**6.2.2 Backend sidecar contract**
- Accept `--host`, `--port`, `--data-dir`, `--log-level` CLI flags.
- Write a `backend.pid` file in `{userData}/runtime/` on startup.
- Bind to `127.0.0.1` only — hard-coded, not configurable.
- On `SIGTERM` drain in-flight requests ≤ 15s then exit.
- Emit `READY port=12345` on stdout once `/health` returns 200 — BackendManager pattern-matches this.

**6.2.3 `electron/backend-manager.ts` contract**
```ts
interface BackendManager {
  start(): Promise<number>;              // returns port
  stop(timeoutMs?: number): Promise<void>;
  restart(): Promise<number>;
  isHealthy(): Promise<boolean>;
  onCrash(cb: (exitCode: number) => void): void;
}
```
- Health check: `GET /api/health` every 10s; 3 consecutive failures → restart.
- Restart storm protection: max 3 restarts in 60s; after that, show error dialog.
- All stdout/stderr piped to `electron-log` at `info` / `error`.

### 6.3 Renderer integration

**6.3.1 Dynamic API base**
- `services/apiService.ts` today uses `const API_BASE = '/api'` ([services/apiService.ts:4](../services/apiService.ts#L4)). Replace with:
```ts
const API_BASE = await window.slideforge.getApiBase(); // e.g. http://127.0.0.1:54321/api
```
- In dev (`npm run dev`), fall back to the Vite proxy behavior.
- React Query's `baseUrl` picked up once, at app boot, before any hooks run.

**6.3.2 Preload IPC surface** (minimal)
```ts
window.slideforge = {
  getApiBase: () => Promise<string>,
  openDeckDialog: () => Promise<{path: string; filename: string} | null>,
  openEvidenceDialog: () => Promise<{path: string; filename: string}[] | null>,
  revealInFolder: (path: string) => Promise<void>,
  getLogsPath: () => Promise<string>,
  platform: 'win32' | 'darwin' | 'linux',
  appVersion: string,
};
```
No `ipcRenderer` leak. No `require` in renderer. All inputs whitelisted and validated.

**6.3.3 Upload flow change**
- Today, [components/FileUpload.tsx](../components/FileUpload.tsx) does browser-based `File` upload via `FormData`.
- Add a path-based upload: renderer calls `openDeckDialog`, passes returned path to a new backend endpoint `POST /api/session/{id}/upload-by-path` that reads from local disk. Avoids a ~50 MB round-trip through the renderer.
- Browser-drag-drop upload stays as fallback.

### 6.4 Packaging (electron-builder)

**6.4.1 Config — `electron-builder.yml`**
```yaml
appId: com.slideforge.ai
productName: SlideForge AI
directories:
  output: dist/electron
files:
  - dist/renderer/**
  - dist/electron/**
  - "!node_modules/**"
extraResources:
  - from: backend/dist/SlideForge
    to: backend
win:
  target: nsis
  icon: build/icon.ico
mac:
  target: dmg
  category: public.app-category.productivity
  icon: build/icon.icns
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
```

**6.4.2 Build scripts in [package.json](../package.json)**
```json
{
  "scripts": {
    "dev:renderer": "vite",
    "dev:electron": "tsc -p electron && electron dist/electron/main.js",
    "dev": "concurrently \"npm:dev:renderer\" \"wait-on http://127.0.0.1:3000 && npm:dev:electron\"",
    "build:renderer": "vite build",
    "build:electron": "tsc -p electron",
    "build:backend": "pwsh backend/build_and_package.ps1",
    "build": "npm run build:renderer && npm run build:electron && npm run build:backend",
    "package": "npm run build && electron-builder",
    "package:win": "npm run build && electron-builder --win",
    "package:mac": "npm run build && electron-builder --mac"
  }
}
```

### 6.5 Security baseline

**6.5.1 `BrowserWindow` config (non-negotiable)**
```ts
new BrowserWindow({
  webPreferences: {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

**6.5.2 CSP**
- Meta tag in built [index.html](../index.html):
  `default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';`
- No `unsafe-eval`. No remote script sources.

**6.5.3 Navigation lockdown**
- `will-navigate` and `setWindowOpenHandler` deny anything not `file://` or `http://127.0.0.1:*`.
- External links open via `shell.openExternal` after confirm dialog.

### 6.6 Data paths

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\SlideForge\` |
| macOS | `~/Library/Application Support/SlideForge/` |

Contents: `sessions.db`, `llm_cache.sqlite`, `logs/`, `guardrails/`, `uploads/`, `runtime/`.

Backend sidecar reads `--data-dir` arg passed by Electron main (via `app.getPath('userData')`).

### 6.7 First-run experience

- On first launch, detect LM Studio / Ollama on standard ports.
- If neither detected, show a modal with links to install one + instructions.
- "Skip for now" path enables API-provider mode (requires user API key).

## 7. Acceptance criteria

- [ ] Double-click installer on clean Windows 11 VM → app opens → upload deck → see scorecard; no manual dependencies beyond LM Studio/Ollama.
- [ ] Same on clean macOS 14 VM.
- [ ] Quitting the app kills the Python sidecar within 15s (verified with `ps` / Task Manager).
- [ ] Killing the backend externally auto-restarts it within 3s and surfaces no user-visible error for in-flight queries (React Query retries).
- [ ] Renderer cannot `require('child_process')` — throws.
- [ ] `electron-builder` output passes `asar` verification and starts under SmartScreen (warned but not blocked).
- [ ] Data written to OS-appropriate `userData` path, not app install directory.

## 8. Test plan

| Test | Level | Notes |
|---|---|---|
| `backend-manager.start_and_health` | Unit (Node) | Mock spawn with fake binary that emits `READY port=`. |
| `backend-manager.restart_on_health_failure` | Unit | Verify restart storm guard. |
| `preload.ipc_surface` | Unit | Assert whitelist — passing disallowed channel throws. |
| `renderer.api_base_resolved` | Integration | Boot app headless (Playwright), check request URL. |
| `e2e.install_and_upload` | E2E | Playwright for Electron; runs on GH runners per-OS. |
| `e2e.quit_cleanup` | E2E | After `app.quit()`, no SlideForge processes remain. |
| `e2e.backend_crash_recovery` | E2E | `kill -9` sidecar PID; UI recovers. |

## 9. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PyInstaller misses a hidden import (common for `surya`, `tokenizers`) | High | High | Smoke-test frozen exe runs the full test suite before Electron packaging |
| Windows Defender flags unsigned binary | High | Med | Sprint 4 will sign; for Sprint 3 accept SmartScreen warning with docs |
| App size bloats past 1 GB from ML deps | Med | Med | `exclude` `torch`/`transformers` test fixtures; strip `.dist-info`; UPX on Win only |
| Electron sandbox blocks FastAPI on random port | Low | High | Bind `127.0.0.1` confirmed allowed in sandboxed renderer |
| Orphaned backend processes on crash | Med | Med | Store PID, `taskkill`/`kill` on startup if a prior PID exists |
| Mac notarization not possible without signing | High | Low (this sprint) | Ship unsigned DMG with docs; real fix is Sprint 4 |

## 10. Dependencies external to the team

- GitHub Actions runners (macos-14, windows-2022) for multi-OS builds.
- Apple Developer account procurement **started** this sprint so Sprint 4 can sign (lead time 1–2 weeks).
- Windows EV code-signing certificate ordered (lead time 3–5 business days).

## 11. Rollout

- Internal alpha at end of week 2 (unsigned builds, 5–10 testers).
- Public beta at end of sprint (unsigned but with clear install docs).
- Tag `v0.4.0-beta.1`.

## 12. Out of scope

- Auto-update → Sprint 4.
- Signed installers / notarization → Sprint 4.
- Telemetry / error reporting → Sprint 4.
- Linux builds → deferred.
- System tray / background mode → deferred.
