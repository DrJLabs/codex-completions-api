# Test Design: Epic 2 - /v1/chat/completions JSON-RPC Parity

**Date:** 2025-10-31
**Author:** drj
**Status:** Draft

---

## Executive Summary

**Scope:** targeted test design for Epic 2

**Risk Summary:**

- Total risks identified: 5
- High-priority risks (≥6): 2
- Critical categories: TECH, DATA

**Coverage Summary:**

- P0 scenarios: 3 (3.0 hours)
- P1 scenarios: 4 (3.0 hours)
- P2/P3 scenarios: 3 (2.0 hours)
- **Total effort**: 8.0 hours (~1.0 days)

---

## Risk Assessment

### High-Priority Risks (Score ≥6)

| Risk ID | Category | Description                                                                                 | Probability | Impact | Score | Mitigation                                                                                                                   | Owner | Timeline   |
| ------- | -------- | ------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----- | ---------- |
| R-001   | TECH     | Proto vs. app-server transcript drift causing false parity alarms or missed regressions     | 2           | 3      | 6     | Generate paired fixtures from a single orchestrator script, apply placeholder sanitizers, and diff normalized payloads in CI | QA    | 2025-11-05 |
| R-002   | DATA     | Insufficient scenario coverage (tool calls, streaming, error envelopes) leaving parity gaps | 2           | 3      | 6     | Maintain parity scenario matrix tied to Epic 2 A/C, require diff harness to assert all required fixtures before merge        | QA    | 2025-11-06 |

### Medium-Priority Risks (Score 3-4)

| Risk ID | Category | Description                                                                     | Probability | Impact | Score | Mitigation                                                                                                                              | Owner  |
| ------- | -------- | ------------------------------------------------------------------------------- | ----------- | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R-003   | OPS      | CI runtime increase or flaky harness execution when comparing large transcripts | 2           | 2      | 4     | Gate parity diff behind focused npm script, shard by scenario, fail fast with deterministic fixtures                                    | DevOps |
| R-004   | TECH     | CLI/app-server version drift invalidating stored fixtures                       | 2           | 2      | 4     | Stamp fixtures with codex version + commit metadata and regenerate on version bumps; add check that generator output matches repo state | QA     |

### Low-Priority Risks (Score 1-2)

| Risk ID | Category | Description                                 | Probability | Impact | Score | Action  |
| ------- | -------- | ------------------------------------------- | ----------- | ------ | ----- | ------- |
| R-005   | PERF     | Occasional transcript sanitization overhead | 1           | 2      | 2     | Monitor |

### Risk Category Legend

- **TECH**: Technical/Architecture (flaws, integration, scalability)
- **SEC**: Security (access controls, auth, data exposure)
- **PERF**: Performance (SLA violations, degradation, resource limits)
- **DATA**: Data Integrity (loss, corruption, inconsistency)
- **BUS**: Business Impact (UX harm, logic errors, revenue)
- **OPS**: Operations (deployment, config, monitoring)

---

## Test Coverage Plan

### P0 (Critical) - Run on every commit

**Criteria**: Blocks parity gate + High risk (≥6) + No workaround

| Requirement                                             | Test Level             | Risk Link | Test Count | Owner | Notes                                                        |
| ------------------------------------------------------- | ---------------------- | --------- | ---------- | ----- | ------------------------------------------------------------ |
| Baseline chat parity (non-stream)                       | Contract / integration | R-001     | 1          | QA    | Diff proto vs. app fixtures for deterministic text responses |
| Streaming delta parity (SSE ordering, usage accounting) | Contract / integration | R-002     | 1          | QA    | Validate chunk ordering, finish reasons, token accounting    |
| Error + tool-call parity (400/429, function invocation) | Contract / integration | R-002     | 1          | QA    | Ensure envelopes, retry hints, tool payloads match           |

**Total P0**: 3 tests, 3.0 hours

