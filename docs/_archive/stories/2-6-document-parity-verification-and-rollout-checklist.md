# Story 2.6: Document Parity Verification and Rollout Checklist

Status: done

## Requirements Context Summary

- Epic 2 assigns this story to consolidate parity verification documentation and rollout approvals before switching production traffic to the Codex App Server. [Source: docs/epics.md#story-26-document-parity-verification-and-rollout-checklist]
- The technical specification mandates deterministic parity fixtures, enforced quality gates, and evidence-driven rollout governance; the checklist must reflect those requirements. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
- PRD functional requirements FR013–FR015 require refreshed regression coverage, smoke automation, and operational runbooks captured as audit-ready collateral. [Source: docs/PRD.md#functional-requirements]
- The migration runbook prescribes the parity fixture maintenance workflow and environment verification steps that the checklist must encode. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
- Epic 2 test design establishes parity quality gates (P0 suites, checklist enforcement); the review plan must demonstrate compliance. [Source: docs/test-design-epic-2.md#quality-gate-criteria]

## Story

As a program manager,
I want a comprehensive parity verification checklist with captured rollout evidence,
so that stakeholders can approve switching `/v1/chat/completions` traffic to the Codex App Server with confidence.

## Acceptance Criteria

1. The documented parity verification checklist enumerates required regression suites, parity harness commands, manual validation steps, and rollout metrics needed before enabling the Codex App Server flag. [Source: docs/epics.md#story-26-document-parity-verification-and-rollout-checklist] [Source: docs/test-design-epic-2.md#quality-gate-criteria] [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates]
2. An audit-ready evidence package is published under `docs/app-server-migration/`, including summary tables that capture parity run results, CLI metadata from `test-results/chat-completions/manifest.json`, refreshed transcripts, and links to regression outputs. [Source: docs/epics.md#story-26-document-parity-verification-and-rollout-checklist] [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow] [Source: docs/test-design-epic-2.md#test-coverage-plan]
3. QA, SRE, and Product stakeholders have a scheduled and documented review plan with sign-off checkpoints, meeting logistics, and follow-up actions captured in the checklist. [Source: docs/epics.md#story-26-document-parity-verification-and-rollout-checklist] [Source: docs/PRD.md#goals-and-background-context] [Source: docs/test-design-epic-2.md#quality-gate-criteria]

## Tasks / Subtasks

- [x] (AC #1) Inventory parity verification obligations from epics, tech spec, test design, and migration runbook; draft checklist sections covering automated suites, parity harness execution, manual verification, and rollout metrics. [Source: docs/epics.md#story-26-document-parity-verification-and-rollout-checklist] [Source: docs/tech-spec-epic-2.md#test-strategy-summary] [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates]
  - [x] (AC #1) Integrate learnings from Story 2.5 by mapping refreshed parity harness assets and manifest coverage directly into the checklist. [Source: stories/2-5-update-regression-suite-for-parity-evidence.md#dev-notes]
  - [x] (AC #1) Run `npm run lint:runbooks` to validate formatting, links, and required parity checklist sections before circulating the draft. [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates] [Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- [x] (AC #2) Capture testimony and artifacts (transcripts, manifest metadata, regression outputs) into structured tables within `docs/app-server-migration/` and link them from the checklist. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
  - [x] (AC #2) Run `npm run transcripts:generate`, `npm run test:parity`, `npm run test:integration`, and `npm test` to refresh evidence prior to documentation, storing outputs or CI links for the package. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow] [Source: docs/test-design-epic-2.md#test-coverage-plan]
- [x] (AC #3) Schedule and record the QA/SRE/Product review plan, including agenda, decision criteria, and ownership of follow-ups within the checklist. [Source: docs/epics.md#story-26-document-parity-verification-and-rollout-checklist] [Source: docs/test-design-epic-2.md#quality-gate-criteria]
  - [x] (AC #3) Align the review cadence with PRD rollout goals and parity readiness signals (metrics, smoke commands, probe monitoring) so approvers can validate operational posture. [Source: docs/PRD.md#goals-and-background-context] [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates]
  - [x] (AC #3) Dry-run the review readiness checklist by executing `npm run smoke:dev` (or staging equivalent) and recording expected sign-off checkpoints for stakeholders. [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates] [Source: docs/bmad/architecture/tech-stack.md#testing--qa]
- [x] (AC #2) Update `docs/sprint-status.yaml` to mark this story as drafted once the documentation package is in place. [Source: docs/sprint-status.yaml]

## Dev Notes

- Checklist output should stay tightly grounded in authoritative docs—quote acceptance criteria verbatim where possible and embed citations for every verification step to simplify validation. [Source: docs/epics.md#story-26-document-parity-verification-and-rollout-checklist]
- Capture operational readiness signals (probes, smoke scripts, metrics) so reviewers can trace each sign-off back to documented evidence. [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates] [Source: docs/tech-spec-epic-2.md#test-strategy-summary]

### Learnings from Previous Story

- Reuse the parity harness, transcript generator, and manifest introduced in Story 2.5—do not fork tooling or duplicate evidence repositories. [Source: stories/2-5-update-regression-suite-for-parity-evidence.md#dev-notes]
- Story 2.5’s review closed without pending items, but it emphasized maintaining CLI metadata and parity manifest integrity; incorporate those details as required checklist artifacts. [Source: stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes]

### Architecture Patterns and Constraints

- Keep rollout documentation consistent with the architecture decision record on feature flag management and health gating so operations teams can map checklist steps to live systems. [Source: docs/architecture.md#decision-summary]
- Highlight mandatory environment expectations (writable `.codex-api/`, readiness probes, Traefik health checks) when describing rollout prerequisites. [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates]

### Testing Expectations

- Re-run parity regeneration commands and regression suites immediately before documenting evidence; attach command outputs or CI references to the evidence tables. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
- Align checklist verification steps with the P0/P1 test coverage expectations from the Epic 2 test design to ensure nothing critical is omitted. [Source: docs/test-design-epic-2.md#test-coverage-plan]

### Project Structure Notes

- Previous story 2-5 shipped refreshed parity harness outputs (`test-results/chat-completions/**`, manifest, updated docs) and closed the review with no outstanding findings—reuse those assets and cite the story for evidence continuity. [Source: stories/2-5-update-regression-suite-for-parity-evidence.md#file-list] [Source: stories/2-5-update-regression-suite-for-parity-evidence.md#senior-developer-review-ai]
- The checklist and evidence tables belong alongside the existing migration materials under `docs/app-server-migration/`; keep parity workflow steps aligned with that runbook. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
- Reference the canonical parity spec for transcript handling and tooling expectations when documenting required evidence. [Source: docs/openai-endpoint-golden-parity.md#81-capture-workflow-proto--app-server-parity]
- Story work stays within documentation and planning artifacts—no source tree changes expected; follow repo structure conventions when linking paths. [Source: docs/bmad/architecture/source-tree.md#overview]

### References

- docs/epics.md#story-26-document-parity-verification-and-rollout-checklist
- docs/tech-spec-epic-2.md#test-strategy-summary
- docs/PRD.md#functional-requirements
- docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow
- docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates
- docs/test-design-epic-2.md#quality-gate-criteria
- docs/openai-endpoint-golden-parity.md#81-capture-workflow-proto--app-server-parity
- stories/2-5-update-regression-suite-for-parity-evidence.md#dev-notes
- stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes
- docs/architecture.md#decision-summary

## Dev Agent Record

### Context Reference

- docs/_archive/story-contexts/2-6-document-parity-verification-and-rollout-checklist.context.xml

### Agent Model Used

- codex-5 (Developer Agent)

### Debug Log

- 2025-11-02T00:08Z — Assembled story context, captured parity artifacts, and recorded validation findings for checklist handoff.
- 2025-11-02T00:24Z — Updated `docs/sprint-status.yaml` to mark Story 2.6 as in-progress before implementation kickoff.
- 2025-11-02T00:25Z — Planning AC1 checklist draft: consolidate obligations from epics, tech spec, migration runbook, test design, and story 2.5 into structured sections (automation suites, parity harness flow, manual verification, rollout metrics); ensure reuse of prior parity assets.
- 2025-11-02T00:26Z — Authored parity rollout checklist with mapped sources, integrated Story 2.5 manifest obligations, and formatted via `npm run lint:runbooks`.
- 2025-11-02T00:27Z — Planning AC2 evidence package: rerun transcripts/regressions, extract manifest metadata, and populate evidence tables under `docs/app-server-migration/` with command outputs and links.
- 2025-11-02T00:29Z — Refreshed transcripts and parity/integration/E2E suites, captured manifest metadata, and recorded evidence tables plus command log in the checklist.
- 2025-11-02T00:29Z — Planning AC3 review cadence documentation: schedule QA/SRE/Product checkpoints, map agenda to readiness signals, and outline follow-up ownership.
- 2025-11-02T00:30Z — Documented stakeholder review plan with agenda, sign-off checkpoints, logistics, and follow-up owners aligned to PRD rollout goals.
- 2025-11-02T00:30Z — Executed `npm run smoke:dev`, recorded dev dry-run results, and linked evidence for stakeholder review checkpoints.
- 2025-11-02T00:33Z — Ran `npm run lint:runbooks` post-updates and advanced story status to review in sprint-status.yaml.

### Debug Log References

- docs/app-server-migration/parity-rollout-checklist.md#evidence-summary--2025-11-02
- docs/app-server-migration/parity-rollout-checklist.md#stakeholder-review-plan

### Completion Notes

- Published `docs/app-server-migration/parity-rollout-checklist.md` with parity verification checklist, evidence tables, and stakeholder review plan.
- Refreshed transcripts and executed `npm run test:parity`, `npm run test:integration`, `npm test`, and `npm run smoke:dev`; recorded results for audit.
- Updated `docs/sprint-status.yaml` to in-progress at kickoff and checklist now ready for review transition.

### File List

- docs/app-server-migration/parity-rollout-checklist.md (new)
- docs/sprint-status.yaml (update)
- docs/_archive/stories/2-6-document-parity-verification-and-rollout-checklist.md (this file)

## Change Log

- [x] 2025-11-02: Draft story created via _create-story_ workflow.
- [x] 2025-11-02: Story context generated, validated, and status moved to ready-for-dev.
- [x] 2025-11-02: Authored parity rollout checklist, captured evidence tables, executed parity/integration/E2E/smoke suites, and logged stakeholder review plan.
- [x] 2025-11-02: Senior Developer Review notes appended.

## Senior Developer Review (AI)

Reviewer: drj  
Date: 2025-11-02T00:33Z  
Outcome: Approve — All acceptance criteria satisfied with documented evidence.

### Summary

- Parity rollout checklist enumerates automated suites, parity harness execution, manual verification steps, and rollout metrics that fulfill the gating requirements (docs/app-server-migration/parity-rollout-checklist.md:7).
- Evidence index and summary capture transcript manifest metadata alongside command results for transcripts regeneration, parity harness, integration, E2E, and smoke runs (docs/app-server-migration/parity-rollout-checklist.md:36; docs/app-server-migration/parity-rollout-checklist.md:46).
- Stakeholder review plan specifies cadence, agenda, and follow-up ownership aligned with readiness and governance expectations (docs/app-server-migration/parity-rollout-checklist.md:65).

### Key Findings

- None.

### Acceptance Criteria Coverage

| AC    | Description                                                                                                           | Status      | Evidence                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------- |
| AC #1 | Checklist documents regression suites, parity harness execution, manual validation, and rollout metrics prerequisites | IMPLEMENTED | docs/app-server-migration/parity-rollout-checklist.md:7  |
| AC #2 | Evidence package publishes manifest metadata, transcripts, and regression outputs under `docs/app-server-migration/`  | IMPLEMENTED | docs/app-server-migration/parity-rollout-checklist.md:36 |
| AC #3 | Stakeholder review cadence, logistics, and follow-up actions captured in checklist                                    | IMPLEMENTED | docs/app-server-migration/parity-rollout-checklist.md:65 |

Summary: 3 of 3 acceptance criteria fully implemented.

### Task Completion Validation

| Task                                                                       | Marked As     | Verified As       | Evidence                                                                                                                            |
| -------------------------------------------------------------------------- | ------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Inventory parity verification obligations (AC #1)                          | [x] Completed | VERIFIED COMPLETE | docs/app-server-migration/parity-rollout-checklist.md:7                                                                             |
| Integrate Story 2.5 learnings into checklist (AC #1)                       | [x] Completed | VERIFIED COMPLETE | docs/app-server-migration/parity-rollout-checklist.md:5                                                                             |
| Run `npm run lint:runbooks` before circulation (AC #1)                     | [x] Completed | VERIFIED COMPLETE | docs/_archive/stories/2-6-document-parity-verification-and-rollout-checklist.md:92                                                           |
| Capture parity evidence tables and artifacts (AC #2)                       | [x] Completed | VERIFIED COMPLETE | docs/app-server-migration/parity-rollout-checklist.md:36                                                                            |
| Refresh transcripts, parity, integration, and E2E suites (AC #2)           | [x] Completed | VERIFIED COMPLETE | docs/app-server-migration/parity-rollout-checklist.md:46; docs/_archive/stories/2-6-document-parity-verification-and-rollout-checklist.md:94 |
| Document QA/SRE/Product review plan (AC #3)                                | [x] Completed | VERIFIED COMPLETE | docs/app-server-migration/parity-rollout-checklist.md:65                                                                            |
| Align review cadence with readiness metrics and smoke commands (AC #3)     | [x] Completed | VERIFIED COMPLETE | docs/app-server-migration/parity-rollout-checklist.md:66; docs/app-server-migration/parity-rollout-checklist.md:73                  |
| Dry-run review readiness via `npm run smoke:dev` (AC #3)                   | [x] Completed | VERIFIED COMPLETE | docs/app-server-migration/parity-rollout-checklist.md:52; docs/_archive/stories/2-6-document-parity-verification-and-rollout-checklist.md:97 |
| Update `docs/sprint-status.yaml` after documentation package ready (AC #2) | [x] Completed | VERIFIED COMPLETE | docs/sprint-status.yaml:54                                                                                                          |

Summary: 9 of 9 completed tasks verified; 0 questionable; 0 false completions.

### Test Coverage and Gaps

- `npm run transcripts:generate` — refreshed proto/app captures and manifest metadata (docs/app-server-migration/parity-rollout-checklist.md:46).
- `npm run test:parity` — parity harness passed all 14 tests (docs/app-server-migration/parity-rollout-checklist.md:47).
- `npm run test:integration` — integration suites covering JSON-RPC adapters and metadata sanitization passed (docs/app-server-migration/parity-rollout-checklist.md:48).
- `npm test` — Playwright SSE/API end-to-end coverage passed (docs/app-server-migration/parity-rollout-checklist.md:49).
- `npm run smoke:dev` — dev environment smoke validation succeeded (docs/app-server-migration/parity-rollout-checklist.md:52).
- `npm run lint:runbooks` — runbook formatting verified (docs/_archive/stories/2-6-document-parity-verification-and-rollout-checklist.md:92).

### Architectural Alignment

- Checklist reiterates readiness probe expectations, writable `.codex-api/`, and smoke validation workflow consistent with architecture decisions (docs/app-server-migration/parity-rollout-checklist.md:22; docs/architecture.md:18).
- Evidence references parity harness and regression gating prescribed in Epic 2 technical specification (docs/tech-spec-epic-2.md:133).

### Security Notes

- No new security risks identified; documentation preserves bearer auth requirements and writable state constraints (docs/architecture.md:18).

### Best-Practices and References

- Epic 2 technical specification — parity gating and test coverage expectations (docs/tech-spec-epic-2.md:133).
- Architecture decision log — readiness gating, `.codex-api/` handling, and Traefik requirements (docs/architecture.md:18).
- Migration runbook section N — rollout checklist context and smoke expectations (docs/app-server-migration/codex-completions-api-migration.md:253).

### Action Items

**Code Changes Required:**

- None.

**Advisory Notes:**

- Note: Archive smoke curl transcripts under `./artifacts/smoke/{env}/` before stakeholder review per checklist follow-up (docs/app-server-migration/parity-rollout-checklist.md:85).
