# Task 06 — Codex Integration & Infrastructure Surfaces

Repo: `DrJLabs/codex-completions-api`  
Date: 2025-12-08  
Status: Complete  
Scope: How this proxy integrates with the Codex CLI/runtime and how it is deployed/operated (Docker/Compose, Traefik, ForwardAuth, scripts).

---

## 1) Objectives

1. Map the integration boundary between the HTTP proxy and the Codex runtime.
2. Enumerate “infra surfaces” (build, deploy, edge auth, ops scripts) that can introduce drift or operational risk.
3. Identify gaps, contradictions, obsolete components, and cleanup candidates to feed the remediation plan (Task 12).

---

## 2) Primary artifacts reviewed (non-exhaustive)

### Runtime integration
- `src/config/index.js` (env surface, defaults, worker tuning)
- `src/services/backend-mode.js` (app-server vs proto selection)
- `src/services/codex-runner.js` (spawn primitive; CODEX_HOME + workdir handling)
- `src/services/worker/supervisor.js` (app-server worker lifecycle, handshake, restart/backoff)
- `src/handlers/chat/stream.js` (call sites that bind handlers → backend transport)

### Deployment / ops
- `Dockerfile` (bakes Codex CLI into image; default CODEX_BIN/CODEX_HOME)
- `docker-compose.yml` (prod-ish stack: app + auth, Traefik labels, host loopback publishes)
- `infra/compose/compose.dev.stack.yml` (dev stack with separate hostnames/ports and volumes)
- `auth/server.mjs` (ForwardAuth verifier; canonical entrypoint)
- `scripts/dev.sh` (local dev launcher; shim switch)
- `scripts/install.sh` (alternate “standalone installer” that generates a separate proxy + systemd user unit)
- `scripts/port-dev-to-prod.sh`, `scripts/stack-snapshot.sh`, `scripts/stack-rollback.sh`, `scripts/sync-codex-config.sh` (deployment workflow)
- `scripts/fake-codex-proto*.js` (shim backends and test fixtures)

### Requirements/intent
- `docs/bmad/prd.md` (ForwardAuth NFR; config surface)

---

## 3) Integration modes and boundaries

### 3.1 Backend selection: app-server vs “proto”
- **Primary switch:** `PROXY_USE_APP_SERVER`.
- **Selection:** `src/services/backend-mode.js` chooses **app-server** when `PROXY_USE_APP_SERVER` is truthy; otherwise **proto**.
- **Default behavior:** `src/config/index.js` derives a default for `PROXY_USE_APP_SERVER` based on the basename of `CODEX_BIN`:
  - If `CODEX_BIN` looks like a proto shim (`fake-codex-proto` or ends with `proto.js`), default is `false`.
  - Otherwise default is `true`.

Operational implication: this “magical” default can flip runtime behavior unexpectedly if someone points `CODEX_BIN` at a shim-like path without explicitly pinning `PROXY_USE_APP_SERVER`.

### 3.2 Process spawn primitive: `codex-runner`
- `spawnCodex(args, opts)` ensures `PROXY_CODEX_WORKDIR` exists, then spawns `resolvedCodexBin` with:
  - `cwd` = `PROXY_CODEX_WORKDIR`
  - `env.CODEX_HOME` = configured `CODEX_HOME` (or caller override)
  - `stdio: ["pipe","pipe","pipe"]`
- `resolvedCodexBin` is `CODEX_BIN` by default, or `node <CODEX_BIN>` if the path ends with `.js`.

Operational implication: **workdir** and **CODEX_HOME** are the two core integration “knobs” controlling filesystem and auth context for the Codex runtime.

### 3.3 App-server lifecycle: `worker/supervisor.js`
In app-server mode, the proxy uses a **long-lived supervised Codex process** and communicates over pipes.

Key behaviors:
- **Singleton supervisor:** `ensureWorkerSupervisor()` instantiates and caches a `CodexWorkerSupervisor`.
- **Spawn args:** `buildSupervisorArgs()` constructs:
  - `app-server`
  - `-c model="<CODEX_MODEL>"`
  - `-c preferred_auth_method="chatgpt"`
  - `-c sandbox_mode="<PROXY_SANDBOX_MODE>"`
  - optionally `-c model_provider="<CODEX_FORCE_PROVIDER>"`
  - optionally `-c parallel_tool_calls="true"` when `PROXY_ENABLE_PARALLEL_TOOL_CALLS=true`
