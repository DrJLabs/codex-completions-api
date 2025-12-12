# Task 07 – Observability & Telemetry
# Source: docs/surveys/task-07-observability-and-telemetry.md

## Work done
- Added optional OTLP tracing with HTTP server spans and backend invocation spans; trace ids are propagated into access logs.
- Expanded Prometheus metrics: HTTP counters/histograms, stream TTFB/duration/end outcomes, worker restart/backoff/ready gauges, active stream gauge, and tool-buffer anomaly signals.
- Metrics router now tracks worker restart deltas and exposes maintenance state; README gains an observability section describing metrics and tracing toggles.

## Gaps
- No upstream (Codex) latency/error metrics or rate-limit/guard metrics; streaming metrics lack explicit tests.
- Cardinality/PII protections rely on normalization helpers but have no CI guard/allowlist tests.
- Operator runbooks/dashboards/alerts for the new metrics and tracing path are not documented; OTEL coverage stops at backend call and does not include child events.

## Plan / Acceptance Criteria & Tests
- AC1: Add upstream transport latency/error metrics and rate-limit/guard counters; include integration tests asserting stream metrics emit TTFB/duration on sampled calls. Test: scrape `/metrics` in integration and assert new series exist and increment.
- AC2: Introduce a metrics label allowlist/PII guard (unit/CI) to prevent route/model explosion. Test: unit tests feeding high-variance URLs and asserting normalized labels; CI job running the guard.
- AC3: Document dashboards/alerts and extend tracing to cover Codex child interactions where feasible. Test: runbook updates plus optional tracing unit test that a span is created when tracing enabled.
