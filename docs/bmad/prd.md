---
title: Codex Completions API — Product Requirements (PRD)
status: active
version: v1.1
updated: 2025-09-24
---

# Goals and Background Context

## Goals

- Deliver an OpenAI Chat Completions-compatible proxy so existing SDKs, IDEs, and CI tooling work without code changes.
- Maintain reliable, low-latency access to Codex via clearly defined SLOs, guardrails, and automated smoke tests for both dev and prod environments.
- Provide observability, configuration toggles, and operational guidance that let platform and QA teams diagnose issues quickly.

## Background Context

The Codex Completions API fronts the Codex CLI (`codex proto`) with a lightweight Node/Express service so clients can keep using the OpenAI Chat Completions contract. The system matured through the server modularization refactor, OpenAI parity epic, and the September 2025 stability campaign, adding structured logging, rate limiting, streaming refinements, and contract tests. This document now aligns with BMAD core expectations and reflects the repository as of 2025-09-24.

## Change Log

| Date       | Version | Description                                                                   | Author     |
| ---------- | ------- | ----------------------------------------------------------------------------- | ---------- |
| 2025-09-24 | v1.1    | Rebuilt PRD to match BMAD template, added usage endpoints, epics, KPIs update | PM (codex) |
| 2025-09-14 | v1.0    | Initial proxy requirements, routes, and smoke checklist                       | PM (codex) |

# Users & Use Cases

- Developers, SDKs, and IDE integrations that already speak the OpenAI Chat Completions API.
- CI/CD smoke and E2E pipelines (Playwright, contract/golden transcript checks) validating availability and streaming order.
- Platform/Ops staff and runbooks monitoring health, latency, and usage to keep parity with production expectations.

# Requirements

## Functional Requirements

