---
title: Source Tree — Codex Completions API
status: draft
version: v1
updated: 2025-09-13
---

# Overview

This document maps the repository layout to the modular architecture described in `docs/bmad/architecture.md`. It highlights entry points, module boundaries, and where tests and ops artifacts live.

# Top-Level

```
server.js                      # HTTP bootstrap (listen + signals)
docker-compose.yml             # PROD compose (Traefik labels are authoritative)
Dockerfile                     # App image
compose.dev.stack.yml          # Dev stack (Traefik + proxy)
README.md                      # Project guide
AGENTS.md                      # Agent directives & repo rules
.env*                          # Local env (never commit secrets)
docs/                          # Architecture, PRD, runbooks, diagrams
auth/                          # Traefik ForwardAuth microservice
src/                           # Application code (Express + modules)
tests/                         # Unit, integration, E2E
scripts/                       # Dev/CI/ops helpers
systemd/                       # User service unit (production host)
.codev/                        # Dev Codex HOME (local)
.codex-api/                    # Prod Codex HOME (writable mount; not tracked)
web-bundles/                   # Optional agent/team bundles (docs/examples)
config/                        # Example provider configs
```

# `src/` Modules

```
src/app.js                     # App factory: JSON limit, CORS, logs, rate-limit, routers
src/config/index.js            # Env surface & defaults
src/config/models.js           # Advertised & accepted model IDs
src/routes/health.js           # GET /healthz
src/routes/models.js           # GET|HEAD /v1/models (optional gating)
src/routes/chat.js             # POST /v1/chat/completions and /v1/completions (shim)
src/routes/usage.js            # GET /v1/usage{,/raw}
src/handlers/chat/nonstream.js # Chat (non-stream)
src/handlers/chat/stream.js    # Chat (SSE stream) + legacy completions stream
src/handlers/chat/shared.js    # Proto arg builder
src/services/codex-runner.js   # spawn("codex", args…), env & workdir
src/services/sse.js            # SSE headers, keepalives, finish
src/middleware/access-log.js   # Structured access log + X-Request-Id
src/middleware/rate-limit.js   # Optional token-bucket limiter
src/lib/errors.js              # Error envelope helpers
src/dev-logging.js             # NDJSON usage + proto event logs (DEV)
src/utils.js                   # tokens, join, CORS, model normalization
```

Key responsibilities:

- `server.js`: thin bootstrap only (`server.js:4`).
- `src/app.js`: mounts global middleware (JSON 16 MiB, CORS, logs, optional rate limit) and routers.
- `routes/*`: HTTP surface; no business logic beyond auth/shape gating.
- `handlers/*`: Codex spawn, SSE framing, shaping, usage logging.
- `services/*`: process/SSE primitives reusable by handlers.
- `middleware/*`: cross‑cutting concerns (access log, rate limiting).

# `auth/` (ForwardAuth)

```
auth/server.mjs                # /verify and /healthz; CORS; WWW-Authenticate on 401
auth/server.js                 # (legacy or alt build target)
auth/package.json
```

# Tests

```
tests/unit/                    # Vitest: pure helpers (utils, dev-logging)
tests/integration/             # Vitest: routes, headers, rate-limit, idle/kill, timeouts
tests/e2e/                     # Playwright: models, non-stream chat, streaming SSE
playwright.config.ts           # E2E runner config
playwright.live.config.ts      # Live E2E config
vitest.config.ts               # Unit/integration config & coverage
```

# Scripts & Ops

```
scripts/dev.sh                 # Local dev launcher (optionally shim backend)
scripts/dev-smoke.sh           # Dev smoke checks
scripts/prod-smoke.sh          # Prod smoke (edge + origin)
scripts/test-live.sh           # Live E2E against a domain
scripts/stack-*.sh             # Snapshot / rollback helpers
scripts/sync-codex-config.sh   # Port .codev → .codex-api (non-secret)
scripts/svg2png.playwright.mjs # Diagram export helper
```

# Docs (selected)

```
docs/bmad/architecture.md                      # Architecture overview (v2)
docs/bmad/architecture/source-tree.md          # This document
docs/bmad/architecture/tech-stack.md           # Runtime & tooling
docs/bmad/architecture/sequence-stream.md      # Streaming sequence diagram
docs/bmad/architecture/server-modularization-refactor.md
docs/request-flow.svg | docs/architecture.svg | docs/architecture.png
```

# Conventions

- ESM only (`type: module`).
- Keep modules focused and testable (handlers/services/utils separated).
- All routes live under `/v1/*` except `/healthz`.
- Prefer structured logs; keep console noise minimal at info level.
- Treat `.codex-api/` as writable in production; use `PROXY_CODEX_WORKDIR` for runtime scratch.
