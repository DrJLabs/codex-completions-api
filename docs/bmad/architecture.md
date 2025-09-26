---
title: Codex Completions API — Architecture
status: active
version: v2.2
updated: 2025-09-26
---

# Introduction

Codex Completions API is a Node/Express proxy that fronts the Codex CLI (`codex proto`) with an OpenAI Chat Completions-compatible surface. The service now follows the modular structure introduced during the server refactor and has since been hardened by streaming parity and stability epics. This document captures the current architecture, integration points, and operational invariants required for continued enhancements as of 2025-09-26.

## Starter Template or Existing Project

Brownfield enhancement of the existing codex-completions-api repository; no external starter template is used. Architecture decisions assume the current monorepo layout, Docker stack, and Traefik edge already in place.

# Existing Project Analysis

## Current Project State

- **Primary Purpose:** Provide a drop-in replacement for OpenAI Chat Completions, translating requests to Codex CLI while preserving response envelopes.
- **Current Tech Stack:** Node.js ≥ 22, Express 4.19, Vitest, Playwright, Docker Compose, Traefik ForwardAuth, Cloudflare edge.
- **Architecture Style:** Modular Express application (routers, handlers, services, middleware) spawning short-lived Codex child processes per request.
- **Deployment Method:** Docker Compose in prod, fronted by host-level Traefik attached to an external `traefik` network; `.codex-api/` mounted writable for Codex state.

## Available Documentation

- `docs/bmad/prd.md` — Product requirements, KPIs, smoke tests.
- `docs/openai-chat-completions-parity.md` — Contract notes for streaming order and error envelopes.
- `docs/bmad/stories/*` — Epic and story execution details (parity, modularization, stability).
- `docs/runbooks/operational.md` and `docs/dev-to-prod-playbook.md` — Operational runbooks and deployment guidance.
- `docs/bmad/architecture/*` — Deeper breakdowns (source tree, tech stack, modularization references).

## Identified Constraints

- Traefik ForwardAuth must continue to target `http://127.0.0.1:18080/verify`; do not switch to container hostname unless Traefik is containerized.
- `.codex-api/` must remain writable in prod; enforcing read-only breaks Codex session persistence and streaming state.
- Containers bake the Codex CLI (`@openai/codex`) into the image at build time (`/usr/local/lib/codex-cli`); `CODEX_BIN` defaults to `/usr/local/lib/codex-cli/bin/codex.js`. Dev stacks can still override `CODEX_BIN` to point at `scripts/fake-codex-proto.js` when shimming the provider.
- `PROXY_SSE_MAX_CONCURRENCY` governs active SSE streams per replica; ensure `ulimit -n` and resource sizing satisfy the concurrency envelope.
- Dev edge relies on `PROXY_DEV_TRUNCATE_AFTER_MS` safeguards; maintain default zero in prod to avoid truncating real traffic.

## Change Log

| Change                                   | Date       | Version | Description                                                                                                                                | Author            |
| ---------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Parallel tools + CLI packaging           | 2025-09-26 | v2.2    | Documented dev parallel tool passthrough, baked Codex CLI into the image, refreshed testing/observability references, updated ops guidance | Architect (codex) |
| Architecture refresh post-stability epic | 2025-09-24 | v2.1    | Documented usage endpoints, concurrency guard service, and updated module maps after Sep 2025 stabilization.                               | Architect (codex) |
| Server modularization doc update         | 2025-09-13 | v2.0    | Captured router/handler/service separation introduced during modularization refactor.                                                      | Architect (codex) |

# Enhancement Scope and Integration Strategy

Recent work centered on brownfield stabilization: enforcing streaming parity, adding usage telemetry endpoints, hardening concurrency guards, and documenting dev/prod operational contracts.

## Enhancement Overview

**Enhancement Type:** Brownfield stabilization & parity

**Scope:** Maintain Chat Completions compatibility, ensure deterministic streaming and usage telemetry, and expose observability tooling.

**Integration Impact:** Medium — touches streaming handlers (`src/handlers/chat/*`), concurrency guard, usage router, logging, and documentation/runbooks.

## Integration Approach

**Code Integration Strategy:** Modular Express app configured in `src/app.js`; routers mount handlers that orchestrate Codex CLI child processes with shared services and middleware. Development stacks can enable `PROXY_ENABLE_PARALLEL_TOOL_CALLS=true` so `codex-runner` passes `--config parallel_tool_calls=true`, while production keeps serialized tool execution for determinism.

