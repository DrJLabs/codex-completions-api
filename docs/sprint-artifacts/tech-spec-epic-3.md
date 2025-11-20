# Epic Technical Specification: Observability & Ops Hardening

Date: 2025-11-20
Author: drj
Epic ID: 3
Status: Draft

---

## Overview

Epic 3 hardens the app-server path with production-grade observability so SREs can detect, triage, and recover from worker issues without regressing the OpenAI-compatible API surface. The tech spec covers structured logging, metrics, health gating, maintenance-mode controls, and short-lived JSON-RPC trace artifacts aligned to FR010–FR012 and NFR001–NFR006.

The outcome is an auditable, low-latency telemetry layer that protects the migration to the Codex App Server: readiness reflects worker handshake, restarts are supervised and observable, and dashboards/alerts provide clear signals during incidents and rollout.

## Objectives and Scope

- In scope:
  - Standardized JSON log schema for worker lifecycle and request/trace events with redaction.
  - Prometheus metrics for throughput, latency, errors, restarts, tool-buffer counters, and maintenance mode.
  - Health probe refinements that reflect worker readiness and restart/backoff state.
  - Maintenance flag and guarded toggle endpoint returning documented 503 + retry hints.
  - Ephemeral JSON-RPC trace buffer (TTL/count bound) for incident triage with SOC-aligned scrubbing.
  - Runbook updates and smoke coverage for observability features.
- Out of scope:
  - API contract changes to `/v1/chat/completions` or new user-facing features.
  - Autoscaling or multi-worker orchestration beyond the existing single-channel design.
  - Long-term data retention or external SIEM integration beyond documented exports.

## System Architecture Alignment

- Follows the architecture decision to keep an inline supervisor with exponential backoff (250 ms→5 s) and 10 s graceful drains; readiness/health check endpoints remain the gating surface.
- Uses a single JSON-RPC channel with `WORKER_MAX_CONCURRENCY`/timeouts to bound load while emitting structured lifecycle telemetry.
- Adopts the documented maintenance flag (`PROXY_MAINTENANCE_MODE` + toggle endpoint) returning 503 with `Retry-After` and retryable hints.
- Places trace artifacts in `.codex-api/trace-buffer/` with TTL/count limits, matching the ADR for short-lived diagnostics.
- Metrics follow the Prometheus pattern referenced in the architecture (`prom-client` 15.1.x), and logs maintain ISO timestamps, `request_id`, and worker metadata as specified.

## Detailed Design

### Services and Modules

- `src/middleware/logging`: emit structured JSON logs (timestamp, level, request_id, component, event, worker_state, model, latency_ms, restart_count, maintenance_mode) for ingress/egress and worker lifecycle; reuse existing logger shape to avoid field drift.
- `src/services/metrics`: Prometheus `prom-client` 15.1.x exporter with counters/histograms for HTTP totals, latency, errors, active streams, worker_restarts_total, tool_buffer_* (from Epic 2), maintenance_mode gauge; expose aggregated labels only (route, method, status_family, model) to contain cardinality.
- `src/services/health`: readiness/liveness helpers that gate on worker handshake + backoff state; surface restart streak and last_exit_code.
- `src/services/worker` supervisor (existing): emit lifecycle hooks into logging/metrics; honor graceful drain (10s) and exponential backoff (250ms→5s); publish health snapshot for probes.
- `src/services/trace-buffer` (new helper): manage `.codex-api/trace-buffer/` TTL/count limits; JSON files named `{timestamp}-{req_id}.json` with redaction applied; emit pruning metrics/logs.
- `middleware/maintenance`: enforce `PROXY_MAINTENANCE_MODE` and guarded toggle endpoint response shaping (503 + Retry-After + retryable hint).

### Data Models and Contracts

