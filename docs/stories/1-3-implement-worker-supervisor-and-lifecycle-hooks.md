# Story 1.3: Implement Worker Supervisor and Lifecycle Hooks

Status: done

## Requirements Context Summary

- Epic 1.3 mandates a supervised Codex App Server worker that starts with the proxy, captures structured stdout/stderr, handles bounded restarts, and performs graceful drains so client traffic stays stable during lifecycle events. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks)
- The PRD's "Worker Restart With Graceful Recovery" journey sets concrete timing goals—restart within 10 seconds, readiness restored inside 8 seconds, and retriable errors for drained requests—that the supervisor must enforce. [Source](docs/PRD.md#user-journeys)
- Migration guidance and architecture standards require a singleton `codex app-server` child with structured JSON logging, Prometheus restart metrics, and signal-aware shutdown handling. [Source](docs/app-server-migration/codex-completions-api-migration.md#b-process-model-change-singleton-child) [Source](docs/architecture.md#implementation-patterns)

## Project Structure Alignment

- Build the supervisor lifecycle in `src/services/` alongside the existing `codex-runner` and expose configuration via `src/config` to stay aligned with the service-oriented layout. [Source](docs/bmad/architecture/source-tree.md#src-modules)
- Reuse the packaged `codex app-server` binary, writable `.codex-api/`, and smoke hooks delivered in Story 1.2 instead of reintroducing proto pathways. [Source](docs/stories/1-2-package-codex-cli-with-app-server-capability.md#completion-notes-list)
- Preserve structured logging, restart metrics, and feature-flag gating that already frame worker health, extending them rather than duplicating logic. [Source](docs/architecture.md#implementation-patterns) [Source](docs/stories/1-2-package-codex-cli-with-app-server-capability.md#debug-log-references)

## Story

As a backend developer,
I want a supervised process that starts, restarts, and terminates the Codex App Server cleanly,
so that the API can rely on a persistent worker without manual intervention. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks)

## Acceptance Criteria

1. Worker supervisor boots the shared Codex App Server on proxy startup, funnels stdout/stderr into structured logging, and keeps observability hooks active across lifecycle events. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks) [Source](docs/architecture.md#implementation-patterns)
2. Supervisor restarts the worker with bounded exponential backoff, exposing restart metrics and warnings so operators can detect crash loops. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks) [Source](docs/architecture.md#implementation-patterns)
3. Shutdown drains in-flight work, updates readiness, and terminates the worker within the configured grace period while presenting retriable errors to clients. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks) [Source](docs/PRD.md#user-journeys)

## Tasks / Subtasks

- [x] (AC #1) Introduce a supervisor module under `src/services/` that spawns `codex app-server` at bootstrap and forwards stdout/stderr through structured logging. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks) [Source](docs/app-server-migration/codex-completions-api-migration.md#b-process-model-change-singleton-child)
  - [x] (AC #1) Wire supervisor startup into the existing feature-flag flow so the worker starts before request handling while reusing the Story 1.2 CLI packaging. [Source](docs/architecture.md#implementation-patterns) [Source](docs/stories/1-2-package-codex-cli-with-app-server-capability.md#completion-notes-list)
  - [x] (AC #1 Testing) Extend integration coverage to assert worker bootstrap logs and readiness gating per the test strategy. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)
- [x] (AC #2) Implement bounded restart/backoff handling with Prometheus counters and structured warnings for repeated exits. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks) [Source](docs/architecture.md#implementation-patterns)
  - [x] (AC #2) Emit restart/latency metrics (`codex_worker_restarts_total`, `codex_worker_latency_ms`) and record exit codes/backoff durations in logs. [Source](docs/architecture.md#implementation-patterns)
  - [x] (AC #2 Testing) Add unit tests for backoff scheduling and simulate crash loops in integration tests. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)
- [x] (AC #3) Handle graceful shutdown by signaling readiness false, draining outstanding requests, and terminating the worker within `WORKER_SHUTDOWN_GRACE_MS`. [Source](docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks) [Source](docs/PRD.md#user-journeys)
  - [x] (AC #3) Ensure drained requests surface retriable errors and readiness toggles back to true once the worker returns. [Source](docs/PRD.md#user-journeys) [Source](docs/architecture.md#implementation-patterns)
  - [x] (AC #3 Testing) Add integration/E2E coverage for SIGTERM handling and health endpoint behavior. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)

## Dev Notes

- Run the supervisor under the existing `PROXY_USE_APP_SERVER` flag so the worker starts, restarts, and shuts down with structured telemetry that mirrors architecture guidance. [Source](docs/architecture.md#implementation-patterns)
- Surface restart warnings, metrics, and readiness toggles that support the PRD's graceful recovery timeline for worker crashes. [Source](docs/PRD.md#user-journeys)
- Validate supervisor wiring via integration/E2E tests after the worker is packaged, keeping parity with migration instructions and QA workflows. [Source](docs/app-server-migration/codex-completions-api-migration.md#b-process-model-change-singleton-child) [Source](docs/bmad/architecture/tech-stack.md#testing--qa)
- Coding standards document remains a placeholder, so continue following the repository's established Node/ESM conventions. [Source](docs/bmad/architecture/coding-standards.md)

### Learnings from Previous Story

- Docker image changes (Dockerfile, `scripts/prod-smoke.sh`, `scripts/dev-smoke.sh`) already ship `@openai/codex` 0.53.0 and a writable `/app/.codex-api`; reuse these assets when spawning the worker instead of introducing new mounts. [Source](docs/stories/1-2-package-codex-cli-with-app-server-capability.md#completion-notes-list) [Source](docs/stories/1-2-package-codex-cli-with-app-server-capability.md#file-list)
- Smoke scripts enforce `codex app-server --help`; fold those checks into supervisor health diagnostics to catch regressions quickly. [Source](docs/stories/1-2-package-codex-cli-with-app-server-capability.md#debug-log-references)
- Story 1.2 closed with no outstanding action items, so there are no prior blockers to carry forward. [Source](docs/stories/1-2-package-codex-cli-with-app-server-capability.md#action-items)

### Project Structure Notes

- Implement supervisor orchestration under `src/services/worker/` (new module) with configuration surfaced through `src/config`, and integrate readiness hooks in `server.js` and `src/routes/health.js`. [Source](docs/bmad/architecture/source-tree.md#src-modules) [Source](docs/architecture.md#integration-points)
- Place supporting tests beside their targets (`tests/integration/worker-supervisor.test.js`, Playwright coverage under `tests/e2e/`) to honor repo conventions. [Source](docs/bmad/architecture/source-tree.md#tests)

### References

- docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks
- docs/PRD.md#user-journeys
- docs/app-server-migration/codex-completions-api-migration.md#b-process-model-change-singleton-child
- docs/architecture.md#implementation-patterns
- docs/architecture.md#integration-points
- docs/bmad/architecture/source-tree.md#src-modules
- docs/bmad/architecture/source-tree.md#tests
- docs/bmad/architecture/tech-stack.md#testing--qa
- docs/bmad/architecture/coding-standards.md
- docs/stories/1-2-package-codex-cli-with-app-server-capability.md#completion-notes-list
- docs/stories/1-2-package-codex-cli-with-app-server-capability.md#debug-log-references
- docs/stories/1-2-package-codex-cli-with-app-server-capability.md#action-items
- docs/stories/1-2-package-codex-cli-with-app-server-capability.md#file-list

## Dev Agent Record

### Context Reference

- docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.context.xml

### Agent Model Used

codex-gpt-5 (story drafting)

### Debug Log References

- 2025-10-31: Implementation plan for AC#1 (supervisor bootstrap)
  - Map out new `src/services/worker/supervisor.js` module that wraps `spawnCodex`, streams stdout/stderr into structured logs, and tracks worker state.
  - Extend `server.js` startup path to initialize the supervisor behind `PROXY_USE_APP_SERVER` and expose readiness hooks for routers.
  - Update `src/routes/health.js` and associated integration tests so `/healthz` reports worker readiness and app-server enablement gates on supervisor state.
  - Capture configuration needs (backoff windows, shutdown grace) in `src/config/index.js` for later AC coverage.
- 2025-10-31: Implemented supervisor lifecycle per ACs — added `src/services/worker/supervisor.js`, wired startup/shutdown in `server.js`, gated chat handlers on readiness, surfaced metrics via `/healthz`, and extended integration/e2e suites (new worker supervisor tests plus updated backend-mode checks).

### Completion Notes List

- 2025-10-31: Delivered supervisor lifecycle (startup, restart, readiness gating, graceful shutdown) with `src/services/worker/supervisor.js`, updated server initialization, readiness-aware chat handlers, `/healthz` metrics, and refreshed integration + Playwright suites (`npm run test:integration`, `npm test`).

### File List

- src/services/worker/supervisor.js
- server.js
- src/routes/health.js
- src/config/index.js
- src/handlers/chat/nonstream.js
- src/handlers/chat/stream.js
- scripts/fake-codex-proto.js
- tests/integration/backend-mode.int.test.js
- tests/integration/worker-supervisor.int.test.js
- .env.example
- .env.dev
- docs/sprint-status.yaml

## Change Log

- [x] 2025-10-31: Draft created for Story 1.3.
- [x] 2025-10-31: Story context generated and validation reports saved.
- [x] 2025-10-31: Implemented supervisor lifecycle, readiness gating, metrics, and test coverage.
- [x] 2025-10-31: Senior Developer Review notes appended.

## Senior Developer Review (AI)

**Reviewer:** drj  
**Date:** 2025-10-31  
**Outcome:** Approve — Supervisor boots the shared worker with full configuration, exposes readiness/metrics, and guards request handling per ACs.

### Summary

- Supervisor now constructs full app-server launch arguments (model, sandbox, provider, parallel tools) before spawning and logs attempts (`src/services/worker/supervisor.js:8`, `src/services/worker/supervisor.js:153`).
- Server bootstrap engages the supervisor when the feature flag is enabled and ensures graceful shutdown signals drain the worker (`server.js:7`, `server.js:20`).
- `/healthz` surfaces supervisor telemetry and chat/completions handlers return 503 with status payloads until readiness is reached (`src/routes/health.js:8`, `src/handlers/chat/nonstream.js:322`, `src/handlers/chat/stream.js:198`).
- Integration suite validates readiness metrics, restart backoff, and feature-flag behaviour; Playwright suite still passes after the new lifecycle (`tests/integration/worker-supervisor.int.test.js:78`, `tests/integration/backend-mode.int.test.js:70`).

### Key Findings

- None.

### Acceptance Criteria Coverage

| AC# | Description                                                                                            | Status      | Evidence                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Supervisor boots the Codex App Server on proxy startup with structured logging and observability hooks | Implemented | src/services/worker/supervisor.js:8; src/services/worker/supervisor.js:153; server.js:7                           |
| 2   | Bounded restart/backoff with metrics and warnings                                                      | Implemented | src/services/worker/supervisor.js:231; src/routes/health.js:8; tests/integration/worker-supervisor.int.test.js:92 |
| 3   | Graceful shutdown drains in-flight work, toggles readiness, and enforces grace period                  | Implemented | server.js:20; src/services/worker/supervisor.js:99; tests/integration/worker-supervisor.int.test.js:106           |

**Summary:** 3 of 3 acceptance criteria fully implemented.

### Task Completion Validation

| Task                                                                | Marked As | Verified As       | Evidence                                                                                          |
| ------------------------------------------------------------------- | --------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| Introduce supervisor module spawning `codex app-server`             | [x]       | Verified Complete | src/services/worker/supervisor.js:8; src/services/worker/supervisor.js:153                        |
| Wire startup behind feature flag and reuse packaging assets         | [x]       | Verified Complete | server.js:7; src/handlers/chat/nonstream.js:322; src/handlers/chat/stream.js:198                  |
| Extend integration coverage for bootstrap/readiness gating          | [x]       | Verified Complete | tests/integration/worker-supervisor.int.test.js:78; tests/integration/backend-mode.int.test.js:70 |
| Implement restart/backoff handling with metrics/logs                | [x]       | Verified Complete | src/services/worker/supervisor.js:231; src/routes/health.js:8                                     |
| Emit restart/latency metrics and log exit/backoff windows           | [x]       | Verified Complete | src/services/worker/supervisor.js:64; src/services/worker/supervisor.js:231                       |
| Add tests simulating crash loops/backoff                            | [x]       | Verified Complete | tests/integration/worker-supervisor.int.test.js:92                                                |
| Handle graceful shutdown, draining, readiness toggles               | [x]       | Verified Complete | server.js:20; src/services/worker/supervisor.js:99                                                |
| Ensure drained requests surface retriable errors/readiness recovery | [x]       | Verified Complete | src/handlers/chat/nonstream.js:322; src/handlers/chat/stream.js:198                               |
| Add integration/E2E coverage for SIGTERM & health behaviour         | [x]       | Verified Complete | tests/integration/worker-supervisor.int.test.js:106; npm run test:integration                     |

### Test Coverage and Gaps

- `npm run test:integration` exercises supervisor readiness, restart backoff, and feature-flag behaviour.
- `npm test` (Playwright) still passes after supervisor lifecycle integration, verifying streaming/non-streaming contracts.

### Architectural Alignment

- Supervisor honours architecture guidance: singleton child under feature flag, structured logging, restart metrics, readiness gates, and integration with graceful shutdown.

### Security Notes

- None.

### Best-Practices and References

- docs/epics.md#story-13-implement-worker-supervisor-and-lifecycle-hooks
- docs/PRD.md#user-journeys
- docs/app-server-migration/codex-completions-api-migration.md#b-process-model-change-singleton-child
- docs/architecture.md#implementation-patterns

### Action Items

**Code Changes Required:**

- None.

**Advisory Notes:**

- None.
