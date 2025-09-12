---
title: Server.js Modularization — Brownfield Refactor Plan
status: draft
version: v0.1
updated: 2025-09-11
---

# Objective

Modularize the current monolithic `server.js` into focused modules to improve testability, reliability, and maintainability without changing external API shapes or behavior.

# Current State (Summary)

- Single file (`server.js`) owns: env/config parsing, CORS, access logging, routing, SSE framing, Codex process spawning, error handling, model normalization, and dev logging.
- Cross‑cutting options (keepalive, stop‑after‑tools, tail suppression, timeouts) are inlined across handlers.
- Hard to unit test streaming vs non‑stream paths and env toggles in isolation.

# Target Architecture (Modules)

- `src/app.js`: Construct Express app; register middleware and routers.
- `src/server.js`: Start HTTP server (port/signals) — minimal.
- `src/config/index.js`: Parse + validate env; export flags and derived values.
- `src/config/models.js`: Compute `PUBLIC_MODEL_IDS` and `ACCEPTED_MODEL_IDS`.
- `src/middleware/cors.js`: Global CORS + OPTIONS handling.
- `src/middleware/access-log.js`: Structured access log (req_id, route, status, dur_ms).
- `src/middleware/auth.js`: Bearer check helper for protected routes.
- `src/middleware/error.js`: Centralized error envelope + handler.
- `src/routes/health.js`: `GET /healthz`.
- `src/routes/models.js`: `GET|HEAD|OPTIONS /v1/models` (optional gating).
- `src/routes/chat.js`: `POST /v1/chat/completions` → delegates to handlers.
- `src/routes/completions.js`: `POST /v1/completions` legacy shim.
- `src/routes/usage.js`: `GET /v1/usage{,/raw}` dev usage aggregates (file‑backed NDJSON).
- `src/handlers/chat/nonstream.js`: OpenAI‑shaped non‑stream response; usage calc; tool‑block post‑processing.
- `src/handlers/chat/stream.js`: SSE framing (role‑first), keepalive, cut/tail suppression.
- `src/services/codex-runner.js`: Spawn Codex; args building; env; error mapping.
- `src/services/sse.js`: Helpers for send/keepalive/finish/cleanup.
- `src/lib/normalize-model.js`: Model normalization utilities.
- `src/lib/errors.js`: Error helpers per PRD “Error Envelope Policy”.
- `src/lib/usage.js`: Token estimates + aggregation.

# Phased Plan

## Phase 0 — Safety Nets

- Add structured access log middleware (keep existing console logs temporarily).
- Ensure PRD smoke tests pass pre‑refactor.
  Exit: health/models/chat (stream & non‑stream) pass locally.

## Phase 1 — Config + Errors

- Extract `src/config/*` and `src/lib/errors.js`.
- Replace inline env parsing and error objects with modules.
  Exit: No behavior change; existing tests/smoke pass.

## Phase 2 — Health & Models Routers

- Move `/healthz` and `/v1/models` into `src/routes/*`; mount from `src/app.js`.
- Keep `server.js` as delegator.
  Exit: Headers & behavior identical (incl. optional model gating).

## Phase 3 — Chat Handlers

- Extract non‑stream and stream handlers under `src/handlers/chat/*`.
- Wire via `src/routes/chat.js`.
  Exit: SSE contract unchanged (role‑first deltas; `[DONE]`; keepalives).

## Phase 4 — Codex Runner & SSE Utils

- Move spawn/args/env logic to `src/services/codex-runner.js`.
- Unify keepalive/cut/tail suppression in `src/services/sse.js`.
  Exit: Stream/non‑stream paths share helpers; behavior intact.

## Phase 5 — Cleanup & Logging

- Remove deprecated inline code from `server.js` (no inline POST or spawn logic); gate dev proto logs; prefer structured JSON logs. Move usage helpers under `src/routes/usage.js`.
  Exit: Thin `server.js` bootstrap; clear module boundaries; usage routes mounted via app.

# Risks & Mitigations

- Regression on SSE semantics → Keep Playwright/E2E stream tests; add integration tests for headers/chunk order.
- Env/config drift → Centralize validation; fail fast on missing `CODEX_BIN` or unwritable `CODEX_HOME`.
- Performance changes → Compare p95 non‑stream and TTFC stream vs baselines.

# Acceptance Criteria

- API shapes and headers match current behavior (see PRD “Success Examples”).
- PRD smoke tests pass; existing tests remain green.
- Structured logs include `req_id`, route, status, latency.
- Modules and directory layout match “Target Architecture”.

# Rollback Plan

- Changes are mechanical; if regressions occur, revert the affected phase (git revert) and file a follow‑up issue.

# Metrics & Observability

- Track at edge or sidecar: request count, p50/p95 latency, time‑to‑first‑chunk, open SSE connections, error rates.
- Optional: include a simple `req_id` correlation between access logs and Codex child events.

# Out of Scope

- New features, model support changes, or protocol changes; refactor is non‑functional.

# References

- `docs/bmad/prd.md`
- `docs/bmad/architecture.md`
- `server.js`
