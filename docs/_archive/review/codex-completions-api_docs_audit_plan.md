# codex-completions-api — Documentation Surface Audit & PR-Ready Plan

> Repo: `DrJLabs/codex-completions-api`  
> Branch analyzed: **default branch** (assumed `main`; **needs confirmation** if default differs in GitHub settings)

## A) Executive Summary (5–10 bullets)

- Entry points exist, but the documentation surface is fragmented: root `README.md` is doing onboarding + ops + API reference, while `docs/README.md` is a minimal index that doesn’t provide a clean “start here → run locally → configure → deploy → troubleshoot” flow.
- A concrete contradiction exists across docs: **sandbox default** is described differently in different places (must be reconciled against code/config and made consistent).
- Backend-mode language is inconsistent: multiple docs still lead with `codex proto`, but current defaults and build/runtime behavior indicate **Codex `app-server` (JSON‑RPC)** is the primary path, with proto as fallback.
- A tracked dev “doc” is actively misleading: `.codev/AGENTS.md` contains unrelated content and should be **deleted or replaced** with a repo-specific agent file.
- Configuration is documented in scattered places (`.env.example`, Dockerfile, various docs) but not centralized into one authoritative reference.
- API usage is strong at the “canonical spec” level (golden parity doc), but missing a short-form “API overview + runnable curl examples + auth” doc for integrators.
- Contribution workflow is incomplete at repo root (missing `CONTRIBUTING.md`, likely `SECURITY.md`, optionally `CODE_OF_CONDUCT.md`/`CHANGELOG.md`), though a PR template exists.
- Deployment/ops is present as scripts and compose files but needs first-class runbooks: snapshot/rollback/backup/smoke tests should be documented as operator workflows.
- Immediate PR-ready actions: (1) rewrite `docs/README.md` into a real index, (2) replace `.codev/AGENTS.md`, (3) add `CONTRIBUTING.md`, (4) add `docs/getting-started.md` + `docs/configuration.md` + `docs/troubleshooting.md`, (5) tighten `README.md` to point at these.

---

## B) Doc Inventory Table