**Database Integration:** None; persistence is limited to NDJSON telemetry files written to `${TMPDIR}` or configured paths.

**API Integration:** Maintains OpenAI-compatible shapes; new `/v1/usage` and `/v1/usage/raw` routes share auth expectations via ForwardAuth.

**UI Integration:** Not applicable — no end-user UI components.

## Compatibility Requirements

- Preserve OpenAI response envelopes (non-stream and streaming) including `finish_reason`, `usage`, and error payloads.
- Accept OpenAI-style chat payloads plus legacy prompt payloads via `/v1/completions` shim.
- Keep model normalization parity between advertised IDs and runtime defaults.
- Ensure Traefik/Cloudflare edge routing labels remain unchanged when updating compose files.

# Tech Stack

## Existing Technology Stack

| Category         | Current Technology                      | Version          | Usage in Enhancement                                                         | Notes                                                                                                   |
| ---------------- | --------------------------------------- | ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Runtime          | Node.js                                 | ≥ 22.x           | Hosts Express server and orchestrates Codex child processes.                 | ESM modules only; supports child process flags for parallel tool experiments.                           |
| Web Framework    | Express                                 | 4.19.x           | Router/middleware composition for API surface.                               | JSON body parsing, OPTIONS handling, CORS.                                                              |
| Child Process    | Codex CLI (`codex proto`)               | 2025-09-24 build | Generates completions for each request.                                      | Baked into `/usr/local/lib/codex-cli`; `CODEX_BIN` defaults to `/usr/local/lib/codex-cli/bin/codex.js`. |
| Logging          | Custom JSON + console loggers           | n/a              | Structured access log, concurrency guard telemetry, NDJSON usage/proto logs. | Outputs consumed by runbooks and `/v1/usage`.                                                           |
| Testing          | Vitest, Playwright                      | 3.2.4 / 1.55.0   | Unit & integration tests; E2E SSE contract checks.                           | Driven by `npm run verify:all`.                                                                         |
| Auth             | ForwardAuth service (`auth/server.mjs`) | Node ESM         | Validates bearer keys before proxy routes in prod.                           | Traefik label invariant.                                                                                |
| Containerization | Docker Compose                          | v2               | Prod/dev stacks, attaches to external `traefik` network.                     | Compose file is source of truth for routing labels.                                                     |

## New Technology Additions

None — stabilization leveraged the existing stack and toggles.

# Data Models and Telemetry Records

- **UsageLogEvent** (NDJSON in `TOKEN_LOG_PATH`): `{ ts, prompt_tokens_est, completion_tokens_est, total_tokens_est, model, req_id, route }`. Consumed by `src/routes/usage.js` and aggregated via `aggregateUsage` in `src/utils.js`.
- **ProtoEvent** (optional NDJSON in `PROTO_LOG_PATH`): recordings of Codex proto stdout/stderr and tool blocks when dev logging is enabled.

## Schema Integration Strategy

- Telemetry remains file-based; no database schema changes required.
- Backward compatibility: usage routes cap returned events (`limit` default 200, max 10000) and preserve previous JSON structure.
- NDJSON files are recreated on demand; ensure filesystem permissions allow creation under `${TMPDIR}` or configured paths.

# Component Architecture

## Routers (`src/routes/*`)

- `health.js` — `/healthz` liveness.
- `models.js` — `/v1/models` with optional auth gating.
- `chat.js` — `/v1/chat/completions` and `/v1/completions` (HEAD + POST) delegating to stream/non-stream handlers.
- `usage.js` — `/v1/usage` and `/v1/usage/raw` for telemetry queries.

## Handlers (`src/handlers/chat/*`)

- `nonstream.js` — Validates payloads, normalizes models, interacts with Codex proto, aggregates content/usage, enforces dev truncate guard.
- `stream.js` — Streams SSE chunks, manages concurrency guard, keepalives, tool suppression, usage chunk emission, and final cleanup.
- `shared.js` — Builds Codex CLI argument lists, configures environment, and injects sandbox/workdir settings.

## Services (`src/services/*`)

- `codex-runner.js` — Spawns `codex proto`, manages environment variables, handles stdout/stderr piping, ensures sandbox/workdir compliance, and honors the dev-only `enableParallelTools` flag to pass `--config parallel_tool_calls=true`.
- `sse.js` — Applies SSE headers, schedules keepalives, finalizes stream events.
- `concurrency-guard.js` — Global semaphore controlling concurrent SSE streams, exposing `setupStreamGuard`, `guardSnapshot`, and logging helpers.

