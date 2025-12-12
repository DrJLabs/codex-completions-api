# Task 11 – Documentation IA & Drift
# Source: docs/surveys/task-11-documentation-ia-and-drift.md

## Work done
- `docs/README.md` is now the canonical public index with explicit pointers to PRD/architecture/response docs and lint guidance; README reflects accurate defaults (sandbox read-only, auth for test/usage, responses route, observability).
- Long-horizon doc set added (`docs/codex-longhorizon/**`) with an index of task docs and backlog/progress tracking.
- Architecture tech stack updated to Express 4.21.x in `docs/bmad/architecture.md`; install path clarified via archival of the systemd installer.

## Gaps
- Canonical vs archive status is still implicit across many docs; no generated config reference or link-check/lint in CI for the broader doc set.
- Proto policy, ForwardAuth canonicalization, and responses exposure policy are not consolidated into the doc IA.
- Doc drift checks (broken links, status labels) are not automated beyond `lint:runbooks`.

## Plan / Acceptance Criteria & Tests
- AC1: Add a docs index with status labels (canonical/archived) and ensure PRD/architecture links resolve consistently. Test: link-check CI job and doc lint passing with new status metadata.
- AC2: Consolidate policy decisions (proto stance, ForwardAuth canonical file, responses flag defaults) into PRD/architecture and README. Test: doc updates plus CI link check referencing the new sections.
- AC3: Generate a config/env reference from `src/config/index.js` (or maintain a single source) and enforce doc lint/link check in CI. Test: CI step fails on missing references; generated doc committed and verified.