| Path | Purpose | Status | Priority |
|---|---|---:|---:|
| `README.md` | Primary entry point: what it is, quickstart, key features, pointers | Update | P0 |
| `docs/README.md` | Documentation index (should be canonical) | Update | P0 |
| `docs/reference/config-matrix.md` | Config/deployment matrix reference | Update | P0 |
| `.env.example` | Local/prod env template & feature toggles | Update | P0 |
| `.env.dev.example` | Dev-stack env template | Update | P1 |
| `Dockerfile` | Image build behavior + baked Codex CLI defaults | OK | P1 |
| `docker-compose.yml` | Production compose entry (must be documented) | OK | P1 |
| `docker-compose.local.example.yml` | Local compose example (must be documented) | OK | P1 |
| `compose.dev.stack.yml` | Dev stack compose (must be documented) | OK | P1 |
| `.codex-api/README.md` | Prod `CODEX_HOME` mount expectations & warnings | OK | P2 |
| `.codev/README.md` | Dev `CODEX_HOME` usage & scripts | Update | P1 |
| `.codev/AGENTS.md` | Dev agent prompt file (currently unrelated content) | Delete/Replace | P0 |
| `.codev/config.toml` | Dev Codex config example | OK | P2 |
| `AGENTS.md` | Repo-level agent instructions | Update | P1 |
| `docs/bmad/prd.md` | PRD / requirements | Update | P1 |
| `docs/bmad/architecture.md` | Architecture doc | Update | P1 |
| `docs/bmad/architecture/end-to-end-tracing-app-server.md` | Tracing runbook | Update | P1 |
| `docs/openai-endpoint-golden-parity.md` | Canonical endpoint + streaming parity spec | Update | P1 |
| `docs/logging-gaps/README.md` | Observability gap tracker | OK | P2 |
| `docs/responses-endpoint/overview.md` | `/v1/responses` implementation overview | OK | P2 |
| `docs/responses-endpoint/ingress-debug-lnjs-400.md` | Troubleshooting note for `/v1/responses` 400 | OK | P2 |
| `docs/responses-endpoint/codex_ready_logging_spec_ingress_to_egress.md` | Logging spec/status | Update | P2 |
| `docs/app-server-migration/codex-completions-api-migration.md` | Migration/runbook context | Update | P1 |
| `docs/app-server-migration/app-server-protocol.schema.json` | App-server JSON-RPC schema artifact | OK | P2 |
| `docs/codex-longhorizon/INDEX_TASK_DOCS.md` | Internal task/survey index | OK | P2 |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist guidance | Update | P1 |
| `.github/workflows/ci.yml` | CI workflow definition | OK | P2 |
| `setup-codex-cloud.sh` | Infra bootstrap script (needs runbook) | Update | P1 |
| **(new)** `CONTRIBUTING.md` | Contribution workflow | Create-new-related | P0 |
| **(new)** `SECURITY.md` | Vulnerability reporting + secret handling | Create-new-related | P1 |
| **(new)** `CODE_OF_CONDUCT.md` | Community standards | Create-new-related | P2 |
| **(new)** `CHANGELOG.md` | Human-readable releases | Create-new-related | P2 |
| **(new)** `docs/getting-started.md` | Onboarding + first-run walkthrough | Create-new-related | P0 |
| **(new)** `docs/local-development.md` | Dev workflows (Node vs Docker vs dev stack) | Create-new-related | P0 |
| **(new)** `docs/configuration.md` | Central env/config reference | Create-new-related | P0 |
| **(new)** `docs/api/overview.md` | API overview + runnable examples | Create-new-related | P0 |
| **(new)** `docs/api/chat-completions.md` | `/v1/chat/completions` summary + links | Create-new-related | P1 |
| **(new)** `docs/api/responses.md` | `/v1/responses` summary + links | Create-new-related | P1 |
| **(new)** `docs/deployment/production.md` | Production deployment guide | Create-new-related | P0 |
| **(new)** `docs/deployment/dev-stack.md` | Dev stack guide | Create-new-related | P1 |
| **(new)** `docs/observability.md` | Logs, request IDs, OTEL, metrics, usage | Create-new-related | P0 |
| **(new)** `docs/troubleshooting.md` | Troubleshooting / FAQ | Create-new-related | P0 |
| **(new)** `docs/ops/runbooks.md` | Snapshot/rollback/backup runbooks | Create-new-related | P1 |

---

## C) Prioritized Backlog

### P0 (must-fix)

1) Replace `.codev/AGENTS.md` with a minimal repo-specific agent file (or remove from tracking)
- **Why:** Content is unrelated and confusing; it will mislead contributors and automation tools.
- **Exact location:** `.codev/AGENTS.md`
- **Proposed patch:** See “Ready-to-Apply Patch Snippets” (Snippet #3)

2) Rewrite `docs/README.md` into a real documentation index
- **Why:** Current version is hard to navigate and contains contradictory/unstable claims (e.g., sandbox defaults).
- **Exact location:** `docs/README.md`
- **Proposed patch:** See Snippet #2

3) Update `README.md` to be a clean entry point (runnable quickstart + pointers)
- **Why:** README should be short, runnable, and defer deep detail to `/docs`.
- **Exact location:** `README.md`
- **Proposed patch:** See Snippet #1

4) Add `CONTRIBUTING.md` and link it from README + PR template
- **Why:** Ensures consistent dev commands, tests, doc hygiene, and security expectations.
- **Exact location:** `CONTRIBUTING.md` (new) and link from `README.md` + `.github/PULL_REQUEST_TEMPLATE.md`
- **Proposed patch:** See Snippet #4 (new file)

5) Create `docs/configuration.md` and make it authoritative
- **Why:** Env vars and defaults are spread across `.env.example`, Dockerfile, and various docs.
- **Proposed path:** `docs/configuration.md`
- **Outline (full):**
  - What is configurable and where defaults come from
  - Auth (`PROXY_API_KEY`, ForwardAuth mode)
  - Backend selection (`PROXY_USE_APP_SERVER`, proto fallback)
  - Endpoint toggles (responses enablement, any gates)
  - CORS & rate limiting knobs
  - Observability (OTEL variables, request IDs)
  - Example `.env` for local dev
  - Safe secret handling notes

