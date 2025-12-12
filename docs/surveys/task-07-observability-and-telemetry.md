# Task 07 — Observability & Telemetry (Logs • Metrics • Tracing • Health)
Repo: `DrJLabs/codex-completions-api`  
Reference: commit `c8628fa5613c5d1dd86bfb0dbfec80e23e965b17` (from linked file URLs)

## 1) Scope & intent
This task inventories and evaluates the **operational signals** exposed by the codebase:
- **Structured logging** (schema, redaction, event taxonomy, correlation IDs)
- **Metrics** (Prometheus exposition, naming, cardinality controls, coverage)
- **Tracing / request reconstruction** (dev tracing, correlation, sanitization)
- **Health / readiness probes** (liveness, readiness, worker state signaling)
- **Operator docs** (runbooks/dashboards/alerts alignment with implementation)

Primary goal: identify **gaps, contradictions, high-cardinality risks, PII leakage risk, missing signals**, and “papered-over” operational failure modes that will cause blind spots in production.

---

## 2) What exists today (current-state map)

### 2.1 Logging
**A. Structured log schema**
- There is an explicit **logging schema** module and accompanying unit tests that enforce:
  - canonical field protection (extras cannot overwrite canonical fields)
  - redaction/truncation behavior (PII / secrets controls)
- Expected consumer: every log event goes through a single shaping function before emission (stdout / JSON line).

**B. Access log middleware**
- A dedicated access log middleware exists to emit one structured event per HTTP request/response.
- It sets/propagates a **request ID** (and typically echoes it back via `X-Request-Id`) so operators can trace end-to-end request flow.

**C. Worker lifecycle logging**
- Worker supervisor emits **structured lifecycle events** (spawn, restart, backoff, error classifications).
- Notable hardening: the supervisor avoids logging raw worker stream lines in the “last sample” field and instead stores safe metadata (length, stream type, timestamp).

**D. Dev logging sinks**
- Dev-only file sinks exist to write NDJSON logs for offline stitching (usage/proto/access).

What this means operationally:
- The repo is designed to run with **JSON structured logs** rather than free-form console logs.
- A correlation strategy (request ID) is present and appears to be treated as a first-class attribute in logs.

### 2.2 Metrics
**A. Prometheus instrumentation**
- `prom-client` is used with a central metrics module to register counters/histograms/gauges.
- There is an HTTP middleware that observes request latency and increments counters for request totals/errors.

**B. `/metrics` endpoint**
- A dedicated `/metrics` route exists and is gated behind configuration flags.
- It supports optional bearer-token protection, and (when token is absent) appears to enforce loopback-only access.

**C. Worker/concurrency metrics**
- Metrics include worker state/backoff/restart-related gauges/counters.
- There is also a notion of “active streams”/concurrency that can be exposed (helpful for streaming workloads).

Operational implication:
- You can scrape the process with Prometheus, and you have a baseline “golden signals” start (traffic, errors, latency).

### 2.3 Health / readiness probes
- Dedicated routes exist for **/healthz**, **/livez**, **/readyz**.
- Readiness is tied to worker supervisor state (i.e., “is the worker ready and not in a restart/backoff spiral?”).
- Health output includes worker state and (safe) restart metadata, improving diagnosability while limiting data leakage.

### 2.4 Tracing / request reconstruction (dev-focused)
- There are dev tracing utilities (HTTP trace, sanitization helpers).
- There is a helper script to stitch request ID timelines across access/proto/usage logs.
- The tracing plan documentation exists (suggesting an intentional strategy rather than ad-hoc debugging).

---

## 3) Strengths (what’s already “production-shaped”)

### 3.1 A coherent correlation model
- The request ID is consistently treated as an operational join key across logs and dev traces.
- Returning `X-Request-Id` to clients improves supportability and ticket-driven debugging.

### 3.2 Defensive logging posture (reduced leakage)
- The worker supervisor’s “last log sample” approach is notably careful (metadata-only rather than raw payload lines).
- The existence of a log schema module + tests indicates the repo is trying to enforce hygiene systematically.

### 3.3 Metrics endpoint protection is considered
- Explicit gating via config + token support indicates operational awareness.
- Loopback-only behavior (when no token is set) is a reasonable default for local dev and some single-node deployments.

### 3.4 Health probes reflect real readiness
- Readiness appears to include worker state, which is the correct primitive for preventing “serving traffic while broken.”

---

## 4) Gaps / risks / contradictions (the “what will hurt later” section)

### 4.1 No clear *production* distributed tracing
What exists is excellent for **local reconstruction**, but there is no obvious production-grade tracing path (e.g., OpenTelemetry to a collector). Without distributed tracing:
- you cannot reliably answer “where is time spent?” across upstream/downstream boundaries
- you cannot correlate “this spike in p99 latency” with upstream API behavior without manual log sampling

**Recommendation**
- Add optional OpenTelemetry instrumentation:
  - HTTP server spans (Express)
  - outbound spans for upstream Codex API calls
  - propagate W3C `traceparent` + include `trace_id` / `span_id` in logs

