# Story 1.5: Wire readiness and liveness probes to worker state

Status: done

## Requirements Context Summary

- Epic 1.5 targets wiring `/healthz` and `/readyz` so probes mirror the Codex worker lifecycle, making orchestrators gate traffic on real readiness. [Source: docs/epics.md#story-15-wire-readiness-and-liveness-probes-to-worker-state]
- Functional requirement FR007 mandates exposing readiness/liveness signals that reflect worker responsiveness before advertising the API as ready, complementing FR006 supervision controls. [Source: docs/PRD.md#functional-requirements]
- Architecture decisions lock readiness on the JSON-RPC handshake and graceful shutdown to protect cutover plans, so probes must consult supervisor state and advertised models rather than superficial process checks. [Source: docs/architecture.md#decision-summary] [Source: docs/stories/1-4-establish-json-rpc-transport-channel.md#dev-notes]
- Deployment runbooks and compose topology expect `/readyz` for container orchestrators and Traefik, so probe logic must stay in the main Express app and surface failure within seconds when the worker drops. [Source: docs/app-server-migration/codex-completions-api-migration.md#h-configuration--deployment] [Source: docs/architecture.md#deployment-architecture]

## Project Structure Alignment

- Update existing health routes under `src/routes/health.js` and shared middleware rather than introducing new endpoints, keeping readiness logic consolidated per source tree conventions. [Source: docs/bmad/architecture/source-tree.md#src-modules]
- Extend the supervisor service at `src/services/worker/supervisor.js` and forthcoming transport hooks so readiness reflects the same lifecycle signals already consumed by chat handlers. [Source: docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#file-list] [Source: docs/stories/1-4-establish-json-rpc-transport-channel.md#project-structure-notes]
- Surface probe state via `src/config/index.js` feature flags and shared config helpers to stay aligned with configuration consolidation patterns. [Source: docs/architecture.md#project-structure]
- Keep probe integration tests alongside existing transport/supervisor suites under `tests/integration/`, mirroring Story 1.4 coverage. [Source: docs/stories/1-4-establish-json-rpc-transport-channel.md#tasks--subtasks]

## Story

As an SRE,
I want the proxy readiness and liveness probes to mirror the Codex worker state,
so that orchestrators only send traffic when the app-server is actually healthy and reconnect quickly after failures.

## Acceptance Criteria

1. Readiness probe stays false until the worker supervisor reports a successful JSON-RPC handshake and advertised models, and flips back to false within 5 seconds if the worker exits or loses handshake state. [Source: docs/epics.md#story-15-wire-readiness-and-liveness-probes-to-worker-state] [Source: docs/PRD.md#functional-requirements]
2. Liveness probe reports process availability based on the supervisor child process, failing only when the worker is no longer running or restart thresholds are exceeded, while allowing transient restarts under the configured backoff policy. [Source: docs/epics.md#story-15-wire-readiness-and-liveness-probes-to-worker-state] [Source: docs/architecture.md#decision-summary]
3. Compose/systemd documentation reflects the new probe behavior with example configuration for Traefik, Docker Compose, and systemd targets, including how orchestrators should react to readiness flips. [Source: docs/app-server-migration/codex-completions-api-migration.md#h-configuration--deployment]

## Tasks / Subtasks

- [x] (AC #1) Extend worker supervisor to publish readiness/liveness signals (handshake success, advertised models, restart backoff state) via an exported API consumed by health routes. [Source: docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#dev-notes]
  - [x] (AC #1 Testing) Add unit coverage for supervisor readiness state transitions (startup, handshake success, worker exit). [Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- [x] (AC #1) Update `src/routes/health.js` readiness handler to consult supervisor state, ensure fallback during startup and failure, and wire logging for probe flips. [Source: docs/bmad/architecture/source-tree.md#src-modules]
- [x] (AC #2) Update liveness handler to reflect worker process availability using supervisor monitoring without blocking on handshake completion. [Source: docs/epics.md#story-15-wire-readiness-and-liveness-probes-to-worker-state]
  - [x] (AC #2 Testing) Add integration tests simulating worker crash/restart to verify liveness and readiness transitions within the promised 5-second window. [Source: docs/stories/1-4-establish-json-rpc-transport-channel.md#tasks--subtasks]
- [x] (AC #3) Document probe configuration examples for Docker Compose, systemd, and Traefik in the deployment runbook (`docs/app-server-migration/codex-completions-api-migration.md`). [Source: docs/implementation-readiness-report-2025-10-30.md#recommendations]
  - [x] (AC #3) Add runbook checklist entry ensuring staged and production environments monitor readiness flips and restart counts. [Source: docs/architecture.md#deployment-architecture]

## Dev Notes

- Tie readiness to the same `JsonRpcTransport` handshake and supervisor readiness signals used by chat handlers to avoid drift between API behavior and probe state. [Source: docs/stories/1-4-establish-json-rpc-transport-channel.md#dev-notes]
- Maintain single-source configuration by extending `src/config/index.js` for probe intervals and failure thresholds, keeping parity with existing env var patterns. [Source: docs/architecture.md#project-structure]
- Ensure structured logs describe probe transitions (`readiness=false`, `reason`, `elapsed_ms`) to feed observability dashboards planned in Epic 3. [Source: docs/architecture.md#logging--observability]
- Cross-check against coding standards guidance so formatting and naming stay consistent even as the checklist evolves. [Source: docs/bmad/architecture/coding-standards.md]
- Require integration tests to run with `npm run test:integration` since probes affect request lifecycle and SSE gating. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]

### Learnings from Previous Story

**From Story 1-4-establish-json-rpc-transport-channel (Status: review)**

- **Transport Interfaces Available:** Reuse the new handshake helpers and request context management in `src/services/transport/index.js` and `src/services/transport/child-adapter.js` instead of duplicating probe signal parsing. [Source: stories/1-4-establish-json-rpc-transport-channel.md#Dev-Notes]
- **Supervisor Hooks:** Supervisor readiness events added in Story 1.4 are already exported from `src/services/worker/supervisor.js`; leverage them to flip readiness rather than polling process state. [Source: stories/1-4-establish-json-rpc-transport-channel.md#Dev-Notes]
- **Testing Fixtures:** Integration suites (`tests/integration/json-rpc-transport.int.test.js`, `tests/integration/backend-mode.int.test.js`) create deterministic worker transcripts; extend those patterns to simulate probe behavior. [Source: stories/1-4-establish-json-rpc-transport-channel.md#Tasks--Subtasks]
- **No Outstanding Review Items:** Senior developer review recorded zero action items, so focus on wiring probes without modifying transport behavior. [Source: stories/1-4-establish-json-rpc-transport-channel.md#Senior-Developer-Review-AI]

### Project Structure Notes

- Health routes remain within `src/routes/health.js`; avoid scattering probe logic into separate modules to preserve route cohesion. [Source: docs/bmad/architecture/source-tree.md#src-modules]
- Supervisor exports live in `src/services/worker/supervisor.js`; keep probe-specific helpers adjacent to maintain visibility for future lifecycle changes. [Source: docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#file-list]
- Add new tests under `tests/integration/` using existing test harness same as transport/supervisor suites; follow naming `health-probes.int.test.js`. [Source: docs/bmad/architecture/source-tree.md#tests]

### References

- docs/epics.md#story-15-wire-readiness-and-liveness-probes-to-worker-state
- docs/PRD.md#functional-requirements
- docs/architecture.md#decision-summary
- docs/app-server-migration/codex-completions-api-migration.md#h-configuration--deployment
- docs/stories/1-4-establish-json-rpc-transport-channel.md#dev-notes
- docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#dev-notes
- docs/bmad/architecture/source-tree.md#src-modules
- docs/bmad/architecture/tech-stack.md#testing--qa

## Dev Agent Record

### Context Reference

- docs/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.context.xml

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

sm-bmad (story drafting)

### Debug Log References

- 2025-10-31T17:04:08Z — Plan for (AC #1) supervisor signals: extend `CodexWorkerSupervisor` to emit structured readiness/liveness state (including handshake payloads, timestamps, restart reasons) and expose a consolidated health accessor for the probe routes before updating `/healthz` and new `/readyz`/`/livez` handlers.
- 2025-10-31T17:12:46Z — Implemented supervisor readiness/liveness state machine, expanded `/healthz` plus new `/readyz` & `/livez`, and confirmed with `npm run test:unit -- tests/unit/worker-supervisor.test.js`.
- 2025-10-31T17:13:28Z — Plan for (AC #2) probe validation: spin app-server integration harness, simulate worker auto-exit to assert `/readyz` flips <5s, `/livez` stays 200, and document timing evidence via new Vitest integration tests.
- 2025-10-31T17:14:28Z — Validated (AC #2) via new app-server integration suite (`npm run test:integration -- tests/integration/health.probes.app-server.int.test.js`) confirming readiness drops within 5s of worker exit while liveness holds steady through restart.
- 2025-10-31T17:15:20Z — Plan for (AC #3) docs/runbook updates: capture `/readyz` & `/livez` wiring across Traefik, Docker Compose, systemd, and add checklist item to monitor readiness flips plus supervisor restart counters in staged/prod.
- 2025-10-31T17:15:55Z — Updated runbook docs with Compose/systemd/Traefik probe examples and added checklist bullet for monitoring readiness+liveness plus supervisor restarts.

### Completion Notes List

- Implemented readiness/liveness health snapshots (`src/services/worker/supervisor.js`), extended health routes with `/readyz` + `/livez` (`src/routes/health.js`), authored integration/unit coverage, and refreshed migration runbook with probe guidance; tests: `npm run test:unit -- tests/unit/worker-supervisor.test.js`, `npm run test:integration -- tests/integration/health.probes.app-server.int.test.js`, `npm run verify:all`.

### File List

- src/services/worker/supervisor.js
- src/routes/health.js
- tests/unit/worker-supervisor.test.js
- tests/integration/routes.health.int.test.js
- tests/integration/health.probes.app-server.int.test.js
- docs/app-server-migration/codex-completions-api-migration.md
- docs/sprint-status.yaml
- docs/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md

## Change Log

- [ ] 2025-10-31: Draft created for Story 1.5.
- [x] 2025-10-31: Implemented supervisor readiness/liveness signals, probe endpoints, integration/unit coverage, and runbook updates.
- [x] 2025-10-31: Senior Developer Review notes appended.

## Senior Developer Review (AI)

**Reviewer:** drj (AI)

**Date:** 2025-10-31

**Outcome:** Approve — readiness and liveness behavior aligns with supervisor lifecycle guarantees, and documentation/test coverage satisfies all acceptance criteria.

### Summary

- Verified that readiness now tracks the Codex worker handshake while liveness tolerates supervised restarts without flapping client traffic.
- Confirmed new `/readyz` and `/livez` endpoints surface structured probe state, and `/healthz` mirrors readiness so orchestrators can pause routing during worker relaunches.
- Validated operational docs include concrete Compose, systemd, and Traefik guidance plus monitoring checklist updates.

### Key Findings

- **High:** None.
- **Medium:** None.
- **Low:** None.

### Acceptance Criteria Coverage

| AC# | Description                                                                                        | Status         | Evidence                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Readiness remains false until JSON-RPC handshake completes and flips back within 5s on worker exit | ✅ Implemented | `src/services/worker/supervisor.js:48-126,300-377,401-470`; `src/routes/health.js:9-85`; `tests/integration/health.probes.app-server.int.test.js:39-75`                       |
| 2   | Liveness reflects process availability, tolerating supervised restarts without blocking handshake  | ✅ Implemented | `src/services/worker/supervisor.js:92-125,155-170,339-505`; `/livez` handler in `src/routes/health.js:87-105`; `tests/integration/health.probes.app-server.int.test.js:39-75` |
| 3   | Deployment docs updated with probe configuration and monitoring checklist                          | ✅ Implemented | `docs/app-server-migration/codex-completions-api-migration.md:128-168,199-243`                                                                                                |

**Summary:** 3 of 3 acceptance criteria validated with code and documentation evidence.

### Task Completion Validation

| Task                                                    | Marked As | Verified As | Evidence                                                                                      |
| ------------------------------------------------------- | --------- | ----------- | --------------------------------------------------------------------------------------------- |
| Extend supervisor to publish readiness/liveness signals | ✅        | ✅          | `src/services/worker/supervisor.js:48-505`; `tests/unit/worker-supervisor.test.js:1-111`      |
| Update `/healthz` readiness handler and logging         | ✅        | ✅          | `src/routes/health.js:9-85`; `tests/integration/routes.health.int.test.js:35-62`              |
| Update liveness handler for worker monitoring           | ✅        | ✅          | `src/routes/health.js:87-105`; `tests/integration/health.probes.app-server.int.test.js:39-75` |
| Add unit coverage for supervisor readiness transitions  | ✅        | ✅          | `tests/unit/worker-supervisor.test.js:1-111`                                                  |
| Add integration coverage for crash/restart timing       | ✅        | ✅          | `tests/integration/health.probes.app-server.int.test.js:39-75`                                |
| Document probe configs for Compose/systemd/Traefik      | ✅        | ✅          | `docs/app-server-migration/codex-completions-api-migration.md:128-168`                        |
| Add runbook monitoring checklist entry                  | ✅        | ✅          | `docs/app-server-migration/codex-completions-api-migration.md:199-243`                        |

**Summary:** 7 of 7 tasks verified, 0 questionable, 0 false completions.

### Test Coverage and Gaps

- `npm run verify:all`
- Unit coverage: `tests/unit/worker-supervisor.test.js` exercises readiness/liveness state transitions.
- Integration coverage: `tests/integration/routes.health.int.test.js` validates contract in proto mode; `tests/integration/health.probes.app-server.int.test.js` simulates worker crash/restart timing.
- No additional gaps identified; future smoke stacks should incorporate `/readyz` expectations.

### Architectural Alignment

- Supervisor updates reuse existing lifecycle hooks per `docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md`.
- Health routes remain centralized in `src/routes/health.js`, aligning with `docs/bmad/architecture/source-tree.md` guidance.
- Documentation syncs with migration runbook expectations in `docs/app-server-migration/codex-completions-api-migration.md`.

### Security Notes

- No new attack surface introduced; probe endpoints expose existing supervisor telemetry over authenticated admin plane.

### Best-Practices and References

- `docs/epics.md#story-15-wire-readiness-and-liveness-probes-to-worker-state`
- `docs/PRD.md#worker-lifecycle--controls`
- `docs/app-server-migration/codex-completions-api-migration.md#h-configuration--deployment`

### Action Items

**Code Changes Required:** None.

**Advisory Notes:**

- Note: Ensure operations dashboards ingest the new readiness/liveness fields from `/healthz` to visualize probe transitions.