6) Create `docs/getting-started.md` and `docs/local-development.md`
- **Why:** Provide a clear, first-run walkthrough and deeper developer workflows.
- **Proposed paths:** `docs/getting-started.md`, `docs/local-development.md`
- **Must include runnable blocks:**
  - `npm i`
  - `cp .env.example .env`
  - Start modes: `npm run dev`, `npm run start:codev`, `npm run dev:shim`
  - Verify with `curl /v1/models` on the default port

7) Create `docs/deployment/production.md`, `docs/observability.md`, `docs/troubleshooting.md`
- **Why:** Formalize deployment expectations (compose/mounts), and enable deterministic debugging.
- **Proposed paths:** `docs/deployment/production.md`, `docs/observability.md`, `docs/troubleshooting.md`

### P1 (should-fix)

- Update `docs/bmad/prd.md` and `docs/bmad/architecture.md` to consistently describe app-server as default and proto as fallback.
- Fix link hygiene and “See also” references in tracing docs.
- Add `SECURITY.md`.
- Add `docs/ops/runbooks.md` tied to `package.json` scripts.
- Tighten `.github/PULL_REQUEST_TEMPLATE.md` to link to `CONTRIBUTING.md` and doc index.

### P2 (nice-to-have)

- Add `CODE_OF_CONDUCT.md` and optionally `CHANGELOG.md`.
- Rationalize root `AGENTS.md` (clarify audience, move verbose prompts to `docs/internal/agents/` if needed).

---

## D) Proposed New Doc Tree

```text
.
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── docs/
│   ├── README.md
│   ├── getting-started.md
│   ├── local-development.md
│   ├── configuration.md
│   ├── api/
│   │   ├── overview.md
│   │   ├── chat-completions.md
│   │   └── responses.md
│   ├── deployment/
│   │   ├── production.md
│   │   └── dev-stack.md
│   ├── observability.md
│   ├── troubleshooting.md
│   ├── ops/
│   │   └── runbooks.md
│   ├── reference/
│   │   └── config-matrix.md
│   ├── openai-endpoint-golden-parity.md
│   ├── responses-endpoint/
│   │   ├── overview.md
│   │   └── ingress-debug-lnjs-400.md
│   ├── logging-gaps/
│   │   └── README.md
│   ├── bmad/
│   │   ├── prd.md
│   │   └── architecture.md
│   └── app-server-migration/
│       ├── codex-completions-api-migration.md
│       └── app-server-protocol.schema.json
└── .codev/
    ├── README.md
    ├── config.toml
    └── AGENTS.md
```

---

## E) Ready-to-Apply Patch Snippets (Top P0 items)

### Snippet #1 — Tighten `README.md` onboarding and push detail into `/docs`

