# Decision Architecture

## Executive Summary

Codex Completions API is migrating from per-request `codex proto` executions to a supervised Codex App Server worker while preserving the OpenAI-compatible `/v1/chat/completions` surface. The design introduces an inline supervisor, single JSON-RPC transport, and expanded observability so Phase 4 implementation can proceed without regressions.

## Project Initialization

This is a brownfield upgrade of `codex-completions-api`; no starter CLI is used. The first implementation story should wire the worker supervisor behind the existing feature flag (`PROXY_USE_APP_SERVER`) in this repository’s current layout.

## Decision Summary

| Category           | Decision                                                                                                                                   | Version                                                                                  | Affects Epics | Rationale                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| Worker Supervision | Inline supervisor module manages a single `codex app-server` child with exponential backoff (250 ms → 5 s) and 10 s graceful drains        | Node.js v22.21.0 (verified 2025‑10‑30 via `node -v`)                                     | 1, 3          | Keeps orchestration co-located, gives precise restart control, feeds lifecycle telemetry |
| Transport          | Maintain one persistent JSON-RPC channel with configurable `WORKER_MAX_CONCURRENCY` and per-request timeouts                               | `@openai/codex` v0.49.x (latest 0.50.0 verified 2025‑10‑30 via `npm view @openai/codex`) | 1, 2          | Meets FR006/FR008 while avoiding multi-worker complexity                                 |
| Runtime Config     | Feature flag `PROXY_USE_APP_SERVER` toggles proto vs. worker without redeploy                                                              | n/a                                                                                      | 1, 4          | Simple rollout control and documented operator workflow                                  |
| Health & Lifecycle | Extend `/healthz`/`/readyz` to require worker handshake and supervise graceful SIGTERM drains                                              | express 4.21.2 (latest 5.1.0 verified 2025‑10‑30 via `npm view express`)                 | 1, 3, 4       | Protects cutover by ensuring readiness reflects worker state                             |
| Observability      | Structured JSON logs plus Prometheus metrics (`prom-client`@15.1.3, verified 2025‑10‑30) for worker lifecycle, latency, and restart counts | prom-client 15.1.3                                                                       | 3, 4          | Satisfies FR010–FR011 and enables cutover dashboards                                     |
| Trace Artifacts    | Ephemeral ring buffer in `.codex-api/trace-buffer/` (max 100 files or 24 h TTL) with existing PII scrubbing                                | n/a                                                                                      | 3             | Supports FR012 without long-term retention risk                                          |
| Deployment         | Continue Docker Compose + Traefik stack; mount `.codex-api/` RW and propagate readiness probes                                             | docker compose plugin v2.x (host baseline)                                               | 4             | Aligns with production routing rules and runbooks                                        |
| Security           | Secrets remain in env variables / `.env*`; `CODEX_HOME` points to `.codex-api/`; worker inherits only required env                         | n/a                                                                                      | 1, 4          | Avoids secret sprawl and keeps worker state writable                                     |
| Operations         | Add maintenance flag (`PROXY_MAINTENANCE_MODE` and guarded toggle endpoint) returning 503 with retry hints                                 | n/a                                                                                      | 3, 4          | Gives on-call engineers rapid, documented traffic throttling                             |

## Project Structure

```
codex-completions-api/
├─ server.js
├─ src/
│  ├─ config/
│  ├─ handlers/
│  │  └─ chat/
│  ├─ lib/
│  ├─ middleware/
│  ├─ services/
│  └─ utils.js
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ scripts/
│  ├─ smoke/
│  ├─ qa/
│  └─ dev.sh
├─ docs/
│  ├─ PRD.md
│  ├─ epics.md
│  ├─ bmm-workflow-status.md
│  ├─ app-server-migration/
│  └─ stories/
├─ docker-compose.yml
├─ compose.dev.stack.yml
├─ systemd/
└─ .codex-api/
```

## Epic to Architecture Mapping

