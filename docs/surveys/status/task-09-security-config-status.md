# Task 09 – Security & Configuration Hygiene
# Source: docs/surveys/task-09-security-and-config-hygiene.md

## Work done
- Added `assertSecureConfig` fail-fast for prod-like runs (API key required, test endpoints and insecure metrics blocked); host binding defaults to loopback with logged address.
- Usage routes now enforce bearer auth; `__test/*` requires bearer + loopback by default; rate limiting includes `/v1/responses`.
- New toggles (`PROXY_TEST_ALLOW_REMOTE`, `PROXY_USAGE_ALLOW_UNAUTH`, `PROXY_ENABLE_RESPONSES`) plus documentation; README reflects auth defaults and host binding. Integration tests cover usage/test auth and rate-limit parity.
- CORS order fixed to ensure preflights carry headers; PROXY_HOST added to compose for explicit exposure.

## Gaps
- No key-rotation/multi-key support; CORS still defaults to allow-all with credentials, which is risky for prod unless constrained by edge.
- ForwardAuth duplication persists; remaining security work is tightening prod CORS defaults/edge-only posture and documenting rotation/hardening guidance.
- Docs/runbooks still need a hardened configuration checklist (models protection, metrics token, PROXY_HOST guidance).

## Plan / Acceptance Criteria & Tests
- AC1: Add support (or clear guidance) for rotated/multi API keys and document rotation steps. Test: unit/integration verifying multiple keys or doc checklist if intentionally single-key.
- AC2: Tighten CORS defaults for prod (or enforce edge-only) and add tests for metrics auth denial and ForwardAuth canonicalization. Test: integration asserting metrics 403 without token/non-loopback; doc/manifest references only canonical ForwardAuth.
- AC3: Publish a security hardening checklist covering host binding, models protection, metrics token, test endpoints, and responses flag. Test: doc lint and CI link check; optional script to validate required envs in prod mode.
