# Story 3.7 – JSON-RPC Trace Buffer Retention

## Context

- **Epic:** Epic 3 – Observability & Ops Hardening
- **Related Requirements:** FR012, NFR005 (PRD)
- **Architecture References:** `docs/architecture.md` (Trace Artifacts section, ADR-004, ADR-005)

## Story Statement

As an observability engineer,
I want short-lived JSON-RPC trace artifacts captured with enforced retention,
So that we can triage incidents without violating data-handling policies.

## Acceptance Criteria

1. Worker supervisor emits optional JSON-RPC trace files to `.codex-api/trace-buffer/` using `{timestamp}-{requestId}.json` naming and writes redacted payloads only when tracing is enabled (feature flag or config toggle documented in code comments).
2. A TTL sweeper enforces both a maximum age of 24 hours and a maximum count of 100 files; pruning events surface in structured logs (`worker_event: "trace_buffer_prune"`) and Prometheus metrics (`codex_trace_buffer_entries`).
3. Runbooks (`docs/app-server-migration/`) document how to enable, inspect, and manually purge trace artifacts, including PII redaction expectations and SOC-compliant retention guidance.

## Definition of Done

- [ ] Unit tests cover trace emission toggling and TTL pruning logic.
- [ ] Integration tests confirm the supervisor honours retention limits and continues normal request flow when toggled off/on.
- [ ] Prometheus metrics and structured log fields validated via smoke test.
- [ ] Documentation updated in runbook with operational instructions and compliance notes.

## Dependencies

- Story 3.1 (Structured logging for worker lifecycle)
- Story 3.2 (Metrics pipeline for app-server path)
- Story 3.3 (Health probe integration tests)

## Notes

- Ensure trace generation is disabled by default; configuration should require explicit opt-in (`PROXY_TRACE_BUFFER=true`).
- Trace files must exclude bearer tokens and redact customer content per existing scrubbing utilities.
- Consider reusing existing cleanup utilities if already present in `.codex-api/` management scripts.