| Epic                                            | Architectural Boundary                                                         | Notes                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Epic 1 – App-Server Platform Foundation         | `src/services/worker`, `src/config`, `docker-compose.yml`                      | Supervisor, feature flag plumbing, lifecycle hooks              |
| Epic 2 – `/v1/chat/completions` JSON-RPC Parity | `src/routes`, `src/handlers/chat`, `src/lib/json-rpc*`, `tests/integration`    | Adapters, SSE parity, request/response translation              |
| Epic 3 – Observability & Ops Hardening          | `src/middleware/logging`, `src/services/metrics`, `scripts/smoke`, `tests/e2e` | Structured logging, Prometheus metrics, smoke tooling           |
| Epic 4 – Production Cutover & Validation        | `docker-compose.yml`, `scripts/port-*`, `docs/app-server-migration`            | Feature flag defaults, readiness gating, maintenance playbooks  |
| Epic 5 – `/v1/responses` Expansion              | Future `src/handlers/responses` sharing transport & observability              | Reuses worker channel and patterns once chat cutover stabilizes |

## Technology Stack Details

### Core Technologies

- **Node.js v22.21.0** — runtime for Express proxy and supervisor (verified 2025‑10‑30).
- **Express 4.21.2** — HTTP routing layer; continue on 4.x LTS while tracking 5.x GA (latest 5.1.0 verified 2025‑10‑30).
- **`@openai/codex` 0.49.x** — Codex App Server CLI bindings (latest 0.50.0 verified 2025‑10‑30); upgrade once JSON-RPC regression tests confirm parity.
- **Prometheus `prom-client` 15.1.3** — metrics export for worker lifecycle (version verified 2025‑10‑30 via `npm view prom-client`).
- **Vitest + Playwright** — unit/integration/E2E verification harness.

### Integration Points

- **JSON-RPC Transport**: `src/services/transport` maintains a single worker channel, handling request IDs, timeouts, and concurrency limits.
- **SSE Gateway**: `/v1/chat/completions` routes stream worker deltas through `src/handlers/chat/stream.js`, emitting role-first deltas plus `[DONE]` terminator.
- **Lifecycle Telemetry**: `src/services/metrics` pushes Prometheus counters/histograms; structured logs flow through existing log pipeline with additional worker fields.
- **Health & Maintenance**: `/healthz`/`/readyz` include worker state checks; maintenance middleware consults `PROXY_MAINTENANCE_MODE` or the guarded toggle endpoint to emit 503s with retry hints.
- **Deployment**: Docker Compose services mount `.codex-api/` RW, set `CODEX_HOME`, and forward Traefik probes; systemd units remain for host-level integrations.

## Implementation Patterns

- **Naming**
  - REST endpoints stay pluralized (`/v1/chat/completions`); query parameters use `snake_case`.
  - JSON payloads mirror OpenAI schema exactly; internal telemetry sits under `codex_metadata`.
  - Environment variables remain UPPER_SNAKE_CASE (`PROXY_USE_APP_SERVER`, `WORKER_MAX_CONCURRENCY`).
  - Metrics follow Prometheus snake_case (`codex_worker_restarts_total`, `codex_worker_latency_ms_bucket`).

- **Structure**
  - Code organized by responsibility (routes, handlers, middleware, services, config).
  - Tests mirror source layout: `tests/unit/<module>.test.js`, `tests/integration/<area>.test.js`, Playwright suites under `tests/e2e/`.
  - Shared constants/types live in `src/config` and are re-exported via `src/config/index.js`.

- **Format**
  - Error responses use `{ "error": { "code": string, "message": string, "retryable": boolean } }`.
  - Successful responses remain OpenAI-compatible; extra data added as `codex_metadata`.
  - SSE events emit role-first deltas and terminate with `data: [DONE]`.

- **Communication**
  - JSON-RPC payloads always include `id`, `method`, `params`; responses validated before streaming.
  - Worker lifecycle events generate structured logs and metrics; no ad-hoc console logging.
  - Maintenance flag returns HTTP 503 with `Retry-After` plus `retryable: true` in the error envelope.

- **Lifecycle**
  - SIGTERM/SIGINT: stop accepting new requests, await in-flight completion up to `WORKER_SHUTDOWN_GRACE_MS` (default 10000 ms), then terminate worker.
  - Restart policy: exponential backoff capped at 5000 ms; after five consecutive failures surface `critical` log and mark `/healthz` degraded.
  - Readiness only true after worker handshake succeeds and backoff window is clear.

- **Location**
  - Runtime artifacts (trace buffer, Codex sessions) live under `.codex-api/`; nothing writes outside that tree.
  - Configuration docs and flag references captured in `docs/app-server-migration/` and `.env.example`.
  - Maintenance toggle endpoint mounted under `/internal/maintenance` with bearer protection.