- Log schema: JSON with `timestamp`, `level`, `request_id`, `component`, `event`, `route`, `model`, `latency_ms`, `tokens_prompt/response`, `worker_state`, `restart_count`, `backoff_ms`, `maintenance_mode`, `error_code`, `retryable`; redaction applied per existing rules (no payload bodies, scrub PII).
- Metrics: Prometheus exposition format at `/metrics`; key series: `codex_http_requests_total{route,method,status_family}`, `codex_http_latency_ms_bucket`, `codex_worker_restarts_total`, `codex_worker_backoff_ms`, `codex_streams_active`, `codex_tool_buffer_started/flushed/aborted_total`, `codex_maintenance_mode{state}`; label hygiene: route names normalized, model optional, no request_id or user identifiers.
- Trace buffer artifacts: redacted JSON frames for RPC traffic with defaults TTL 24h and max 100 files; filenames `{timestamp}-{req_id}.json`; pruning records include reason and counts; relationships: trace artifact keyed by `req_id` referenced in logs/metrics for stitching (logs carry `request_id`; metrics omit it).
- Relationships: logs reference request + worker lifecycle events; metrics aggregate routes/methods/status families; trace buffer stores per-request RPC frames keyed by `req_id`; alerts/dashboards stitch via `req_id` plus route/model labels.
- Examples:
  - Log entry: `{ "timestamp":"...", "level":"info", "component":"sse", "event":"stream_chunk", "request_id":"req_ab12", "model":"codex-5", "latency_ms":120, "worker_state":"ready", "maintenance_mode":false }`
  - Metric labels: `codex_http_latency_ms_bucket{route="/v1/chat/completions",method="POST",status_family="2xx",model="codex-5"}`
  - Trace buffer record (redacted): `{ "req_id":"req_ab12", "events":[{"type":"rpc_request","method":"sendUserTurn","redacted":true}], "timestamp":"..." }`

### APIs and Interfaces

- `/metrics` (GET, unauthenticated internal path): Prometheus scrape; must be disabled or auth-protected externally via Traefik as per runtime config.
- `/metrics` auth: exposed only on internal network; if exposed externally, require Traefik forward-auth or disable endpoint.
- `/healthz` / `/readyz`: return 200 only when worker supervisor reports healthy handshake and no active backoff; include minimal body `{status, worker_state, last_exit_code?, restart_streak?}` for diagnostics.
- `/internal/maintenance` (toggle endpoint, bearer-protected): flips `PROXY_MAINTENANCE_MODE`; responses always 200 with current state; when enabled, normal traffic returns 503 + `Retry-After` header and `retryable:true`.
- Existing `/v1/*` handlers continue unchanged except for additional logging/metrics hooks; SSE path must record keepalives, role-first deltas, `[DONE]`, and disconnects.

### Workflows and Sequencing

- Request path: ingress log → maintenance check → auth → handler → metrics start → transport send → stream/JSON response → metrics observe latency/tokens → egress log with outcome and worker state.
- Worker lifecycle: supervisor start → readiness waits for handshake → logs `worker_started` with PID and version → on exit log `worker_exited` with exit_code and restart_count → backoff tracked in metrics until healthy.
- Trace buffer: on configurable enable, capture redacted RPC request/response/notification per req_id; prune on TTL/count with logs/metrics.
- Maintenance mode: toggle sets flag, emits log `maintenance_toggled`, updates metric gauge; middleware injects 503 envelope and `Retry-After`.

## Non-Functional Requirements

### Performance

- Preserve streaming first-token and total latency within ±5% of current P95 (NFR002); metrics must expose P50/P95/P99 to verify budget. Avoid high-cardinality labels that would distort scrape latency.

### Security

- Maintain existing auth/rate-limit paths; metrics and maintenance endpoints guarded per deployment. No secrets in logs/metrics/trace artifacts; redaction applied before writing.

### Reliability/Availability

- Meet ≥99.9% availability (NFR001) with supervised restarts <10s recovery (NFR004); readiness gates traffic during backoff; maintenance flag provides controlled degradation with retry hints.

### Observability

- Logs/metrics/traces satisfy SOC auditability (NFR005/NFR006): structured JSON logs, Prometheus metrics, redacted trace buffer, documented retention knobs, dashboards for latency/errors/restarts/tool buffers, alert hooks for error budget burn.

## Dependencies and Integrations

