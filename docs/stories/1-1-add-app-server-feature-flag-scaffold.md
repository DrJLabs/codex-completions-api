# Story 1.1: Add App-Server Feature Flag Scaffold

Status: drafted

## Story

As an operator,
I want the proxy to support a runtime switch between proto and app-server,
so that we can enable or disable the new backend without redeploying.

## Acceptance Criteria

1. Environment variable `PROXY_USE_APP_SERVER` toggles backend selection at startup.
2. Configuration docs outline defaults for dev, staging, and prod.
3. Unit tests cover both flag paths and ensure default matches current proto behavior.

## Tasks / Subtasks

- [ ] Thread feature flag through backend selection (AC: #1)
  - [ ] Add `PROXY_USE_APP_SERVER` boolean to `src/config/index.js` with a default of `false`, using the existing helpers to normalize boolean env values [Source: docs/architecture.md#decision-summary].
  - [ ] Introduce a shared selector (e.g., `src/services/backend-mode.js`) that resolves `'proto'` vs `'app-server'` once at startup and logs the active mode for operators [Source: docs/architecture.md#decision-summary].
  - [ ] Ensure the bootstrap path keeps proto active when the flag is unset while clearly logging when operators opt into the app-server path (even if later stories still stub the worker).
- [ ] Document rollout defaults for each environment (AC: #2)
  - [ ] Update the migration or README docs with a table that lists dev/staging/prod defaults plus explicit toggle steps for operators [Source: docs/implementation-readiness-report-2025-10-30.md].
  - [ ] Add `.env.example` / `.env.dev` entries documenting the flag and its default so local setups stay aligned [Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected].
- [ ] Cover flag paths with automated tests (AC: #3)
  - [ ] Create or extend a Vitest unit suite under `tests/unit/config/` that asserts the config defaults to proto and flips when the env var is set [Source: docs/bmad/architecture/tech-stack.md#testing-qa].
  - [ ] Add a focused integration test (chat handler or service shim) that verifies backend selection logic feeds future worker wiring while keeping existing proto behavior intact [Source: docs/architecture.md#epic-to-architecture-mapping].

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
- [Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected]
- [Source: docs/bmad/architecture/tech-stack.md#testing-qa]
- [Source: docs/implementation-readiness-report-2025-10-30.md]

## Dev Agent Record

### Context Reference

- Story context XML pending; run \*story-context after the draft is reviewed.

### Agent Model Used

- codex-gpt-5 (story drafting)

### Debug Log References

- Pending implementation.

### Completion Notes List

- Draft defines configuration scaffold and documentation updates required before wiring the worker.

### File List

- NEW: docs/stories/1-1-add-app-server-feature-flag-scaffold.md (draft)

## Change Log

- [ ] 2025-10-30: Draft created for story 1.1 (pending implementation).
