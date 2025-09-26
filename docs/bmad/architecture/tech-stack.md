---
title: Tech Stack — Codex Completions API
status: active
version: v1.1
updated: 2025-09-26
---

# Runtime & Language

- Node.js: ≥ 22 (ESM only). Enforced via `package.json` `engines.node` (`>=22`) and `.nvmrc` (22) across dev/prod.
- Platform: Linux container (Docker) for proxy; host services for Traefik ForwardAuth and backups.
- Primary language: JavaScript (ES2023) with modern syntax enabled by Node 22.

# Frameworks & Libraries

- Web framework: `express@^4.19` — routing and middleware.
- Utilities: `nanoid@^5` — request/stream IDs.
- Child process: Node `child_process.spawn` via `src/services/codex-runner.js`.
- Streaming: Server‑Sent Events (SSE) utilities in `src/services/sse.js`.

# External Dependency

- Codex CLI package (`@openai/codex`) mounted at `/usr/local/lib/codex-cli` inside containers; `CODEX_BIN` defaults to `/usr/local/lib/codex-cli/bin/codex.js`. Home/state in `CODEX_HOME` (dev: `.codev/`, prod: `.codex-api/`), workdir in `PROXY_CODEX_WORKDIR`.
- Dev can optionally install ad-hoc Codex CLI builds under `~/.codex-dev/bin` for local experiments; production always uses the mounted package volume.

# Authentication & Security

- Bearer token on chat/completions routes; optional gating for `/v1/models`.
- Traefik ForwardAuth microservice (`auth/server.mjs`) validates `Authorization: Bearer` upstream in PROD.
- CORS enabled by default globally; OPTIONS handled centrally.
- Optional in‑app rate limiting: token‑bucket per API key/IP.

# Configuration Surface (selected)

- Core: `PORT`, `PROXY_ENV`, `PROXY_API_KEY`, `PROXY_PROTECT_MODELS`.
- Codex: `CODEX_BIN`, `CODEX_HOME`, `CODEX_MODEL`, `CODEX_FORCE_PROVIDER`, `PROXY_CODEX_WORKDIR`.
- Streaming/SSE: `PROXY_SSE_KEEPALIVE_MS`, `PROXY_SSE_MAX_CONCURRENCY`, `PROXY_KILL_ON_DISCONNECT`.
- Tool-heavy clients: `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS_GRACE_MS`, `PROXY_ENABLE_PARALLEL_TOOL_CALLS` (dev-only passthrough for Codex parallel tool calls; keep disabled in prod for determinism).
- Timeouts: `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`, `PROXY_PROTO_IDLE_MS`.
- Rate limit: `PROXY_RATE_LIMIT_ENABLED`, `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`.
- CORS/Debug: `PROXY_ENABLE_CORS`, `PROXY_DEBUG_PROTO`, `PROXY_TEST_ENDPOINTS`.

# Testing & QA

- Unit & Integration: `vitest@^3` (+ `@vitest/coverage-v8`).
- E2E/API/SSE: `@playwright/test@^1.55` with streaming transcript fixtures.
- Coverage target configured in `vitest.config.ts` (V8 engine).
- CI baseline (2025-09-25): GitHub Actions runners and Docker images must install Playwright 1.55 browsers (Chromium 140 / Firefox 141 / WebKit 26) and Vitest 3.2.x; live E2E asserts `/v1/models` advertises `codev-5*` in dev and `codex-5*` in prod.
- Benchmark harness: `scripts/benchmarks/stream-multi-choice.mjs` now shells out to `ps` for RSS/CPU instead of `pidusage`, avoiding additional deps.
- Keploy snapshot replay was an experimental path and is **shelved as of 2025-09-22**. CI no longer installs the Keploy CLI or runs the dry-run workflow; the dedicated runner has been decommissioned. Future replay automation should revisit tooling once a lighter-weight solution is chosen.

# Linting & Formatting

- ESLint 9 (flat config) with plugins: import, n, promise, security; Prettier 3 for formatting.
- `npm run verify:all` runs format check, lint, unit, integration, and E2E.

# Build & Packaging

- Dockerfile: builds app image.
- Production compose: `docker-compose.yml` (source of truth for Traefik labels and networks).
- Dev stack: `compose.dev.stack.yml` with Traefik on host, app container, and ForwardAuth.
- Systemd unit: `systemd/codex-openai-proxy.service` for host‑level management.

# Ingress & Edge

- Traefik (host/system service) with ForwardAuth target `http://127.0.0.1:18080/verify`.
- Cloudflare as public edge (DNS/SSL); routes forward to Traefik origin.

# Logging & Observability

- Structured JSON access logs (`src/middleware/access-log.js`) to stdout.
- Usage and proto event NDJSON in temp dir (`src/dev-logging.js`); aggregated via `/v1/usage`.
- No builtin Prometheus metrics; rely on logs/edge metrics.

# Model IDs

- DEV advertises `codev-5{,-low,-medium,-high,-minimal}`; PROD advertises `codex-5{,…}`; both prefixes accepted everywhere, normalized to runtime `CODEX_MODEL`.
- Runtime `CODEX_MODEL` should stay at the default (`gpt-5`). Dev API keys cannot invoke `gpt-5-minimal`
  directly; forcing `CODEX_MODEL=gpt-5-minimal` results in `400 Unsupported model` responses. Let the
  proxy handle reasoning effort mapping instead.

# Operational Notes

- `.codex-api/` MUST be writable in production; do not mount read‑only.
- Mount `/usr/local/lib/codex-cli` read-only from the project (`./node_modules/@openai/codex`) into both dev and prod stacks so Codex CLI binaries and vendor assets remain aligned.
- Long‑lived SSE: budget file descriptors and timeouts accordingly; consider replica scaling and `PROXY_SSE_MAX_CONCURRENCY` for backpressure.
- Enable `PROXY_ENABLE_PARALLEL_TOOL_CALLS=true` only in dev stacks when experimenting with Codex parallel tool execution; production leaves it unset/false to keep serialized tooling.
