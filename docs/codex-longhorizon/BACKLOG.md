# Long-Horizon Backlog

Each item lists an id, source documents, scope tags, acceptance criteria, verification method, and dependencies/ordering. Items marked PROPOSED derive from survey findings where explicit criteria were absent.

## P0 — Security & Correctness

| ID | Source docs | Scope tags | Acceptance criteria | Verification | Dependencies / ordering |
| --- | --- | --- | --- | --- | --- |
| LH-P0-01 | Task 12 §3 P0-1; Task 09; Task 02 | api, security, auth | `/v1/usage` and `/v1/usage/raw` require bearer (or explicit edge-only guard) in-app; unauth requests 401 with `WWW-Authenticate: Bearer`; behavior with bearer unchanged; docs note protection + dev override | Integration test hitting usage with/without bearer; manual curl to confirm headers; doc updates | None; coordinate with doc drift item |
| LH-P0-02 | Task 12 §3 P0-2; Task 09 | security, config, test-endpoints | `__test/*` gated by bearer even when enabled; default allowlist limited to loopback; flags clearly documented; tests cover enabled/disabled states | Integration test for `__test/*` without/with bearer and remote vs loopback host; doc update in README/PRD | None |
| LH-P0-03 | Task 12 §3 P0-3; Task 13; Task 02 | api, security, rate-limit | Rate-limit middleware applies to `/v1/responses` (and other write endpoints) when enabled; behavior consistent with chat/completions; docs reflect scope | Integration test toggling rate-limit flag and asserting 429 across chat/completions/responses; config unit test for guarded paths | Depends on shared rate-limit helper, no external deps |
| LH-P0-04 | Task 12 §3 P0-4; Task 09 | security, config | In non-dev/prod modes startup fails fast when API key missing/default, test endpoints enabled, or metrics exposed without auth (if policy adopted); error messages guide operator; docs/runbooks updated | Automated startup check (env matrix) expecting non-zero exit; unit test for config guard where feasible; doc/runbook changes | None; ensure CI/dev overrides documented |
| LH-P0-05 | Task 12 §3 P0-5; Task 09 | ops, security | Explicit HOST/bind config; default binds loopback; actual bind address logged; compose/systemd docs reflect required overrides | Unit/config test for host default; manual/server log check; doc updates | None |

## P1 — Contract Stability, Docs, and Tooling

| ID | Source docs | Scope tags | Acceptance criteria | Verification | Dependencies / ordering |
| --- | --- | --- | --- | --- | --- |
| LH-P1-01 | Task 12 §3 P1-1; Task 05 | contract, tooling, tests | Single authoritative JSON-RPC schema workflow (local TS vs upstream export) chosen and documented; alternative removed; `npm run jsonrpc:schema` and `npm run jsonrpc:bundle` are idempotent (`git diff --exit-code`); docs align with method/notification set and field behaviors | Run schema/bundle commands then `git diff --exit-code`; CI wiring check; doc update | None |
| LH-P1-02 | Task 12 §3 P1-2; Task 11; Task 13 | docs, config, api | Canonical doc index/IA adopted; drift items resolved (sandbox defaults, test route auth, usage protection, responses support, proto policy, Express version); README/PRD/AGENTS updated; doc lint/governance in place (lint:runbooks or similar) | Run doc lint (`npm run lint:runbooks` if available) and manual review of updated docs; confirm README lists `/v1/responses` + proto stance | Should follow completion of P0 auth/rate-limit decisions |
| LH-P1-03 | Task 12 §3 P1-3; Task 08 | tests, ci, tooling | CI uploads Playwright/smoke artifacts; PRs fail when tests regenerate goldens unexpectedly (“workspace dirty” guard); guidance for reviewing artifacts documented | Local dry run: execute test suite and assert clean `git status`; verify artifact output path; CI config review | None |
| LH-P1-04 | Task 13 | api, config, docs | Responses exposure policy implemented (feature flag or documented default); default state explicit; tests cover enabled/disabled; README/PRD reflect scope and flag | Integration test toggling flag and asserting route availability; doc updates | After LH-P0-03 (rate-limit) for consistent behavior |

## P2 — Observability & Deployment Hygiene

| ID | Source docs | Scope tags | Acceptance criteria | Verification | Dependencies / ordering |
| --- | --- | --- | --- | --- | --- |
| LH-P2-01 | Task 12 §3 P2-1; Task 07 | observability, perf | Streaming metrics added: TTFB, stream duration, abnormal termination counters (client abort/upstream abort/worker crash), worker readiness/restart counters; metric names/labels documented and low-cardinality | Unit/integration scraping `/metrics` for new series; doc/runbook updates describing names/labels | After P0 auth so metrics exposure policy is set |
| LH-P2-02 | Task 12 §3 P2-2; Task 07 | observability, tracing | Optional OTEL tracing for inbound + upstream with log correlation; disabled by default; minimal config documented; safe for local dev | Manual/local run with OTEL flag and check for emitted traces/log correlation; doc updates | After P2-01 metrics to reuse label conventions |
| LH-P2-03 | Task 12 §3 P2-3; Task 06 | deployment, docs | Legacy deployment path (installer/systemd variant) either archived or documented as secondary; Compose declared canonical; docs updated to reflect decision; redundant ForwardAuth entrypoints resolved | Doc review; removal/archive PR; smoke of canonical compose path | After P1 docs alignment to avoid conflicting guidance |