```diff
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@
-## Getting started (local Node)
-
-1. Install deps: `npm i`
-2. Set your API key and run dev server:
-
-   `PROXY_API_KEY=your-key npm run dev`
-
-3. Test:
-
-   `curl -s http://127.0.0.1:11435/v1/models -H "Authorization: Bearer your-key" | jq`
+## Getting started
+
+### Prerequisites
+- Node.js **>= 22**
+- Optional: Docker (for compose/dev stack workflows)
+
+### Quickstart (local Node)
+1) Install deps:
+   - `npm i`
+2) Start the proxy (choose one):
+   - **Default dev wrapper**:
+     - `PROXY_API_KEY=your-dev-key npm run dev`
+   - **Project-local Codex HOME** (recommended for local dev):
+     - `PROXY_API_KEY=your-dev-key npm run start:codev`
+   - **Shim mode (no Codex required)**:
+     - `PROXY_API_KEY=your-dev-key npm run dev:shim`
+3) Verify:
+   - `curl -s http://127.0.0.1:11435/v1/models -H "Authorization: Bearer your-dev-key" | jq`
+
+### Next steps
+- Configuration and env vars: `docs/configuration.md` (and `.env.example`)
+- API overview + examples: `docs/api/overview.md`
+- Deployment/runbooks: `docs/deployment/production.md`
@@
-### Dev helpers
+### Development workflows
+- Env templates: `.env.example` (local), `.env.dev.example` (dev stack)
+- Dev stack: `npm run dev:stack:up` / `npm run dev:stack:logs` / `npm run dev:stack:down`
```

### Snippet #2 — Rewrite `docs/README.md` into a canonical index

```diff
diff --git a/docs/README.md b/docs/README.md
--- a/docs/README.md
+++ b/docs/README.md
@@
-# Documentation Overview ...
+# Documentation Index
+
+This folder is the canonical index for repository documentation. Keep it updated whenever docs are added, removed, or renamed.
+
+## Start here
+- `../README.md` — overview + quickstart
+- `getting-started.md` — first-run walkthrough
+
+## Local development
+- `local-development.md` — Node vs Docker vs dev stack workflows
+- `configuration.md` — env vars and defaults (authoritative)
+
+## API reference
+- `api/overview.md` — endpoint list + runnable curl examples
+- `openai-endpoint-golden-parity.md` — canonical parity and golden transcripts
+- `responses-endpoint/overview.md` — implementation notes for `/v1/responses`
+
+## Observability
+- `observability.md` — logs, request IDs, OTEL knobs, metrics
+- `logging-gaps/README.md` — gap tracker
+
+## Deployment and ops
+- `deployment/production.md` — production compose + mounts + smoke tests
+- `ops/runbooks.md` — snapshot/rollback/backup runbooks
```

### Snippet #3 — Replace `.codev/AGENTS.md` with a minimal repo-specific agent prompt

```diff
diff --git a/.codev/AGENTS.md b/.codev/AGENTS.md
--- a/.codev/AGENTS.md
+++ b/.codev/AGENTS.md
@@
-# (unrelated content)
+# codex-completions-api — AGENTS (development)
+
+Optional prompt/config artifact for Codex/agent tooling when working in this repo.
+
+## Scope
+- Node/Express proxy that exposes OpenAI-compatible endpoints and calls the Codex CLI backend.
+- Default backend is **Codex `app-server` (JSON-RPC)**; proto mode is fallback.
+
+## Constraints
+- Never introduce or commit secrets (tokens, auth state, provider credentials).
+- Keep behavior aligned with `docs/openai-endpoint-golden-parity.md`.
+- Prefer minimal, testable changes; update docs when defaults change.
+
+## Useful entry points
+- `server.js` — bootstrap and lifecycle
+- `src/app.js` — routing and middleware
+- `.env.example` — supported configuration knobs
+- `docs/README.md` — doc index
+
+## Quality gates
+- `npm run format:check`
+- `npm run lint`
+- `npm run test:unit`
+- `npm run test:integration`
+- `npm run verify:all`
```

### Snippet #4 — Add `CONTRIBUTING.md` (new file)

```diff
diff --git a/CONTRIBUTING.md b/CONTRIBUTING.md
new file mode 100644
--- /dev/null
+++ b/CONTRIBUTING.md
@@
+# Contributing to codex-completions-api
+
+## Prerequisites
+- Node.js **>= 22**
+- npm
+- Optional: Docker
+
+## Setup
+```bash
+npm i
+cp .env.example .env
+```
+
+## Run locally
+### Dev wrapper
+```bash
+PROXY_API_KEY=your-dev-key npm run dev
+```
+
+### Shim mode (no Codex required)
+```bash
+PROXY_API_KEY=your-dev-key npm run dev:shim
+```
+
+### Project-local Codex HOME
+```bash
+PROXY_API_KEY=your-dev-key npm run start:codev
+```
+
+## Tests and quality gates
+```bash
+npm run format:check
+npm run lint
+npm run test:unit
+npm run test:integration
+npm run verify:all
+```
+
+## Documentation hygiene
+- If docs are added/renamed, update `README.md` and `docs/README.md`.
+
+## Secrets
+- Do not commit credentials/tokens or Codex runtime state.
+- Run secret scanning locally:
+```bash
+npm run secret-scan
+```
```

---

## Needs confirmation (explicit)

These items should be verified by directly cross-referencing the active code paths before finalizing doc wording:

- **Sandbox default behavior:** reconcile contradictory statements against runtime config and enforcement in the request pipeline.
- **Exact health/metrics/usage endpoint paths:** document only after confirming route files and exported router mounts (e.g., `src/routes/health.js`, `src/routes/metrics.js`, `src/routes/usage.js`).
- **Responses gating semantics (`PROXY_ENABLE_RESPONSES`):** document actual behavior by confirming the flag wiring in route registration and middleware.

