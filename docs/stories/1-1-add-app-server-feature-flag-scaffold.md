# Story 1.1: Add App-Server Feature Flag Scaffold

Status: done

## Story

As an operator,
I want the proxy to support a runtime switch between proto and app-server,
so that we can enable or disable the new backend without redeploying.

## Acceptance Criteria

1. Environment variable `PROXY_USE_APP_SERVER` toggles backend selection at startup.
2. Configuration docs outline defaults for dev, staging, and prod.
3. Unit tests cover both flag paths and ensure default matches current proto behavior.

## Tasks / Subtasks

- [x] (AC: #1) Thread feature flag through backend selection
  - [x] (AC: #1) Add `PROXY_USE_APP_SERVER` boolean to `src/config/index.js` with a default of `false`, using the existing helpers to normalize boolean env values [Source: docs/architecture.md#decision-summary].
  - [x] (AC: #1) Introduce a shared selector (e.g., `src/services/backend-mode.js`) that resolves `'proto'` vs `'app-server'` once at startup and logs the active mode for operators [Source: docs/architecture.md#decision-summary].
  - [x] (AC: #1 Testing) Ensure the bootstrap path keeps proto active when the flag is unset while clearly logging when operators opt into the app-server path (even if later stories still stub the worker). Capture this behavior in a targeted integration assertion.
- [x] (AC: #2) Document rollout defaults for each environment
  - [x] (AC: #2) Update the migration or README docs with a table that lists dev/staging/prod defaults plus explicit toggle steps for operators [Source: docs/implementation-readiness-report-2025-10-30.md].
  - [x] (AC: #2) Add `.env.example` / `.env.dev` entries documenting the flag and its default so local setups stay aligned [Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected].
  - [x] (AC: #2 Testing) Add a docs lint or CI check that verifies the table and env examples stay in sync across environments.
- [x] (AC: #3) Cover flag paths with automated tests
  - [x] (AC: #3) Create or extend a Vitest unit suite under `tests/unit/config/` that asserts the config defaults to proto and flips when the env var is set [Source: docs/bmad/architecture/tech-stack.md#testing-qa].
  - [x] (AC: #3 Testing) Add a focused integration test (chat handler or service shim) that verifies backend selection logic feeds future worker wiring while keeping existing proto behavior intact [Source: docs/architecture.md#epic-to-architecture-mapping].
- **Review Follow-ups (AI)**
  - [x] [AI-Review][High] Wire `PROXY_USE_APP_SERVER` into backend selection so app-server mode actually changes the spawned Codex command (AC #1) [file: src/handlers/chat/shared.js:1-76; src/handlers/chat/nonstream.js:288-430; src/handlers/chat/stream.js:1-330]

## Dev Notes

- Introduce `PROXY_USE_APP_SERVER` through a single configuration surface so later stories only depend on a helper (no repeated env parsing) and leave proto as the default until the worker is ready [Source: docs/architecture.md#decision-summary].
- Log the evaluated backend at startup and in health checks so operators can confirm the active mode quickly during the rollout [Source: docs/implementation-readiness-report-2025-10-30.md].
- Keep documentation and sample env files synchronized with the rollout plan so dev/staging/prod defaults stay explicit [Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected].
- Use Vitest for config tests and prefer deterministic integration shims around the upcoming worker interface to avoid flakes [Source: docs/bmad/architecture/tech-stack.md#testing-qa].

### Requirements & Context Summary

- Epic 1 identifies this story as the feature-flag scaffold that unlocks safe backend switching during the migration [Source: docs/epics.md#epic-1-app-server-platform-foundation].
- PRD requirement FR005 mandates a documented runtime flag (e.g., `PROXY_USE_APP_SERVER`) to toggle between proto and the app-server without redeploying [Source: docs/PRD.md#functional-requirements].
- Architecture decisions confirm the same flag governs runtime selection and must plug into the shared configuration surface to keep rollout control simple [Source: docs/architecture.md#decision-summary][Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected].
- The implementation readiness report already maps FR005 to this flag, so documentation updates need to align with that planning artifact [Source: docs/implementation-readiness-report-2025-10-30.md].
- The epic technical specification restates packaging and configuration expectations that this story unlocks, ensuring the CLI and flag scaffolding remain in sync for downstream work [Source: docs/tech-spec-epic-1.md#dependencies-and-integrations].

### Architecture & Structure Alignment

- First story in Epic 1—no predecessor learnings exist yet, so this draft establishes the baseline convention the rest of the epic will reuse.
- Configuration changes belong in `src/config/` and should expose a helper that later epics can call without re-reading environment variables [Source: docs/architecture.md#project-structure].
- Update operator-facing docs under `docs/` (README or app-server migration guide) so environment defaults for dev/staging/prod stay in sync with the runtime plan [Source: docs/implementation-readiness-report-2025-10-30.md].
- Extend `.env.example` / `.env.dev` entries so developers enable the flag consistently across stacks [Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected].

### Testing Strategy

- Add a Vitest suite that stubs `process.env.PROXY_USE_APP_SERVER` on both branches to assert the selector returns `'proto'` by default and `'app-server'` when enabled [Source: docs/bmad/architecture/tech-stack.md#testing-qa].
- Reuse existing deterministic chat handler shims to prove the flag-fed selector still routes through the proto implementation until the worker lands, preventing regressions.
- Update `npm run verify:all` expectations so the new tests run in CI with no additional flags.

### Project Structure Notes

- Place the selector helper alongside other services in `src/services/` so worker lifecycle stories can extend it without touching routers [Source: docs/architecture.md#epic-to-architecture-mapping].
- Document the flag in `docs/app-server-migration/codex-completions-api-migration.md` to keep migration guidance co-located with rollout instructions.
- Reflect env defaults in `.env.example` to avoid drift between local and production stacks.

### References

- [Source: docs/epics.md#epic-1-app-server-platform-foundation]
- [Source: docs/PRD.md#functional-requirements]
- [Source: docs/architecture.md#decision-summary]
- [Source: docs/architecture.md#project-structure]
- [Source: docs/tech-spec-epic-1.md#dependencies-and-integrations]
- [Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected]
- [Source: docs/bmad/architecture/tech-stack.md#testing-qa]
- [Source: docs/implementation-readiness-report-2025-10-30.md]

## Dev Agent Record

### Context Reference

- docs/stories/1-1-add-app-server-feature-flag-scaffold.context.xml

### Agent Model Used

- codex-gpt-5 (story drafting)

### Debug Log References

- 2025-10-30: AC#1 implementation plan
  - Extend `src/config/index.js` with a normalized `PROXY_USE_APP_SERVER` boolean defaulting to proto behavior.
  - Introduce `src/services/backend-mode.js` to resolve the backend once, expose selector helpers, and emit a startup log for operators.
  - Ensure the bootstrap path loads the selector and surfaces the active mode via `/healthz` so ops can confirm rollout state.
  - Add unit and integration coverage that keeps proto as the default path and asserts the log toggles when the flag flips.
- 2025-10-30: AC#2 documentation & compliance plan
  - Build an environment defaults table in `docs/app-server-migration/codex-completions-api-migration.md` summarizing dev/staging/prod modes and operator toggle steps.
  - Add `PROXY_USE_APP_SERVER` entries to `.env.example` and `.env.dev` with comments aligning to the rollout defaults.
  - Introduce a docs lint test that loads the table and env samples to ensure values stay synchronized during CI.
- 2025-10-30: AC#3 testing coverage plan
  - Extend unit suites to assert `PROXY_USE_APP_SERVER` defaults to proto and flips when the env flag is true.
  - Add an integration spec that boots the server under both modes, verifies `/healthz` exposes the selection, and confirms startup logs announce the active backend.

### Completion Notes List

- AC#1: Introduced the `PROXY_USE_APP_SERVER` config flag, new `src/services/backend-mode.js`, startup logging, and `/healthz` telemetry while keeping proto as the default backend.
- For AC#2 we documented dev/staging/prod rollout defaults in the migration guide, synced `.env.example` / `.env.dev`, and added a docs lint to keep the table and env samples aligned.
- AC#3 received unit coverage (`tests/unit/config/backend-mode.spec.js`, `tests/unit/docs/app-server-flag-docs.spec.js`) plus targeted integrations (`tests/integration/backend-mode.int.test.js`); refreshed streaming transcripts, tightened concurrency harness, and ran `npm run test:unit` + `npm run test:integration` locally.
- 2025-10-31: Updated handlers and shared helpers to route spawn arguments based on `selectBackendMode()`, enabling the feature flag to toggle proto vs app-server command paths.

### File List

- UPDATED: src/config/index.js; server.js; src/routes/health.js; docs/stories/1-1-add-app-server-feature-flag-scaffold.md.
- NEW: src/services/backend-mode.js; tests/unit/config/backend-mode.spec.js; tests/unit/docs/app-server-flag-docs.spec.js; tests/integration/backend-mode.int.test.js.
- UPDATED: .env.example; .env.dev; docs/app-server-migration/codex-completions-api-migration.md; tests/integration/responses.stream.concurrency.int.test.js.
- UPDATED: test-results/chat-completions/streaming-{usage,usage-length,multi-choice}.json; test-results/responses/streaming-{text,tool-call}.json; scripts/fake-codex-proto.js.

## Change Log

- [x] 2025-10-30: Draft created for story 1.1.
- [x] 2025-10-31: Implemented feature flag scaffold, docs, and tests (`npm run test:unit`, `npm run test:integration`).
- [x] 2025-10-31: Addressed review follow-up by wiring backend selection and re-running verification suites.
- [x] 2025-10-31: Senior Developer Review notes appended.

## Senior Developer Review (AI)

**Reviewer:** drj  
**Date:** 2025-10-31  
**Outcome:** Approve — `PROXY_USE_APP_SERVER` now selects the appropriate backend while documentation and tests stay aligned.

### Summary

- `buildBackendArgs()` feeds the spawn path so the flag drives proto vs app-server selection (`src/handlers/chat/shared.js:35-69`, `src/handlers/chat/stream.js:197-267`, `src/handlers/chat/nonstream.js:288-420`).
- Spawn logs surface the active backend and the integration suite exercises both modes (`tests/integration/backend-mode.int.test.js:40-97`).
- Rollout documentation and sample env defaults remain synchronized (`docs/app-server-migration/codex-completions-api-migration.md:197-207`, `.env.example:7-8`, `.env.dev:7-8`).

### Key Findings

- None.

### Acceptance Criteria Coverage

| AC# | Description                                                                        | Status      | Evidence                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Environment variable `PROXY_USE_APP_SERVER` toggles backend selection at startup   | Implemented | src/handlers/chat/shared.js:35-69; src/handlers/chat/stream.js:197-267; src/handlers/chat/nonstream.js:288-420; tests/integration/backend-mode.int.test.js:40-97                                   |
| 2   | Configuration docs outline defaults for dev, staging, and prod                     | Implemented | docs/app-server-migration/codex-completions-api-migration.md:197-207; .env.example:7-8; .env.dev:7-8                                                                                               |
| 3   | Unit tests cover both flag paths and ensure default matches current proto behavior | Implemented | tests/unit/config/backend-mode.spec.js:16-45; tests/integration/backend-mode.int.test.js:40-97; tests/unit/docs/app-server-flag-docs.spec.js:9-30; `npm run test:unit`; `npm run test:integration` |

**Summary:** 3 of 3 acceptance criteria fully implemented.

### Task Completion Validation

| Task                                              | Marked As | Verified As       | Evidence                                                                                                       |
| ------------------------------------------------- | --------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Thread feature flag through backend selection     | [x]       | Verified Complete | src/handlers/chat/shared.js:35-69; src/handlers/chat/stream.js:197-267; src/handlers/chat/nonstream.js:288-420 |
| Add `PROXY_USE_APP_SERVER` boolean to config      | [x]       | Verified Complete | src/config/index.js:27-39                                                                                      |
| Introduce shared selector and log active mode     | [x]       | Verified Complete | src/services/backend-mode.js:1-37; server.js:1-7                                                               |
| Ensure bootstrap logs and integration coverage    | [x]       | Verified Complete | server.js:1-7; tests/integration/backend-mode.int.test.js:40-97                                                |
| Update migration docs with rollout defaults table | [x]       | Verified Complete | docs/app-server-migration/codex-completions-api-migration.md:197-207                                           |
| Document flag in `.env` samples                   | [x]       | Verified Complete | .env.example:7-8; .env.dev:7-8                                                                                 |
| Add docs lint keeping env/table aligned           | [x]       | Verified Complete | tests/unit/docs/app-server-flag-docs.spec.js:9-30                                                              |
| Extend unit suite for flag defaults               | [x]       | Verified Complete | tests/unit/config/backend-mode.spec.js:16-45                                                                   |
| Integration test for backend selection plumbing   | [x]       | Verified Complete | tests/integration/backend-mode.int.test.js:40-97                                                               |

**Summary:** Verified 9 of 9 completed tasks; 0 questionable; 0 falsely marked complete.

### Test Coverage and Gaps

- `npm run test:unit` and `npm run test:integration` both pass, exercising proto/app-server toggles and documentation alignment.

### Architectural Alignment

- Runtime configuration decisions are now honored: the feature flag controls the spawned backend path while retaining existing logging and health surfaces.

### Security Notes

- None.

### Best-Practices and References

- docs/architecture.md — Runtime Config decision summary
- docs/tech-spec-epic-1.md — Runtime flag helper expectations

### Action Items

**Code Changes Required:**

- None.

**Advisory Notes:**

- None.