## Middleware (`src/middleware/*`)

- `access-log.js` — Structured JSON request log with request IDs and timing.
- `rate-limit.js` — Token-bucket rate limiter keyed by bearer token/IP, configurable via env toggles.

## Config & Utilities

- `src/config/index.js` — Typed env loader for all `PROXY_*`, `CODEX_*`, and sandbox settings.
- `src/config/models.js` — Advertised model ID helpers (dev vs prod).
- `src/utils.js` — Token estimators, usage aggregation, model normalization, CORS helpers.
- `src/dev-logging.js` — Usage/proto NDJSON appenders and `<use_tool>` block extraction.

## Auth & Edge Integration

- `auth/server.mjs` — ForwardAuth sidecar validating bearer keys and mirroring CORS handling for Traefik.
- `docker-compose.yml` — Defines service labels (`traefik.http.routers.codex-*`) and attaches external `traefik` network.

## Scripts & Tooling (`scripts/*`)

- Smoke & live tests (`dev-smoke.sh`, `prod-smoke.sh`, `test-live.sh`).
- Porting utilities (`port-dev-to-prod.sh`, `sync-codex-config.sh`).
- Ops automation (`stack-snapshot.sh`, `stack-rollback.sh`).

# Request Lifecycles

## GET /healthz

1. Express router responds immediately with `{ ok: true, sandbox_mode }` derived from `config.PROXY_SANDBOX_MODE`.
2. No auth required; used by edge health checks and compose health probes.

## GET /v1/models

1. Optional bearer validation occurs in `models.js` when `PROXY_PROTECT_MODELS=true`.
2. Response lists public model IDs based on `PROXY_ENV`; `normalizePublicModels` from `src/config/models.js` ensures environment parity, and Playwright live E2E asserts dev stacks expose `codev-5*` while prod exposes `codex-5*`.

## POST /v1/chat/completions — Non-stream

1. Request validated (`nonstream.validatePayload`); Bearer required (`Authorization` header).
2. Model normalized via `normalizeModel`; tool-tail toggles and dev-only `enableParallelTools` inspected.
3. `codex-runner` spawns `codex proto` with sandbox/workdir and optional provider/effort overrides (`CODEX_FORCE_PROVIDER`, `PROXY_STOP_AFTER_TOOLS*`, plus `parallel_tool_calls=true` when permitted).
4. Handler accumulates stdout events, tracks `<use_tool>` blocks (via `extractUseToolBlocks`), and enforces idle/overall timeouts.
5. Deterministic finalize path returns JSON with aggregated content, `finish_reason`, and usage estimates; dev truncate guard returns `finish_reason:"length"` when configured.

## POST /v1/chat/completions — Stream (SSE)

1. `setupStreamGuard` enforces `PROXY_SSE_MAX_CONCURRENCY`; rejected requests emit 429 with guard headers/logs.
2. SSE headers set (`text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`). Keepalive scheduler respects UA overrides and `X-No-Keepalive` hints.
3. Stream emits role-first delta chunk, successive content deltas, optional tool-tail suppression, optional finish-reason and usage chunks, and final `[DONE]` sentinel. Dev-only parallel tool calls may interleave tool responses; suppression toggles ensure serialized tails in prod.
4. Cleanup releases concurrency guard token, clears keepalive intervals, and optionally kills child process if `PROXY_KILL_ON_DISCONNECT` is true.

## POST /v1/completions (Legacy Shim)

1. Payload converted from prompt format to chat messages; shares validation, spawning, and completion flow with chat handlers.
2. Response or stream mirrors chat behavior, preserving OpenAI envelope semantics for legacy clients.

## `/v1/usage` & `/v1/usage/raw`

1. `parseTime` filters query window; `aggregateUsage` returns totals and optional hourly/daily buckets.
2. Raw endpoint returns capped NDJSON events (`limit` query with safe bounds) for debugging/analytics.
3. Same bearer expectations as other protected routes (enforced via ForwardAuth); no additional schema transformations.

# Security Model

- Bearer token required for chat/completions/usage routes; models route optionally gated via `PROXY_PROTECT_MODELS`.
- ForwardAuth (`auth/server.mjs`) performs pre-request verification in prod deployments.
- In-app rate limiter (disabled by default) guards POST chat/completions; edge rate limiting via Traefik/Cloudflare is recommended primary defense.
- Dev parallel tooling remains opt-in; production disables `PROXY_ENABLE_PARALLEL_TOOL_CALLS` to preserve deterministic sequencing and simplify audit trails.
- Concurrency guard prevents SSE overload; guard telemetry logged for observability.
- CORS enabled by default with origin echo and credentials support; can be disabled via `PROXY_ENABLE_CORS` when edge handles CORS.

