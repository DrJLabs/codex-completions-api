# Story 1.6: Document foundation and operational controls

Status: done

## Story

As a product operator,
I want runbooks and docs explaining the new worker controls,
so that teams know how to configure environments during later rollout. [Source: docs/epics.md#story-16-document-foundation-and-operational-controls]

## Requirements Context Summary

- Epic 1 mandates that documentation for Story 1.6 covers operator guidance for the Codex App Server rollout, extending the feature-flag and readiness work delivered in Stories 1.1–1.5. [Source: docs/epics.md#story-16-document-foundation-and-operational-controls]
- The PRD insists on keeping feature-flag operations, worker supervision, probes, and runbooks aligned (FR005–FR015), so the new materials must describe the app-server flag, restart policy, readiness/liveness behavior, and regression evidence expectations. [Source: docs/PRD.md#requirements]
- Architecture decisions fix on a supervised singleton worker, JSON-RPC transport, and structured observability, meaning documentation has to explain lifecycle hooks, restart/backoff limits, and log/metric expectations for operators. [Source: docs/architecture.md#decision-summary]
- The migration playbook already outlines CLI pinning, CODEX_HOME handling, and health probe wiring for Compose, systemd, and Traefik; Story 1.6 must consolidate those instructions into runbooks and change logs for each environment. [Source: docs/app-server-migration/codex-completions-api-migration.md]
- Previous Story 1.5 delivered readiness/liveness probes and noted new supervisor APIs plus documentation updates, so this story should surface those learnings and reference where to reuse probe logic rather than re-specifying it. [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes]
- The tech stack guide highlights enforced Node.js 22, CLI packaging, and test tooling that should be captured in operational matrices to keep dev/staging/prod config guidance consistent. [Source: docs/bmad/architecture/tech-stack.md]

## Project Structure Notes

- Reuse the supervisor lifecycle and probe wiring delivered in Story 1.5 instead of introducing new health endpoints; documentation should point operators to `src/services/worker/supervisor.js` and `src/routes/health.js` for canonical behavior. [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#file-list]
- Highlight where runbook updates live (`docs/app-server-migration/codex-completions-api-migration.md`) and keep references aligned with the existing source-tree layout (`docs/bmad/architecture/source-tree.md`).
- Note that feature-flag configuration remains centralized in `src/config/index.js` and environment files (`.env`, `.env.dev`), so any environment matrix should reference those paths rather than duplicating settings elsewhere. [Source: docs/architecture.md#project-structure]
- Unified project structure doc is not yet authored; call out this gap and point to `docs/bmad/architecture/source-tree.md` as the interim structure reference.

## Acceptance Criteria

1. Runbook updates describe the `PROXY_USE_APP_SERVER` rollout procedure (toggle defaults, smoke requirements, probe expectations) and cite feature-flag, CLI, and health probe guidance sourced from the migration playbook and architecture decisions. [Source: docs/app-server-migration/codex-completions-api-migration.md] [Source: docs/architecture.md#decision-summary]
2. Environment matrix enumerates required configuration for dev, staging, and production (feature flag, CLI version, CODEX_HOME mount, probe endpoints) and aligns with documented tech stack and existing `.env` samples. [Source: docs/app-server-migration/codex-completions-api-migration.md] [Source: docs/bmad/architecture/tech-stack.md]
3. Migration change log highlights operational readiness (flag status, runbook availability, parity checkpoints) for partner teams, referencing the Epic 1 documentation scope and prior readiness story outputs. [Source: docs/epics.md#story-16-document-foundation-and-operational-controls] [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes]

## Tasks / Subtasks

- [x] (AC #1) Update runbook sections covering feature flag toggles, CLI pinning, CODEX_HOME, and readiness/liveness probe procedures for Compose, systemd, and Traefik, ensuring citations to migration/architecture docs stay current. [Source: docs/app-server-migration/codex-completions-api-migration.md]
  - [x] (AC #1 Testing) `npm run lint:runbooks` (now targets `docs/app-server-migration`) → pass @ 2025-10-31T19:21:35Z; `npx prettier -c docs/app-server-migration/codex-completions-api-migration.md` → pass. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- [x] (AC #2) Produce environment matrix capturing dev/staging/prod configuration deltas (feature flag defaults, CLI version, probe expectations, smoke commands) and cross-verify against `.env`, `.env.dev`, and tech stack docs. [Source: docs/app-server-migration/codex-completions-api-migration.md] [Source: docs/bmad/architecture/tech-stack.md]
  - [x] (AC #2 Testing) Reviewed matrix against `.env`, `.env.dev`, and `docker-compose.yml` to ensure values match documented defaults. [Source: docs/app-server-migration/codex-completions-api-migration.md]
- [x] (AC #3) Append change-log entry that summarizes operational readiness, references updated runbook sections, and links to parity evidence captured in Story 1.5 outputs. [Source: docs/epics.md#story-16-document-foundation-and-operational-controls] [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#change-log]
  - [x] (AC #3 Testing) Confirmed new change-log entry cites Section M runbook updates and Story 1.5 readiness evidence per ops checklist. [Source: docs/app-server-migration/codex-completions-api-migration.md] [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#change-log]

### Review Follow-ups (AI)

- [x] **AI-Review (High):** Fix `npm run lint:runbooks` so it covers runbook docs and returns success (AC #1 Testing). Resolved 2025-10-31T19:21:35Z by pointing script at `docs/app-server-migration` and re-running lint. Reference: package.json lint script / docs/app-server-migration/codex-completions-api-migration.md.

## Dev Notes

- Reuse the probe implementation and supervisor APIs detailed in Story 1.5; pull exact filenames (`src/services/worker/supervisor.js`, `src/routes/health.js`) into the documentation instead of restating behavior. [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#file-list]
- When updating docs, run `npm run lint:runbooks` to satisfy the documentation lint cited in tech stack guidance. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- For the environment matrix, diff against `.env.example` and `.env.dev` to confirm defaults match the documented rollout plan; note any discrepancies in the change log. [Source: docs/app-server-migration/codex-completions-api-migration.md] [Source: docs/bmad/architecture/tech-stack.md]
- Capture CI and smoke prerequisites (`npm run smoke:dev`, `npm run smoke:prod`) so operations teams have a checklist before toggling the flag. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]

### Architecture patterns and constraints

- Ensure runbook revisions restate the supervised worker lifecycle, JSON-RPC transport handshake, and readiness gating so operators understand why toggles and probes exist. [Source: docs/architecture.md#decision-summary]
- Document CLI pinning (`@openai/codex` ≥ 0.53.0) and CODEX_HOME write requirements surfaced in the migration guide to keep environment instructions consistent. [Source: docs/app-server-migration/codex-completions-api-migration.md]

### Learnings from Previous Story

- Supervisor state machine, probe wiring, and documentation touchpoints were delivered in Story 1.5; reference those artifacts rather than recreating logic, and hyperlink to the previous story’s Dev Notes and File List. [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes]
- Story 1.5’s tests (`tests/unit/worker-supervisor.test.js`, `tests/integration/health.probes.app-server.int.test.js`) are the canonical verification for probe behavior—use them as citations when documenting expected readiness/liveness transitions. [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#file-list]
- The change log from Story 1.5 already includes doc updates in the migration playbook; ensure this story adds follow-on entries instead of overwriting previous records. [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#change-log]

### Project Structure Notes

- Runbook updates should reference existing code locations: supervisor lifecycle (`src/services/worker/supervisor.js`), health routes (`src/routes/health.js`), and configuration entry points (`src/config/index.js`). [Source: docs/architecture.md#project-structure]
- Point operators to the `docs/bmad/architecture/source-tree.md` overview until a dedicated unified structure doc is authored. [Source: docs/bmad/architecture/source-tree.md]

### References

- [Source: docs/epics.md]
- [Source: docs/PRD.md]
- [Source: docs/architecture.md]
- [Source: docs/app-server-migration/codex-completions-api-migration.md]
- [Source: docs/bmad/architecture/tech-stack.md]
- [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md]
- [Source: docs/bmad/architecture/coding-standards.md]

## Dev Agent Record

### Context Reference

- docs/_archive/story-contexts/1-6-document-foundation-and-operational-controls.context.xml

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- To be completed in later workflow steps -->

### Debug Log References

<!-- To be completed in later workflow steps -->

- 2025-10-31T18:53:30Z: Initial plan:
  - [x] Refresh runbook section M with explicit toggle/checklist steps for Compose, systemd, and Traefik, reusing details from migration guide and Story 1.5 probes.
  - [x] Expand documentation to call out CLI pinning (\`@openai/codex@0.53.0\`) and CODEX_HOME requirements, citing architecture/migration references.
  - [x] Build environment matrix covering dev/staging/prod defaults (flag, CLI version, CODEX_HOME mount, probes, smoke commands).
  - [x] Add migration change log entry summarizing readiness artifacts and linking to Story 1.5 evidence.
  - [x] Execute \`npm run lint:runbooks\` (returns "No files matching" for `docs/runbooks`; followed up with `npx prettier -c docs/app-server-migration/codex-completions-api-migration.md`).
- 2025-10-31T18:56:43Z: Updated Section M, captured smoke/health verification requirements, added environment matrix + change log, and recorded lint output for AC #1 testing evidence.
- 2025-10-31T18:57:54Z: Cross-checked environment matrix values against `.env`, `.env.dev`, and `docker-compose.yml`; confirmed CLI pinning via package.json and smoke scripts before marking AC #2 complete.
- 2025-10-31T18:58:22Z: Verified change log cites Section M additions plus Story 1.5 readiness evidence per ops review checklist.
- 2025-10-31T19:00:24Z: Ran `npm run test:unit`; all 12 unit test files (45 tests) passed after confirming docs table alignment.
- 2025-10-31T19:21:35Z: Updated `lint:runbooks` script to lint docs/app-server-migration and re-ran command successfully.
- 2025-10-31T19:23:52Z: Re-ran `npm run test:unit` (12 files, 45 tests) after documentation updates; all passed.

### Completion Notes List

- Added Section M runbook guidance for feature flag toggles, CLI pinning, CODEX_HOME requirements, and readiness probes across Compose, systemd, and Traefik deployments.
- Published environment configuration matrix covering dev/staging/prod defaults, smoke commands, and probe expectations after cross-checking against `.env`, `.env.dev`, and `docker-compose.yml`.
- Logged lint evidence: `npm run lint:runbooks` (targeting docs/app-server-migration) → pass and `npx prettier -c docs/app-server-migration/codex-completions-api-migration.md` → pass.
- Executed `npm run test:unit`; all suites passed after synchronizing documentation table with `.env` defaults.
- Patched `lint:runbooks` to target docs/app-server-migration and confirmed command success at 2025-10-31T19:21:35Z.

### File List

- docs/app-server-migration/codex-completions-api-migration.md — Updated Section M with toggle workflow, verification checklist, environment matrix, and change log additions.
- docs/_archive/stories/1-6-document-foundation-and-operational-controls.md — Tracked debug log, change log, and file list updates for Story 1.6.
- docs/backlog.md — Added engineering backlog entry for lint script follow-up.

## Change Log

- [x] 2025-10-31: Draft created summarizing app-server operational documentation scope (feature flag, probes, environment matrix) based on migration playbook and Story 1.5 learnings. [Source: docs/app-server-migration/codex-completions-api-migration.md] [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes]
- [x] 2025-10-31: Added runbook toggle workflow, environment matrix, and operational change log referencing Story 1.5 probe evidence and Epic 1 rollout guidance. [Source: docs/app-server-migration/codex-completions-api-migration.md#m-runbook-checklist-updates] [Source: docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#change-log]
- [x] 2025-10-31: Addressed review feedback by updating `lint:runbooks` to lint docs/app-server-migration and re-running the command successfully. [Source: package.json] [Source: npm run lint:runbooks (2025-10-31T19:21:35Z)]
- [x] 2025-10-31: Senior Developer Review (AI) approved after verifying lint fix and AC coverage. [Source: docs/app-server-migration/codex-completions-api-migration.md#m-runbook-checklist-updates]

## Senior Developer Review (AI)

Reviewer: drj

Date: 2025-10-31

Outcome: Approve — initial lint failure resolved by updating the script on 2025-10-31T19:21:35Z; all ACs and tasks now verified.

### Summary

Documentation updates capture the rollout workflow for `PROXY_USE_APP_SERVER`, environment matrices, and change-log narrative. The lint command now targets `docs/app-server-migration`, so `npm run lint:runbooks` succeeds (2025-10-31T19:21:35Z). `npm run test:unit` (12 files, 45 tests) also passes.

### Key Findings

- None.

### Acceptance Criteria Coverage

| AC  | Description                                                                                                     | Status                                             | Evidence                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Runbook updates detail toggle defaults, smoke requirements, and probe expectations with architecture citations. | ✅ Pass (lint script updated 2025-10-31T19:21:35Z) | docs/app-server-migration/codex-completions-api-migration.md:242-264; `npm run lint:runbooks` (2025-10-31T19:21:35Z)                           |
| 2   | Environment matrix aligns dev/staging/prod config with env samples and tech stack guidance.                     | ✅ Pass                                            | docs/app-server-migration/codex-completions-api-migration.md:266-274; .env.example:7-8; .env.dev:7-8                                           |
| 3   | Change log highlights operational readiness and references Story 1.5 evidence.                                  | ✅ Pass                                            | docs/app-server-migration/codex-completions-api-migration.md:276-278; docs/_archive/stories/1-6-document-foundation-and-operational-controls.md:105-110 |

### Task Completion Validation

| Task                                                                              | Marked As | Verified As                 | Evidence                                                                                                                                       |
| --------------------------------------------------------------------------------- | --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| (AC #1) Update runbook sections for feature flag, CLI pinning, CODEX_HOME, probes | [x]       | ✅ Matches implementation   | docs/app-server-migration/codex-completions-api-migration.md:242-258                                                                           |
| (AC #1 Testing) `npm run lint:runbooks`                                           | [x]       | ✅ Pass after script update | `npm run lint:runbooks` (2025-10-31T19:21:35Z)                                                                                                 |
| (AC #2) Publish environment matrix across environments                            | [x]       | ✅ Matches implementation   | docs/app-server-migration/codex-completions-api-migration.md:266-274                                                                           |
| (AC #2 Testing) Cross-check matrix with env samples                               | [x]       | ✅ Verified                 | .env.example:7-21; .env.dev:7-34                                                                                                               |
| (AC #3) Append operational change-log entry                                       | [x]       | ✅ Present                  | docs/app-server-migration/codex-completions-api-migration.md:276-278; docs/_archive/stories/1-6-document-foundation-and-operational-controls.md:105-110 |
| (AC #3 Testing) Reference Story 1.5 evidence in change log                        | [x]       | ✅ Verified                 | docs/_archive/stories/1-6-document-foundation-and-operational-controls.md:105-110                                                                       |

Summary: 6 of 6 checklist items verified after lint script update.

### Test Coverage and Gaps

- `npm run lint:runbooks` now succeeds after pointing the script at `docs/app-server-migration`.
- `npx prettier -c docs/app-server-migration/codex-completions-api-migration.md` passes after the updates.
- `npm run test:unit` (12 files, 45 tests) passes; no additional automated coverage required for documentation.

### Architectural Alignment

- Section M cites architecture decision records and Story 1.5 probe guidance, keeping rollout instructions aligned with the supervised worker + `/readyz` architecture.

### Security Notes

- No security-impacting changes observed; documentation updates only.

### Best-Practices and References

- docs/app-server-migration/codex-completions-api-migration.md
- docs/bmad/architecture/tech-stack.md
- docs/_archive/stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md

### Action Items

**Code Changes Required:**

- None — all review items resolved.

**Advisory Notes:**

- None.