- **Consistency**
  - Logs are JSON with ISO timestamps, `level`, `component`, `request_id`, and worker metadata.
  - Dates/times in APIs use ISO-8601 UTC strings; internal duration math uses `Date.now()` deltas.
  - Test strategy: unit → integration → Playwright E2E; smoke scripts in `scripts/smoke/` for dev/staging/prod.
  - Documentation updates accompany any flag or operational change (PR summary + runbooks).

## Consistency Rules

### Naming Conventions

- Endpoint routes pluralized and versioned (`/v1/chat/completions`).
- Env vars are uppercase snake case; metrics snake case; JSON fields adhere to OpenAI schema.

### Code Organization

- Keep HTTP wiring in routes, business logic in handlers/services, shared helpers in `src/lib` or `src/utils.js`.
- Tests colocated per layer with mirrored paths.

### Error Handling

- Central error middleware converts failures into `{ error: { code, message, retryable } }` with matching HTTP status.
- Worker unavailability maps to `WORKER_UNAVAILABLE` and sets `retryable: true` when backoff is active.

### Logging Strategy

- Use structured JSON logs everywhere; include worker lifecycle fields (`event`, `exit_code`, `backoff_ms`).
- Levels: `info` (normal), `warn` (recoverable), `error` (failures). Attach `request_id` for all routed traffic.

## Data Architecture

- API remains stateless; data persistence limited to ephemeral trace buffers and Codex worker session files under `.codex-api/`.
- Supervisory state (restart counters, maintenance flag) held in-memory and exposed via health endpoints.

## API Contracts

- `/v1/chat/completions` and `/v1/completions` maintain OpenAI-compatible request/response schemas for streaming and non-streaming modes.
- Errors follow the unified envelope; maintenance flag triggers 503 with retry hints.
- `/v1/models` advertises Codex models but respects `PROXY_PROTECT_MODELS` when enabled.

## Security Architecture

- Bearer token required for all non-health routes; validation occurs before hitting handler stack.
- Secrets injected via env or `.env` (documented in `.env.example`); never committed.
- Worker runs with inherited env only; `CODEX_HOME` points to writable `.codex-api/` mount.
- Maintenance toggle endpoint protected by bearer auth and omitted from public routers.

## Performance Considerations

- `WORKER_MAX_CONCURRENCY` caps concurrent JSON-RPC requests; defaults sized from current SLA load (<70 % CPU at peak).
- Timeout defaults (e.g., `WORKER_REQUEST_TIMEOUT_MS`) keep first-token latency within ±5 % of baseline (NFR002).
- Exponential backoff plus readiness gating satisfies restart recovery target (<10 s per NFR004).
- Metrics (`codex_worker_latency_ms`, `codex_worker_restarts_total`) feed dashboards and alerting.

## Deployment Architecture

- Docker Compose service attaches to external `traefik` network with unchanged labels; readiness probes call `/readyz` to ensure worker is healthy before traffic.
- `.codex-api/` mounted RW in container; Compose env sets `PROXY_USE_APP_SERVER`, `WORKER_MAX_CONCURRENCY`, `PROXY_MAINTENANCE_MODE` (default `false`).
- Systemd unit optionally supervises the Compose stack; runbooks updated to include maintenance toggle usage.

## Development Environment

### Prerequisites

- Node.js ≥ 22.21.0
- Docker Engine ≥ 26 with compose plugin ≥ 2.x
- `npm ci` with GitHub Packages access for `@openai/codex`
- `npx playwright install --with-deps chromium`

### Setup Commands

```bash
npm ci
npx playwright install --with-deps chromium
HUSKY=0 npm run verify:all
npm run dev:stack:up   # optional full dev stack with Traefik + worker
```

## Architecture Decision Records (ADRs)

1. **ADR-001 – Worker Supervision Inline**: keep supervisor in-process for deterministic restart/backoff and unified telemetry.
2. **ADR-002 – Single JSON-RPC Channel**: enforce bounded concurrency through one persistent transport to simplify parity and error handling.
3. **ADR-003 – Feature Flag Rollout**: manage proto ↔ app-server cutover via `PROXY_USE_APP_SERVER` so ops can flip without redeploy.
4. **ADR-004 – Observability Expansion**: adopt Prometheus metrics plus structured logs for lifecycle transparency and SLA guarantees.
5. **ADR-005 – Maintenance Flag**: provide documented maintenance mode returning 503 with retry hints for controlled degradation.

---

_Generated by BMAD Decision Architecture Workflow v1.0_
_Date: 2025-10-30_
_For: drj_
