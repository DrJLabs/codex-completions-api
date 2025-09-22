---
title: Tech Stack — Codex Completions API
status: draft
version: v1
updated: 2025-09-13
---

# Runtime & Language

- Node.js: >= 22 (ESM only). See `package.json:81` and local `node -v` in dev.
- Platform: Linux container (Docker) and host (for Traefik ForwardAuth).
- Primary language: JavaScript (ES2023).

# Frameworks & Libraries

- Web framework: `express@^4.19` — routing and middleware.
- Utilities: `nanoid@^5` — request/stream IDs.
- Child process: Node `child_process.spawn` via `src/services/codex-runner.js`.
- Streaming: Server‑Sent Events (SSE) utilities in `src/services/sse.js`.

# External Dependency

- Codex CLI binary (`CODEX_BIN`, default `codex`) invoked as `codex proto ...` with configuration flags for model/provider/sandbox. Home/state in `CODEX_HOME` (dev: `.codev/`, prod: `.codex-api/`), workdir in `PROXY_CODEX_WORKDIR`.

# Authentication & Security

- Bearer token on chat/completions routes; optional gating for `/v1/models`.
- Traefik ForwardAuth microservice (`auth/server.mjs`) validates `Authorization: Bearer` upstream in PROD.
- CORS enabled by default globally; OPTIONS handled centrally.
- Optional in‑app rate limiting: token‑bucket per API key/IP.

# Configuration Surface (selected)

- Core: `PORT`, `PROXY_ENV`, `PROXY_API_KEY`, `PROXY_PROTECT_MODELS`.
- Codex: `CODEX_BIN`, `CODEX_HOME`, `CODEX_MODEL`, `CODEX_FORCE_PROVIDER`, `PROXY_CODEX_WORKDIR`.
- Streaming/SSE: `PROXY_SSE_KEEPALIVE_MS`, `PROXY_SSE_MAX_CONCURRENCY`, `PROXY_KILL_ON_DISCONNECT`.
- Tool‑heavy clients: `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS_GRACE_MS`.
- Timeouts: `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`, `PROXY_PROTO_IDLE_MS`.
- Rate limit: `PROXY_RATE_LIMIT_ENABLED`, `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`.
- CORS/Debug: `PROXY_ENABLE_CORS`, `PROXY_DEBUG_PROTO`, `PROXY_TEST_ENDPOINTS`.

# Testing & QA

- Unit & Integration: `vitest@^3` (+ `@vitest/coverage-v8`).
- E2E/API/SSE: `@playwright/test@^1.55`.
- Coverage target configured in `vitest.config.ts` (V8 engine).
- CI Baseline (2025-09-20): GitHub Actions runners and Docker images must install Playwright 1.55 browsers (Chromium 140 / Firefox 141 / WebKit 26) and Vitest 3.2.x. The Keploy installer (`https://keploy.io/install.sh`) currently provisions CLI v2.10.25; capture the version in logs and note that `--generate-report` is unavailable until Keploy 3.x ships.
- Keploy proxy snapshots: run the installer after auditing it, then rely on `config/keploy.yaml` (2.x-compatible numeric delays + `globalNoise.body`) with `scripts/keploy-start-server.sh` to drive record/test workflows. `KEPLOY_ENABLED=true` toggles suites to call `keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0`, while fallback mode leaves Vitest/Playwright hitting the Express app directly.
- Run `./scripts/setup-keploy-cli.sh` whenever provisioning the CLI (locally or in CI). The script verifies ports 16789/16790/26789 are free, enforces loopback binding (`KEPLOY_HOST_BIND=127.0.0.1`), downloads the official installer with `curl -fsSL`, and surfaces the installed CLI version.
- CI caches the CLI layer (`~/.keploy` and `~/.cache/keploy`) keyed on `scripts/setup-keploy-cli.sh` + `config/keploy.yaml`. When `KEPLOY_ENABLED=true`, the `keploy-dry-run` job runs `keploy test --config-path config` and uploads logs/metrics artifacts without extending `npm run verify:all` beyond budget (runtime delta logged for visibility).
- The repository GitHub environment stores `KEPLOY_ENABLED=true` so the dry-run job executes automatically on pushes. It remains labelled a “dry run” because it replays previously recorded snapshots and never attempts to capture live traffic or hit external services; failures surface contract drift without disrupting the main test matrix.
- Environment variables: `KEPLOY_MODE` (default `test`), `KEPLOY_APP_PORT` (11436 by default for local evidence runs), `KEPLOY_RECORD_PORT` (16789), `KEPLOY_TEST_PORT` (16790), `KEPLOY_DNS_PORT` (26789), and `KEPLOY_HOST_BIND` (loopback) are documented in `.env.example` / `.env.dev` for developers enabling the proxy locally.
- Keploy replays execute on the self-hosted runner `codex-keploy-ci-01` (labels: `self-hosted`, `linux`, `keploy`) to satisfy CAP_IPC_LOCK; CI runs `CI #459–463` validated the setup while GitHub-hosted runners remain blocked on memlock constraints and private-repo minute limits.

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
- Long‑lived SSE: budget file descriptors and timeouts accordingly; consider replica scaling and `PROXY_SSE_MAX_CONCURRENCY` for backpressure.
