# Parity Verification and Rollout Checklist

## Purpose

This checklist consolidates the parity verification gates that must pass before toggling `PROXY_USE_APP_SERVER` for `/v1/chat/completions`. It draws directly from Epic 2 guidance, the parity migration runbook, and Story 2.5 parity evidence so stakeholders can audit readiness without re-reading every source. (Sources: [../epics.md#story-26-document-parity-verification-and-rollout-checklist](../epics.md#story-26-document-parity-verification-and-rollout-checklist), [../tech-spec-epic-2.md#test-strategy-summary](../tech-spec-epic-2.md#test-strategy-summary), [../stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes](../stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes))

## Automated Regression Suites

- [ ] `npm run test:integration` — Execute JSON-RPC integration coverage (baseline, streaming, error gates) against the latest fixtures; capture CLI output or CI link for evidence. (Sources: [../tech-spec-epic-2.md#test-strategy-summary](../tech-spec-epic-2.md#test-strategy-summary), [../test-design-epic-2.md#quality-gate-criteria](../test-design-epic-2.md#quality-gate-criteria))
- [ ] `npm test` — Run the end-to-end SSE and API parity checks to confirm streaming adapters remain stable after fixture refresh. (Sources: [../tech-spec-epic-2.md#test-strategy-summary](../tech-spec-epic-2.md#test-strategy-summary), [../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow](../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow))
- [ ] `npm run test:parity` — Validate proto vs. app transcript equivalence; archive the harness summary for audit. (Sources: [../openai-endpoint-golden-parity.md#81-capture-workflow-proto--app-server-parity](../openai-endpoint-golden-parity.md#81-capture-workflow-proto--app-server-parity), [../stories/2-5-update-regression-suite-for-parity-evidence.md#dev-notes](../stories/2-5-update-regression-suite-for-parity-evidence.md#dev-notes))
- [ ] `npm run lint:runbooks` — Lint documentation updates, ensuring links and tables meet rollout formatting rules. (Sources: [../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates](../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates), [../bmad/architecture/tech-stack.md#testing--qa](../bmad/architecture/tech-stack.md#testing--qa))

## Parity Harness Execution

- [ ] Regenerate transcripts via `npm run transcripts:generate`; ensure `test-results/chat-completions/{proto,app}/` and `manifest.json` carry refreshed `cli_version`, `commit`, and `backend` metadata. (Sources: [../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow](../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow), [../stories/2-5-update-regression-suite-for-parity-evidence.md#dev-notes](../stories/2-5-update-regression-suite-for-parity-evidence.md#dev-notes))
- [ ] Record the parity harness diff summary plus intentional mismatch drill notes demonstrating failure diagnostics remain actionable. (Sources: [../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow](../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow))
- [ ] Map each harness scenario to the P0/P1 gates listed in `tests/parity/chat-fixture-parity.test.mjs` so reviewers can trace coverage. (Sources: [../test-design-epic-2.md#quality-gate-criteria](../test-design-epic-2.md#quality-gate-criteria))

## Manual Verification Steps

- [ ] Execute `npm run smoke:dev` (or staging/prod equivalent) and capture `readyz/livez` responses, CLI availability, and HTTPS routing proofs. (Sources: [../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates](../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates), [../../scripts/dev-smoke.sh](../../scripts/dev-smoke.sh))
- [ ] Verify `curl -f https://{domain}/readyz` returns readiness within 5 s and note supervisor restart counts before and after the run. (Sources: [../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates](../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates), [../architecture.md#decision-summary](../architecture.md#decision-summary))
- [ ] Confirm `.codex-api/` (prod) or `.codev/` (dev) remains writable and that health probes stay wired to Traefik for rollback safety. (Sources: [../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates](../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates))
- [ ] Document stakeholder dry-run agenda covering parity evidence review, smoke demo, and sign-off expectations. (Sources: [../epics.md#story-26-document-parity-verification-and-rollout-checklist](../epics.md#story-26-document-parity-verification-and-rollout-checklist), [../PRD.md#goals-and-background-context](../PRD.md#goals-and-background-context))

## Rollout Metrics & Observability

- [ ] Track `/readyz` latency, `worker_supervisor.restarts_total`, and streaming error rates pre/post toggle; attach graphs or logs. (Sources: [../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates](../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates))
- [ ] Capture transcript manifest deltas (scenario counts, backend storage) to prove parity scope is unchanged since Story 2.5. (Sources: [../stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes](../stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes))
- [ ] Log Codex CLI/App Server version identifiers in the rollout package so future fixture updates stay traceable. (Sources: [../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow](../app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow))
- [ ] Note acceptance criteria outcomes (AC 1–AC 3) and link supporting artifacts (transcripts, manifest, smoke evidence, meeting notes). (Sources: [../epics.md#story-26-document-parity-verification-and-rollout-checklist](../epics.md#story-26-document-parity-verification-and-rollout-checklist))

## Evidence Index (populate during execution)

| Asset                     | Location                                                                    | Notes                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Transcript manifest       | `test-results/chat-completions/manifest.json`                               | `generated_at` 2025-11-02T00:27:44Z · `cli_version` 0.53.0 · commit 72b0d431400e35e044af95374f69f26494f596f3 · 13 scenarios |
| Parity harness report     | Vitest stdout (`npm run test:parity`)                                       | 14 tests passed in `tests/parity/chat-fixture-parity.test.mjs`; intentional mismatch drill ready per workflow step 5        |
| Regression suite logs     | Vitest stdout (`npm run test:integration`) · Playwright report (`npm test`) | Integration suites and 27 Playwright E2E scenarios passed on 2025-11-02                                                     |
| Smoke validation evidence | `./artifacts/smoke/{env}/`                                                  | Dev dry run 2025-11-02T00:30Z logged in checklist; upload curl transcripts before stakeholder review                        |
| Stakeholder review notes  | `docs/app-server-migration/parity-rollout-review.md` (planned)              | Agenda, attendees, sign-off checkpoints                                                                                     |

## Evidence Summary — 2025-11-02

| Command                        | Result | UTC Timestamp     | Notes                                                                          |
| ------------------------------ | ------ | ----------------- | ------------------------------------------------------------------------------ |
| `npm run transcripts:generate` | ✅     | 2025-11-02T00:27Z | Proto/app transcripts refreshed; manifest updated with CLI 0.53.0              |
| `npm run test:parity`          | ✅     | 2025-11-02T00:27Z | Vitest parity harness (14 tests) passed with no diffs                          |
| `npm run test:integration`     | ✅     | 2025-11-02T00:27Z | Vitest integration suites covering JSON-RPC, metadata, concurrency all green   |
| `npm test`                     | ✅     | 2025-11-02T00:28Z | Playwright E2E suite (27 tests) passed, transcript captures refreshed          |
| `npm run smoke:dev`            | ✅     | 2025-11-02T00:30Z | codex-dev.onemainarmy.com smoke: health, models, non-stream, stream all passed |

### Manifest Snapshot

| Field             | Value                                    |
| ----------------- | ---------------------------------------- |
| `generated_at`    | 2025-11-02T00:27:44.521Z                 |
| `commit`          | 72b0d431400e35e044af95374f69f26494f596f3 |
| `cli_version`     | 0.53.0                                   |
| `scenario_count`  | 13                                       |
| `proto.codex_bin` | scripts/fake-codex-proto.js              |
| `app.codex_bin`   | scripts/fake-codex-jsonrpc.js            |

## Stakeholder Review Plan

- Audience: QA (parity quality gate owner), SRE (operations readiness), Product (rollout approval authority). (Sources: [../epics.md#story-26-document-parity-verification-and-rollout-checklist](../epics.md#story-26-document-parity-verification-and-rollout-checklist), [../PRD.md#goals-and-background-context](../PRD.md#goals-and-background-context))
- Cadence: 60-minute review scheduled within 24 hours of parity evidence refresh; follow-up checkpoint 48 hours post-toggle for rollback readiness confirmation. (Sources: [../test-design-epic-2.md#quality-gate-criteria](../test-design-epic-2.md#quality-gate-criteria), [../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates](../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates))
- Medium: Recorded video conference with shared parity dashboard and access to `test-results/chat-completions/` artifacts.

### Agenda & Decision Points

| Sequence | Topic                    | Owner           | Inputs                                                            | Decision/Output                                           |
| -------- | ------------------------ | --------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| 1        | Evidence recap           | Developer agent | Evidence Summary table; transcript manifest snapshot              | Confirm artifacts complete; log any gaps                  |
| 2        | Automated suite health   | QA              | Vitest + Playwright pass/fail, scenario deltas                    | Gate decision: proceed or block on parity regressions     |
| 3        | Smoke & metrics review   | SRE             | `npm run smoke:{env}` output, `/readyz` latency, restart counters | Declare infrastructure ready or assign remediation action |
| 4        | Product rollout decision | Product         | Checklist completion status, risk register                        | Approve toggle schedule; capture sign-off in minutes      |
| 5        | Follow-up tracking       | All             | Review actions table below                                        | Assign owners and due dates                               |

### Follow-up Actions & Owners

| Action                                                         | Owner           | Due      | Notes                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload smoke validation evidence to `./artifacts/smoke/{env}/` | SRE             | +1 day   | Include curl output and supervisor metrics (Source: [../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates](../app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates)) |
| Verify parity harness intentional mismatch drill recorded      | QA              | +1 day   | Attach screenshot/log per workflow step 5                                                                                                                                                                                             |
| Publish meeting minutes & sign-off summary                     | Product         | Same day | Store under `docs/app-server-migration/parity-rollout-review.md`                                                                                                                                                                      |
| Update sprint status and rollout tracker                       | Developer agent | Same day | Ensure Story 2.6 status transitions per checklist completion                                                                                                                                                                          |

### Logistics Checklist

- Reserve meeting invite: **Parity Rollout Readiness Review** with Zoom link and parity dashboard pointers.
- Pre-distribute Evidence Summary, Manifest Snapshot, and smoke script outputs 12 hours ahead.
- Capture decisions and actions in the Change Log and upload minutes to the evidence package.