### P1 (High) - Run on PR to main

**Criteria**: Important flows + Medium risk (3-4) + Shared components

| Requirement                        | Test Level  | Risk Link | Test Count | Owner | Notes                                              |
| ---------------------------------- | ----------- | --------- | ---------- | ----- | -------------------------------------------------- |
| Multi-turn conversation parity     | Integration | R-003     | 1          | Dev   | Validate conversation state + request IDs          |
| Usage/latency metrics parity       | Integration | R-004     | 1          | QA    | Compare metadata (usage totals, latency comments)  |
| Transcript regeneration smoke      | Unit/CLI    | R-001     | 1          | Dev   | Assert generator outputs match checked-in fixtures |
| CLI/App-server version enforcement | Unit        | R-004     | 1          | Dev   | Guard that version metadata mismatch fails fast    |

**Total P1**: 4 tests, 3.0 hours

### P2 (Medium) - Run nightly/weekly

**Criteria**: Secondary scenarios + Low risk (1-2) + Edge cases

| Requirement                                          | Test Level  | Risk Link | Test Count | Owner | Notes                                            |
| ---------------------------------------------------- | ----------- | --------- | ---------- | ----- | ------------------------------------------------ |
| Rare finish_reason variants (length, content_filter) | Integration | R-005     | 1          | QA    | Validate sanitizers and harness tolerance        |
| Transcript tooling error handling                    | Unit        | R-003     | 1          | Dev   | Ensure harness fails with actionable diagnostics |

**Total P2**: 2 tests, 1.5 hours

### P3 (Low) - Run on-demand

**Criteria**: Extended telemetry, exploratory comparisons

| Requirement                               | Test Level         | Test Count | Owner | Notes                                       |
| ----------------------------------------- | ------------------ | ---------- | ----- | ------------------------------------------- |
| Visual diff of human-readable transcripts | Manual exploratory | 1          | QA    | Run before major releases or schema changes |

**Total P3**: 1 tests, 0.5 hours

---

## Execution Order

### Smoke Tests (<5 min)

- [ ] Generator self-check (`npm run generate:transcripts -- --dry-run`) (1 min)
- [ ] Harness sanity diff on baseline scenario (2 min)

**Total**: 2 scenarios

### P0 Tests (<10 min)

- [ ] Non-stream baseline diff (API contract)
- [ ] Streaming delta diff (API contract)
- [ ] Error/tool-call diff (API contract)

### P1 Tests (~15 min)

- [ ] Multi-turn parity (integration)
- [ ] Usage/latency parity (integration)
- [ ] Transcript regeneration validation (unit/CLI)
- [ ] Version metadata guard (unit)

### P2 Tests (~20 min nightly)

- [ ] Rare finish_reason diff
- [ ] Harness error handling unit suite

### P3 Tests (on-demand)

- [ ] Manual visual diff review before cutover

---

## Tooling & Environment

- **Fixtures**: Extend `scripts/generate-chat-transcripts.mjs` to emit paired proto/app output under `test-results/chat-completions/{proto,app}`
- **Harness**: New `npm run test:parity` comparing serialized fixtures using stable JSON diff (strip metadata)
- **CI**: Run parity smoke on PR (P0/P1), full matrix nightly; fail build if diff baseline deviates
- **Dependencies**: App-server must start with `PROXY_USE_APP_SERVER=true`; proto shim available for legacy capture; ensure deterministic env vars (`FAKE_CODEX_*`)

---

## Effort Estimates

| Priority  | Test Count | Avg Hours/Test | Total Hours | Notes                 |
| --------- | ---------- | -------------- | ----------- | --------------------- |
| P0        | 3          | 1.0            | 3.0         | Core parity gate      |
| P1        | 4          | 0.75           | 3.0         | Supplemental coverage |
| P2        | 2          | 0.75           | 1.5         | Nightly regression    |
| P3        | 1          | 0.5            | 0.5         | Manual verification   |
| **Total** | **10**     | -              | **8.0**     | **~1.0 days**         |