1. **FR1:** Expose `GET /healthz` returning `{ ok: true, sandbox_mode }` without auth for liveness and sandbox telemetry.
2. **FR2:** Expose `GET|HEAD|OPTIONS /v1/models` to advertise environment-specific models (`codev-5*` in dev, `codex-5*` in prod) while respecting `PROXY_PROTECT_MODELS` bearer-gating.
3. **FR3:** Support `POST /v1/chat/completions` (non-stream) with OpenAI-compatible response body, including stable `id`, `object:"chat.completion"`, `created`, normalized `model`, `choices`, `usage`, and `finish_reason` semantics (`stop`, `length`, etc.).
4. **FR4:** When `stream:true`, emit SSE chunks with role-first delta, deterministic `created`/`id`/`model`, optional usage chunk when `stream_options.include_usage:true`, keepalive comments, and final `[DONE]` line. Honor tool-tail controls and concurrency guard outcomes.
5. **FR5:** Provide `POST /v1/completions` shim that maps prompt-based payloads onto the chat handlers, preserving auth, streaming options, and envelope parity.
6. **FR6:** Surface usage telemetry via `GET /v1/usage` (aggregated metrics) and `GET /v1/usage/raw` (bounded NDJSON events) for internal QA/ops workflows.
7. **FR7:** Offer optional in-app token-bucket rate limiting (`PROXY_RATE_LIMIT_ENABLED`, `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`) that defends POST chat/completions endpoints in addition to edge rate limiting.
8. **FR8:** Enforce streaming concurrency guard and tool-response shaping toggles through env vars (`PROXY_SSE_MAX_CONCURRENCY`, `PROXY_STOP_AFTER_TOOLS`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_STOP_AFTER_TOOLS_GRACE_MS`, `PROXY_TOOL_BLOCK_MAX`).
9. **FR9:** When `PROXY_TEST_ENDPOINTS=true`, expose `GET /__test/conc` and `POST /__test/conc/release` to inspect/release SSE guard state for CI debugging only.

## Non-Functional Requirements

1. **NFR1:** All protected endpoints require `Authorization: Bearer <PROXY_API_KEY>`; prod traffic is pre-authenticated by Traefik ForwardAuth (`auth/server.mjs`) at `http://127.0.0.1:18080/verify`.
2. **NFR2:** Maintain OpenAI envelope compatibility (error shape `{ error: { message, type, param?, code? } }`, normalized model IDs, optional `system_fingerprint`). Unknown parameters are ignored gracefully.
3. **NFR3:** Provide structured JSON access logs with `req_id`, latency, auth presence, and route plus a text log line for existing observers; record usage events to `TOKEN_LOG_PATH` NDJSON for analytics.
4. **NFR4:** Achieve 99.9% monthly availability, non-stream p95 ≤ 5 s, stream TTFC p95 ≤ 2 s, and 5xx error rate < 1% (auth errors excluded). Keep SSE connections alive with configurable `PROXY_SSE_KEEPALIVE_MS`.
5. **NFR5:** Service remains stateless; `.codex-api/` must stay writable in prod for Codex sessions. Sandbox defaults to `danger-full-access`; `PROXY_CODEX_WORKDIR` isolates Codex runtime files (default `/tmp/codex-work`).
6. **NFR6:** Protect streaming stability with `PROXY_SSE_MAX_CONCURRENCY`, optional `PROXY_KILL_ON_DISCONNECT`, and dev-only truncate guard (`PROXY_DEV_TRUNCATE_AFTER_MS`) without regressing contract order.
7. **NFR7:** Respect Test Selection Policy — touching `server.js`, handlers, or streaming code mandates `npm run test:integration` and `npm test`; broader changes run `npm run verify:all`.

# User Interface Design Goals

Not applicable — service is API-only with no end-user UI. Surface consumer-facing behavior through OpenAI-compatible API responses and docs.

# Technical Assumptions & Constraints

## Platform & Runtime

- Node.js ≥ 22.x, Express 4.19.x, `nanoid` for IDs; ESM modules only.
- The proxy shells out to Codex CLI (`codex proto`) using `src/services/codex-runner.js`, respecting `CODEX_BIN`, `CODEX_HOME`, and sandbox/workdir envs.
- Runs behind Traefik + Cloudflare; compose/service labels in `docker-compose.yml` are authoritative for prod.

## External Integrations

- Traefik ForwardAuth invokes `auth/server.mjs`; do not change the verify URL unless Traefik runs inside the same Docker network.
- Edge smoke tests rely on `.env`/`.env.dev` keys and domains (`DOMAIN`, `DEV_DOMAIN`); maintain them for `scripts/prod-smoke.sh` and `scripts/dev-smoke.sh`.

## Development & QA Practices

- Default verification path: `npm run verify:all` (format → lint → unit → integration → Playwright E2E).
- Contract coverage uses Playwright golden transcripts plus Vitest integration tests; Keploy snapshots are optional and currently paused per Story 3.6.
- Follow BMAD branching (`feat/*`, `fix/*`, `chore/*`) and commit style (Conventional Commits) before PRs.

# API Surface & Behavior

## Endpoint Summary

| Endpoint                   | Methods              | Auth                                          | Notes                                                                                |
| -------------------------- | -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/healthz`                 | `GET`                | None                                          | Returns `{ ok: true, sandbox_mode }` for liveness.                                   |
| `/v1/models`               | `GET, HEAD, OPTIONS` | Optional (see `PROXY_PROTECT_MODELS`)         | Advertises environment-specific models; HEAD responds 200 with JSON content-type.    |
| `/v1/chat/completions`     | `POST`               | Bearer required                               | Core Chat Completions route; supports streaming and non-stream with OpenAI envelope. |
| `/v1/completions`          | `POST`               | Bearer required                               | Legacy shim translating prompt payloads to chat backend.                             |
| `/v1/usage`                | `GET`                | Bearer required (via ForwardAuth)             | Aggregated usage counts (`parseTime` query filters).                                 |
| `/v1/usage/raw`            | `GET`                | Bearer required (via ForwardAuth)             | Returns bounded NDJSON events with `limit` (default 200, max 10000).                 |
| `/__test/conc*` (dev only) | `GET`, `POST`        | Bearer required + `PROXY_TEST_ENDPOINTS=true` | Observability hooks for SSE guard in CI/dev only.                                    |

## Streaming Contract & Tool Controls

- Role-first SSE chunk, then content deltas, optional empty delta with `finish_reason`, optional usage chunk, and final `[DONE]` line.
- `PROXY_SSE_KEEPALIVE_MS` emits keepalive comments (disabled for Electron/Obsidian UAs or when `X-No-Keepalive: 1` / `?no_keepalive=1`).
- Tool-aware options: `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE` (`burst`|`first`), `PROXY_STOP_AFTER_TOOLS_GRACE_MS`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_MAX`.

## Error Envelope & Validation

- Authentication failures return HTTP 401 with `WWW-Authenticate` header and `code:"invalid_api_key"`.
- Invalid models return HTTP 404 with `code:"model_not_found"` and `param:"model"`.
- Rate limiting yields HTTP 429 with `code:"rate_limit_error"` when in-app guard is enabled.

## Representative Responses

### GET /v1/models

```json
{
  "object": "list",
  "data": [{ "id": "codex-5-low", "object": "model", "owned_by": "codex", "created": 0 }]
}
```

### POST /v1/chat/completions (non-stream)

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1726032000,
  "model": "gpt-5",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16 }
}
```

### Error Example — invalid API key

```json
{
  "error": {
    "message": "unauthorized",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

# Configuration Surface

- **Core:** `PORT`, `PROXY_ENV`, `PROXY_API_KEY`, `PROXY_PROTECT_MODELS`, `CODEX_MODEL`, `CODEX_BIN`, `CODEX_HOME`, `PROXY_SANDBOX_MODE`, `PROXY_CODEX_WORKDIR`, `CODEX_FORCE_PROVIDER`.
- **Streaming & Tools:** `PROXY_SSE_KEEPALIVE_MS`, `PROXY_SSE_MAX_CONCURRENCY`, `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_STOP_AFTER_TOOLS_GRACE_MS`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_MAX`, `PROXY_KILL_ON_DISCONNECT`.
- **Timeouts & Limits:** `PROXY_TIMEOUT_MS`, `PROXY_IDLE_TIMEOUT_MS`, `PROXY_STREAM_IDLE_TIMEOUT_MS`, `PROXY_PROTO_IDLE_MS`, `PROXY_DEV_TRUNCATE_AFTER_MS`, `PROXY_MAX_PROMPT_TOKENS`.
- **Security & Rate Limits:** `PROXY_RATE_LIMIT_ENABLED`, `PROXY_RATE_LIMIT_WINDOW_MS`, `PROXY_RATE_LIMIT_MAX`.
- **Diagnostics:** `PROXY_ENABLE_CORS`, `PROXY_DEBUG_PROTO`, `PROXY_TEST_ENDPOINTS`, `STREAM_RELEASE_FILE` (test harness only), `TOKEN_LOG_PATH` (via `src/dev-logging.js`).

# Observability, Logging & Tooling

- Structured JSON access log (`src/middleware/access-log.js`) plus console text log.
- Usage NDJSON logs aggregated by `GET /v1/usage`; raw events accessible via `GET /v1/usage/raw`.
- Concurrency guard snapshot via `guardSnapshot()` and optional `/__test/conc` endpoints when enabled.
- Runbooks: `docs/runbooks/operational.md`, `docs/dev-to-prod-playbook.md`, streaming parity notes in `docs/openai-chat-completions-parity.md`.

# Success Metrics & KPIs

- Availability SLO: 99.9% monthly (excludes planned maintenance).
- Non-stream response p95 ≤ 5 s for prompts ≤ 512 joined tokens.
- Streaming TTFC p95 ≤ 2 s with keepalive cadence ≤ configured interval.
- 5xx (minus auth) < 1% of total requests.
- Concurrency per replica ≤ `PROXY_SSE_MAX_CONCURRENCY`; ensure `ulimit -n` ≥ 32 × concurrency.

# Delivery Plan & Status

## Epics

| Epic                                                        | Status    | Updated    | Notes                                                                                                          |
| ----------------------------------------------------------- | --------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `docs/bmad/stories/epic-openai-chat-completions-parity.md`  | Done      | 2025-09-14 | Locked OpenAI parity for non-stream, streaming, error envelopes, usage toggle.                                 |
| `docs/bmad/stories/epic-server-modularization-refactor.md`  | Done      | 2025-09-13 | Completed modularization of server, introduced structured logs and service boundaries.                         |
| `docs/bmad/stories/epic-stability-ci-hardening-sep-2025.md` | Completed | 2025-09-23 | Closed September stability campaign (non-stream truncation, usage timing, concurrency guard, contract checks). |

## Completed Story Highlights

- Phase 1.x (config, routers, modularization) delivered foundational modules and error envelopes.
- Phase 2.x (OpenAI parity) shipped finish-reason chunking, usage toggles, and refined error codes.
- Phase 3.x (Sep 2025 stability) resolved dev-edge timeout, truncation determinism, streaming usage timing, concurrency guard determinism, golden transcript CI, and Keploy toggle documentation.

## Outstanding Follow-up / Backlog

- Release/backup hardening evidence (tracked under `docs/bmad/issues/_archive/2025-09-14-release-backup-hardening.md`).
- Graceful shutdown SIGTERM integration test automation follow-up (`docs/bmad/issues/2025-09-12-graceful-shutdown-sigterm.md`).
- Finish_reason telemetry enhancements (archived in `docs/bmad/issues/_archive/2025-09-22-finish-reason-follow-ups.md`).

# Acceptance Criteria & Verification

## Automated Verification

- `npm run verify:all` — primary gate (format, lint, unit, integration, Playwright E2E).
- Targeted runs: `npm run test:unit`, `npm run test:integration`, `npm test`, and `npm run lint` when touching respective layers.

## Smoke Commands (local dev)

```bash
BASE="http://127.0.0.1:11435"
KEY="codex-local-secret"  # or your PROXY_API_KEY

curl -s "$BASE/healthz" | jq .
curl -s "$BASE/v1/models" | jq .
curl -sI "$BASE/v1/models"

curl -s "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}' | jq '.choices[0].message.content'

curl -N "$BASE/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","stream":true,"messages":[{"role":"user","content":"Count to 3"}]}'

curl -s "$BASE/v1/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","stream":false,"prompt":"Say hello."}' | jq '.choices[0].text'
```

# Out of Scope

- File, image, or audio APIs; only chat/completions are supported.
- Fine-tuning and embeddings endpoints.
- Multi-choice (`n>1`) streaming; currently rejected with `invalid_request_error`.
- Automatic deployment orchestration; refer to runbooks and scripts in `scripts/`.

# Checklist Results

PM checklist and automated BMAD QA gates are tracked per-story; no new checklist run was triggered when compiling this revision.

# Next Steps

## UX Expert Prompt

> API-only project — no UI deliverables. Confirm documentation consumers have the endpoint contract above; no UX action required beyond keeping SDK docs synced.

## Architect Prompt

> Validate `docs/bmad/architecture.md` against current repo: ensure module map (routers, handlers, services, middleware) reflects recent stability changes, and confirm streaming concurrency guard + usage endpoints remain captured in architecture diagrams and runbooks.