- **Env:** sets `CODEX_WORKER_SUPERVISED="true"` for the child (useful for shims and potentially for real CLI behavior).
- **Handshake/readiness:** uses a handshake timeout (`WORKER_HANDSHAKE_TIMEOUT_MS`) and observes stdout/stderr lines; “ready” can be inferred from JSON lines (`{"ready":true}`), or log-like events (`event:"ready"`, `status:"listening"`, etc.).
- **Restart policy:** exponential backoff (`WORKER_BACKOFF_INITIAL_MS` → `WORKER_BACKOFF_MAX_MS`) and a cap (`WORKER_RESTART_MAX`), after which the supervisor stops trying.

Operational implication: the worker is robust against crashes, but you need observability around restart loops; otherwise failure modes can look like intermittent 5xx/timeouts.

### 3.4 Handler integration (where “backend meets HTTP”)
The streaming chat handler (`src/handlers/chat/stream.js`) is the primary “glue”:
- Selects backend mode.
- In app-server mode:
  - Calls `ensureWorkerSupervisor()` and obtains the child process.
  - Binds a JSON-RPC transport over the child pipes (`ChildProcessAdapter` + `JsonRpcTransport`).
  - Streams events back out as SSE after normalization.

Operational implication: the handler is a correctness-critical junction for **protocol translation** (Codex events → OpenAI-compatible SSE/JSON).

### 3.5 Shim backends (`scripts/fake-codex-proto*.js`)
The repository includes multiple fake backends used for testing/dev:
- `scripts/fake-codex-proto.js` (general shim)
- `scripts/fake-codex-proto-long.js` (large output; stress)
- `scripts/fake-codex-proto-no-complete.js` (missing completion events; edge-case)
- `scripts/fake-codex-jsonrpc.js` (JSON-RPC flavored shim)

Operational implication: these are valuable for deterministic test harnesses, but they also introduce risk of **drift** if they stop matching real Codex behavior.

---

## 4) Infrastructure & operational surfaces

### 4.1 Container image build (`Dockerfile`)
Notable build choices:
- Uses `node:22-alpine`.
- Installs dependencies and **bakes Codex CLI into the image**:
  - Copies from `node_modules/@openai/codex` → `/usr/local/lib/codex-cli`
  - Symlinks `/usr/local/bin/codex`
  - Verifies `codex app-server --help` during build.
- Sets defaults:
  - `CODEX_BIN=/usr/local/lib/codex-cli/bin/codex.js`
  - `CODEX_HOME=/app/.codex-api`
- Creates `/tmp/codex-work` and `/app/.codex-api`, sets ownership to `node`.

Operational implication: prod deployments do not depend on a host-installed `codex` binary; however, they **do** depend on a valid `CODEX_HOME` (auth config) volume.

### 4.2 “Prod-ish” Compose (`docker-compose.yml`)
Core structure:
- Services:
  - `app` (the proxy) exposed on `127.0.0.1:11435`
  - `auth` (ForwardAuth verifier) exposed on `127.0.0.1:18080`
- Uses an **external** Docker network named `traefik`.
- Mounts:
  - `./.codex-api:/app/.codex-api` (Codex auth/config)
  - `./.data:/app/.data` (usage/events/logs)

Traefik integration:
- Adds routers and middlewares via labels:
  - Main router for host `codex-api.onemainarmy.com`
  - Preflight router that bypasses forwardauth and routes to an internal `noop@internal`
  - Middlewares: CORS headers, security headers, rate limiting, ForwardAuth (`http://127.0.0.1:18080/verify`)

Operational implications:
- Traefik is assumed to be **running on the host** (ForwardAuth calls `127.0.0.1`).
- CORS is set both at Traefik and (optionally) at the app, which can drift.

### 4.3 Dev Compose (`infra/compose/compose.dev.stack.yml`)
Similar to prod compose but with dev-specific knobs:
- Hostname `codex-dev-api.onemainarmy.com`
- Auth verify port `127.0.0.1:18081`
- Mounts:
  - `./.codev:/home/node/.codex` (dev Codex HOME)
  - `./scripts:/app/scripts` (so you can point `CODEX_BIN` at shims)
- Exposes proxy on `127.0.0.1:18010` by default.

