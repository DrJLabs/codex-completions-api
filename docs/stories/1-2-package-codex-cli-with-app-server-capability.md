# Story 1.2: Package Codex CLI with App-Server Capability

Status: done

## Story

As a platform engineer,
I want the runtime image to include the required Codex CLI version and assets,
so that the proxy can launch the app-server worker reliably across environments.

## Acceptance Criteria

1. Dockerfile installs and pins `@openai/codex` ≥0.49 with JSON-RPC support, baking the `codex app-server` entrypoint into `/usr/local/lib/codex-cli` so the proxy can spawn the worker without host mounts. [Source: docs/epics.md#story-12-package-codex-cli-with-app-server-capability][Source: docs/app-server-migration/codex-completions-api-migration.md#a-replace-cli-invocation][Source: docs/research-technical-2025-10-30.md#option-1-codex-app-server-migration]
2. Container image exposes a writable `CODEX_HOME` (default `/app/.codex-api`) without bundling secrets, matching the deployment and security guidance documented for production hosts. [Source: docs/epics.md#story-12-package-codex-cli-with-app-server-capability][Source: docs/architecture.md#deployment-architecture][Source: docs/architecture.md#security-architecture]
3. Build and smoke workflows execute a Codex CLI availability check (for example, `codex app-server --help`) during image build/test so regressions surface before deploy. [Source: docs/epics.md#story-12-package-codex-cli-with-app-server-capability][Source: docs/bmad/architecture/tech-stack.md#testing--qa][Source: docs/app-server-migration/codex-completions-api-migration.md#l-feature-flag-rollout-defaults]

## Tasks / Subtasks

- [x] (AC: #1) Harden Codex CLI packaging in Docker build output.
  - [x] (AC: #1) Pin `@openai/codex` to a JSON-RPC-capable release ≥0.49.x in `package.json`/lockfile and document the pinned version in the migration guide. [Source: docs/epics.md#story-12-package-codex-cli-with-app-server-capability][Source: docs/research-technical-2025-10-30.md#option-1-codex-app-server-migration][Source: docs/app-server-migration/codex-completions-api-migration.md#a-replace-cli-invocation]
  - [x] (AC: #1) Update `Dockerfile` to verify the baked CLI directory contains the `app-server` subcommand before switching to the non-root user. [Source: docs/app-server-migration/codex-completions-api-migration.md#a-replace-cli-invocation][Source: docs/bmad/architecture/source-tree.md#top-level]
  - [x] (AC: #1 Testing) Build the image and run `docker run --rm codex-completions-api:latest codex --version` (or `codex app-server --help`) to confirm the binary ships correctly. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- [x] (AC: #2) Guarantee writable `CODEX_HOME` inside the container without bundling secrets.
  - [x] (AC: #2) Ensure the Docker build creates and chowns `/app/.codex-api` prior to `USER node`, and confirm compose/runbooks keep the mount RW. [Source: docs/architecture.md#deployment-architecture][Source: docs/architecture.md#security-architecture]
  - [x] (AC: #2) Reconcile documentation (`docs/app-server-migration/...`, `.env.example`) so operators mount secrets externally instead of copying into the image. [Source: docs/app-server-migration/codex-completions-api-migration.md#l-feature-flag-rollout-defaults][Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected]
  - [x] (AC: #2 Testing) Run `docker run --rm codex-completions-api:latest sh -c 'touch /app/.codex-api/.write-test'` to confirm the path remains writable after the chown. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- [x] (AC: #3) Wire Codex CLI checks into smoke/CI workflows.
  - [x] (AC: #3) Extend `scripts/prod-smoke.sh` (and dev variant) to fail fast when `codex app-server --help` exits non-zero. [Source: docs/app-server-migration/codex-completions-api-migration.md#l-feature-flag-rollout-defaults][Source: docs/bmad/architecture/tech-stack.md#testing--qa]
  - [x] (AC: #3) Update onboarding docs/README to instruct running the new smoke step before `npm run verify:all`. [Source: docs/PRD.md#goals-and-background-context][Source: docs/implementation-readiness-report-2025-10-30.md]
  - [x] (AC: #3 Testing) Execute `npm run smoke:prod` (or dev) plus `npm run test:integration` to demonstrate the new CLI check integrates cleanly with the existing verification chain. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]

## Dev Notes

### Learnings from Previous Story

- Reuse `src/services/backend-mode.js` plus the new unit/integration suites (`tests/unit/config/backend-mode.spec.js`, `tests/integration/backend-mode.int.test.js`) to centralize backend selection logic instead of re-reading env flags in Docker scripts. [Source: docs/stories/1-1-add-app-server-feature-flag-scaffold.md#completion-notes-list][Source: docs/stories/1-1-add-app-server-feature-flag-scaffold.md#file-list]
- Keep rollout documentation and env samples synchronized; the docs lint added in Story 1.1 will fail if defaults drift. [Source: docs/stories/1-1-add-app-server-feature-flag-scaffold.md#debug-log-references]
- No outstanding review tasks remain; continue the approved approach to logging and spawn argument selection. [Source: docs/stories/1-1-add-app-server-feature-flag-scaffold.md#senior-developer-review-ai]

### Requirements & Context Summary

- Story 1.2 packages the Codex CLI so the proxy can launch the JSON-RPC worker in every environment. [Source: docs/epics.md#story-12-package-codex-cli-with-app-server-capability]
- PRD mandates maintaining OpenAI parity while migrating off `codex proto`, making a pinned CLI with app-server support critical. [Source: docs/PRD.md#functional-requirements][Source: docs/PRD.md#goals-and-background-context]
- Migration guide details the necessary CLI invocation changes and environment defaults operators rely on. [Source: docs/app-server-migration/codex-completions-api-migration.md#a-replace-cli-invocation][Source: docs/app-server-migration/codex-completions-api-migration.md#l-feature-flag-rollout-defaults]
- Architecture documentation requires `.codex-api/` to stay writable and secrets to remain external mounts. [Source: docs/architecture.md#deployment-architecture][Source: docs/architecture.md#security-architecture]
- Tech stack reference calls out Node 22, the baked CLI path, and verification commands to keep parity checks reproducible. [Source: docs/bmad/architecture/tech-stack.md#runtime--language][Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- Research dossier reinforces choosing CLI ≥0.49 to access the supported app-server surface as proto is removed. [Source: docs/research-technical-2025-10-30.md#option-1-codex-app-server-migration]
- No `tech-spec-epic-1*.md` is present yet; rely on epics and PRD until the epic tech spec is published. [Source: docs/epics.md#epic-1-app-server-platform-foundation]

### Project Structure Notes

- Docker packaging lives at the repository root; keep changes alongside `docker-compose.yml` per the source-tree conventions. [Source: docs/bmad/architecture/source-tree.md#top-level]
- Respect the non-root runtime by preparing writable directories before `USER node`, mirroring Story 1.1’s handling of shared helpers. [Source: docs/stories/1-1-add-app-server-feature-flag-scaffold.md#architecture--structure-alignment]
- Keep configuration and smoke scripts under `scripts/` and update accompanying docs in `docs/app-server-migration/` to maintain operator parity. [Source: docs/bmad/architecture/source-tree.md#scripts--ops]

### Testing Strategy

- Cover Docker build and CLI verification via the existing smoke/test harnesses (`npm run verify:all`, `npm run smoke:prod`) and add targeted container checks for the app-server binary. [Source: docs/bmad/architecture/tech-stack.md#testing--qa]

### Additional Standards

- Project coding standards remain the default Node/ESM guidance; the placeholder document adds no extra constraints. [Source: docs/bmad/architecture/coding-standards.md]

### References

- docs/epics.md#story-12-package-codex-cli-with-app-server-capability
- docs/PRD.md#functional-requirements
- docs/app-server-migration/codex-completions-api-migration.md#a-replace-cli-invocation
- docs/architecture.md#deployment-architecture
- docs/bmad/architecture/tech-stack.md#testing--qa
- docs/research-technical-2025-10-30.md#option-1-codex-app-server-migration
- docs/stories/1-1-add-app-server-feature-flag-scaffold.md#completion-notes-list
- docs/bmad/architecture/source-tree.md#top-level
- docs/bmad/architecture/coding-standards.md

## Dev Agent Record

### Context Reference

- docs/stories/1-2-package-codex-cli-with-app-server-capability.context.xml

### Agent Model Used

codex-gpt-5 (story drafting)

### Debug Log References

- 2025-10-31T00:00Z Plan — AC#1: pin `@openai/codex` to a concrete ≥0.49 release, regenerate lockfile, and document the pinned version in the migration guide. AC#1/#2: update Dockerfile to validate `codex app-server` availability and provision a writable `/app/.codex-api` before switching users, then prove via `docker run` checks. AC#2: align `.env` documentation so secrets stay external and CODEX_HOME expectations remain explicit. AC#3: extend `scripts/prod-smoke.sh` and `scripts/dev-smoke.sh` with a `codex app-server --help` gate and update onboarding docs/README to require running the new smoke step before `npm run verify:all`. AC#1–3: finish by building the container, verifying CLI and write access, and running `npm run test:integration` plus the relevant smoke command.
- 2025-10-31T07:05Z Implementation — AC#1: bumped `@openai/codex` to 0.53.0, rebuilt the image, and confirmed `codex --version` plus `codex app-server --help` from the container. AC#2: ensured Dockerfile provisions `/app/.codex-api` and verified write access via `docker run --rm codex-completions-api:latest sh -c 'touch /app/.codex-api/.write-test'`. AC#3: tightened smoke scripts around the CLI check and documented the smoke-before-verify workflow, then executed `npm run smoke:dev` (with the new CLI gate) and `npm run test:integration`.

### Completion Notes List

- AC#1 — Pinned `@openai/codex` to 0.53.0, updated the migration guide, and added a Dockerfile guard that runs `codex app-server --help` during the build; validated the baked binary with `docker run --rm codex-completions-api:latest codex --version`.
- AC#2 — Provisioned `/app/.codex-api` in the image (owned by `node`) and verified write access with `docker run --rm codex-completions-api:latest sh -c 'touch /app/.codex-api/.write-test'`; documentation now calls out the writable mount requirement.
- AC#3 — Hardened `scripts/dev-smoke.sh`/`scripts/prod-smoke.sh` to run the CLI availability gate, documented the smoke-before-verify workflow, and executed `npm run smoke:dev` (SKIP_ORIGIN=1) followed by `npm run test:integration` to confirm the harnesses stay green.

### File List

- package.json
- package-lock.json
- Dockerfile
- scripts/prod-smoke.sh
- scripts/dev-smoke.sh
- README.md
- docs/app-server-migration/codex-completions-api-migration.md
- docs/bmad/architecture/tech-stack.md
- docs/stories/1-2-package-codex-cli-with-app-server-capability.md
- docs/stories/1-2-package-codex-cli-with-app-server-capability.context.xml
- docs/sprint-status.yaml

## Change Log

- [x] 2025-10-31: Story context generated (docs/stories/1-2-package-codex-cli-with-app-server-capability.context.xml).
- [x] 2025-10-31: Context validation report saved (docs/stories/validation-report-2025-10-31T052130Z.md).
- [x] 2025-10-31: Context validation re-run (docs/stories/validation-report-2025-10-31T052520Z.md).
- [x] 2025-10-31: Independent validation report generated (docs/stories/validation-report-2025-10-31T051932Z.md).
- [x] 2025-10-31: Draft created for story 1.2.
- [x] 2025-10-31: CLI packaging pinned to 0.53.0, Dockerfile/app-server smoke checks added, docs and smoke harness updated.
- [x] 2025-10-31: Senior Developer Review notes appended (Approved).

## Senior Developer Review (AI)

Reviewer: drj

Date: 2025-10-31

Outcome: Approve — Packaging meets all acceptance criteria and supporting docs/tests confirm readiness. No blocking issues identified.

### Summary

- Codex CLI pinned to 0.53.0 and verified during image build; container now provisions a writable `/app/.codex-api` prior to switching to the non-root user.
- Smoke workflows fail fast via `codex app-server --help`, and the README/tech stack docs instruct running smoke before `npm run verify:all`.
- Integration suite and container smoke commands executed locally without regressions.

### Key Findings

- **High:** None.
- **Medium:** None.
- **Low:** None.

### Acceptance Criteria Coverage

| AC# | Description                                                     | Status      | Evidence                                                                                                                                 |
| --- | --------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pin Codex CLI ≥0.49 with app-server entrypoint baked into image | Implemented | package.json:58, package-lock.json:9-19, Dockerfile:16-28, docs/app-server-migration/codex-completions-api-migration.md:33-37            |
| 2   | Provide writable CODEX_HOME without bundling secrets            | Implemented | Dockerfile:23-28, docs/app-server-migration/codex-completions-api-migration.md:120-130, .env.example:9-13                                |
| 3   | Add Codex CLI availability checks into build/smoke workflows    | Implemented | Dockerfile:20-21, scripts/dev-smoke.sh:28-39, scripts/prod-smoke.sh:29-42, README.md:365-369, docs/bmad/architecture/tech-stack.md:48-57 |

**Summary:** 3 of 3 acceptance criteria fully implemented.

### Task Completion Validation

| Task                                                      | Marked As | Verified As       | Evidence                                                                                                                                 |
| --------------------------------------------------------- | --------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| (AC #1) Harden Codex CLI packaging in Docker build output | Complete  | Verified complete | package.json:58, package-lock.json:9-19, Dockerfile:16-28, docs/app-server-migration/codex-completions-api-migration.md:33-37            |
| (AC #2) Guarantee writable CODEX_HOME inside container    | Complete  | Verified complete | Dockerfile:23-28, docs/app-server-migration/codex-completions-api-migration.md:120-130, .env.example:9-13                                |
| (AC #3) Wire Codex CLI checks into smoke/CI workflows     | Complete  | Verified complete | Dockerfile:20-21, scripts/dev-smoke.sh:28-39, scripts/prod-smoke.sh:29-42, README.md:365-369, docs/bmad/architecture/tech-stack.md:48-57 |

**Summary:** 3 of 3 completed tasks verified; 0 questionable; 0 falsely marked complete.

### Test Coverage and Gaps

- `docker run --rm codex-completions-api:latest codex --version` → `codex-cli 0.53.0` (local verification).
- `docker run --rm codex-completions-api:latest codex app-server --help` confirms the entrypoint ships with the image.
- `docker run --rm codex-completions-api:latest sh -c 'touch /app/.codex-api/.write-test'` validates container write permissions.
- `npm run test:integration` (Vitest) executed successfully.
- No additional automated gaps identified for this scope.

### Architectural Alignment

- Dockerfile changes align with deployment guidance requiring a writable `.codex-api/` (`docs/architecture.md`, `docs/app-server-migration/codex-completions-api-migration.md`).
- Smoke gating follows the testing strategy defined in `docs/bmad/architecture/tech-stack.md`.

### Security Notes

- No new secret handling risks introduced; docs reinforce mounting secrets externally with read/write access.

### Best-Practices and References

- `docs/app-server-migration/codex-completions-api-migration.md`
- `docs/architecture.md`
- `docs/bmad/architecture/tech-stack.md`

### Action Items

**Code Changes Required:**

- None.

**Advisory Notes:**

- Note: Run `npm run smoke:dev` / `npm run smoke:prod` after building the `codex-completions-api:latest` image so the CLI availability check can locate the new artifact.