# Rate Limiting & Concurrency Guard

- `services/concurrency-guard.js` maintains a global semaphore per process. `setupStreamGuard` logs `acquired`/`rejected`/`released` events and exposes optional headers when `PROXY_TEST_ENDPOINTS=true`.
- `/__test/conc` and `/__test/conc/release` (dev/test only) expose guard state and release hooks for CI scenarios.
- `PROXY_SSE_MAX_CONCURRENCY` defaults to 4 in dev; prod recommended max is 16 (see PRD env profile).

# Observability & Telemetry

- Structured request logs (`[http]` text and JSON) capture latency, auth presence, and user agents.
- Concurrency guard events logged with `[proxy]` prefix for guard monitoring.
- Usage NDJSON and optional proto event logs support `/v1/usage` reporting and debugging.
- Runbooks detail analysis steps for non-stream truncation, streaming order, and dev edge timeouts.
- `scripts/benchmarks/stream-multi-choice.mjs` now samples CPU/RSS via `ps`, removing the `pidusage` dependency for streaming diagnostics.

# Configuration & Environment Profiles

- See `docs/bmad/prd.md#Configuration Surface` for exhaustive env variable list.
- Dev defaults (`.env.dev`): `PROXY_ENV=dev`, advertised `codev-5*`, `PROXY_PROTECT_MODELS=false`, `PROXY_SSE_MAX_CONCURRENCY=4`, `PROXY_DEV_TRUNCATE_AFTER_MS=9000` as needed.
- Prod defaults: `PROXY_PROTECT_MODELS=true`, `PROXY_RATE_LIMIT_ENABLED=true`, `PROXY_SSE_MAX_CONCURRENCY=16`, `PROXY_KILL_ON_DISCONNECT=true`, `PROXY_DEV_TRUNCATE_AFTER_MS=0`.

# Testing & Quality Gates

- Unit tests cover utilities (`tests/unit`); integration tests focus on routes, error envelopes, rate limiting, truncation determinism.
- Playwright E2E suite validates `/v1/models`, non-stream chat, streaming order, and `[DONE]` termination; the live suite additionally asserts dev stacks expose `codev-5*` models while prod exposes `codex-5*` to detect misconfigured environments.
- Golden transcripts stored under `test-results/` back contract checks.
- Test selection policy: changes to handlers/server require `npm run test:integration` + `npm test`; broad changes execute `npm run verify:all`.
- QA gates and risk assessments tracked under `docs/bmad/qa/` per story.

# Deployment & Operations

- `npm run dev:stack:up` spins up dev stack with Traefik and dev domain; `npm run dev:stack:down` tears it down.
- Prod deploy: `docker compose up -d --build --force-recreate` followed by `npm run smoke:prod`.
- `npm run port:prod` automates dev → prod config sync and optional smoke tests.
- `.codex-api/` houses Codex runtime state; ensure volume mounts persist across restarts and align CLI package mount with the project-local path (`./node_modules/@openai/codex`).
- `scripts/stack-snapshot.sh` and `stack-rollback.sh` provide snapshot/rollback automation (dev and prod).

# Troubleshooting Playbook Highlights

- **Non-stream timeouts:** Verify `PROXY_DEV_TRUNCATE_AFTER_MS` and edge timeouts; use `scripts/dev-edge-smoke.sh` for reproduction.
- **Streaming stalls:** Inspect keepalive settings, concurrency guard logs, and SSE client hints (Electron/Obsidian overrides).
- **Unauthorized errors:** Confirm ForwardAuth health (`auth/server.mjs` logs) and bearer key distribution.
- **Rate limit/429 issues:** Check in-app guard toggles and edge rate limiting; capture guard headers via `/__test/conc` when enabled.

# Related Documents

- `docs/bmad/prd.md` — authoritative requirements and KPIs.
- `docs/openai-chat-completions-parity.md` — detailed streaming parity checklist.
- `docs/bmad/architecture/source-tree.md` — directory-level breakdown.
- `docs/bmad/stories/epic-stability-ci-hardening-sep-2025.md` — stability epic outcomes driving current architecture.
- `docs/runbooks/operational.md` — incident response and smoke guidance.