- Runtime deps: `express`, `@openai/codex`, `nanoid`; planned/promoted for observability: `prom-client` 15.1.x (per architecture), existing logging infra.
- Infra: Traefik routers/health probes must remain unchanged; `/metrics` scrape via internal network only; `.codex-api/` mounted RW for trace buffer and worker state.
- Tooling/tests: Vitest + Playwright; smoke scripts under `scripts/smoke/*.sh`; Docker Compose/systemd for health probes and maintenance flag wiring; Grafana (default) dashboards/alerts for latency, restarts, errors, tool_buffer_* with templates stored alongside runbook.

## Acceptance Criteria (Authoritative)

- Logging: standardized schema applied to worker lifecycle + request/trace events; redaction preserved; schema documented (Story 3.1).
- Metrics: `/metrics` exports request latency/error buckets, restarts, tool_buffer_*; dashboards/alerts for throughput, latency, errors, restarts, tool-buffer anomalies (Story 3.2).
- Probes: readyz/livez reflect worker state/backoff; tests cover crash, slow-start, restart scenarios; compose/systemd consume guidance (Story 3.3).
- Alerts/runbooks: latency/SLO breach, restart frequency, sustained error rate, tool-buffer anomalies; runbooks include `req_id` stitching and toggle/rollback steps (Story 3.4).
- Maintenance mode: `PROXY_MAINTENANCE_MODE` + guarded toggle endpoint return 503 + Retry-After; comms templates documented; observability reflects state (Story 3.5).
- Compliance: redaction/retention validated for access/trace/usage/metrics; threat model updated; checklist signed off (Story 3.6).
- Trace buffer: `.codex-api/trace-buffer/` with TTL/count limits, redaction, pruning logs/metrics; enablement gated and documented (Story 3.7).
- Alerts/dashboards: sample alert rules (SLO burn, restart-rate, error-rate, tool_buffer_anomalies) and Grafana dashboards referenced in runbook with owners (SRE) and thresholds documented.

## Traceability Mapping

- AC→Spec→Tests mapping:
  - Logging schema → System Architecture Alignment / Services → unit tests for log serializer and redaction.
  - Metrics/export/dashboards → APIs/Interfaces & Dependencies → integration test `/metrics`; dashboard/alert config smoke.
  - Probes → Workflows/Sequencing → integration tests for crash/slow start; dev stack smoke.
  - Maintenance mode → APIs/Interfaces → integration test for 503 envelope and Retry-After; smoke script toggle.
  - Trace buffer → Data Models & Dependencies → unit test TTL/count pruning; integration to ensure redaction.
  - Compliance → Non-Functional → checklist review artifact.

## Risks, Assumptions, Open Questions

- Risks (R) with mitigation:
  - R1: Insufficient redaction could leak PII in trace buffer. Mitigation: reuse existing scrubbers, add unit tests for redaction, gate trace-buffer enablement behind flag, and include scrub verification step in smoke.
  - R2: `/metrics` exposure without auth could leak internal data. Mitigation: expose only on internal network; require Traefik forward-auth if exposed externally; document default to disable external scrape.
  - R3: Label cardinality explosion. Mitigation: constrain labels to route/method/status_family/model; forbid request_id/user labels; add lint/check to metric registration.
- Assumptions (A): A1 single worker model remains; A2 Traefik handles auth for internal endpoints; A3 `.codex-api/` is writable in prod/dev.
- Questions (Q) with proposed resolutions:
  - Q1: Retention defaults? Use TTL 24h and max 100 files (documented and configurable).
  - Q2: Dashboard stack? Default Grafana; store dashboard JSON and alert templates with runbook; if different stack, map equivalent alerts.

## Test Strategy Summary

- Unit: log schema/redaction helpers; metrics registry initialization; trace-buffer pruning logic; maintenance middleware behavior.
- Integration: `/readyz`/`/healthz` honoring worker state/backoff; `/metrics` exposure; maintenance 503 envelope + headers; trace buffer write + prune.
- E2E/Playwright: streaming/JSON chat flows still emit SSE + logs/metrics; disconnect/keepalive captured; dev stack smoke for probes and maintenance toggle.
- Smoke/ops: `scripts/prod-smoke.sh`/`dev-smoke.sh` extended to check probes, `/metrics` scrape, maintenance flag on/off, and restart visibility; document evidence in tech spec/runbook.
