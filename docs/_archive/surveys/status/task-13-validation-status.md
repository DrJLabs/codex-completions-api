# Task 13 – Validation Pass & Errata
# Source: docs/surveys/task-13-validation-pass-and-errata.md

## Work done
- Clarified `/v1/responses` status: added `PROXY_ENABLE_RESPONSES` flag with tests, updated README to list the route, and extended rate limiting to cover it.
- README and docs now reflect Express 4.21.x and responses availability; instrumentation tags responses streams with correct route/mode for metrics/tracing.
- Responses parity confusion reduced by documenting auth defaults and adding a flag-driven disable path.

## Gaps
- Proto retirement vs continued use in tests remains unresolved; policy not documented.
- README/docs now mention responses but deployment exposure policy (enable/disable per environment) is not yet codified.
- No explicit errata entry for remaining doc drift items beyond responses/rate-limit fixes.

## Plan / Acceptance Criteria & Tests
- AC1: Decide and document proto support policy; adjust tests or docs accordingly. Test: either migrate remaining proto-based tests to JSON-RPC shims or add doc note plus CI tag for proto-only suites.
- AC2: Define environment-specific default for `PROXY_ENABLE_RESPONSES` (dev/prod) and add a smoke test to assert the chosen default. Test: integration checking default exposure per env vars.
- AC3: Track errata resolutions in a single log (or update Task 12 backlog) and ensure README/PRD reflect final decisions. Test: doc lint/link check referencing the errata/log.
