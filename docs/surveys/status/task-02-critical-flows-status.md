# Task 02 – Critical Request/Response Flows
# Source: docs/surveys/task-02-critical-request-response-flows_2025-12-08.md

## Work done
- CORS now runs before OPTIONS short-circuit so preflights carry headers; preflight logging added in `src/app.js`.
- Token-bucket rate limit now guards `/v1/responses` alongside chat/completions, with integration coverage.
- `/v1/usage*` now requires bearer auth; `__test/*` requires bearer + loopback by default; `/v1/responses` can be feature-flagged via `PROXY_ENABLE_RESPONSES`.
- Host binding is explicit (`PROXY_HOST`) and startup performs production security checks.
- `/v1/responses` now uses `requireWorkerReady` (HEAD + POST) with integration coverage for 503 while the worker is unready and 200 after readiness.
- Legacy `/v1/completions` shim is covered for auth + rate-limit parity (401 without bearer; 429 on second request) and non-stream contract in integration tests.
- CORS preflights for `/v1/chat/completions` and `/v1/responses` are now asserted in integration tests (allowed origin/headers/methods).

## Gaps
- None identified for AC1–AC3; keep monitoring readiness gating and CORS behavior if configuration flags change.

## Plan / Acceptance Criteria & Tests
- AC1: Apply the readiness guard to `/v1/responses` (and HEAD alias). Test layer: integration. Implementation: mirror `requireWorkerReady` usage from `src/routes/chat.js`; add test that simulates unready worker (use fake worker handshake off) returning 503 and ready returning 200.
- AC2: Document and regression-test the `/v1/completions` shim flow (auth, rate-limit, output shape) or explicitly deprecate it. Test layer: integration. Implementation: add doc note + test hitting `/v1/completions` with/without bearer and asserting same rate-limit/auth/error shapes as chat.
- AC3: Add CORS preflight tests for chat and responses ensuring allowed origins/headers are present after OPTIONS. Test layer: integration. Implementation: Vitest hitting OPTIONS /v1/chat/completions and /v1/responses with origin header, asserting 204 + CORS headers.
