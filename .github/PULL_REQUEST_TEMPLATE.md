## Summary

- Purpose: <!-- brief purpose of the PR -->
- Scope: <!-- files/areas touched -->

## Change Details

- Key changes:
  - Thin bootstrap `server.js` (no inline POST/spawn)
  - Add `src/routes/usage.js`; mount in `src/app.js`
  - Add `tests/integration/access-log.int.test.js` (req_id/route/status/dur_ms + X-Request-Id)
  - Update docs (architecture logging + modularization plan)

## Verification

- Integration: <!-- paste summary, e.g., 23 passed, 2 skipped -->
- E2E: <!-- SSE parity green? -->
- Smoke: <!-- optional -->

## References

- Story: docs/bmad/stories/1.6.phase-5-cleanup-and-logging.md
- Gate: docs/bmad/qa/gates/1.6-phase-5-cleanup-and-logging.yml
- Risk: docs/bmad/qa/assessments/1.6-risk-20250912.md
- Test Design: docs/bmad/qa/assessments/1.6-test-design-20250912.md
- Trace: docs/bmad/qa/assessments/1.6-trace-20250912.md
- NFR: docs/bmad/qa/assessments/1.6-nfr-20250912.md
- Closed Issue: docs/bmad/qa/issues/2025-09-12-observability-log-assertions.md

## Checklist

- [ ] Tests pass locally (integration/E2E)
- [ ] No behavior/shape/header regressions
- [ ] Docs updated
