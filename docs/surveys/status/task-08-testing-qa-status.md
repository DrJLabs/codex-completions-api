# Task 08 – Testing & QA Posture
# Source: docs/surveys/task-08-testing-and-qa-posture.md

## Work done
- CI now uploads Playwright and smoke artifacts, enforces a clean workspace after tests, and runs `jsonrpc:verify`; `verify:all` includes the schema check.
- Playwright config emits HTML + blob reports in CI; new integration coverage for security hardening, rate-limit parity (including responses), and responses flag gating.
- Added unit coverage for `assertSecureConfig` and expanded JSON-RPC schema tests.

## Gaps
- Coverage gating remains optional; no fast/slow tagging or documented test selection policy.
- Toggle surfaces are mostly covered (models protection, responses flags, worker restart/backoff); SSE metrics are asserted for series presence but not for post‑stream increments.
- Live E2E scheduling/rotation policy and artifact retention guidance are not documented.

## Plan / Acceptance Criteria & Tests
- AC1: Add optional/thresholded coverage step in CI or document explicit decision to skip; introduce test tags for slow/live suites. Test: CI job running coverage with a threshold or a doc explaining opt-out plus tag-aware scripts.
- AC2: Add focused tests for model protection, SSE metrics, and worker restart guards. Test: Vitest/Playwright cases covering `PROXY_PROTECT_MODELS=true`, stream metrics presence, and restart counter behavior.
- AC3: Document test matrix (unit/integration/e2e/live/smoke), selection policy, and artifact retention. Test: doc lint plus CI link check to the new guidance.