Operational implications:
- Dev and prod intentionally use different Codex HOME directories and (often) different advertised model IDs (e.g., `codev-*` vs `codex-*`).
- The volume mount of `scripts/` makes it easy to enable shim behavior, but increases the chances of accidental “proto-mode” defaults unless env is pinned.

### 4.4 ForwardAuth verifier (`auth/server.mjs`)
- Minimal HTTP server with `/verify`.
- Validates `Authorization: Bearer <token>` equals `PROXY_API_KEY`.
- Returns JSON `{ "ok": true }` on success; returns `401` otherwise.
- Always returns `204` for OPTIONS (CORS preflight).

Notes:
- Legacy CJS entrypoint removed 2025-12-18 after confirming no manifest references.

### 4.5 Standalone installer (`scripts/install.sh`) — major divergence
`scripts/install.sh` generates a **separate** proxy implementation under the user’s home directory and installs a systemd *user* unit. It:
- Writes its own `server.js` (not the repo’s `server.js`).
- Uses `codex exec` per request (not app-server supervision).
- Uses naive line filtering of Codex output.
- Produces a different operational footprint from the container-based approach.

Operational implication: the repo currently contains **two materially different deployment stories**. This is high-risk for operator confusion and documentation drift.

---

## 5) Findings (gaps, contradictions, cleanup candidates)

### A) Two competing deployment paths
- Containerized Traefik + ForwardAuth path (Compose + baked CLI) appears to be the “modern” path.
- `scripts/install.sh` provides a different, older, per-request `codex exec` approach.

Recommendation: decide whether `install.sh` is supported. If not, archive it (or move to `docs/_archive/`) and make the canonical deployment path unambiguous.

### B) Duplicated edge vs origin controls
- **CORS** is configured at Traefik via labels and also in-app via `PROXY_ENABLE_CORS` + allowed origins list.
- **Rate limiting** exists at Traefik (label middleware) and optionally in-app (`PROXY_RATE_LIMIT_*` in config/PRD).

Recommendation: pick a single source of truth for each control (edge preferred for coarse limits; in-app for semantic limits), document the intent, and ensure the other layer is disabled or strictly consistent.

### C) “Magical default” for `PROXY_USE_APP_SERVER`
Defaulting based on `CODEX_BIN` filename is convenient but non-obvious.

Recommendation: explicitly set `PROXY_USE_APP_SERVER=true` in all non-test deployment manifests and scripts, and treat proto-mode as test-only unless explicitly enabled.

### D) Secrets and filesystem surface area
- Codex auth material lives in `.codex-api` / `.codev` and is mounted into containers.
- The worker runs under the `node` user and reads from `CODEX_HOME`.

Recommendation: document the minimal required files inside `CODEX_HOME`, consider read-only mounts in prod, and explicitly document rotation steps.

### E) Worker restart observability
Supervisor can enter restart loops until `WORKER_RESTART_MAX` is reached.

Recommendation: ensure Task 07 (observability) surfaces worker restarts, last exit codes, and readiness state via logs and/or `/healthz` fields.

---

## 6) Suggested remediation backlog inputs (for Task 12)

High priority:
1. Canonicalize deployment: choose Compose+Traefik as primary; demote/retire `scripts/install.sh` unless there is a strong reason to keep it.
2. Centralize environment documentation: one matrix showing required vars per environment (local dev, dev stack, prod).
3. Rationalize CORS + rate limit layers to prevent drift.

Medium priority:
4. Add explicit operator-facing signals for worker readiness/restart loops (health payload and/or structured logs).
5. Harden CODEX_HOME handling (permissions, read-only mounts, documented structure).

Low priority:
6. Legacy entrypoints (e.g., `auth/server.js`) removed 2025-12-18 after confirming no manifest references.

---

## 7) Open questions to resolve later

- Is Traefik always host-run (as labels imply), or is there also a supported containerized Traefik deployment?
- Should `preferred_auth_method` be configurable (currently hard-coded to `chatgpt` for the worker)?
- Are the fake Codex scripts intended as permanent test fixtures, or should they be generated/kept in a dedicated test-fixtures area?

---

## 8) Outputs produced by this task

- A mapped view of:
  - runtime integration switches,
  - worker supervision contract,
  - deployment surfaces (Docker/Compose/Traefik/Auth/scripts),
  - and primary drift/cleanup candidates.
- A backlog seed list for remediation planning (Task 12).
