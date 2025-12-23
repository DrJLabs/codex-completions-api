# Story 3.2: Metrics pipeline for app-server path

Status: done

## Story

As a monitoring engineer,
I want Prometheus-style metrics for the app-server path,
so that dashboards and alerts cover SLIs/SLOs with parity to proto. _[Source: docs/epics.md#story-32-metrics-export-and-dashboards]_ _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#acceptance-criteria-authoritative]_

## Acceptance Criteria

1. `/metrics` (or equivalent internal path) exposes Prometheus metrics for request totals, latency buckets/summaries, error categories, restart/backoff state, active streams, and existing `tool_buffer_*` counters using `prom-client` 15.1.x; endpoint is scoped for internal scrape or guarded by Traefik/ForwardAuth. _[Source: docs/epics.md#story-32-metrics-export-and-dashboards]_ _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#services-and-modules]_ _[Source: docs/architecture.md#decision-summary]_ _[Source: docs/PRD.md#functional-requirements]_  
2. Metrics use normalized labels (route, method, status_family, optional model) with documented cardinality limits; latency buckets align with existing conventions and NFR002 latency budgets; published field names mirror the app-server architecture decisions and avoid request-level identifiers. _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#data-models-and-contracts]_ _[Source: docs/architecture.md#technology-stack-details]_ _[Source: docs/PRD.md#functional-requirements]_  
3. Dashboards and alerts for throughput, latency, error rate, restart rate, maintenance state, and tool-buffer anomalies are created/updated with documented thresholds and links to the runbooks. _[Source: docs/epics.md#story-32-metrics-export-and-dashboards]_ _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#acceptance-criteria-authoritative]_ _[Source: docs/architecture.md#observability]_  

## Tasks / Subtasks

- [x] Implement `/metrics` exposure via `src/services/metrics` and route wiring, emitting request totals, latency buckets/summaries, error categories, restart/backoff, active streams, and `tool_buffer_*` counters; guard endpoint for internal scrape only. (AC1)
- [x] Define metric names and label sets (route, method, status_family, optional model) with bucket configuration that matches existing latency conventions; ensure no high-cardinality or request_id/user labels. (AC1, AC2)
- [x] Integrate worker supervisor and SSE/concurrency guard signals so restart/backoff state and active stream counts surface in metrics. (AC1)
- [x] Add tests: unit coverage for metric registry and label validation; integration coverage to confirm `/metrics` returns the expected series and omits disallowed labels; extend smoke checks for `/metrics` scrape. (AC1, AC2)
- [x] Document metrics, label hygiene, and retention/guard rails in runbooks; add dashboard/alert JSON or templates covering throughput, latency, errors, restarts, maintenance flag, and tool-buffer anomalies with thresholds tied to NFR002/FR011. (AC2, AC3)
- [x] Update sprint tracking artifacts if new dashboards/alert files are added; note required environment wiring for internal scrape and ForwardAuth/Trafik guards. (AC3)

### Review Follow-ups (AI)
- [x] Add authenticated/loopback guard on `/metrics` when `PROXY_ENABLE_METRICS` is true.
- [x] Extend prod/dev smoke scripts with a `/metrics` scrape to verify exposure and label hygiene.
- [x] Commit dashboard + alert artifacts and link from runbook to satisfy AC3.

## Dev Notes

- Metrics should use `prom-client` 15.1.x with normalized labels (route, method, status_family, optional model) and no request/user identifiers; keep cardinality bounded and align histogram buckets to existing latency budgets. _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#data-models-and-contracts]_ _[Source: docs/architecture.md#observability]_  
- `/metrics` is intended for internal scrape; if exposed externally it must be guarded by Traefik ForwardAuth per production routing rules. Do not change router labels or network attachments. _[Source: docs/architecture.md#deployment-architecture]_ _[Source: docs/PRD.md#functional-requirements]_  
- Instrument restart/backoff and active stream state from the worker supervisor/concurrency guard so dashboards reflect readiness and recovery (FR006/FR011). _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#services-and-modules]_ _[Source: docs/architecture.md#health-lifecycle]_  
- Testing expectations: unit coverage for metric registration/label validation; integration to assert `/metrics` exports request totals, latency, error buckets, restarts, tool_buffer counters, and omits high-cardinality labels; smoke checks should scrape `/metrics` in dev/prod stacks. _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#test-strategy-summary]_  

### Learnings from Previous Story (3-1)

- Reuse the structured logging schema and redaction safeguards added in Story 3-1 so metrics/logs align on terminology (component, worker_state) without introducing payload leaks. _[Source: docs/_archive/sprint-artifacts/3-1-structured-logging-for-worker-lifecycle.md]_  
- Prior work touched `src/services/worker/supervisor.js`, `src/services/logging/schema.js`, and `src/dev-logging.js`; emit metric hooks alongside these paths to avoid duplicating state machines and to keep restart/backoff signals consistent. _[Source: docs/_archive/sprint-artifacts/3-1-structured-logging-for-worker-lifecycle.md#file-list]_  
- Completion notes from Story 3-1: schema/redaction enforced across worker/trace/usage logs; worker stream samples sanitized; tests executed (`npm run test:unit`, `npm run test:integration -- tests/integration/worker-supervisor.int.test.js`) validating redaction and canonical fields. _[Source: docs/_archive/sprint-artifacts/3-1-structured-logging-for-worker-lifecycle.md#completion-notes-list]_  

### Project Structure Notes

- Metric exposure belongs in `src/services/metrics` with route wiring from `server.js`/`src/app.js`; keep label definitions centralized to prevent drift. _[Source: docs/architecture.md#project-structure]_  
- Tap worker lifecycle/concurrency data from `src/services/worker/supervisor.js` and streaming handlers under `src/handlers/chat/` for active stream counters. _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#services-and-modules]_  
- Dashboard/alert artifacts should live alongside runbooks (`docs/runbooks/**` or `docs/app-server-migration/**`) and be referenced from the same README to preserve parity with existing observability docs. _[Source: docs/architecture.md#deployment-architecture]_  

### References

- docs/epics.md#story-32-metrics-export-and-dashboards  
- docs/_archive/sprint-artifacts/tech-spec-epic-3.md#acceptance-criteria-authoritative  
- docs/architecture.md#observability  
- docs/PRD.md#functional-requirements  
- docs/_archive/sprint-artifacts/3-1-structured-logging-for-worker-lifecycle.md  

## Dev Agent Record

### Context Reference

- docs/_archive/sprint-artifacts/3-2-metrics-pipeline-for-app-server-path.context.xml

### Agent Model Used

codex-5 (planned)

### Debug Log References

- Plan: add `prom-client@15.1.3` registry under `src/services/metrics/index.js`, wire Express middleware + `/metrics` route gated by `PROXY_ENABLE_METRICS`, expose worker/backoff/stream gauges, reuse tool buffer counters.
- Plan: instrument request latency/count labels (route, method, status_family, model) with bounded buckets; integrate worker status snapshot + concurrency guard for active stream gauge.
- Plan: add unit/integration coverage for label hygiene + `/metrics` scrape, and document metrics/alerts/guardrails in `docs/app-server-migration/metrics-and-alerts.md`.

### Completion Notes List

- Added Prometheus `/metrics` surface gated by `PROXY_ENABLE_METRICS`, with `codex_http_*`, worker readiness/backoff gauges, stream gauge, and tool buffer counters wired from supervisor and guard snapshots.
- Added metrics middleware + label hygiene (route/method/status_family/model) and prom-client registry in `src/services/metrics/index.js`; tool buffer counters now emit prom labels.
- Tests: `npm run test:unit`, `npm run test:integration`, `npm test` (Playwright E2E) all passing; metrics endpoint covered by new unit + integration specs.
- Docs: `docs/app-server-migration/metrics-and-alerts.md` captures metrics names, bucket/label policy, ForwardAuth guidance, and alert/dashboard templates.
- Change log + sprint status updated; story status set to review.
- Hardened `/metrics` with optional bearer + loopback guard, added smoke scrapes, and committed dashboard + alert artifacts; reran unit + integration suites.

### File List

- package.json
- package-lock.json
- src/config/index.js
- src/services/metrics/index.js
- src/services/metrics/chat.js
- src/middleware/metrics.js
- src/routes/metrics.js
- src/app.js
- tests/unit/metrics.normalization.test.js
- tests/integration/metrics.int.test.js
- docs/app-server-migration/metrics-and-alerts.md
- docs/app-server-migration/dashboards/observability-dashboard.json
- docs/app-server-migration/alerts/metrics-alerts.yaml
- scripts/prod-smoke.sh
- scripts/dev-smoke.sh
- docs/sprint-status.yaml
- docs/_archive/sprint-artifacts/3-2-metrics-pipeline-for-app-server-path.md

## Change Log

- 2025-11-20: Drafted story from epics, PRD, architecture, and tech spec; set status to drafted.
- 2025-11-20: Implemented `/metrics` exporter, prom-client registry, metrics middleware/tests, and observability runbook; moved story to review.
- 2025-11-20: Added Senior Developer Review (AI); outcome set to Changes Requested.
- 2025-11-20: Addressed review findings—secured `/metrics`, added smoke scrapes plus dashboard/alert artifacts, and returned story to review.
- 2025-11-20: Senior Developer Review (AI) approved metrics pipeline and moved story to done.

## Senior Developer Review (AI) - Final Approval

Reviewer: drj  
Date: 2025-11-20  
Outcome: Ready for Review — maintenance-state telemetry/alerts added; AC1/AC2 already satisfied.

### Summary
- Metrics guard plus smoke scrapes added; dashboards/alerts artifacts present.
- Maintenance-state gauge + alert added to satisfy AC3.

### Key Findings
- None outstanding; maintenance gauge/alert added.

### Acceptance Criteria Coverage
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Implemented | `/metrics` exports HTTP/worker/streams/tool_buffer gauges behind `PROXY_ENABLE_METRICS` with guard. (src/routes/metrics.js:5-38; src/services/metrics/index.js:13-175; src/app.js:18-104) |
| AC2 | Implemented | Normalized labels; tests assert bounded labels and no request_id. (src/services/metrics/index.js:92-149; tests/unit/metrics.normalization.test.js:14-48; tests/integration/metrics.int.test.js:13-41) |
| AC3 | Implemented | Dashboard + alerts added, including maintenance-state gauge/alert. (docs/app-server-migration/metrics-and-alerts.md:3-45; docs/app-server-migration/alerts/metrics-alerts.yaml) |

### Task Completion Validation
| Task | Status | Evidence |
| --- | --- | --- |
| Implement `/metrics` exposure and guard | Verified | Guarded route with token/loopback. (src/routes/metrics.js:5-38) |
| Define metric names/labels | Verified | HTTP/tool-buffer labels normalized. (src/services/metrics/index.js:13-149) |
| Integrate worker/supervisor + SSE signals | Verified | Scrape sets stream + worker gauges. (src/routes/metrics.js:9-15) |
| Add tests incl. `/metrics` scrape | Verified | Unit/integration pass; smoke scripts now scrape metrics. (tests/integration/metrics.int.test.js:13-41; scripts/dev-smoke.sh; scripts/prod-smoke.sh) |
| Document metrics + dashboards/alerts | Implemented | Runbook + artifacts added, including maintenance-state gauge/alert. (docs/app-server-migration/metrics-and-alerts.md:3-45; docs/app-server-migration/alerts/metrics-alerts.yaml) |
| Update sprint tracking artifacts | Verified | Status set to review. (docs/sprint-status.yaml:58-68) |

### Tests
- `npm run test:unit`
- `npm run test:integration` (includes `/metrics` guard)

### Action Items
- None; pending review approval.

## Senior Developer Review (AI)

Reviewer: drj  
Date: 2025-11-20  
Outcome: Approve — AC1–AC3 verified; no outstanding findings.

### Summary
- `/metrics` gated by token/loopback with worker/stream/tool-buffer/maintenance gauges populated per scrape. (src/routes/metrics.js:1-47; src/app.js:18-104)
- Label hygiene enforced with bounded buckets; middleware records per-request latency/errors for Prometheus 15.1.x registry. (src/services/metrics/index.js:13-175; src/middleware/metrics.js:8-32)
- Dashboards/alerts + smoke scrapes documented for SLO coverage. (docs/app-server-migration/metrics-and-alerts.md:3-54; docs/app-server-migration/alerts/metrics-alerts.yaml:1-44; scripts/dev-smoke.sh:1-60; scripts/prod-smoke.sh:1-60)

### Key Findings
- None.

### Acceptance Criteria Coverage
| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | Implemented | Prometheus registry exposes HTTP latency/error/restart/backoff/streams/tool_buffer/maintenance gauges behind PROXY_ENABLE_METRICS and guarded router. (src/services/metrics/index.js:1-175; src/routes/metrics.js:1-47; src/app.js:18-104) |
| AC2 | Implemented | Labels normalized (route/method/status_family/model) with truncation; tests enforce bounded labels and no request_id leakage. (src/services/metrics/index.js:98-149; src/middleware/metrics.js:8-32; tests/unit/metrics.normalization.test.js:15-55; tests/integration/metrics.int.test.js:13-27) |
| AC3 | Implemented | Runbook documents metrics/labels + thresholds; dashboards/alerts checked in. (docs/app-server-migration/metrics-and-alerts.md:3-54; docs/app-server-migration/alerts/metrics-alerts.yaml:1-44; docs/app-server-migration/dashboards/observability-dashboard.json:1-5) |

### Task Completion Validation
| Task | Status | Evidence |
| --- | --- | --- |
| `/metrics` exposure + guard | Verified | Router enforces bearer/loopback and updates worker/stream gauges per scrape. (src/routes/metrics.js:1-47; src/app.js:18-104) |
| Metric names/label hygiene | Verified | Registry defines HTTP/tool_buffer metrics with normalized label helpers. (src/services/metrics/index.js:13-175; src/middleware/metrics.js:8-32) |
| Worker/supervisor + SSE signal integration | Verified | Scrape pulls guardSnapshot + supervisor status into gauges. (src/routes/metrics.js:2-44; src/services/metrics/index.js:157-169) |
| Tests added | Verified | Unit/integration assertions for label bounds, auth, maintenance flag. (tests/unit/metrics.normalization.test.js:1-55; tests/integration/metrics.int.test.js:1-57) |
| Docs/dashboards/alerts | Verified | Metrics runbook, Grafana dashboard JSON, and Prometheus alert rules present. (docs/app-server-migration/metrics-and-alerts.md:3-54; docs/app-server-migration/alerts/metrics-alerts.yaml:1-44; docs/app-server-migration/dashboards/observability-dashboard.json:1-5) |
| Sprint tracking updated | Verified | Story status set to done. (docs/sprint-status.yaml:64-68) |

### Tests
- Not re-run in this review; last recorded runs: `npm run test:unit`, `npm run test:integration`, `npm test`.

### Action Items
- None.