### Prerequisites

**Test Data:**

- Deterministic fixture generator for proto & app outputs
- Placeholder sanitizers for IDs, timestamps, tool handles

**Tooling:**

- JSON diff utility (e.g., custom script or Jest snapshot) tolerant of ordering
- Harness logger capturing mismatches with actionable context

**Environment:**

- Ability to launch app-server inline via `startServer`
- CI agent with Codex CLI and feature flag toggles available

---

## Quality Gate Criteria

- 100% pass rate on P0 parity suites
- All risks with score ≥6 mitigated or waived before merge
- Version metadata mismatch blocks PR until fixtures regenerated
- Parity diff harness integrated into CI with artifact output for review

---

## Mitigation Plans

### R-001

- **Mitigation Strategy:** Single orchestrator script captures proto and app outputs back-to-back, sanitizes dynamic fields, and stores metadata for diff harness
- **Owner:** QA
- **Timeline:** 2025-11-05
- **Verification:** CI parity job passes with fresh fixtures; harness logs include backend tags

### R-002

- **Mitigation Strategy:** Maintain scenario checklist tied to Epic 2 A/C; parity harness asserts presence of required fixture files prior to diff execution
- **Owner:** QA
- **Timeline:** 2025-11-06
- **Verification:** Harness fails if required fixture missing; review checklist before release

### R-003

- **Mitigation Strategy:** Shard parity diff execution and cap fixture size; monitor duration via CI timing dashboard
- **Owner:** DevOps
- **Timeline:** 2025-11-07
- **Verification:** CI runtime < 5 min for parity stage over three consecutive runs

### R-004

- **Mitigation Strategy:** Embed Codex CLI version/commit metadata inside fixtures; parity job compares metadata to repo configuration and fails when stale
- **Owner:** Dev
- **Timeline:** 2025-11-05
- **Verification:** Intentional version bump triggers expected failure until fixtures regenerated

### R-005

- **Mitigation Strategy:** Track sanitization cost in profiling logs; optimize only if runtime exceeds 30s per suite
- **Owner:** QA
- **Timeline:** Monitor during nightly runs
- **Verification:** Profiling shows sanitization step <10% of suite time

---

## Assumptions and Dependencies

### Assumptions

1. App-server backend exposes identical JSON-RPC schema described in Epic 2
2. Proto shim remains available for baseline comparison during migration
3. CI agents can execute Codex CLI without external network dependencies

### Dependencies

1. Extended transcript generator merged before harness work (2025-11-04)
2. Diff harness implementation complete before Epic 2 story work begins (2025-11-06)

### Risks to Plan

- **Risk:** Upstream CLI refactors change response formatting
  - **Impact:** Harness requires sanitizer updates; diff noise increases
  - **Contingency:** Treat CLI changelog as trigger for fixture regeneration review

---

## Approval

- [ ] Product Manager: \***\*\_\_\_\_\*\*** Date: \***\*\_\_\_\_\*\***
- [ ] Tech Lead: \***\*\_\_\_\_\*\*** Date: \***\*\_\_\_\_\*\***
- [ ] QA Lead: \***\*\_\_\_\_\*\*** Date: \***\*\_\_\_\_\*\***

**Comments:**

---

## Appendix

### Knowledge Base References

- `risk-governance.md`
- `probability-impact.md`
- `test-levels-framework.md`
- `test-priorities-matrix.md`

### Related Documents

- PRD: docs/PRD.md
- Epic: docs/epics.md
- Architecture: docs/architecture.md
- Tech Spec: docs/app-server-migration/codex-completions-api-migration.md

---

**Generated by**: BMad TEA Agent - Test Architect Module
**Workflow**: `bmad/bmm/testarch/test-design`
**Version**: 4.0 (BMad v6)