### 4.2 Metrics coverage is baseline, not “SLO-complete”
Typical missing signals for this kind of proxy/service:
- upstream request latency/error rate by upstream endpoint + upstream status (Codex)
- streaming-specific metrics:
  - time-to-first-token / time-to-first-byte
  - stream duration distribution
  - abnormal termination counts
- rate-limit / guardrail metrics:
  - throttles, rejects, queue depths, concurrency saturation
- worker lifecycle SLO metrics:
  - restart rate, backoff time spent, “ready false” duration

**Recommendation**
- Expand metric set to cover:
  - `upstream_http_latency_ms{route,status}` histogram
  - `upstream_http_errors_total{route,status,code}` counter
  - `stream_ttfb_ms` histogram and `stream_duration_ms` histogram
  - `rate_limit_denied_total{reason}` counter
  - `worker_ready` gauge and `worker_restart_total{reason}` counter

### 4.3 Cardinality risk: route/url labeling must be strictly normalized
If any metric label uses raw `req.originalUrl` or unbounded identifiers, you will get:
- exploding Prometheus TSDB cardinality
- unusable dashboards

There appears to be route label normalization in the codebase; this should be treated as non-negotiable:
- enforce a strict route label set (Express route templates or an allowlist)
- strip query strings and IDs
- test normalization against “worst case” paths

**Recommendation**
- Add unit tests that feed high-variance URLs and confirm label collapse to a bounded set.
- Ensure all label dimensions are bounded: no user IDs, org IDs, request IDs, model names (unless limited), etc.

### 4.4 Log schema adoption must be universal (risk of drift)
The presence of a schema module does not guarantee every log event uses it.
Drift risks:
- occasional `console.log` / `console.error` bypasses redaction
- some modules log raw request/response bodies in error paths
- inconsistent event naming/taxonomy across subsystems

**Recommendation**
- Add a “schema compliance” test or lint:
  - forbid `console.*` in src (except in a single logger implementation)
  - enforce `logStructured()` usage only
- Add a minimal event taxonomy guide (component/event enums) and validate them at runtime in non-prod.

### 4.5 Log payloads and PII: explicitly define “never log” fields
Even with redaction, you should explicitly treat these as “never log”:
- Authorization headers (all schemes)
- cookies / session identifiers
- request bodies for completion prompts (may contain user secrets)
- upstream response bodies (may contain user content)

**Recommendation**
- Move from blacklist redaction to an allowlist strategy for high-risk contexts:
  - Access logs: only metadata
  - Error logs: code/message/category, never raw payload unless explicitly enabled in dev

### 4.6 Health endpoints: ensure semantics match platform expectations
It’s common for platforms (K8s, ECS, etc.) to interpret:
- **/livez**: “process is alive” (should be cheap and almost always 200 unless truly deadlocked)
- **/readyz**: “safe to receive traffic” (should be strict and reflect worker readiness)

**Recommendation**
- Validate that /livez does not depend on upstream connectivity.
- Validate that /readyz fails during restart/backoff and returns a clear reason payload.

### 4.7 Documentation alignment is uncertain (needs explicit parity check)
There are docs for metrics/alerts/runbooks/dashboards, but this task has not yet verified they are fully aligned with:
- actual metric names and label sets
- actual probe behavior
- real failure modes observed in logs

**Recommendation**
- Add a build-time or CI “metrics parity” check:
  - scrape `/metrics` in a test run
  - compare emitted metric names against a committed allowlist used by dashboards/alerts

---

## 5) Remediation candidates (prioritized)

### P0 — Prevent cardinality/PII incidents
1. Confirm every metric uses normalized route labels (bounded).
2. Ensure logs do not include request/response bodies by default (prod).
3. Ensure `/metrics` requires token in production deployments (document the policy).

### P1 — Make operators effective (reduce MTTR)
1. Add upstream Codex call metrics (latency + errors).
2. Add streaming timing metrics (TTFB, duration, abort reasons).
3. Add event taxonomy + severity conventions (levels).

### P2 — Mature the tracing story
1. Add OpenTelemetry support behind flags.
2. Emit trace IDs in logs and propagate them to upstream requests.
3. Provide an operator guide: “Given an incident, here is how you pivot from alert → metrics → logs → trace.”

---

## 6) Concrete outputs to produce later (ties into upcoming tasks)
These are explicitly good candidates for Tasks 8–12:
- A “golden signals dashboard” spec (traffic/errors/latency/saturation) plus alert thresholds.
- CI checks:
  - metrics allowlist parity
  - log schema compliance
- A production tracing plan (collector/exporter + sampling rules).
- A “PII logging policy” document with tests.

---

## 7) Completion criteria (for this task)
This task is “done” when:
- we can enumerate all telemetry surfaces (routes, modules, docs)
- we have a risk register for PII + cardinality
- we have a prioritized remediation list suitable for planning

Status: COMPLETE (analysis + recommendations)
