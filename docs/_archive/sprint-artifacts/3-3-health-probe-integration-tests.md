# Story 3.3: Health probe integration tests

Status: done

## Story

As a reliability engineer,  
I want probes and tests that reflect worker state and restart/backoff behavior,  
so that orchestrators react correctly to crashes and slow starts.

## Acceptance Criteria

1. `/readyz` and `/livez` reflect worker handshake/backoff states and expose restart/backoff metadata; integration tests cover crash, slow-start, and restart scenarios and assert readyz flips within the documented thresholds. _[Source: docs/epics.md#story-33-health-probe-robustness]_ _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#acceptance-criteria-authoritative]_ _[Source: docs/architecture.md#decision-summary]_
2. Compose/systemd health checks consume `/readyz` with the documented timing guidance; runbook examples show probe commands and expected responses, including restart counters for orchestration visibility. _[Source: docs/epics.md#story-33-health-probe-robustness]_ _[Source: docs/app-server-migration/codex-completions-api-migration.md#h-configuration--deployment]_ _[Source: docs/architecture.md#project-structure]_ _[Source: docs/PRD.md#functional-requirements]_
3. Probes corroborate logs/metrics: readiness output aligns with worker telemetry (restart/backoff) and existing Prometheus gauges; runbooks describe how to validate alignment during smoke and incident drills. _[Source: docs/epics.md#story-33-health-probe-robustness]_ _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#services-and-modules]_ _[Source: docs/architecture.md#observability]_ _[Source: docs/PRD.md#functional-requirements]_

## Tasks / Subtasks

- [x] Add integration tests that simulate crash, slow-start, and restart loops to assert `/readyz` flips to false/true within thresholds and `/livez` remains healthy; include restart/backoff metadata in assertions. (AC: #1)
  - [x] Extend `tests/integration/health.probes.app-server.int.test.js` (or new file) with crash/slow-start/restart cases asserting restart/backoff fields. (AC: #1)
  - [x] Add unit coverage for probe payload shape when supervisor state changes. (AC: #1)
  - [x] Add testing subtask: verify restart/backoff fields align with supervisor snapshot across scenarios. (AC: #1)
- [x] Ensure probe handlers surface handshake/backoff/restart counters consistent with worker supervisor snapshots and existing metrics gauges. (AC: #1, #3)
  - [x] Cross-verify restart/backoff fields against `/metrics` gauges during tests. (AC: #3)
  - [x] Add testing subtask: assert `/readyz` telemetry matches Prometheus gauges in integration tests. (AC: #3)
- [x] Document Compose/systemd health check examples (intervals/timeouts) that target `/readyz`, and note expected restart thresholds in the deployment runbook. (AC: #2)
  - [x] Add probe command snippets and timing guidance to `docs/app-server-migration/codex-completions-api-migration.md`. (AC: #2)
  - [x] Add testing subtask: lint or check for presence of `/readyz` probe snippets in docs (AC: #2)
- [x] Extend smoke/ops checklists to verify `/readyz` vs metrics/logs alignment, including restart counter validation and backoff visibility. (AC: #3)
  - [x] Add smoke steps for `/readyz` + restart counters to `scripts/dev-smoke.sh`/`scripts/prod-smoke.sh`. (AC: #3)
  - [x] Add testing subtask: ensure smoke scripts exercise `/readyz` with restart/backoff expectations. (AC: #3)
- [x] Map tasks explicitly to ACs and include testing subtasks for each AC to prevent regressions. (AC: #1, #2, #3)
  - [x] Add integration test assertions for restart/backoff alignment per AC #1/#3. (AC: #1, #3)
  - [x] Add doc validation/linters or checks for probe snippets (AC #2) and smoke scripts (AC #3). (AC: #2, #3)

## Task → AC Mapping

- AC #1: Tasks 1, 2; testing subtasks 1.3, 2.2.
- AC #2: Task 3; testing subtask 3.2.
- AC #3: Tasks 2, 4; testing subtasks 2.2, 4.2, 5.2.

## Dev Notes

- Probe logic must continue to source worker state from the supervisor so readiness mirrors handshake/backoff and restart counts; keep `/healthz`/`/readyz`/`/livez` wired in the main Express app. _[Source: docs/_archive/sprint-artifacts/tech-spec-epic-3.md#services-and-modules]_ _[Source: docs/architecture.md#decision-summary]_
- Guard orchestration by keeping Traefik/Compose health checks pointed at `/readyz` and honoring the 10s graceful drain and 250 ms→5 s backoff policy before reopening traffic. _[Source: docs/architecture.md#decision-summary]_ _[Source: docs/app-server-migration/codex-completions-api-migration.md#h-configuration--deployment]_
- Align probe outputs with metrics/logs: restart/backoff counters should match Prometheus gauges and structured log fields to keep dashboards/alerts consistent during smoke drills. _[Source: docs/architecture.md#observability]_ _[Source: docs/app-server-migration/metrics-and-alerts.md]_
- PRD requires health/readiness behavior to protect user-facing availability; keep `/readyz` semantics aligned with functional requirements and deployment expectations. _[Source: docs/PRD.md#functional-requirements]_

### Learnings from Previous Story (3-2)

- Metrics pipeline already exposes restart/backoff and stream gauges behind guarded `/metrics`; reuse those sources in probes to avoid duplicate state machines. _[Source: docs/_archive/sprint-artifacts/3-2-metrics-pipeline-for-app-server-path.md]_
- Keep readiness semantics consistent with the metrics guard and Traefik health checks so probes and scrapes agree on worker state. _[Source: docs/_archive/sprint-artifacts/3-2-metrics-pipeline-for-app-server-path.md]_
- File references to reuse: `src/services/metrics/index.js`, `src/routes/metrics.js`, `src/middleware/metrics.js`, `tests/integration/metrics.int.test.js`, `tests/unit/metrics.normalization.test.js`, `docs/app-server-migration/metrics-and-alerts.md`, `docs/app-server-migration/alerts/metrics-alerts.yaml`, `docs/app-server-migration/dashboards/observability-dashboard.json`. _[Source: docs/_archive/sprint-artifacts/3-2-metrics-pipeline-for-app-server-path.md#file-list]_
- Completion notes/warnings from Story 3-2: metrics guard, smoke scrapes, dashboards/alerts, and restart/backoff gauges are already implemented—reuse those patterns and avoid duplicating state machines. _[Source: docs/_archive/sprint-artifacts/3-2-metrics-pipeline-for-app-server-path.md#completion-notes-list]_

### Project Structure Notes

- Probe handlers live in `src/routes/health.js` and consume supervisor snapshots; avoid moving them out of the main app to preserve Traefik/Compose expectations. _[Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md]_
- Supervisor state and restart/backoff data come from `src/services/worker/supervisor.js`; any new fields for probes must stay aligned with metrics emission to prevent divergence. _[Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md]_
- Document deployment wiring and smoke steps alongside existing migration materials in `docs/app-server-migration/`. _[Source: docs/app-server-migration/codex-completions-api-migration.md]_

### References

- docs/epics.md  
- docs/_archive/sprint-artifacts/tech-spec-epic-3.md  
- docs/architecture.md  
- docs/app-server-migration/codex-completions-api-migration.md  
- docs/app-server-migration/metrics-and-alerts.md  
- docs/_archive/sprint-artifacts/3-2-metrics-pipeline-for-app-server-path.md  
- docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md  

## Dev Agent Record

### Context Reference

- docs/_archive/sprint-artifacts/3-3-health-probe-integration-tests.context.xml

### Agent Model Used

codex-5 (planned)

### Debug Log References

- Implemented probe metadata merge + tests: added unit coverage for readiness payload shape with mocked supervisor metadata; extended integration checks already present.
- Added doc probe lint script and ran it.
- Smoke scripts now cross-check /readyz vs metrics restart/backoff fields.

### Completion Notes List

- Ready/liveness endpoints surface restart/backoff metadata merged from supervisor snapshots and match Prometheus gauges.
- Added unit coverage for readiness payload shape (app-server enabled/disabled paths).
- Added doc lint (`npm run lint:readyz-doc`) enforcing `/readyz` snippet + restart metadata in migration runbook.
- Tests run: `npx vitest run tests/unit/health.route.spec.js`; `npx vitest run tests/integration/health.probes.app-server.int.test.js`; `npm test`; `npm run lint:readyz-doc`.

### File List

- src/routes/health.js
- tests/integration/health.probes.app-server.int.test.js
- tests/unit/health.route.spec.js
- docs/app-server-migration/codex-completions-api-migration.md
- scripts/dev-smoke.sh
- scripts/prod-smoke.sh
- scripts/qa/check-readyz-doc.js
- package.json

## Change Log

- 2025-11-20: Drafted story from epics/PRD/architecture and prior story learnings; status set to drafted.
- 2025-11-20: Added restart/backoff metadata to probes, expanded integration tests/smoke checks, and updated runbook guidance; status set to review.
- 2025-11-20: Addressed review follow-ups with readiness payload unit test and `/readyz` doc lint; smoke/tests updated; status set to review.
- 2025-11-20: Senior Developer Review (AI) completed; outcome = Approve.
- 2025-11-20: Story approved; status set to done.

## Senior Developer Review (AI)

- Reviewer: drj
- Date: 2025-11-20
- Outcome: Approve

### Summary
- Probes emit restart/backoff metadata aligned with supervisor state; unit/integration/smoke coverage validate crash/slow-start/restart and metrics alignment. Runbook documents probe expectations.

### Key Findings
- No blocking issues.

### Acceptance Criteria Coverage

| AC | Description | Status | Evidence |
| --- | --- | --- | --- |
| 1 | /readyz+/livez reflect handshake/backoff; tests cover crash/slow-start/restart with metadata | IMPLEMENTED | src/routes/health.js#L9-L135; tests/integration/health.probes.app-server.int.test.js#L1-L148; tests/unit/health.route.spec.js#L1-L77 |
| 2 | Runbook shows Compose/systemd health checks consuming /readyz with timing/restart counters | IMPLEMENTED | docs/app-server-migration/codex-completions-api-migration.md#L134-L183 |
| 3 | Probes corroborate metrics/logs; runbooks show how to validate | IMPLEMENTED | tests/integration/health.probes.app-server.int.test.js#L42-L112; scripts/dev-smoke.sh#L20-L116; scripts/prod-smoke.sh#L20-L120; docs/app-server-migration/codex-completions-api-migration.md#L172-L183 |

**AC Summary:** 3 of 3 acceptance criteria implemented (with coverage). No AC-level gaps.

### Task Completion Validation

| Task/Subtask | Marked As | Verified As | Evidence |
| --- | --- | --- | --- |
| Add integration tests for crash/slow-start/restart readiness + metadata | [x] | VERIFIED COMPLETE | tests/integration/health.probes.app-server.int.test.js:42-148 |
| Extend integration file with restart/backoff assertions | [x] | VERIFIED COMPLETE | tests/integration/health.probes.app-server.int.test.js:42-112 |
| Add unit coverage for probe payload shape when supervisor state changes | [x] | VERIFIED COMPLETE | tests/unit/health.route.spec.js:1-77 |
| Verify restart/backoff fields align with supervisor snapshot across scenarios | [x] | VERIFIED COMPLETE | tests/integration/health.probes.app-server.int.test.js:79-112 |
| Ensure probe handlers surface handshake/backoff/restart counters consistent with metrics | [x] | VERIFIED COMPLETE | src/routes/health.js:9-135 |
| Cross-verify restart/backoff fields against /metrics gauges during tests | [x] | VERIFIED COMPLETE | tests/integration/health.probes.app-server.int.test.js:88-112 |
| Document Compose/systemd /readyz examples + thresholds in runbook | [x] | VERIFIED COMPLETE | docs/app-server-migration/codex-completions-api-migration.md:134-183 |
| Add testing subtask: lint/check presence of /readyz probe snippets in docs | [x] | VERIFIED COMPLETE | scripts/qa/check-readyz-doc.js; npm run lint:readyz-doc |
| Extend smoke scripts with /readyz vs metrics/logs alignment | [x] | VERIFIED COMPLETE | scripts/dev-smoke.sh:20-116; scripts/prod-smoke.sh:20-120 |
| Add doc validation/linters or checks for probe snippets/smoke scripts | [x] | VERIFIED COMPLETE | scripts/qa/check-readyz-doc.js; scripts/dev-smoke.sh; scripts/prod-smoke.sh |

**Task Summary:** Verified 10/10 completed items.

### Test Coverage and Gaps
- Added: integration coverage for crash/restart and slow-start readiness with metrics alignment (tests/integration/health.probes.app-server.int.test.js).
- Unit: readiness payload metadata for app-server enabled/disabled (tests/unit/health.route.spec.js).
- Smoke: dev/prod scripts assert `/readyz` metadata vs metrics.

### Architectural Alignment
- Changes pull supervisor restart/backoff metadata into probes and align with metrics gauges; consistent with architecture and tech-spec (restart telemetry single source).

### Security Notes
- No new auth surface; health payloads only expose restart metadata (non-sensitive). Metrics access still guarded by existing flags/token.

### Best-Practices / References
- Prometheus gauge alignment: ensure `codex_worker_restarts_total`/`codex_worker_backoff_ms` stay single-source (metrics/index.js) and probes consume supervisor snapshot for consistency.

### Action Items

**Code Changes Required**
- [ ] None

**Advisory Notes**
- Note: Maintain alignment between supervisor snapshot and metrics gauges if metadata fields expand.
